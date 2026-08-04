/**
 * ask-ai.js — self-contained vanilla JS chat widget
 * Mount with: mountAskAi(element, { endpoint, getToken })
 */

const SPARKLES_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9.937 15.5A2 2 0 0 0 8.5 14.063l-6.135-1.582a.5.5 0 0 1 0-.962L8.5 9.936A2 2 0 0 0 9.937 8.5l1.582-6.135a.5.5 0 0 1 .963 0L14.063 8.5A2 2 0 0 0 15.5 9.937l6.135 1.581a.5.5 0 0 1 0 .964L15.5 14.063a2 2 0 0 0-1.437 1.437l-1.582 6.135a.5.5 0 0 1-.963 0z"/></svg>`;

const SEND_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m22 2-7 20-4-9-9-4Z"/><path d="M22 2 11 13"/></svg>`;

const DEFAULT_CHIPS = [
  "Can I afford a new hire this quarter?",
  "What's my biggest cash leak?",
  "Where am I weakest vs industry?",
];

export function mountAskAi(container, options) {
  const { endpoint, getToken } = options;

  let open = false;
  let loading = false;
  let question = "";
  let answer = "";
  let answerChips = [];
  let errorMsg = "";

  function render() {
    container.innerHTML = "";

    const widget = document.createElement("div");
    widget.className = "ask-ai-widget";

    if (!open) {
      const trigger = document.createElement("button");
      trigger.type = "button";
      trigger.className = "ask-ai-trigger";
      trigger.innerHTML = `<span class="ask-ai-icon">${SPARKLES_SVG}</span>
        <span>Ask anything about your numbers…</span>`;
      trigger.addEventListener("click", () => { open = true; render(); });
      widget.appendChild(trigger);
    } else {
      const panel = document.createElement("div");
      panel.className = "ask-ai-panel";

      // Header
      const header = document.createElement("div");
      header.className = "ask-ai-header";
      header.innerHTML = `<span class="ask-ai-icon" style="width:14px;height:14px">${SPARKLES_SVG}</span> Ask your numbers`;
      panel.appendChild(header);

      // Build sendBtn first so textarea and chip handlers can update its disabled state.
      const sendBtn = document.createElement("button");
      sendBtn.type = "button";
      sendBtn.className = "ask-ai-send";
      sendBtn.disabled = loading || !question.trim();
      sendBtn.innerHTML = `${SEND_SVG} ${loading ? "Thinking…" : "Ask"}`;
      sendBtn.addEventListener("click", submit);

      // Textarea
      const ta = document.createElement("textarea");
      ta.className = "ask-ai-textarea";
      ta.placeholder = "e.g. Can I afford to hire a junior next month? What's killing my margin?";
      ta.value = question;
      ta.disabled = loading;
      ta.addEventListener("input", (e) => {
        question = e.target.value;
        sendBtn.disabled = loading || !question.trim();
      });
      ta.addEventListener("keydown", (e) => {
        if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) submit();
      });
      panel.appendChild(ta);

      // Suggestion chips (before answer)
      if (!answer) {
        const chips = document.createElement("div");
        chips.className = "ask-ai-chips";
        DEFAULT_CHIPS.forEach((c) => {
          const btn = document.createElement("button");
          btn.type = "button";
          btn.className = "ask-ai-chip";
          btn.textContent = c;
          btn.addEventListener("click", () => {
            question = c;
            ta.value = c;
            sendBtn.disabled = false; // chip always provides non-empty text
          });
          chips.appendChild(btn);
        });
        panel.appendChild(chips);
      }

      // Actions row
      const actions = document.createElement("div");
      actions.className = "ask-ai-actions";
      actions.appendChild(sendBtn);

      const cancelBtn = document.createElement("button");
      cancelBtn.type = "button";
      cancelBtn.className = "ask-ai-cancel";
      cancelBtn.textContent = "Cancel";
      cancelBtn.addEventListener("click", () => {
        open = false; question = ""; answer = ""; answerChips = []; errorMsg = "";
        render();
      });
      actions.appendChild(cancelBtn);
      panel.appendChild(actions);

      // Thinking state
      if (loading) {
        const thinking = document.createElement("div");
        thinking.className = "ask-ai-thinking";
        thinking.textContent = "Analysing your numbers…";
        panel.appendChild(thinking);
      }

      // Error
      if (errorMsg) {
        const err = document.createElement("div");
        err.className = "ask-ai-error";
        err.textContent = errorMsg;
        panel.appendChild(err);
      }

      // Answer
      if (answer) {
        const answerEl = document.createElement("div");
        answerEl.className = "ask-ai-answer";
        answerEl.textContent = answer;

        if (answerChips.length > 0) {
          const chipRow = document.createElement("div");
          chipRow.className = "ask-ai-answer-chips";
          answerChips.forEach((c) => {
            const btn = document.createElement("button");
            btn.type = "button";
            btn.className = "ask-ai-chip";
            btn.textContent = c;
            btn.addEventListener("click", () => {
              question = c;
              answer = "";
              answerChips = [];
              errorMsg = "";
              render();
              // auto-submit
              submit();
            });
            chipRow.appendChild(btn);
          });
          answerEl.appendChild(chipRow);
        }

        panel.appendChild(answerEl);
      }

      widget.appendChild(panel);

      // Focus textarea after render
      requestAnimationFrame(() => ta.focus());
    }

    container.appendChild(widget);
  }

  async function submit() {
    const q = question.trim();
    if (!q || loading) return;
    loading = true;
    answer = "";
    answerChips = [];
    errorMsg = "";
    render();

    try {
      const token = await getToken();
      if (!token) throw new Error("Not signed in — please reload and try again.");

      // Extract clientId from URL or container dataset
      const clientId =
        container.dataset.clientId ||
        new URLSearchParams(window.location.search).get("clientId") ||
        window.__askAiClientId;

      if (!clientId) throw new Error("No client context found.");

      const res = await fetch(endpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ clientId, question: q }),
      });

      const data = await res.json();

      if (res.status === 429) throw new Error(data.error || "Rate limit reached — try again in a moment.");
      if (!res.ok) throw new Error(data.error || `Error ${res.status}`);

      answer = data.answer || "No answer returned.";
      answerChips = data.chips || [];
    } catch (e) {
      errorMsg = e.message || "Something went wrong.";
    } finally {
      loading = false;
      render();
    }
  }

  render();
}
