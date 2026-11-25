export const DEFAULT_SETTINGS = {
  apiUrl: "",
  apiKey: "",
  model: "",
  targetLanguage: "简体中文",
  authType: "bearer",
  customAuthHeader: "",
  systemPrompt:
    "You are a precise translation engine. Translate the user's text into the target language. Preserve meaning, tone, names, numbers, Markdown, and code blocks. Return only the translation.",
  temperature: 0.2,
  showSentenceSource: true,
  showPageSource: true,
  autoOpenPdfReader: true
};

export async function getSettings() {
  const stored = await chrome.storage.local.get(DEFAULT_SETTINGS);
  return { ...DEFAULT_SETTINGS, ...stored };
}

export async function saveSettings(settings) {
  await chrome.storage.local.set({ ...DEFAULT_SETTINGS, ...settings });
}
