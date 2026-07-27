(function () {
  const MAX_TEXT_LENGTH = 12000;
  const ROOT_ID = "llm-selection-translator-root";
  const BUTTON_SIZE = 48;

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
    if (
      initialized ||
      document.documentElement?.namespaceURI !== "http://www.w3.org/1999/xhtml" ||
      typeof chrome === "undefined" ||
      !chrome.runtime?.id
    ) {
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
      .ball svg {
        display: block;
        height: 44px;
        pointer-events: none;
        width: 44px;
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
    ball.innerHTML = icon("translate");
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
    if (name === "translate") {
      // Inlined from /translate.svg so page CSP cannot block an extension resource request.
      return `
        <svg viewBox="0 0 512 512" aria-hidden="true" fill="none" xmlns="http://www.w3.org/2000/svg">
          <defs>
            <linearGradient id="llmst-body-fill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0" stop-color="#fafafa"/>
              <stop offset=".52" stop-color="#eee"/>
              <stop offset="1" stop-color="#e5e5e5"/>
            </linearGradient>
            <linearGradient id="llmst-badge-fill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0" stop-color="#f7f7f7"/>
              <stop offset="1" stop-color="#ededed"/>
            </linearGradient>
            <filter id="llmst-body-shadow" x="-12%" y="-12%" width="130%" height="135%">
              <feDropShadow dx="1" dy="4" stdDeviation="3.5" flood-color="#000" flood-opacity=".52"/>
            </filter>
            <filter id="llmst-pin-shadow" x="-35%" y="-25%" width="170%" height="160%">
              <feDropShadow dy="2" stdDeviation="2" flood-color="#000" flood-opacity=".62"/>
            </filter>
            <filter id="llmst-mouth-shadow" x="-12%" y="-30%" width="130%" height="180%">
              <feDropShadow dx="1" dy="4" stdDeviation="3" flood-color="#000" flood-opacity=".28"/>
            </filter>
            <filter id="llmst-badge-shadow" x="-20%" y="-18%" width="150%" height="150%">
              <feDropShadow dx="1" dy="2" stdDeviation="2.2" flood-color="#000" flood-opacity=".23"/>
            </filter>
          </defs>
          <g fill="#363636" stroke="#1c1c1c" stroke-width="5" filter="url(#llmst-pin-shadow)">
            <rect x="141" y="49" width="18" height="49" rx="9"/>
            <rect x="247" y="49" width="18" height="49" rx="9"/>
            <rect x="353" y="49" width="18" height="49" rx="9"/>
            <rect x="47" y="141" width="50" height="18" rx="9"/>
            <rect x="47" y="247" width="50" height="18" rx="9"/>
            <rect x="47" y="353" width="50" height="18" rx="9"/>
            <rect x="415" y="141" width="50" height="18" rx="9"/>
            <rect x="415" y="247" width="50" height="18" rx="9"/>
            <rect x="415" y="353" width="50" height="18" rx="9"/>
            <rect x="141" y="415" width="18" height="50" rx="9"/>
            <rect x="247" y="415" width="18" height="50" rx="9"/>
            <rect x="353" y="415" width="18" height="50" rx="9"/>
          </g>
          <rect x="97" y="97" width="318" height="318" rx="50" fill="url(#llmst-body-fill)" stroke="#666" stroke-width="6" filter="url(#llmst-body-shadow)"/>
          <rect x="115.5" y="115.5" width="281" height="281" rx="39" stroke="#777" stroke-width="4"/>
          <circle cx="176" cy="184" r="42" fill="#000"/>
          <circle cx="337" cy="184" r="42" fill="#000"/>
          <rect x="128" y="284" width="236" height="36" rx="4" fill="#000" transform="rotate(-14 246 302)" filter="url(#llmst-mouth-shadow)"/>
          <g filter="url(#llmst-badge-shadow)">
            <rect x="317.5" y="320.5" width="76" height="77" rx="20" fill="url(#llmst-badge-fill)" stroke="#666" stroke-width="3"/>
            <rect x="322.5" y="324.5" width="66" height="68" rx="16" stroke="#fff" stroke-width="2" stroke-opacity=".92"/>
          </g>
          <g stroke="#000" stroke-width="5.25" stroke-linecap="round" stroke-linejoin="round">
            <path d="M346 331v5.5M333 338h26.5M337 339c2 7 8.5 15 19.5 20.5M358.5 339c-2 8-8.8 17-21.5 22"/>
            <path d="M360 376.5c2.2-7 4.7-14.1 7.3-19.8.9-1.9 1.8-2.7 2.8-2.7s1.9.8 2.8 2.7c2.6 5.7 5 12.8 7 19.8M363.5 366.8h13"/>
          </g>
        </svg>`;
    }
    if (name === "copy") {
      return `<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect width="14" height="14" x="8" y="8" rx="2"/><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/></svg>`;
    }
    return `<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>`;
  }
})();
