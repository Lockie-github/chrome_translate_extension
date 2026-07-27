const statusNode = document.querySelector("#status");
const translateForm = document.querySelector("#translate-form");
const translateInput = document.querySelector("#translate-input");
const translateButton = document.querySelector("#translate");
const translationResult = document.querySelector("#translation-result");
const resultSource = document.querySelector("#result-source");
const resultDirection = document.querySelector("#result-direction");
const wordResult = document.querySelector("#word-result");
const wordEntries = document.querySelector("#word-entries");
const sentenceResult = document.querySelector("#sentence-result");
const sentenceTranslation = document.querySelector("#sentence-translation");

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
  resultSource.textContent = translation.source;
  resultDirection.textContent = translation.direction === "zh-en" ? "中译英" : "英译中";
  wordResult.hidden = translation.kind !== "word";
  sentenceResult.hidden = translation.kind !== "sentence";

  if (translation.kind === "word") {
    wordEntries.replaceChildren(...translation.entries.map(createWordEntry));
  } else {
    sentenceTranslation.textContent = translation.translation;
  }

  translationResult.hidden = false;
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
