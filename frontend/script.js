(() => {
  "use strict";

  const els = {
    thread: document.getElementById("thread"),
    emptyState: document.getElementById("emptyState"),
    suggestions: document.getElementById("suggestions"),
    input: document.getElementById("input"),
    sendBtn: document.getElementById("sendBtn"),
    resetBtn: document.getElementById("resetBtn"),
    modelLabel: document.getElementById("modelLabel"),
    composerHint: document.getElementById("composerHint"),
    msgTemplate: document.getElementById("msgTemplate"),
    meterTemplate: document.getElementById("meterTemplate"),
  };

  const STORAGE_KEY = "nemo.chat.history.v1";
  let history = loadHistory();
  let isStreaming = false;

  init();

  function init() {
    renderHistory();
    checkHealth();
    bindEvents();
    autoresize();
  }

  // -------------------------------------------------------------------
  // Setup
  // -------------------------------------------------------------------
  function bindEvents() {
    els.input.addEventListener("input", () => {
      autoresize();
      els.sendBtn.disabled = els.input.value.trim().length === 0 || isStreaming;
    });

    els.input.addEventListener("keydown", (e) => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        handleSend();
      }
    });

    els.sendBtn.addEventListener("click", handleSend);
    els.resetBtn.addEventListener("click", handleReset);

    if (els.suggestions) {
      els.suggestions.addEventListener("click", (e) => {
        const chip = e.target.closest(".suggestion-chip");
        if (!chip) return;
        els.input.value = chip.textContent;
        autoresize();
        handleSend();
      });
    }
  }

  async function checkHealth() {
    try {
      const res = await fetch("/api/health");
      const data = await res.json();
      if (data.configured) {
        els.modelLabel.textContent = shortModelName(data.model);
        els.modelLabel.classList.add("is-live");
      } else {
        els.modelLabel.textContent = "API key not set";
        els.modelLabel.classList.add("is-error");
        els.composerHint.textContent = "Add NVIDIA_API_KEY to backend/.env, then restart the server.";
      }
    } catch {
      els.modelLabel.textContent = "backend offline";
      els.modelLabel.classList.add("is-error");
    }
  }

  function shortModelName(model) {
    if (!model) return "unknown model";
    const parts = model.split("/");
    return parts[parts.length - 1];
  }

  // -------------------------------------------------------------------
  // Sending
  // -------------------------------------------------------------------
  async function handleSend() {
    const text = els.input.value.trim();
    if (!text || isStreaming) return;

    els.input.value = "";
    autoresize();
    els.sendBtn.disabled = true;
    hideEmptyState();

    appendMessage("user", text);
    history.push({ role: "user", content: text });
    saveHistory();

    const assistantEl = appendMessage("assistant", "");
    const meter = els.meterTemplate.content.firstElementChild.cloneNode(true);
    assistantEl.querySelector(".msg__bubble").appendChild(meter);
    scrollToBottom();

    isStreaming = true;
    let fullText = "";
    let firstToken = true;

    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages: history }),
      });

      if (!res.ok || !res.body) {
        const errData = await safeJson(res);
        throw new Error(errData?.error || `Request failed (${res.status})`);
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });

        const lines = buffer.split("\n\n");
        buffer = lines.pop(); // keep incomplete chunk

        for (const line of lines) {
          if (!line.startsWith("data: ")) continue;
          const raw = line.slice(6).trim();
          if (raw === "[DONE]") continue;

          let payload;
          try {
            payload = JSON.parse(raw);
          } catch {
            continue;
          }

          if (payload.error) {
            throw new Error(payload.error);
          }

          if (payload.content) {
            if (firstToken) {
              meter.remove();
              firstToken = false;
            }
            fullText += payload.content;
            renderBubbleContent(assistantEl.querySelector(".msg__bubble"), fullText);
            scrollToBottom();
          }
        }
      }

      if (!fullText) {
        assistantEl.remove();
      } else {
        history.push({ role: "assistant", content: fullText });
        saveHistory();
      }
    } catch (err) {
      meter.remove();
      assistantEl.classList.add("error");
      renderBubbleContent(assistantEl.querySelector(".msg__bubble"), `⚠ ${err.message}`);
    } finally {
      isStreaming = false;
      els.sendBtn.disabled = els.input.value.trim().length === 0;
      scrollToBottom();
    }
  }

  async function safeJson(res) {
    try {
      return await res.json();
    } catch {
      return null;
    }
  }

  function handleReset() {
    if (isStreaming) return;
    history = [];
    saveHistory();
    els.thread.querySelectorAll(".msg").forEach((el) => el.remove());
    showEmptyState();
  }

  // -------------------------------------------------------------------
  // Rendering
  // -------------------------------------------------------------------
  function appendMessage(role, text) {
    const node = els.msgTemplate.content.firstElementChild.cloneNode(true);
    node.classList.add(role);
    const bubble = node.querySelector(".msg__bubble");
    if (text) renderBubbleContent(bubble, text);
    els.thread.appendChild(node);
    return node;
  }

  function renderHistory() {
    if (history.length === 0) {
      showEmptyState();
      return;
    }
    hideEmptyState();
    history.forEach((m) => appendMessage(m.role, m.content));
    scrollToBottom(false);
  }

  function renderBubbleContent(bubble, text) {
    bubble.innerHTML = formatText(text);
  }

  // Minimal, safe formatting: escape HTML, then support ```code```, `code`, **bold**
  function formatText(raw) {
    const escaped = raw
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;");

    const withBlocks = escaped.replace(/```([\s\S]*?)```/g, (_, code) => `<pre>${code.trim()}</pre>`);
    const withInline = withBlocks.replace(/`([^`]+)`/g, (_, code) => `<code>${code}</code>`);
    const withBold = withInline.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
    return withBold;
  }

  function hideEmptyState() {
    if (els.emptyState) els.emptyState.style.display = "none";
  }

  function showEmptyState() {
    if (els.emptyState) els.emptyState.style.display = "";
  }

  function scrollToBottom(smooth = true) {
    requestAnimationFrame(() => {
      els.thread.scrollTo({
        top: els.thread.scrollHeight,
        behavior: smooth ? "smooth" : "auto",
      });
    });
  }

  function autoresize() {
    els.input.style.height = "auto";
    els.input.style.height = Math.min(els.input.scrollHeight, 120) + "px";
  }

  // -------------------------------------------------------------------
  // Persistence
  // -------------------------------------------------------------------
  function loadHistory() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      return raw ? JSON.parse(raw) : [];
    } catch {
      return [];
    }
  }

  function saveHistory() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(history));
    } catch {
      /* storage unavailable — chat still works, just won't persist */
    }
  }
})();
