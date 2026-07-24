(function () {
  const MAX_TEXT_LENGTH = 12000;
  const ROOT_ID = "llm-selection-translator-root";
  const BUTTON_SIZE = 38;

  let root;
  let shadow;
  let ball;
  let panel;
  let selectedText = "";
  let hideTimer = 0;
  let initialized = false;
  let dragState = null;

  window.LLMSelectionTranslator = {
    init
  };

  function init() {
    if (initialized || typeof chrome === "undefined" || !chrome.runtime?.id) {
      return;
    }
    initialized = true;
    ensureUi();
    document.addEventListener("mouseup", scheduleSelectionCheck, true);
    document.addEventListener("keyup", scheduleSelectionCheck, true);
    document.addEventListener("selectionchange", debounceSelectionCheck, true);
    window.addEventListener("scroll", hideBall, true);
    window.addEventListener("resize", hideBall, true);
  }

  let selectionTimer = 0;
  function debounceSelectionCheck() {
    clearTimeout(selectionTimer);
    selectionTimer = window.setTimeout(checkSelection, 120);
  }

  function scheduleSelectionCheck() {
    clearTimeout(selectionTimer);
    selectionTimer = window.setTimeout(checkSelection, 40);
  }

  function ensureUi() {
    if (root) {
      return;
    }

    root = document.createElement("div");
    root.id = ROOT_ID;
    root.style.all = "initial";
    root.style.position = "fixed";
    root.style.zIndex = "2147483647";
    document.documentElement.appendChild(root);

    shadow = root.attachShadow({ mode: "open" });
    const style = document.createElement("style");
    style.textContent = `
      :host {
        all: initial;
        color-scheme: light;
        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      }
      .ball {
        align-items: center;
        background: transparent;
        border: 0;
        border-radius: 999px;
        box-shadow: none;
        color: #fff;
        cursor: pointer;
        display: none;
        height: ${BUTTON_SIZE}px;
        justify-content: center;
        position: fixed;
        transition: transform .14s ease, background .14s ease;
        width: ${BUTTON_SIZE}px;
      }
      .ball:hover {
        background: transparent;
        transform: translateY(-1px) scale(1.04);
      }
      .ball img {
        display: block;
        height: 34px;
        object-fit: contain;
        pointer-events: none;
        width: 34px;
      }
      .panel {
        background: #fff;
        border: 1px solid #d7dce5;
        border-radius: 8px;
        box-shadow: 0 18px 46px rgba(16, 24, 40, .22);
        color: #111827;
        display: none;
        font-size: 14px;
        line-height: 1.6;
        max-height: min(420px, calc(100vh - 36px));
        max-width: min(460px, calc(100vw - 24px));
        min-width: min(340px, calc(100vw - 24px));
        overflow: hidden;
        position: fixed;
      }
      .panel-header {
        align-items: center;
        border-bottom: 1px solid #edf0f5;
        cursor: move;
        display: flex;
        gap: 8px;
        justify-content: space-between;
        padding: 10px 12px;
        user-select: none;
      }
      .title {
        color: #111827;
        font-size: 13px;
        font-weight: 650;
      }
      .actions {
        cursor: default;
        display: flex;
        gap: 4px;
      }
      .icon-button {
        align-items: center;
        background: transparent;
        border: 0;
        border-radius: 6px;
        color: #4b5563;
        cursor: pointer;
        display: inline-flex;
        height: 28px;
        justify-content: center;
        padding: 0;
        width: 28px;
      }
      .icon-button:hover {
        background: #eef2ff;
        color: #123fbd;
      }
      .panel-body {
        max-height: 348px;
        overflow: auto;
        padding: 12px;
        white-space: pre-wrap;
        word-break: break-word;
      }
      .muted {
        color: #667085;
      }
      .error {
        color: #b42318;
      }
    `;

    ball = document.createElement("button");
    ball.className = "ball";
    ball.type = "button";
    ball.title = "翻译选中文本";
    ball.innerHTML = `<img src="${chrome.runtime.getURL("translate.png")}" alt="">`;
    ball.addEventListener("mousedown", (event) => event.preventDefault());
    ball.addEventListener("click", translateSelection);

    panel = document.createElement("section");
    panel.className = "panel";
    panel.innerHTML = `
      <div class="panel-header">
        <div class="title">翻译</div>
        <div class="actions">
          <button class="icon-button" data-action="copy" title="复制译文">${icon("copy")}</button>
          <button class="icon-button" data-action="close" title="关闭">${icon("x")}</button>
        </div>
      </div>
      <div class="panel-body muted">等待翻译...</div>
    `;
    panel.addEventListener("click", handlePanelClick);
    panel.querySelector(".panel-header").addEventListener("pointerdown", startPanelDrag);
    shadow.append(style, ball, panel);
  }

  function checkSelection() {
    const selection = window.getSelection();
    const text = selection?.toString().trim() || "";
    if (!text || selection.rangeCount === 0) {
      selectedText = "";
      hideBall();
      return;
    }

    const range = selection.getRangeAt(0);
    const rect = getUsableRect(range);
    if (!rect) {
      hideBall();
      return;
    }

    selectedText = text.slice(0, MAX_TEXT_LENGTH);
    const top = clamp(rect.bottom + 8, 10, window.innerHeight - BUTTON_SIZE - 10);
    const left = clamp(rect.right - BUTTON_SIZE, 10, window.innerWidth - BUTTON_SIZE - 10);
    showBall(left, top);
  }

  function getUsableRect(range) {
    const rects = Array.from(range.getClientRects()).filter((rect) => rect.width && rect.height);
    if (rects.length) {
      return rects[rects.length - 1];
    }
    const rect = range.getBoundingClientRect();
    return rect.width || rect.height ? rect : null;
  }

  function showBall(left, top) {
    clearTimeout(hideTimer);
    ball.style.left = `${left}px`;
    ball.style.top = `${top}px`;
    ball.style.display = "flex";
  }

  function hideBall() {
    if (ball) {
      ball.style.display = "none";
    }
  }

  function showPanel(left, top, body, state = "normal") {
    const bodyNode = panel.querySelector(".panel-body");
    bodyNode.className = `panel-body ${state === "error" ? "error" : state === "muted" ? "muted" : ""}`;
    bodyNode.textContent = body;
    panel.style.left = `${clamp(left, 12, window.innerWidth - panelWidth() - 12)}px`;
    panel.style.top = `${clamp(top, 12, window.innerHeight - 120)}px`;
    panel.style.display = "block";
  }

  async function translateSelection(event) {
    event.preventDefault();
    event.stopPropagation();
    if (!selectedText) {
      return;
    }

    const left = Number.parseFloat(ball.style.left) || 20;
    const top = Number.parseFloat(ball.style.top) + BUTTON_SIZE + 8 || 64;
    hideBall();
    showPanel(left, top, "正在翻译...", "muted");

    try {
      const response = await chrome.runtime.sendMessage({
        type: "TRANSLATE_TEXT",
        text: selectedText
      });
      if (!response?.ok) {
        throw new Error(response?.error || "翻译失败。");
      }
      showPanel(left, top, response.result);
    } catch (error) {
      showPanel(left, top, error.message || String(error), "error");
    }
  }

  async function handlePanelClick(event) {
    const button = event.target.closest("button");
    if (!button) {
      return;
    }
    if (button.dataset.action === "close") {
      panel.style.display = "none";
    }
    if (button.dataset.action === "copy") {
      const text = panel.querySelector(".panel-body")?.textContent || "";
      await navigator.clipboard.writeText(text);
    }
  }

  function startPanelDrag(event) {
    if (event.button !== 0 || event.target.closest("button")) {
      return;
    }

    const rect = panel.getBoundingClientRect();
    dragState = {
      pointerId: event.pointerId,
      offsetX: event.clientX - rect.left,
      offsetY: event.clientY - rect.top
    };
    panel.setPointerCapture?.(event.pointerId);
    event.preventDefault();
    window.addEventListener("pointermove", movePanel, true);
    window.addEventListener("pointerup", stopPanelDrag, true);
    window.addEventListener("pointercancel", stopPanelDrag, true);
  }

  function movePanel(event) {
    if (!dragState || event.pointerId !== dragState.pointerId) {
      return;
    }

    const rect = panel.getBoundingClientRect();
    const left = clamp(event.clientX - dragState.offsetX, 8, window.innerWidth - rect.width - 8);
    const top = clamp(event.clientY - dragState.offsetY, 8, window.innerHeight - rect.height - 8);
    panel.style.left = `${left}px`;
    panel.style.top = `${top}px`;
  }

  function stopPanelDrag(event) {
    if (dragState && event.pointerId === dragState.pointerId) {
      panel.releasePointerCapture?.(event.pointerId);
      dragState = null;
    }
    window.removeEventListener("pointermove", movePanel, true);
    window.removeEventListener("pointerup", stopPanelDrag, true);
    window.removeEventListener("pointercancel", stopPanelDrag, true);
  }

  function panelWidth() {
    return panel.getBoundingClientRect().width || Math.min(460, window.innerWidth - 24);
  }

  function clamp(value, min, max) {
    return Math.max(min, Math.min(Math.max(min, max), value));
  }

  function icon(name) {
    if (name === "languages") {
      return `<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m5 8 6 6"/><path d="m4 14 6-6 2-3"/><path d="M2 5h12"/><path d="M7 2h1"/><path d="m22 22-5-10-5 10"/><path d="M14 18h6"/></svg>`;
    }
    if (name === "copy") {
      return `<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect width="14" height="14" x="8" y="8" rx="2"/><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/></svg>`;
    }
    return `<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>`;
  }
})();
