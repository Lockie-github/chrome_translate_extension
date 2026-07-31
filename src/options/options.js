import { DEFAULT_SETTINGS, getSettings, saveSettings } from "../shared/settings.js";

const form = document.querySelector("#settings-form");
const statusNode = document.querySelector("#status");
const testButton = document.querySelector("#test-button");

load();

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  await saveSettings(readForm());
  setStatus("设置已保存。");
});

testButton.addEventListener("click", async () => {
  await saveSettings(readForm());
  setStatus("正在测试...");
  const response = await chrome.runtime.sendMessage({
    type: "TRANSLATE_TEXT",
    text: "Hello, this is a translation test."
  });
  if (response?.ok) {
    setStatus(`测试成功：${response.result}`);
  } else {
    setStatus(response?.error || "测试失败。", true);
  }
});

async function load() {
  const settings = await getSettings();
  for (const [key, value] of Object.entries({ ...DEFAULT_SETTINGS, ...settings })) {
    const field = form.elements[key];
    if (!field) {
      continue;
    }
    if (field.type === "checkbox") {
      field.checked = Boolean(value);
    } else {
      field.value = value ?? "";
    }
  }
}

function readForm() {
  return {
    apiUrl: form.elements.apiUrl.value.trim(),
    apiKey: form.elements.apiKey.value.trim(),
    model: form.elements.model.value.trim(),
    targetLanguage: form.elements.targetLanguage.value.trim() || DEFAULT_SETTINGS.targetLanguage,
    authType: form.elements.authType.value,
    customAuthHeader: form.elements.customAuthHeader.value.trim(),
    systemPrompt: form.elements.systemPrompt.value.trim() || DEFAULT_SETTINGS.systemPrompt,
    temperature: Number(form.elements.temperature.value || DEFAULT_SETTINGS.temperature),
    showSentenceSource: form.elements.showSentenceSource.checked,
    autoOpenPdfReader: form.elements.autoOpenPdfReader.checked
  };
}

function setStatus(message, isError = false) {
  statusNode.textContent = message;
  statusNode.classList.toggle("error", isError);
}
