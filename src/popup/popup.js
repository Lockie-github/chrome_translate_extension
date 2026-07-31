const statusNode = document.querySelector("#status");
const translateForm = document.querySelector("#translate-form");
const translateInput = document.querySelector("#translate-input");
const translateButton = document.querySelector("#translate");
const translationResult = document.querySelector("#translation-result");
const resultSource = document.querySelector("#result-source");
const resultDirection = document.querySelector("#result-direction");
const copyTranslationButton = document.querySelector("#copy-translation");
const wordResult = document.querySelector("#word-result");
const wordEntries = document.querySelector("#word-entries");
const sentenceResult = document.querySelector("#sentence-result");
const sentencePairs = document.querySelector("#sentence-pairs");
let currentTranslation = null;
let copyResetTimer = null;

document.querySelector("#options").addEventListener("click", () => {
  chrome.runtime.openOptionsPage();
});

document.querySelector("#open-pdf").addEventListener("click", async () => {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.url) {
    setStatus("没有找到当前页 URL。");
    return;
  }
  const response = await chrome.runtime.sendMessage({
    type: "OPEN_PDF_READER",
    url: tab.url
  });
  setStatus(response?.ok ? "已打开 PDF 文本阅读器。" : response?.error || "打开失败。");
});

translateForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  await translateInputText();
});

translateInput.addEventListener("keydown", (event) => {
  if (event.isComposing || event.key !== "Enter" || event.shiftKey) {
    return;
  }
  event.preventDefault();
  translateForm.requestSubmit();
});

copyTranslationButton.addEventListener("click", async () => {
  const text = getTranslatedText(currentTranslation);
  if (!text) {
    return;
  }

  try {
    await navigator.clipboard.writeText(text);
    setStatus("");
    showCopyFeedback("已复制");
  } catch {
    setStatus("复制失败，请重试。", true);
  }
});

async function translateInputText() {
  const text = translateInput.value.trim();
  if (!text) {
    setStatus("请输入要翻译的文本。", true);
    translateInput.focus();
    return;
  }

  translationResult.hidden = true;
  setTranslating(true);
  setStatus("正在翻译...");

  try {
    const response = await chrome.runtime.sendMessage({
      type: "TRANSLATE_BILINGUAL",
      text
    });
    if (!response?.ok) {
      throw new Error(response?.error || "翻译失败，请稍后重试。");
    }

    showTranslation(response.result);
    setStatus("");
  } catch (error) {
    setStatus(error?.message || "翻译失败，请稍后重试。", true);
  } finally {
    setTranslating(false);
  }
}

function showTranslation(translation) {
  currentTranslation = translation;
  showCopyFeedback("复制译文", false);
  resultSource.textContent = translation.source;
  resultSource.hidden = translation.kind === "sentence";
  resultSource.parentElement.classList.toggle("sentence-mode", translation.kind === "sentence");
  resultDirection.textContent = translation.direction === "zh-en" ? "中译英" : "英译中";
  wordResult.hidden = translation.kind !== "word";
  sentenceResult.hidden = translation.kind !== "sentence";

  if (translation.kind === "word") {
    wordEntries.replaceChildren(...translation.entries.map(createWordEntry));
  } else {
    const showSource = translation.showSentenceSource !== false;
    const displayPairs = showSource
      ? translation.pairs
      : [mergeTranslatedSentences(translation.pairs, translation.direction)];
    sentencePairs.replaceChildren(
      ...displayPairs.map((pair) => createSentencePair(pair, translation.direction, showSource))
    );
  }

  translationResult.hidden = false;
}

function getTranslatedText(translation) {
  if (!translation) {
    return "";
  }
  if (translation.kind === "word") {
    return translation.entries.map((entry) => entry.meanings.join("；")).join("\n");
  }

  const translatedLanguage = translation.direction === "zh-en" ? "english" : "chinese";
  const sentences = translation.pairs.map((pair) => pair[translatedLanguage]);
  if (translation.showSentenceSource !== false) {
    return sentences.join("\n");
  }
  return sentences.join(translatedLanguage === "english" ? " " : "");
}

function showCopyFeedback(label, reset = true) {
  window.clearTimeout(copyResetTimer);
  copyTranslationButton.textContent = label;
  if (reset) {
    copyResetTimer = window.setTimeout(() => {
      copyTranslationButton.textContent = "复制译文";
    }, 1500);
  }
}

function mergeTranslatedSentences(pairs, direction) {
  const translatedLanguage = direction === "zh-en" ? "english" : "chinese";
  const merged = { english: "", chinese: "" };
  const separator = translatedLanguage === "english" ? " " : "";
  merged[translatedLanguage] = pairs.map((pair) => pair[translatedLanguage]).join(separator);
  return merged;
}

function createSentencePair(pair, direction, showSource) {
  const item = document.createElement("div");
  item.className = "sentence-pair";

  const english = document.createElement("p");
  english.className = "sentence-english";
  english.lang = "en";
  english.textContent = pair.english;

  const chinese = document.createElement("p");
  chinese.className = "sentence-chinese";
  chinese.lang = "zh-CN";
  chinese.textContent = pair.chinese;

  if (showSource) {
    item.append(english, chinese);
  } else {
    item.append(direction === "zh-en" ? english : chinese);
  }
  return item;
}

function createWordEntry(entry) {
  const row = document.createElement("div");
  row.className = "word-entry";

  const partOfSpeech = document.createElement("div");
  partOfSpeech.className = "part-of-speech";
  partOfSpeech.textContent = entry.partOfSpeech;

  const meanings = document.createElement("div");
  meanings.className = "meanings";
  meanings.textContent = entry.meanings.join("；");

  row.append(partOfSpeech, meanings);
  return row;
}

function setTranslating(isTranslating) {
  translateButton.disabled = isTranslating;
  translateButton.textContent = isTranslating ? "翻译中..." : "翻译";
  translateInput.disabled = isTranslating;
}

function setStatus(message, isError = false) {
  statusNode.textContent = message;
  statusNode.classList.toggle("error", isError);
}
