(() => {
  // ── State ──────────────────────────────────────────────────────────────────
  let isOpen = false;
  let messages = []; // { role: 'user' | 'assistant', content: string }

  // ── DOM refs ───────────────────────────────────────────────────────────────
  const toggleBtn = document.getElementById("chat-toggle-btn");
  const widget = document.getElementById("chat-widget");
  const closeBtn = document.getElementById("chat-close-btn");
  const messagesEl = document.getElementById("chat-messages");
  const form = document.getElementById("chat-form");
  const input = document.getElementById("chat-input");
  const sendBtn = document.getElementById("chat-send-btn");

  // ── Toggle open / close ────────────────────────────────────────────────────
  function openChat() {
    isOpen = true;
    widget.classList.remove("hidden", "chat-close");
    void widget.offsetWidth; // force reflow so animation restarts
    widget.classList.add("chat-open");
    toggleBtn.setAttribute("aria-expanded", "true");
    input.focus();

    if (messages.length === 0) {
      appendMessage(
        "assistant",
        "Hi! I'm Geanna 👋 — ask me anything about my skills, projects, internship, or background. I'd love to chat!"
      );
    }
  }

  function closeChat() {
    isOpen = false;
    widget.classList.remove("chat-open");
    widget.classList.add("chat-close");
    setTimeout(() => widget.classList.add("hidden"), 200);
    toggleBtn.setAttribute("aria-expanded", "false");
  }

  const iconOpen = document.getElementById("chat-icon-open");
  const iconClose = document.getElementById("chat-icon-close");

  function syncToggleIcon() {
    iconOpen.classList.toggle("hidden", isOpen);
    iconClose.classList.toggle("hidden", !isOpen);
  }

  toggleBtn.addEventListener("click", () => {
    isOpen ? closeChat() : openChat();
    syncToggleIcon();
  });
  closeBtn.addEventListener("click", () => { closeChat(); syncToggleIcon(); });

  // Close on Escape
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && isOpen) { closeChat(); syncToggleIcon(); }
  });

  // ── Render a message bubble ────────────────────────────────────────────────
  function appendMessage(role, content) {
    messages.push({ role, content });

    const wrapper = document.createElement("div");
    wrapper.className = `flex ${role === "user" ? "justify-end" : "justify-start"} animate-fade-in`;

    const bubble = document.createElement("div");
    bubble.className =
      role === "user"
        ? "user-bubble max-w-[80%] rounded-2xl rounded-br-sm px-4 py-2 text-sm"
        : "assistant-bubble max-w-[80%] rounded-2xl rounded-bl-sm px-4 py-2 text-sm";

    // Render newlines as <br>
    bubble.innerHTML = escapeHtml(content).replace(/\n/g, "<br>");

    wrapper.appendChild(bubble);
    messagesEl.appendChild(wrapper);
    scrollToBottom();
  }

  // ── Typing indicator ───────────────────────────────────────────────────────
  function showTyping() {
    const el = document.createElement("div");
    el.id = "chat-typing";
    el.className = "flex justify-start";
    el.innerHTML = `
      <div class="assistant-bubble rounded-2xl rounded-bl-sm px-4 py-2 text-sm flex items-center gap-1">
        <span class="typing-dot"></span>
        <span class="typing-dot animation-delay-150"></span>
        <span class="typing-dot animation-delay-300"></span>
      </div>`;
    messagesEl.appendChild(el);
    scrollToBottom();
  }

  function hideTyping() {
    document.getElementById("chat-typing")?.remove();
  }

  // ── Scroll helpers ─────────────────────────────────────────────────────────
  function scrollToBottom() {
    messagesEl.scrollTop = messagesEl.scrollHeight;
  }

  // ── Escape HTML to prevent XSS ─────────────────────────────────────────────
  function escapeHtml(str) {
    return str
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  // ── Send message ───────────────────────────────────────────────────────────
  async function sendMessage(text) {
    if (!text.trim()) return;

    appendMessage("user", text);
    input.value = "";
    setLoading(true);
    showTyping();

    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages }),
      });

      const data = await res.json();
      hideTyping();

      if (res.status === 429) {
        appendMessage("assistant", `⏳ ${data.error}`);
        return;
      }

      if (!res.ok) throw new Error(data.error || "Unknown error");
      appendMessage("assistant", data.reply);
    } catch (err) {
      hideTyping();
      appendMessage("assistant", "Sorry, something went wrong. Please try again.");
      console.error("Chat error:", err);
    } finally {
      setLoading(false);
      input.focus();
    }
  }

  function setLoading(loading) {
    sendBtn.disabled = loading;
    input.disabled = loading;
    sendBtn.classList.toggle("opacity-50", loading);
    sendBtn.classList.toggle("cursor-not-allowed", loading);
  }

  // ── Form submit ────────────────────────────────────────────────────────────
  form.addEventListener("submit", (e) => {
    e.preventDefault();
    sendMessage(input.value);
  });

  // Send on Enter (Shift+Enter = newline not applicable for single-line input)
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      sendMessage(input.value);
    }
  });
})();
