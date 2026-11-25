(() => {
  if (window !== window.top) {
    return;
  }

  const BLOCKS = "p, h1, h2, h3, h4, h5, h6, li, dt, dd, blockquote, figcaption, td, th, div";
  const COMPACT = "a, button, label, nav, [role='button'], [role='link'], [role='navigation']";
  const NAVIGATION = "nav, aside, [role='navigation'], [role='complementary'], [role='menu'], [role='menubar'], [role='tree'], [role='tablist']";
  const EXCLUDED = [
    "script", "style", "noscript", "template", "textarea", "input", "select", "option",
    "pre", "svg", "math", "canvas", "iframe", "embed", "object", "audio", "video",
    "[hidden]", "[aria-hidden='true']", "[translate='no']", ".notranslate",
    "#llm-selection-translator-root"
  ].join(",");
  const LETTER = /\p{L}/u;
  let showSource = true;
  let sourcePreferenceChanged = false;
  let job;

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== "local" || !changes.showPageSource) {
      return;
    }
    sourcePreferenceChanged = true;
    showSource = changes.showPageSource.newValue !== false;
    job?.groups.forEach(renderGroup);
  });
  const preferenceReady = chrome.storage.local.get({ showPageSource: true }).then((settings) => {
    if (!sourcePreferenceChanged) {
      showSource = settings.showPageSource !== false;
    }
  });

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    switch (message?.type) {
      case "PAGE_TRANSLATION_START":
        if (job?.phase !== "running" && job?.phase !== "done") {
          const current = job?.groups.length ? job : { groups: [], targetLanguage: "" };
          job = current;
          current.phase = "running";
          current.error = "";
          run(current).catch((error) => {
            current.phase = "failed";
            current.error = error.message;
          });
        }
        break;
      case "PAGE_TRANSLATION_RESTORE":
        job?.groups.forEach(clearGroup);
        job = undefined;
        break;
      case "PAGE_TRANSLATION_STATUS":
        break;
      default:
        return;
    }
    sendResponse(getStatus());
  });

  function getStatus() {
    return {
      phase: job?.phase || "idle",
      total: job?.groups.length || 0,
      completed: job?.groups.filter((group) => group.complete).length || 0,
      skipped: job?.groups.filter((group) => group.skipped).length || 0,
      error: job?.error || ""
    };
  }

  async function run(current) {
    if (!current.groups.length) {
      await preferenceReady;
      current.targetLanguage = await request({ type: "PREPARE_PAGE_TRANSLATION" });
      if (job !== current) {
        return;
      }
      current.groups = collectGroups();
      if (!current.groups.length) {
        throw new Error("当前页面没有可翻译的网页文字。");
      }
    }

    const batches = createBatches(current.groups);
    let nextBatch = 0;
    const processBatches = async () => {
      while (job === current && nextBatch < batches.length) {
        const batch = batches[nextBatch++];
        try {
          const result = await request({
            type: "TRANSLATE_PAGE_BATCH",
            targetLanguage: current.targetLanguage,
            groups: batch.map(({ parts }) => parts.map(({ id, text }) => ({ id, text })))
          });
          if (job !== current) {
            return;
          }

          const translations = new Map(result.map(({ id, text }) => [id, text]));
          const affectedGroups = new Set();
          for (const { group, sentence, parts } of batch) {
            for (const part of parts) {
              part.translation = translations.get(part.id);
            }
            sentence.complete = sentence.parts.every((part) => part.id === undefined || part.translation !== undefined);
            affectedGroups.add(group);
          }
          affectedGroups.forEach(renderGroup);
        } catch (error) {
          current.error = error.message;
        }
      }
    };

    await Promise.all([processBatches(), processBatches()]);
    if (job === current) {
      const incomplete = current.groups.some((group) => !group.complete && !group.skipped);
      current.phase = incomplete ? "failed" : "done";
      if (incomplete && !current.error) {
        current.error = "部分译文未返回，可以重试。";
      }
    }
  }

  async function request(message) {
    const response = await chrome.runtime.sendMessage(message);
    if (!response?.ok) {
      throw new Error(response?.error || "网页翻译请求失败。");
    }
    return response.result;
  }

  function collectGroups() {
    if (!document.body || document.body.isContentEditable) {
      return [];
    }

    const groups = [];
    let group;
    let nextId = 1;
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT, {
      acceptNode(node) {
        if (node.nodeType === Node.TEXT_NODE) {
          return NodeFilter.FILTER_ACCEPT;
        }
        if (node.matches(EXCLUDED) || node.isContentEditable) {
          return NodeFilter.FILTER_REJECT;
        }
        const style = getComputedStyle(node);
        if (style.display === "none" || style.visibility === "hidden" || style.visibility === "collapse" ||
            style.opacity === "0" || style.contentVisibility === "hidden") {
          return NodeFilter.FILTER_REJECT;
        }
        return node.nodeName === "BR" ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_SKIP;
      }
    });

    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      if (node.nodeType !== Node.TEXT_NODE) {
        group = undefined;
        continue;
      }
      const parent = node.parentElement;
      const block = parent.closest(BLOCKS);
      const compact = parent.closest(COMPACT);
      const candidate = block && (!compact || (compact.matches("a") && block.contains(compact) && !block.closest(COMPACT)));
      let container = candidate ? block : compact?.matches("a, button, label, [role='button'], [role='link']")
        ? compact : parent;
      // A shared flex or grid row may contain multiple independent labels.
      for (let element = parent; element !== container; element = element.parentElement) {
        if (hasLayoutParent(element) || isLayout(getComputedStyle(element).display)) {
          container = element;
          break;
        }
      }
      if (group?.container !== container) {
        const { top, bottom } = container.getBoundingClientRect();
        const priority = top < window.innerHeight && bottom > 0 ? 0 : 1;
        const display = getComputedStyle(container).display;
        const navigation = Boolean(container.closest(NAVIGATION));
        group = {
          container,
          stacked: candidate && /^(block|list-item|table-cell|flow-root)$/.test(display),
          constrained: isLayout(display) || hasLayoutParent(container) || navigation,
          navigation,
          records: [],
          priority
        };
        groups.push(group);
      }

      if (node.length) {
        const literal = Boolean(parent.closest("code, kbd, samp"));
        group.records.push({ node, original: node.data, literal, parts: [] });
      }
    }

    let segmenter;
    try {
      segmenter = new Intl.Segmenter(document.documentElement.lang || undefined, { granularity: "sentence" });
    } catch {
      segmenter = new Intl.Segmenter(undefined, { granularity: "sentence" });
    }
    for (const item of groups) {
      item.sentences = collectSentences(item.records, segmenter, () => nextId++);
    }
    return groups.filter((item) => item.sentences.length)
      .sort((first, second) => first.priority - second.priority);
  }

  function isLayout(display) {
    return /(?:^|[- ])(?:flex|grid)$/.test(display);
  }

  function hasLayoutParent(node) {
    for (let parent = node.parentElement; parent; parent = parent.parentElement) {
      const display = getComputedStyle(parent).display;
      if (display !== "contents") {
        return isLayout(display);
      }
    }
    return false;
  }

  function collectSentences(records, segmenter, nextId) {
    // Match HTML whitespace without changing the offsets into the original text nodes.
    const source = records.map(({ original }) => original).join("")
      .replace(/[\t\n\r\f]/g, " ")
      .replace(/\b(?:Mr|Mrs|Ms|Dr|Prof)\.(?=\s+\p{Lu})/gu, (title) => title.slice(0, -1) + "x");
    const sentences = [];
    let recordIndex = 0;
    let offset = 0;
    for (const { segment } of segmenter.segment(source)) {
      const sentence = { parts: [], complete: false };
      let remaining = segment.length;
      while (remaining > 0) {
        const record = records[recordIndex];
        const text = record.original.slice(offset, offset + remaining);
        const chunks = !record.literal && LETTER.test(text) ? splitText(text) : [text];
        for (const original of chunks) {
          offset += original.length;
          const part = { record, original, end: offset, sentence };
          if (!record.literal && LETTER.test(original)) {
            part.id = nextId();
            part.text = original.trim();
          }
          record.parts.push(part);
          sentence.parts.push(part);
        }
        remaining -= text.length;
        if (offset === record.original.length) {
          recordIndex++;
          offset = 0;
        }
      }
      if (sentence.parts.some((part) => part.id !== undefined)) {
        sentences.push(sentence);
      }
    }
    return sentences;
  }

  function splitText(text) {
    const pieces = [];
    let remaining = text;
    while (remaining.length > 1200) {
      const window = remaining.slice(0, 1200);
      const space = window.search(/\s(?=\S*\s*$)/u);
      const boundary = space > 600 ? space + 1 : /[\uD800-\uDBFF]$/.test(window) ? 1199 : 1200;
      pieces.push(remaining.slice(0, boundary));
      remaining = remaining.slice(boundary);
    }
    pieces.push(remaining);
    return pieces;
  }

  function createBatches(groups) {
    const batches = [];
    let batch = [];
    let length = 0;
    let count = 0;
    for (const group of groups) {
      if (group.complete || group.skipped) {
        continue;
      }
      for (const sentence of group.sentences) {
        for (const part of sentence.parts) {
          if (part.id === undefined || part.translation !== undefined) {
            continue;
          }
          if (count === 32 || length + part.text.length > 4500) {
            batches.push(batch);
            batch = [];
            length = 0;
            count = 0;
          }
          if (batch.at(-1)?.sentence !== sentence) {
            batch.push({ group, sentence, parts: [] });
          }
          batch.at(-1).parts.push(part);
          count++;
          length += part.text.length;
        }
      }
    }
    if (batch.length) {
      batches.push(batch);
    }
    return batches;
  }

  function renderGroup(group) {
    if (group.skipped) {
      return;
    }
    const completed = group.sentences.filter((sentence) => sentence.complete);
    if (!completed.length) {
      return;
    }
    const { container, records } = group;
    const intact = clearGroup(group) && container.isConnected && records.every(({ node }) => container.contains(node));
    if (!intact) {
      group.complete = false;
      group.skipped = true;
      return;
    }
    group.complete = completed.length === group.sentences.length;

    if (!showSource) {
      replaceOriginal(records);
      return;
    }

    const insertions = new Map();
    for (const { parts } of completed) {
      const text = parts.map(translatedText).join("").trim();
      if (text === parts.map(({ original }) => original).join("").trim()) {
        continue;
      }
      const last = parts.findLast(({ original }) => original.trim());
      if (!insertions.has(last.record)) {
        insertions.set(last.record, []);
      }
      insertions.get(last.record).push({ offset: last.end, text });
    }
    group.translationNodes = [];
    for (const [record, items] of insertions) {
      insertTranslations(group, record, items);
    }
  }

  function replaceOriginal(records) {
    let previousSentence;
    let previousText = "";
    for (const record of records) {
      let replacement = "";
      for (const part of record.parts) {
        const text = part.sentence.complete ? translatedText(part) : part.original;
        // Adjacent CJK sentences can become Latin-script sentences that need a space.
        if (part.sentence !== previousSentence && part.translation !== undefined && part.sentence.complete &&
            /[.!?][”’"')\]]*$/u.test(previousText) && /^\p{Script=Latin}/u.test(text)) {
          replacement += " ";
        }
        replacement += text;
        previousText = text;
        previousSentence = part.sentence;
      }
      if (replacement !== record.original) {
        record.replacement = replacement;
        record.node.data = replacement;
      }
    }
  }

  function translatedText({ original, translation }) {
    return translation === undefined ? original : original.replace(/\S[\s\S]*\S|\S/u, () => translation);
  }

  function insertTranslations(group, record, items) {
    let node = record.node;
    if (hasLayoutParent(node)) {
      wrapLayoutText(group, node);
    }
    let start = 0;
    const pieces = [node];
    for (const { offset, text } of items) {
      let anchor = node;
      if (offset < record.original.length) {
        node = node.splitText(offset - start);
        start = offset;
        pieces.push(node);
      } else {
        while (anchor.parentNode !== group.container && !anchor.nextSibling &&
            !hasLayoutParent(anchor.parentElement) && !group.layoutWrappers?.includes(anchor.parentElement)) {
          anchor = anchor.parentNode;
        }
      }
      const translation = createTranslation(text, group);
      anchor.after(translation);
      group.translationNodes.push(translation);
    }
    if (pieces.length > 1) {
      record.pieces = pieces.map((piece) => ({ node: piece, text: piece.data }));
    }
  }

  function wrapLayoutText(group, node) {
    // Keep the original anonymous flex or grid item and its translation in one slot.
    let first = node;
    while (first.previousSibling?.nodeType === Node.TEXT_NODE) {
      first = first.previousSibling;
    }
    const wrapper = document.createElement("span");
    wrapper.style.cssText = "display:block; min-inline-size:0; max-inline-size:100%";
    first.before(wrapper);
    for (let text = first; text?.nodeType === Node.TEXT_NODE;) {
      const next = text.nextSibling;
      wrapper.append(text);
      text = next;
    }
    (group.layoutWrappers ??= []).push(wrapper);
  }

  function createTranslation(text, { stacked, constrained, navigation }) {
    const translation = document.createElement("span");
    translation.translate = false;
    translation.dir = "auto";
    if (constrained) {
      translation.style.cssText = "display:block; contain:inline-size; max-inline-size:100%; margin-block-start:0.15em; " +
        "white-space:normal; overflow-wrap:anywhere; word-break:normal";
      if (navigation || !stacked) {
        translation.style.fontSize = "0.9em";
      }
    } else {
      translation.style.cssText = stacked
        ? "display:block; margin-block-start:0.25em; white-space:inherit; overflow-wrap:anywhere"
        : "display:inline; margin-inline-start:0.35em";
    }
    translation.textContent = text;
    return translation;
  }

  function clearGroup(group) {
    group.translationNodes?.forEach((node) => node.remove());
    group.translationNodes = undefined;
    let intact = true;
    for (const record of group.records) {
      if (record.pieces) {
        const consecutive = record.pieces.every(({ node, text }, index) =>
          node.data === text && (index === 0 || record.pieces[index - 1].node.nextSibling === node));
        if (consecutive) {
          record.node.data = record.original;
          record.pieces.slice(1).forEach(({ node }) => node.remove());
        }
        intact = consecutive && intact;
        record.pieces = undefined;
      } else if (record.replacement !== undefined && record.node.data === record.replacement) {
        record.node.data = record.original;
      }
      record.replacement = undefined;
      intact = record.node.data === record.original && intact;
    }
    group.layoutWrappers?.forEach((wrapper) => wrapper.replaceWith(...wrapper.childNodes));
    group.layoutWrappers = undefined;
    return intact;
  }
})();
