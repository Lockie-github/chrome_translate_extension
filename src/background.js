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

  const body = {
    model: settings.model,
    temperature: Number(settings.temperature ?? 0.2),
    messages: [
      {
        role: "system",
        content: settings.systemPrompt
      },
      {
        role: "user",
        content: `Target language: ${settings.targetLanguage}\n\nText:\n${cleanText}`
      }
    ]
  };

  const response = await fetch(settings.apiUrl, {
    method: "POST",
    headers,
    body: JSON.stringify(body)
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
