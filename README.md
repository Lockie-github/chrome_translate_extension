# 划词大模型翻译 Chrome 扩展

这是一个仅本机使用的 Chrome MV3 扩展。选中网页文本后会出现悬浮球，点击后通过你在设置页填写的大模型 API 翻译文本。

## 安装

1. 打开 Chrome 的 `chrome://extensions/`。
2. 打开右上角“开发者模式”。
3. 点击“加载已解压的扩展程序”。
4. 选择这个目录：`llm-selection-translator`。
5. 点击扩展图标进入“设置”，填写 API URL、API Key 和模型名称。

API Key 保存在 `chrome.storage.local`，只用于本机扩展数据。

## API 要求

扩展按 OpenAI Chat Completions 兼容格式请求：

```json
{
  "model": "your-model",
  "temperature": 0.2,
  "messages": [
    { "role": "system", "content": "..." },
    { "role": "user", "content": "Target language: 简体中文\n\nText:\n..." }
  ]
}
```

支持从 `choices[0].message.content`、`choices[0].text`、`output_text` 或 `output[].content[].text` 读取结果。

## PDF 支持说明

Chrome 内置 PDF 查看器不是普通网页 DOM，扩展无法直接往其中注入网页悬浮球。因此这个扩展提供自己的 PDF 文本阅读器：

- 打开以 `.pdf` 结尾的 URL 时，默认会自动跳转到扩展的 PDF 文本阅读器。
- 也可以点击扩展图标，再点“用 PDF 文本阅读器打开当前页”。
- 如果当前地址是常见 datasheet 入口页，阅读器会先扫描页面中的真实 `.pdf` 链接，再读取 PDF 文本。
- 阅读器使用 PDF.js 按页渲染 PDF，尽量保留原始版式，并在页面上叠加可选择的文字层。选中文本后同样出现悬浮球并翻译。

限制：

- 扫描版 PDF、加密 PDF、复杂字体编码 PDF 可能无法提供可选择文字层。
- 本地 `file://` PDF 需要在 Chrome 扩展详情页开启“允许访问文件网址”。
- 如果需要翻译扫描版 PDF，需要额外接入 OCR 服务。

## 更新扩展

修改文件后，在 `chrome://extensions/` 找到本扩展，点击“重新加载”。如果使用的是 zip，需要先解压后加载解压目录。
