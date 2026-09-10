/**
 * Milōn Bot widget — Ask AI conversational chrome, one branded surface.
 * Numbers Q&A → ask-ai. Brain tools (invite / blockers / propose / draft) → milon-bot.
 * Mount with: mountAskAi(element, { endpoint, getToken })
 */

import {
  MILON_BOT_ACCOUNTANT_CHIPS,
  MILON_BOT_BLURB_ACCOUNTANT,
  MILON_BOT_BLURB_OWNER,
  MILON_BOT_OWNER_CHIPS,
  MILON_BOT_SUBTITLE,
  MILON_BOT_TITLE,
  deriveMilonBotEndpoint,
  routeMilonIntent,
} from "./milon-bot-copy.ts";

export { routeMilonIntent, MILON_BOT_TITLE, MILON_BOT_SUBTITLE, MILON_BOT_ACCOUNTANT_CHIPS, MILON_BOT_OWNER_CHIPS };

const SPARKLES_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9.937 15.5A2 2 0 0 0 8.5 14.063l-6.135-1.582a.5.5 0 0 1 0-.962L8.5 9.936A2 2 0 0 0 9.937 8.5l1.582-6.135a.5.5 0 0 1 .963 0L14.063 8.5A2 2 0 0 0 15.5 9.937l6.135 1.581a.5.5 0 0 1 0 .964L15.5 14.063a2 2 0 0 0-1.437 1.437l-1.582 6.135a.5.5 0 0 1-.963 0z"/></svg>`;

const SEND_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m22 2-7 20-4-9-9-4Z"/><path d="M22 2 11 13"/></svg>`;

const TOOL_LABELS = {
  get_invite_status: "Invite status",
  list_blockers: "Blockers",
  propose_next_steps: "Propose",
  draft_deliverable: "Draft",
  answer_from_brain: "Brain",
};

function toolHint(name, status) {
  const base = TOOL_LABELS[name] ?? name;
  if (status === "empty") return `${base} · empty`;
  if (status === "error") return `${base} · failed`;
  return base;
}

// ── Minimal safe markdown → HTML renderer ───────────────────────────────
// Escapes all HTML first, then converts the subset Claude actually emits:
// headings, bold, italics, tables, bullet/numbered lists, paragraphs.
function escapeHtml(s) {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function inlineMd(s) {
  return s
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
    .replace(/(^|[^*])\*([^*\n]+)\*/g, "$1<em>$2</em>")
    .replace(/`([^`]+)`/g, "<code>$1</code>");
}

export function renderMarkdown(md) {
  const lines = escapeHtml(md).split("\n");
  const out = [];
  let listType = null; // "ul" | "ol"
  let tableRows = null; // array of arrays

  const closeList = () => {
    if (listType) {
      out.push(`</${listType}>`);
      listType = null;
    }
  };
  const flushTable = () => {
    if (!tableRows || tableRows.length === 0) {
      tableRows = null;
      return;
    }
    const [head, ...body] = tableRows;
    let html = '<table class="ask-ai-md-table"><thead><tr>';
    html += head.map((c) => `<th>${inlineMd(c)}</th>`).join("");
    html += "</tr></thead><tbody>";
    for (const row of body) {
      html += "<tr>" + row.map((c) => `<td>${inlineMd(c)}</td>`).join("") + "</tr>";
    }
    html += "</tbody></table>";
    out.push(html);
    tableRows = null;
  };

  for (const raw of lines) {
    const line = raw.trimEnd();
    const trimmed = line.trim();

    // Table row?
    if (/^\|.*\|$/.test(trimmed)) {
      const cells = trimmed
        .slice(1, -1)
        .split("|")
        .map((c) => c.trim());
      // Separator row (|---|---|) — skip
      if (cells.every((c) => /^:?-{2,}:?$/.test(c) || c === "")) continue;
      closeList();
      if (!tableRows) tableRows = [];
      tableRows.push(cells);
      continue;
    }
    flushTable();

    if (trimmed === "") {
      closeList();
      continue;
    }

    const h = trimmed.match(/^(#{1,4})\s+(.*)$/);
    if (h) {
      closeList();
      const lvl = Math.min(h[1].length + 2, 5); // ## → h4-ish visual scale
      out.push(`<h${lvl} class="ask-ai-md-h">${inlineMd(h[2])}</h${lvl}>`);
      continue;
    }

    const ul = trimmed.match(/^[-•]\s+(.*)$/);
    if (ul) {
      if (listType !== "ul") {
        closeList();
        out.push("<ul>");
        listType = "ul";
      }
      out.push(`<li>${inlineMd(ul[1])}</li>`);
      continue;
    }
    const ol = trimmed.match(/^\d+[.)]\s+(.*)$/);
    if (ol) {
      if (listType !== "ol") {
        closeList();
        out.push("<ol>");
        listType = "ol";
      }
      out.push(`<li>${inlineMd(ol[1])}</li>`);
      continue;
    }

    closeList();
    out.push(`<p>${inlineMd(trimmed)}</p>`);
  }
  closeList();
  flushTable();
  return out.join("");
}

export function mountAskAi(container, options) {
  const {
    endpoint,
    botEndpoint: botEndpointOverride,
    getToken,
    variant = "compact",
    audience = "owner",
    chips: chipOverride,
    placeholder: placeholderOverride,
    heading: headingOverride,
    subtitle: subtitleOverride,
    blurb: blurbOverride,
    hideBrand = false,
    // Small line under the header, e.g. "answers get more relevant once your
    // figures are in". Omit / null to hide.
    note = null,
  } = options || {};
  const studio = variant === "studio";
  const accountant = audience === "accountant";
  const botEndpoint = botEndpointOverride || deriveMilonBotEndpoint(endpoint);
  const suggestionChips =
    chipOverride || (accountant ? MILON_BOT_ACCOUNTANT_CHIPS : MILON_BOT_OWNER_CHIPS);
  const heading = headingOverride || MILON_BOT_TITLE;
  const subtitle = subtitleOverride === undefined ? MILON_BOT_SUBTITLE : subtitleOverride;
  const blurb =
    blurbOverride === undefined
      ? accountant
        ? MILON_BOT_BLURB_ACCOUNTANT
        : MILON_BOT_BLURB_OWNER
      : blurbOverride;
  const placeholder =
    placeholderOverride ||
    (accountant
      ? "e.g. What's still outstanding — or where's the drag vs peers?"
      : "e.g. Am I healthy, or what's still outstanding?");

  let open = studio;
  let loading = false;
  let pendingIntent = null;
  let question = "";
  let answer = "";
  let answerChips = [];
  let toolHints = [];
  let errorMsg = "";
  let history = [];

  function render() {
    container.innerHTML = "";

    const widget = document.createElement("div");
    widget.className = studio ? "ask-ai-widget ask-ai-studio" : "ask-ai-widget";

    if (!open) {
      const trigger = document.createElement("button");
      trigger.type = "button";
      trigger.className = "ask-ai-trigger";
      trigger.innerHTML = `<span class="ask-ai-icon">${SPARKLES_SVG}</span>
        <span>${accountant ? "Ask Milōn Bot about this client…" : "Ask Milōn Bot…"}</span>`;
      trigger.addEventListener("click", () => {
        open = true;
        render();
      });
      widget.appendChild(trigger);
    } else {
      const panel = document.createElement("div");
      panel.className = "ask-ai-panel";

      if (!hideBrand) {
        const brand = document.createElement("div");
        brand.className = "ask-ai-brand";
        const header = document.createElement("div");
        header.className = "ask-ai-header";
        header.innerHTML = `<span class="ask-ai-icon" style="width:14px;height:14px">${SPARKLES_SVG}</span> <span class="ask-ai-title">${heading}</span>`;
        brand.appendChild(header);
        if (subtitle) {
          const sub = document.createElement("p");
          sub.className = "ask-ai-subtitle";
          sub.textContent = subtitle;
          brand.appendChild(sub);
        }
        if (blurb) {
          const blurbEl = document.createElement("p");
          blurbEl.className = "ask-ai-blurb";
          blurbEl.textContent = blurb;
          brand.appendChild(blurbEl);
        }
        panel.appendChild(brand);
      }

      if (note) {
        const noteEl = document.createElement("p");
        noteEl.className = "ask-ai-note";
        noteEl.textContent = note;
        panel.appendChild(noteEl);
      }

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
      ta.placeholder = placeholder;
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
        suggestionChips.forEach((c) => {
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
      cancelBtn.textContent = studio ? "Clear" : "Cancel";
      cancelBtn.addEventListener("click", () => {
        question = "";
        answer = "";
        answerChips = [];
        toolHints = [];
        pendingIntent = null;
        history = [];
        errorMsg = "";
        if (!studio) open = false;
        render();
      });
      actions.appendChild(cancelBtn);
      panel.appendChild(actions);

      // Thinking state
      if (loading) {
        const thinking = document.createElement("div");
        thinking.className = "ask-ai-thinking";
        thinking.textContent =
          pendingIntent === "milon-bot" ? "Checking what's on file…" : "Analysing your numbers…";
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
        answerEl.innerHTML = renderMarkdown(answer);

        if (toolHints.length > 0) {
          const hint = document.createElement("p");
          hint.className = "ask-ai-tools";
          hint.textContent = toolHints.join(" · ");
          answerEl.appendChild(hint);
        }

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
              toolHints = [];
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
    pendingIntent = routeMilonIntent(q);
    loading = true;
    answer = "";
    answerChips = [];
    toolHints = [];
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

      const useBot = pendingIntent === "milon-bot" && botEndpoint;
      const url = useBot ? botEndpoint : endpoint;
      const res = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(
          useBot
            ? {
                clientId,
                message: q,
                history: history.slice(-8),
                audience: accountant ? "accountant" : "owner",
              }
            : {
                clientId,
                question: q,
                ...(accountant ? { audience: "accountant" } : {}),
              },
        ),
      });

      const data = await res.json();

      if (res.status === 429)
        throw new Error(data.error || "Rate limit reached — try again in a moment.");
      if (!res.ok) throw new Error(data.error || `Error ${res.status}`);

      answer = data.answer || "No answer returned.";
      answerChips = data.chips || [];
      toolHints = Array.isArray(data.tools)
        ? data.tools.map((t) => toolHint(t.name, t.status))
        : [];
      history = [...history, { role: "user", content: q }, { role: "assistant", content: answer }];
      if (history.length > 16) history = history.slice(-16);
    } catch (e) {
      errorMsg = e.message || "Something went wrong.";
    } finally {
      loading = false;
      pendingIntent = null;
      render();
    }
  }

  render();
}
