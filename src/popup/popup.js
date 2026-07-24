const statusNode = document.querySelector("#status");
const lastNode = document.querySelector("#last");
const sourceNode = document.querySelector("#source");
const resultNode = document.querySelector("#result");

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

loadLastTranslation();

async function loadLastTranslation() {
  const { lastContextMenuTranslation } = await chrome.storage.local.get("lastContextMenuTranslation");
  if (!lastContextMenuTranslation) {
    return;
  }
  sourceNode.textContent = lastContextMenuTranslation.source;
  resultNode.textContent = lastContextMenuTranslation.result;
  lastNode.hidden = false;
}

function setStatus(message) {
  statusNode.textContent = message;
}
