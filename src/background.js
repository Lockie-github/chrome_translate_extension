import { DEFAULT_SETTINGS, getSettings } from "./shared/settings.js";

chrome.runtime.onInstalled.addListener(async () => {
  const current = await chrome.storage.local.get(DEFAULT_SETTINGS);
  await chrome.storage.local.set({ ...DEFAULT_SETTINGS, ...current });

  chrome.contextMenus.create({
    id: "translate-selection",
    title: "翻译选中文本",
    contexts: ["selection"]
  });

  chrome.contextMenus.create({
    id: "open-pdf-reader",
    title: "用划词翻译阅读器打开当前 PDF",
    contexts: ["page", "link"]
  });
});

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  if (info.menuItemId === "translate-selection" && info.selectionText) {
    const translated = await translateText(info.selectionText);
    await chrome.storage.local.set({
      lastContextMenuTranslation: {
        source: info.selectionText,
        result: translated,
        createdAt: Date.now()
      }
    });
    if (tab?.id && chrome.action.openPopup) {
      try {
        await chrome.action.openPopup();
      } catch {
        await chrome.action.setBadgeText({ text: "新", tabId: tab.id });
      }
    }
    return;
  }

  if (info.menuItemId === "open-pdf-reader") {
    const url = info.linkUrl || tab?.url || "";
    if (url) {
      await openPdfReader(url, tab?.id);
    }
  }
});

chrome.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
  if (changeInfo.status !== "loading" || !tab.url) {
    return;
  }

  const settings = await getSettings();
  if (!settings.autoOpenPdfReader || !looksLikePdfUrl(tab.url)) {
    return;
  }

  const readerUrl = chrome.runtime.getURL(
    `src/pdf/pdf-reader.html?src=${encodeURIComponent(tab.url)}`
  );
  if (tab.url.startsWith(chrome.runtime.getURL("src/pdf/pdf-reader.html"))) {
    return;
  }

  await chrome.tabs.update(tabId, { url: readerUrl });
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type === "TRANSLATE_TEXT") {
    translateText(message.text)
      .then((result) => sendResponse({ ok: true, result }))
      .catch((error) => sendResponse({ ok: false, error: error.message }));
    return true;
  }

  if (message?.type === "TRANSLATE_BILINGUAL") {
    translateBilingual(message.text)
      .then((result) => sendResponse({ ok: true, result }))
      .catch((error) => sendResponse({ ok: false, error: error.message }));
    return true;
  }

  if (message?.type === "OPEN_PDF_READER") {
    openPdfReader(message.url, sender.tab?.id)
      .then(() => sendResponse({ ok: true }))
      .catch((error) => sendResponse({ ok: false, error: error.message }));
    return true;
  }

  return false;
});

async function openPdfReader(url, tabId) {
  const readerUrl = chrome.runtime.getURL(
    `src/pdf/pdf-reader.html?src=${encodeURIComponent(url)}`
  );

  if (tabId) {
    await chrome.tabs.update(tabId, { url: readerUrl });
  } else {
    await chrome.tabs.create({ url: readerUrl });
  }
}

function looksLikePdfUrl(url) {
  try {
    const parsed = new URL(url);
    if (parsed.protocol.startsWith("chrome-extension")) {
      return false;
    }
    const pathname = decodeURIComponent(parsed.pathname).toLowerCase();
    const fullUrl = decodeURIComponent(url).toLowerCase();
    return (
      pathname.endsWith(".pdf") ||
      pathname.includes(".pdf/") ||
      fullUrl.includes(".pdf") ||
      /\/datasheet\//i.test(pathname)
    );
  } catch {
    return false;
  }
}

async function translateText(text) {
  const cleanText = String(text || "").trim();
  if (!cleanText) {
    throw new Error("没有可翻译的文本。");
  }

  const settings = await getSettings();
  validateSettings(settings);
  return requestModel(settings, [
    {
      role: "system",
      content: settings.systemPrompt
    },
    {
      role: "user",
      content: `Target language: ${settings.targetLanguage}\n\nText:\n${cleanText}`
    }
  ]);
}

async function translateBilingual(text) {
  const cleanText = String(text || "").trim();
  if (!cleanText) {
    throw new Error("没有可翻译的文本。");
  }

  const settings = await getSettings();
  validateSettings(settings);
  const sourceLanguage = detectSourceLanguage(cleanText);
  const targetLanguage = sourceLanguage === "zh" ? "English" : "Simplified Chinese";
  const result = await requestModel(settings, [
    {
      role: "system",
      content: [
        "You are a concise Chinese-English bilingual dictionary.",
        `The source language is ${sourceLanguage === "zh" ? "Chinese" : "English"}. Translate it into ${targetLanguage}.`,
        "Classify a single lexical word or short Chinese lexical item as word.",
        "Classify phrases, idioms, questions, clauses, and sentences as sentence.",
        "If the input contains multiple non-empty lines, return one sentence result and translate every line in order, preserving the line breaks.",
        "For a word, group several common meanings by part of speech. Use Chinese part-of-speech labels such as 名词、动词、形容词、副词、介词、代词、连词、感叹词、短语.",
        "For a sentence, return one natural translation of the complete meaning.",
        "The response must be valid JSON. Escape line breaks inside JSON string values as \\n and do not use trailing commas.",
        "Do not include pronunciation, phonetics, examples, notes, Markdown, or any text outside the JSON object.",
        'Return exactly one of these JSON shapes: {"kind":"word","entries":[{"partOfSpeech":"名词","meanings":["meaning 1","meaning 2"]}]} or {"kind":"sentence","translation":"complete translation"}.'
      ].join(" ")
    },
    {
      role: "user",
      content: cleanText
    }
  ]);

  return parseBilingualResult(result, cleanText, sourceLanguage);
}

async function requestModel(settings, messages) {
  const headers = {
    "content-type": "application/json"
  };

  if (settings.authType === "bearer" && settings.apiKey) {
    headers.authorization = `Bearer ${settings.apiKey}`;
  } else if (settings.authType === "x-api-key" && settings.apiKey) {
    headers["x-api-key"] = settings.apiKey;
  } else if (settings.authType === "custom" && settings.customAuthHeader && settings.apiKey) {
    headers[settings.customAuthHeader] = settings.apiKey;
  }

  const response = await fetch(settings.apiUrl, {
    method: "POST",
    headers,
    body: JSON.stringify({
      model: settings.model,
      temperature: Number(settings.temperature ?? 0.2),
      messages
    })
  });

  const payloadText = await response.text();
  let payload;
  try {
    payload = payloadText ? JSON.parse(payloadText) : {};
  } catch {
    payload = { raw: payloadText };
  }

  if (!response.ok) {
    const reason = payload?.error?.message || payload?.message || payloadText || response.statusText;
    throw new Error(`API 请求失败 (${response.status}): ${reason}`);
  }

  const result = readModelText(payload);
  if (!result) {
    throw new Error("API 响应里没有找到翻译文本。请确认接口兼容 OpenAI Chat Completions。");
  }
  return result.trim();
}

function detectSourceLanguage(text) {
  return /[\u3400-\u9fff]/u.test(text) ? "zh" : "en";
}

function parseBilingualResult(rawResult, source, sourceLanguage) {
  const start = rawResult.indexOf("{");
  const end = rawResult.lastIndexOf("}");
  if (start === -1 || end <= start) {
    throw new Error("模型没有返回有效的词典格式，请重试。");
  }

  const parsed = parseModelJson(rawResult.slice(start, end + 1));
  if (!parsed) {
    throw new Error("模型返回的词典格式无法解析，请重试。");
  }

  const base = {
    source,
    direction: sourceLanguage === "zh" ? "zh-en" : "en-zh"
  };
  if (parsed?.kind === "sentence" && typeof parsed.translation === "string") {
    const translation = parsed.translation.trim();
    if (translation) {
      return { ...base, kind: "sentence", translation };
    }
  }

  if (parsed?.kind === "word" && Array.isArray(parsed.entries)) {
    const entries = parsed.entries
      .map((entry) => ({
        partOfSpeech: String(entry?.partOfSpeech || "释义").trim(),
        meanings: Array.isArray(entry?.meanings)
          ? entry.meanings.map((meaning) => String(meaning).trim()).filter(Boolean)
          : []
      }))
      .filter((entry) => entry.meanings.length > 0);
    if (entries.length > 0) {
      return { ...base, kind: "word", entries };
    }
  }

  throw new Error("模型返回的翻译内容不完整，请重试。");
}

function parseModelJson(jsonText) {
  try {
    return JSON.parse(jsonText);
  } catch {
    // Some compatible models emit literal line breaks in JSON strings or trailing commas.
  }

  const repaired = escapeJsonStringControls(jsonText).replace(/,\s*([}\]])/g, "$1");
  try {
    return JSON.parse(repaired);
  } catch {
    return null;
  }
}

function escapeJsonStringControls(jsonText) {
  let result = "";
  let inString = false;
  let escaped = false;

  for (const character of jsonText) {
    if (!inString) {
      result += character;
      if (character === '"') {
        inString = true;
      }
      continue;
    }

    if (escaped) {
      result += character;
      escaped = false;
    } else if (character === "\\") {
      result += character;
      escaped = true;
    } else if (character === '"') {
      result += character;
      inString = false;
    } else if (character === "\n") {
      result += "\\n";
    } else if (character === "\r") {
      result += "\\r";
    } else if (character === "\t") {
      result += "\\t";
    } else {
      result += character;
    }
  }

  return result;
}

function validateSettings(settings) {
  if (!settings.apiUrl) {
    throw new Error("请先在扩展选项中填写 API URL。");
  }
  if (!settings.model) {
    throw new Error("请先在扩展选项中填写模型名称。");
  }
  if (settings.authType !== "none" && !settings.apiKey) {
    throw new Error("请先在扩展选项中填写 API Key，或把认证方式改为无。");
  }
}

function readModelText(payload) {
  const choice = payload?.choices?.[0];
  if (typeof choice?.message?.content === "string") {
    return choice.message.content;
  }
  if (Array.isArray(choice?.message?.content)) {
    return choice.message.content
      .map((part) => part?.text || part?.content || "")
      .join("");
  }
  if (typeof choice?.text === "string") {
    return choice.text;
  }
  if (typeof payload?.output_text === "string") {
    return payload.output_text;
  }
  if (Array.isArray(payload?.output)) {
    return payload.output
      .flatMap((item) => item?.content || [])
      .map((part) => part?.text || "")
      .join("");
  }
  return "";
}
