import * as pdfjsLib from "../../vendor/pdfjs/build/pdf.mjs";

const params = new URLSearchParams(location.search);
const sourceUrl = params.get("src") || "";
const statusNode = document.querySelector("#status");
const sourceNode = document.querySelector("#source-url");
const pagesNode = document.querySelector("#pages");
const zoomLabel = document.querySelector("#zoom-label");

let pdfDocument = null;
let pdfBuffer = null;
let currentPdfUrl = "";
let scale = 1.25;
let renderRun = 0;

pdfjsLib.GlobalWorkerOptions.workerSrc = chrome.runtime.getURL(
  "vendor/pdfjs/build/pdf.worker.mjs"
);

sourceNode.textContent = sourceUrl;
document.querySelector("#reload").addEventListener("click", loadPdf);
document.querySelector("#options").addEventListener("click", () => chrome.runtime.openOptionsPage());
document.querySelector("#zoom-in").addEventListener("click", () => changeZoom(0.15));
document.querySelector("#zoom-out").addEventListener("click", () => changeZoom(-0.15));

window.LLMSelectionTranslator?.init();
loadPdf();

async function loadPdf() {
  renderRun += 1;
  pagesNode.textContent = "";
  setStatus("Locating PDF...");

  if (!sourceUrl) {
    setStatus("Missing PDF URL.", true);
    return;
  }

  try {
    const pdf = await fetchPdfPayload(sourceUrl);
    pdfBuffer = pdf.buffer;
    currentPdfUrl = pdf.url;
    sourceNode.textContent = currentPdfUrl === sourceUrl ? sourceUrl : `${sourceUrl} -> ${currentPdfUrl}`;

    setStatus("Loading PDF renderer...");
    pdfDocument = await pdfjsLib.getDocument({
      data: pdfBuffer.slice(0),
      cMapUrl: chrome.runtime.getURL("vendor/pdfjs/cmaps/"),
      cMapPacked: true,
      standardFontDataUrl: chrome.runtime.getURL("vendor/pdfjs/standard_fonts/"),
      enableXfa: true,
      isEvalSupported: false
    }).promise;

    await renderDocument();
  } catch (error) {
    setStatus(error.message || String(error), true);
  }
}

async function renderDocument() {
  if (!pdfDocument) {
    return;
  }

  const runId = ++renderRun;
  pagesNode.textContent = "";
  updateZoomLabel();
  setStatus(`Rendering 1 / ${pdfDocument.numPages}...`);

  for (let pageNumber = 1; pageNumber <= pdfDocument.numPages; pageNumber += 1) {
    if (runId !== renderRun) {
      return;
    }
    await renderPage(pageNumber);
    setStatus(`Rendering ${Math.min(pageNumber + 1, pdfDocument.numPages)} / ${pdfDocument.numPages}...`);
  }

  setStatus("");
}

async function renderPage(pageNumber) {
  const page = await pdfDocument.getPage(pageNumber);
  const viewport = page.getViewport({ scale });
  const outputScale = window.devicePixelRatio || 1;

  const pageNode = document.createElement("section");
  pageNode.className = "pdf-page";
  pageNode.style.width = `${Math.floor(viewport.width)}px`;
  pageNode.style.height = `${Math.floor(viewport.height)}px`;
  pageNode.style.setProperty("--scale-factor", String(scale));
  pageNode.dataset.pageNumber = String(pageNumber);

  const pageLabel = document.createElement("div");
  pageLabel.className = "page-label";
  pageLabel.textContent = String(pageNumber);

  const canvas = document.createElement("canvas");
  canvas.className = "canvas-layer";
  canvas.width = Math.floor(viewport.width * outputScale);
  canvas.height = Math.floor(viewport.height * outputScale);
  canvas.style.width = `${Math.floor(viewport.width)}px`;
  canvas.style.height = `${Math.floor(viewport.height)}px`;

  const textLayerNode = document.createElement("div");
  textLayerNode.className = "textLayer";
  textLayerNode.style.width = `${Math.floor(viewport.width)}px`;
  textLayerNode.style.height = `${Math.floor(viewport.height)}px`;
  textLayerNode.style.setProperty("--scale-factor", String(scale));

  pageNode.append(canvas, textLayerNode, pageLabel);
  pagesNode.appendChild(pageNode);

  const context = canvas.getContext("2d", { alpha: false });
  await page.render({
    canvasContext: context,
    viewport,
    transform: outputScale !== 1 ? [outputScale, 0, 0, outputScale, 0, 0] : null
  }).promise;

  const textContent = await page.getTextContent();
  const textLayer = new pdfjsLib.TextLayer({
    textContentSource: textContent,
    container: textLayerNode,
    viewport
  });
  await textLayer.render();
}

async function changeZoom(delta) {
  scale = clamp(Number((scale + delta).toFixed(2)), 0.6, 2.6);
  if (pdfDocument) {
    await renderDocument();
  } else {
    updateZoomLabel();
  }
}

function updateZoomLabel() {
  zoomLabel.textContent = `${Math.round((scale / 1.25) * 100)}%`;
}

async function fetchPdfPayload(url, visited = new Set(), depth = 0) {
  const normalizedUrl = normalizeUrl(url);
  if (!normalizedUrl) {
    throw new Error("Invalid PDF URL.");
  }
  if (visited.has(normalizedUrl)) {
    throw new Error("Skipped a repeated PDF candidate URL.");
  }
  if (depth > 5) {
    throw new Error("Could not locate the real PDF file from the entry page.");
  }

  visited.add(normalizedUrl);
  setStatus(`Reading: ${normalizedUrl}`);

  const response = await fetch(normalizedUrl, {
    credentials: "include",
    redirect: "follow"
  });
  if (!response.ok) {
    throw new Error(`PDF request failed (${response.status}).`);
  }

  const finalUrl = response.url || normalizedUrl;
  const contentType = response.headers.get("content-type") || "";
  const buffer = await response.arrayBuffer();

  if (isPdfPayload(buffer, contentType)) {
    return { buffer, url: finalUrl };
  }

  const html = decodeResponseText(buffer, contentType);
  const candidates = findPdfCandidates(html, finalUrl);
  if (!candidates.length) {
    throw new Error("The current URL returned a web page, not a PDF, and no readable PDF link was found in that page.");
  }

  let lastError;
  for (const candidate of candidates) {
    if (visited.has(candidate)) {
      continue;
    }
    try {
      return await fetchPdfPayload(candidate, visited, depth + 1);
    } catch (error) {
      lastError = error;
    }
  }

  throw lastError || new Error("Found PDF candidate links, but none could be read.");
}

function isPdfPayload(buffer, contentType) {
  const header = bytesToBinary(new Uint8Array(buffer.slice(0, 8)));
  return header.startsWith("%PDF-") || /application\/pdf/i.test(contentType);
}

function looksLikePdfUrl(url) {
  try {
    const parsed = new URL(url);
    const pathname = decodeURIComponent(parsed.pathname).toLowerCase();
    return pathname.endsWith(".pdf") || pathname.includes(".pdf/");
  } catch {
    return /\.pdf(?:$|[?#/])/i.test(url);
  }
}

function findPdfCandidates(html, baseUrl) {
  const candidates = new Set();
  const addCandidate = (value) => {
    for (const decoded of decodeVariants(value)) {
      const cleaned = decoded
        .replace(/&amp;/g, "&")
        .replace(/^['"\s]+|['"\s>);]+$/g, "");
      if (!cleaned) {
        continue;
      }
      try {
        const absolute = new URL(cleaned, baseUrl).href;
        if (looksLikePdfUrl(absolute)) {
          candidates.add(absolute);
        }
      } catch {
        continue;
      }
    }
  };

  try {
    const doc = new DOMParser().parseFromString(html, "text/html");
    for (const selector of ["a[href]", "iframe[src]", "embed[src]", "object[data]", "source[src]", "meta[content]"]) {
      for (const node of doc.querySelectorAll(selector)) {
        addCandidate(node.getAttribute("href") || node.getAttribute("src") || node.getAttribute("data") || node.getAttribute("content") || "");
      }
    }
  } catch {
    // Raw text scanning below handles malformed HTML.
  }

  for (const text of decodeVariants(`${baseUrl}\n${html}`)) {
    scanPdfUrls(text, baseUrl).forEach((candidate) => candidates.add(candidate));
  }

  return Array.from(candidates);
}

function scanPdfUrls(text, baseUrl) {
  const found = new Set();
  let baseProtocol = "https:";
  try {
    baseProtocol = new URL(baseUrl).protocol;
  } catch {
    // Use https for protocol-relative URLs if the base is invalid.
  }
  const absolutePattern = /(?:https?:)?\/\/[^\s"'<>\\]+?\.pdf(?:[^\s"'<>\\)]*)?/gi;
  const relativePattern = /(?:href|src|data|url|file|pdf)\s*[:=]\s*["']([^"']+?\.pdf(?:[^"']*)?)["']/gi;

  for (const pattern of [absolutePattern, relativePattern]) {
    let match;
    while ((match = pattern.exec(text))) {
      const raw = match[1] || match[0];
      const normalized = raw.startsWith("//") ? `${baseProtocol}${raw}` : raw;
      try {
        found.add(new URL(normalized.replace(/&amp;/g, "&"), baseUrl).href);
      } catch {
        continue;
      }
    }
  }

  return Array.from(found).filter(looksLikePdfUrl);
}

function decodeVariants(value) {
  const variants = new Set([String(value || "")]);
  let current = String(value || "");
  for (let index = 0; index < 4; index += 1) {
    variants.add(current.replace(/\\\//g, "/").replace(/\\u002[fF]/g, "/"));
    try {
      const decoded = decodeURIComponent(current);
      if (decoded === current) {
        break;
      }
      variants.add(decoded);
      current = decoded;
    } catch {
      break;
    }
  }
  return Array.from(variants);
}

function decodeResponseText(buffer, contentType) {
  const charset = /\bcharset=([^;]+)/i.exec(contentType)?.[1]?.trim();
  const bytes = new Uint8Array(buffer);
  if (charset) {
    try {
      return new TextDecoder(charset).decode(bytes);
    } catch {
      // Fall through to UTF-8.
    }
  }
  return new TextDecoder("utf-8").decode(bytes);
}

function normalizeUrl(url) {
  try {
    return new URL(url, location.href).href;
  } catch {
    return "";
  }
}

function bytesToBinary(bytes) {
  let output = "";
  const chunkSize = 0x8000;
  for (let index = 0; index < bytes.length; index += chunkSize) {
    output += String.fromCharCode(...bytes.subarray(index, index + chunkSize));
  }
  return output;
}

function setStatus(message, isError = false) {
  statusNode.textContent = message;
  statusNode.classList.toggle("error", isError);
  statusNode.hidden = !message;
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}
