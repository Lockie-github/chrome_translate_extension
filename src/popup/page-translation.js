import { DEFAULT_SETTINGS } from "../shared/settings.js";

const translateButton = document.querySelector("#translate-page");
const restoreButton = document.querySelector("#restore-page");
const showSource = document.querySelector("#show-page-source");
const statusNode = document.querySelector("#page-status");
let tabId;
let pollTimer;
let requestId = 0;

translateButton.addEventListener("click", () => updatePage("PAGE_TRANSLATION_START"));
restoreButton.addEventListener("click", () => updatePage("PAGE_TRANSLATION_RESTORE"));
showSource.addEventListener("change", async () => {
  try {
    await chrome.storage.local.set({ showPageSource: showSource.checked });
  } catch {
    showSource.checked = !showSource.checked;
    setStatus("无法保存原文显示设置。", true);
  }
});
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === "local" && changes.showPageSource) {
    showSource.checked = changes.showPageSource.newValue !== false;
  }
});

chrome.storage.local.get({ showPageSource: DEFAULT_SETTINGS.showPageSource }).then((settings) => {
  showSource.checked = settings.showPageSource;
  showSource.disabled = false;
}).catch(() => setStatus("无法读取原文显示设置。", true));

chrome.tabs.query({ active: true, currentWindow: true }).then(([tab]) => {
  if (tab?.id != null && /^(https?|file):/i.test(tab.url || "")) {
    tabId = tab.id;
    return updatePage();
  }
  setStatus("当前页面不支持网页翻译。");
}).catch(() => setStatus("无法读取当前标签页。", true));

async function updatePage(type = "PAGE_TRANSLATION_STATUS") {
  clearTimeout(pollTimer);
  const id = ++requestId;
  if (type !== "PAGE_TRANSLATION_STATUS") {
    translateButton.disabled = true;
    restoreButton.disabled = true;
  }
  try {
    const status = await chrome.tabs.sendMessage(tabId, { type }, { frameId: 0 });
    if (id === requestId) {
      render(status);
    }
  } catch {
    if (id === requestId) {
      translateButton.disabled = true;
      restoreButton.hidden = true;
      setStatus("当前页面无法连接翻译脚本。若扩展刚重新加载，请刷新网页后重试。");
    }
  }
}

function render({ phase, total, completed, skipped, error }) {
  translateButton.disabled = phase === "running" || phase === "done";
  translateButton.textContent = phase === "failed" && total ? "重试未完成内容" : "翻译网页";
  restoreButton.hidden = phase !== "running" && !total;
  restoreButton.disabled = false;

  if (phase === "running") {
    setStatus(total ? `正在翻译 ${completed + skipped}/${total}` : "正在准备网页翻译…");
    pollTimer = setTimeout(updatePage, 400);
  } else if (phase === "done") {
    setStatus(skipped ? `已翻译 ${completed} 个文本块，跳过 ${skipped} 个已变化的文本块。` : "网页翻译完成。");
  } else if (phase === "failed") {
    setStatus(total ? `已翻译 ${completed}/${total} 个文本块。${error}` : error, true);
  } else {
    setStatus("");
  }
}

function setStatus(message, isError = false) {
  statusNode.textContent = message;
  statusNode.hidden = !message;
  statusNode.classList.toggle("error", isError);
}
