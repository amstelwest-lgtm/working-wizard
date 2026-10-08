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
  DRAFT_ADVISORY_PACK_COMMAND,
  DRAFT_ADVISORY_PACK_LABEL,
  deriveMilonBotEndpoint,
  isDeliverableRecommendationQuestion,
  parseAgentObjective,
  persistedCreateIntent,
  routeMilonIntent,
  teamDeskOwnsMount,
} from "./milon-bot-copy.ts";
import { deliverableHandoff } from "./workflow-coach.ts";
import { friendlyReachMessage } from "./reach-error.ts";
import {
  ASK_EMPTY_REPLY,
  ASK_TIMEOUT_REPLY,
  parseAskAiBody,
  parseAskAiPayload,
} from "./ask-ai-response.ts";
import {
  PRECARD_CAP_MESSAGE,
  isPrecardLimitKind,
  normalizePrecardTurnId,
  precardBotRemainingLabel,
  precardCapReason,
} from "./precard-cap.ts";
import { billingStartPath, peekPendingCheckout } from "./pending-checkout.ts";
import { firmSignupCheckoutIntent } from "./stripe-plans.ts";
import { botSignoffCtas, botSignoffDestination, botSignoffStateLine } from "./bot-signoff-path.ts";

export {
  routeMilonIntent,
  MILON_BOT_TITLE,
  MILON_BOT_SUBTITLE,
  MILON_BOT_ACCOUNTANT_CHIPS,
  MILON_BOT_OWNER_CHIPS,
};

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
  const source = typeof md === "string" ? md : "";
  const lines = escapeHtml(source).split("\n");
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
  if (teamDeskOwnsMount(container)) return;
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
    // Accountant studio: open the deliverable this answer is about, with coach intent.
    onOpenDeliverable = null,
    onPersistedCreate = null,
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
  let precardCap = null;
  let precardRemaining = null;
  let answerChips = [];
  let toolHints = [];
  let agentRun = null;
  let workingObjective = false;
  let creatingDeliverable = false;
  let errorMsg = "";
  let history = [];
  let signoffCtas = [];
  let lastQuestion = "";
  let boundClientId = null;
  let requestGen = 0;

  const THREAD_PREFIX = "milon-bot-thread:";

  function currentClientId() {
    return (
      container.dataset.clientId ||
      (typeof window !== "undefined" && window.__askAiClientId) ||
      ""
    );
  }

  function sessionStore() {
    try {
      const store = globalThis.sessionStorage;
      if (!store || typeof store.getItem !== "function") return null;
      return store;
    } catch {
      return null;
    }
  }

  function readThread(clientId) {
    if (!clientId) return [];
    try {
      const store = sessionStore();
      if (!store) return [];
      const raw = store.getItem(THREAD_PREFIX + clientId);
      if (!raw) return [];
      const parsed = JSON.parse(raw);
      if (!Array.isArray(parsed)) return [];
      return parsed
        .filter(
          (turn) =>
            turn &&
            (turn.role === "user" || turn.role === "assistant") &&
            typeof turn.content === "string" &&
            turn.content.trim(),
        )
        .map((turn) => {
          const next = { role: turn.role, content: turn.content };
          const turnId = normalizePrecardTurnId(turn.turnId);
          if (turnId) next.turnId = turnId;
          if (turn.precardCap && isPrecardLimitKind(turn.precardCap.limit)) {
            next.precardCap = { limit: turn.precardCap.limit };
          }
          if (typeof turn.error === "string" && turn.error.trim()) {
            next.error = turn.error.trim().slice(0, 400);
          }
          return next;
        })
        .slice(-16);
    } catch {
      return [];
    }
  }

  function writeThread(clientId, turns) {
    if (!clientId) return;
    try {
      const store = sessionStore();
      if (!store) return;
      const key = THREAD_PREFIX + clientId;
      if (!turns.length) {
        store.removeItem(key);
        return;
      }
      store.setItem(key, JSON.stringify(turns.slice(-16)));
    } catch {
      /* private mode or a full store — the in-memory thread still shows */
    }
  }

  function syncThreadClient() {
    const id = String(currentClientId() || "");
    if (id === boundClientId) return;
    if (boundClientId) writeThread(boundClientId, history);
    boundClientId = id;
    history = readThread(id);
  }

  function render() {
    container.innerHTML = "";

    const widget = document.createElement("div");
    widget.className = studio ? "ask-ai-widget ask-ai-studio" : "ask-ai-widget";
    const unanswered =
      !loading && history.length > 0 && history[history.length - 1]?.role === "user";
    widget.dataset.askState = loading ? "thinking" : unanswered || errorMsg ? "error" : answer ? "answer" : "idle";

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
      sendBtn.addEventListener("click", () => {
        submit();
      });

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
      // compositionstart/end is the reliable IME signal. Chrome sets
      // KeyboardEvent.isComposing on Enter keydown even when the user is not
      // composing, which dropped the send intermittently. keyCode 229 is the
      // IME commit key and must not send. Shift+Enter still inserts a newline.
      let composing = false;
      ta.addEventListener("compositionstart", () => {
        composing = true;
      });
      ta.addEventListener("compositionend", (e) => {
        composing = false;
        question = e.target.value;
        sendBtn.disabled = loading || !question.trim();
      });
      ta.addEventListener("keydown", (e) => {
        if (e.key !== "Enter" || e.shiftKey) return;
        if (composing || e.keyCode === 229) return;
        question = ta.value;
        if (loading || !question.trim()) return;
        e.preventDefault();
        submit();
      });
      panel.appendChild(ta);

      syncThreadClient();

      // Suggestion chips only before the first turn of this session.
      if (!answer && history.length === 0 && !loading) {
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
        precardCap = null;
        precardRemaining = null;
        answerChips = [];
        toolHints = [];
        agentRun = null;
        workingObjective = false;
        pendingIntent = null;
        history = [];
        writeThread(boundClientId || currentClientId(), []);
        errorMsg = "";
        signoffCtas = [];
        lastQuestion = "";
        if (!studio) open = false;
        render();
      });
      actions.appendChild(cancelBtn);
      panel.appendChild(actions);

      // Thinking state
      if (loading) {
        const thinking = document.createElement("div");
        thinking.className = "ask-ai-thinking";
        thinking.textContent = creatingDeliverable
          ? "Saving the draft…"
          : workingObjective
          ? "Working the objective…"
          : pendingIntent === "milon-bot"
            ? "Checking what's on file…"
            : "Analysing your numbers…";
        panel.appendChild(thinking);
      }

      // Error
      if (errorMsg) {
        const err = document.createElement("div");
        err.className = "ask-ai-error";
        err.role = "alert";
        err.textContent = errorMsg;
        panel.appendChild(err);
      }

      const shown = history.slice();
      if (loading && lastQuestion) {
        const last = shown[shown.length - 1];
        if (!last || last.role !== "user" || last.content !== lastQuestion) {
          shown.push({ role: "user", content: lastQuestion });
        }
      }

      if (shown.length > 0) {
        const thread = document.createElement("div");
        thread.className = "ask-ai-thread";
        thread.role = "log";
        shown.forEach((turn, index) => {
          const capLimit = capLimitForTurn(turn);
          const latest =
            index === shown.length - 1 && !loading;
          const latestAssistant =
            turn.role === "assistant" && latest && Boolean(answer) && !capLimit;
          const bubble = document.createElement("div");
          bubble.className = turn.role === "user"
            ? "ask-ai-turn ask-ai-turn-user"
            : capLimit
              ? "ask-ai-turn ask-ai-answer precard-cap-card"
              : "ask-ai-turn ask-ai-answer";
          if (latestAssistant || (turn.role === "assistant" && latest)) bubble.dataset.latest = "1";
          if (capLimit) {
            bubble.dataset.precardCap = capLimit;
            const reason = document.createElement("p");
            reason.className = "precard-cap-reason";
            reason.textContent = precardCapReason(capLimit);
            const title = document.createElement("p");
            title.className = "precard-cap-title";
            title.textContent = PRECARD_CAP_MESSAGE;
            const link = document.createElement("a");
            link.className = "precard-cap-button";
            link.href = billingStartPath(peekPendingCheckout() ?? firmSignupCheckoutIntent());
            link.textContent = "Add a card";
            bubble.appendChild(reason);
            bubble.appendChild(title);
            bubble.appendChild(link);
          } else if (turn.role === "user") {
            bubble.textContent = turn.content;
          } else {
            bubble.innerHTML = renderMarkdown(turn.content);
          }
          if (latestAssistant) {
            decorateLatestAnswer(bubble);
            const left =
              typeof precardRemaining === "number" ? precardBotRemainingLabel(precardRemaining) : null;
            if (left) {
              const note = document.createElement("p");
              note.className = "precard-cap-remaining";
              note.textContent = left;
              bubble.appendChild(note);
            }
          }
          thread.appendChild(bubble);
          if (turn.role === "user" && latest) {
            thread.appendChild(inlineTurnError(turn));
          }
        });
        panel.appendChild(thread);
        thread.scrollTop = thread.scrollHeight;
      }

      widget.appendChild(panel);

      // Focus textarea after render
      requestAnimationFrame(() => ta && ta.focus());
    }

    container.appendChild(widget);
  }

  function decorateLatestAnswer(answerEl) {
    if (agentRun && agentRun.objective) {
      answerEl.appendChild(renderAgentTrace(agentRun));
    }

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
          submit();
        });
        chipRow.appendChild(btn);
      });
      answerEl.appendChild(chipRow);
    }

    if (isDeliverableRecommendationQuestion(lastQuestion)) {
      const draft = document.createElement("button");
      draft.type = "button";
      draft.className = "ask-ai-handoff ask-ai-draft-pack";
      draft.dataset.draftPack = "1";
      draft.textContent = DRAFT_ADVISORY_PACK_LABEL;
      draft.addEventListener("click", () => {
        if (loading) return;
        question = DRAFT_ADVISORY_PACK_COMMAND;
        submit();
      });
      answerEl.appendChild(draft);
    }

    if (signoffCtas.length && typeof onOpenDeliverable === "function") {
      const row = document.createElement("div");
      row.className = "ask-ai-signoff-row";
      const note = document.createElement("p");
      note.className = "ask-ai-signoff-state";
      note.dataset.signoffState = "1";
      note.textContent = botSignoffStateLine(signoffCtas);
      row.appendChild(note);
      signoffCtas.forEach((cta) => {
        const go = document.createElement("button");
        go.type = "button";
        go.className = "ask-ai-handoff ask-ai-signoff";
        go.dataset.signoff = cta.kind;
        go.dataset.tab = cta.tab;
        go.textContent = cta.label;
        go.addEventListener("click", () => {
          onOpenDeliverable(botSignoffDestination(cta, lastQuestion));
        });
        row.appendChild(go);
      });
      answerEl.appendChild(row);
    }

    const handoff =
      signoffCtas.length || typeof onOpenDeliverable !== "function"
        ? null
        : deliverableHandoff(lastQuestion);
    if (handoff) {
      const go = document.createElement("button");
      go.type = "button";
      go.className = "ask-ai-handoff";
      go.dataset.coach = handoff.coach || "";
      go.dataset.tab = handoff.tab;
      go.textContent = `${handoff.label} →`;
      go.addEventListener("click", () => {
        onOpenDeliverable({
          tab: handoff.tab,
          focus: handoff.focus,
          coach: handoff.coach,
          why: handoff.why,
        });
      });
      answerEl.appendChild(go);
    }
  }

  function renderAgentTrace(run) {
    const wrap = document.createElement("div");
    wrap.className = "ask-ai-trace";

    const objective = document.createElement("p");
    objective.className = "ask-ai-trace-objective";
    objective.textContent = `Objective — ${run.objective}`;
    wrap.appendChild(objective);

    const list = document.createElement("ol");
    const steps = Array.isArray(run.trace) ? run.trace : [];
    steps.forEach((step) => {
      if (!step || typeof step !== "object") return;
      const li = document.createElement("li");
      const verified =
        step.verified === true
          ? "verified"
          : step.verified === false
            ? "not verified"
            : step.status;
      const happened =
        step.happened === true ? "happened" : step.happened === false ? "did not happen" : "";
      const head = [step.label || step.tool || "Step", verified, happened]
        .filter(Boolean)
        .join(" — ");
      li.textContent = step.detail ? `${head}. ${step.detail}` : head;
      list.appendChild(li);
    });
    wrap.appendChild(list);

    const outcome = document.createElement("p");
    outcome.className = "ask-ai-trace-outcome";
    const extra = run.escalationReason ? ` ${run.escalationReason}` : "";
    outcome.textContent = `Outcome — ${run.outcomeLabel || run.status || "Stopped"}.${extra}`;
    wrap.appendChild(outcome);

    if (run.claimRejected) {
      const note = document.createElement("p");
      note.className = "ask-ai-trace-note";
      note.textContent = "A completion claim was rejected because the action was not verified.";
      wrap.appendChild(note);
    }

    const questions = Array.isArray(run.questions)
      ? run.questions.filter((q) => typeof q === "string" && q)
      : [];
    if (questions.length) {
      const waiting = document.createElement("p");
      waiting.className = "ask-ai-trace-note";
      waiting.textContent = `Waiting on — ${questions.join(" ")}`;
      wrap.appendChild(waiting);
    }
    return wrap;
  }

  async function readTurn(res) {
    const status = typeof res?.status === "number" ? res.status : 0;
    const ok = Boolean(res?.ok) && status >= 200 && status < 300;
    // text() sees HTML/empty edge bodies. json() is the fallback the unit harness uses.
    if (res && typeof res.text === "function") {
      try {
        return parseAskAiPayload(status, await res.text(), ok);
      } catch (e) {
        return { ok: false, error: friendlyReachMessage(e, "Couldn't read Milōn's reply. Try again.") };
      }
    }
    if (res && typeof res.json === "function") {
      try {
        return parseAskAiBody(status, await res.json(), ok);
      } catch (e) {
        return { ok: false, error: friendlyReachMessage(e, "Couldn't read Milōn's reply. Try again.") };
      }
    }
    return parseAskAiPayload(status, "", ok);
  }

  function capLimitForTurn(turn) {
    if (!turn || turn.role !== "assistant") return null;
    if (turn.precardCap && isPrecardLimitKind(turn.precardCap.limit)) return turn.precardCap.limit;
    if (typeof turn.content === "string" && turn.content.trim() === PRECARD_CAP_MESSAGE) return "bot";
    return null;
  }

  function newTurnId() {
    try {
      if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
        return crypto.randomUUID();
      }
    } catch {
      /* private context */
    }
    return `turn-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
  }

  function askTimeoutMs() {
    const raw = Number(options && options.timeoutMs);
    return Number.isFinite(raw) && raw > 0 ? raw : 90000;
  }

  function priorTurns(turnId) {
    return history
      .filter(
        (turn) =>
          turn &&
          turn.turnId !== turnId &&
          (turn.role === "user" || turn.role === "assistant") &&
          typeof turn.content === "string",
      )
      .slice(-8)
      .map((turn) => ({ role: turn.role, content: turn.content }));
  }

  function inlineTurnError(turn) {
    const err = document.createElement("div");
    err.className = "ask-ai-error ask-ai-inline-error";
    err.role = "alert";
    err.textContent = turn.error || ASK_EMPTY_REPLY;
    const retry = document.createElement("button");
    retry.type = "button";
    retry.className = "ask-ai-retry";
    retry.dataset.retry = "1";
    retry.textContent = "Retry";
    retry.addEventListener("click", () => {
      if (turn.turnId) submit(turn.turnId);
      else {
        question = turn.content;
        submit();
      }
    });
    err.appendChild(retry);
    return err;
  }

  function paintBareError(message) {
    const text = message || "Something went wrong.";
    try {
      container.innerHTML = "";
      if (lastQuestion) {
        const echo = document.createElement("p");
        echo.className = "ask-ai-turn ask-ai-turn-user";
        echo.textContent = lastQuestion;
        container.appendChild(echo);
      }
      const err = document.createElement("div");
      err.className = "ask-ai-error";
      err.role = "alert";
      err.textContent = text;
      container.appendChild(err);
      const retry = document.createElement("button");
      retry.type = "button";
      retry.className = "ask-ai-retry";
      retry.textContent = "Retry";
      retry.addEventListener("click", () => {
        const last = [...history].reverse().find((turn) => turn.role === "user" && turn.turnId);
        if (last) submit(last.turnId);
        else {
          if (lastQuestion && !String(question || "").trim()) question = lastQuestion;
          submit();
        }
      });
      container.appendChild(retry);
    } catch {
      /* last-resort paint failed; nothing safer to do */
    }
  }

  function safeRender(draft) {
    try {
      render();
      return;
    } catch (e) {
      if (typeof answer !== "string" || !answer.trim()) answer = "";
      errorMsg = errorMsg || friendlyReachMessage(e, "Something went wrong.");
      if (!String(question || "").trim() && draft) question = draft;
    }
    try {
      render();
    } catch {
      paintBareError(errorMsg);
    }
  }

  async function submit(retryTurnId) {
    syncThreadClient();
    const retryId = normalizePrecardTurnId(retryTurnId);
    const existing = retryId
      ? history.find((turn) => turn.role === "user" && turn.turnId === retryId)
      : null;
    const q = String(existing ? existing.content : question || "").trim();
    if (!q || loading) return;
    const turnId = retryId || newTurnId();
    const objective = parseAgentObjective(q);
    const createIntent = persistedCreateIntent(q);
    creatingDeliverable = Boolean(createIntent);
    workingObjective = Boolean(objective) && !createIntent;
    pendingIntent = createIntent || objective ? "milon-bot" : routeMilonIntent(q);
    if (!existing) {
      history = [...history, { role: "user", content: q, turnId }];
      if (history.length > 16) history = history.slice(-16);
    } else {
      history = history.map((turn) =>
        turn.role === "user" && turn.turnId === turnId
          ? { role: "user", content: turn.content, turnId }
          : turn,
      );
    }
    writeThread(boundClientId || currentClientId(), history);
    question = "";
    loading = true;
    answer = "";
    precardCap = null;
    precardRemaining = null;
    answerChips = [];
    toolHints = [];
    agentRun = null;
    errorMsg = "";
    signoffCtas = [];
    lastQuestion = q;
    const gen = ++requestGen;
    safeRender(q);

    const controller = new AbortController();
    let timer = 0;
    const pending = (async () => {
      const token = await getToken();
      if (!token) throw new Error("Not signed in — please reload and try again.");

      const clientId =
        container.dataset.clientId ||
        new URLSearchParams(window.location.search).get("clientId") ||
        window.__askAiClientId;

      if (!clientId) throw new Error("No client context found.");

      const useAgent = Boolean(objective) && !createIntent && Boolean(botEndpoint);
      const useCreate = Boolean(createIntent) && Boolean(botEndpoint);
      const useBot = (useAgent || useCreate || pendingIntent === "milon-bot") && botEndpoint;
      const url = useBot ? botEndpoint : endpoint;
      const prior = priorTurns(turnId);
      return fetch(url, {
        method: "POST",
        signal: controller.signal,
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(
          useCreate
            ? {
                clientId,
                mode: "create",
                message: q,
                turnId,
                audience: accountant ? "accountant" : "owner",
              }
            : useAgent
            ? {
                clientId,
                mode: "agent",
                objective,
                turnId,
                audience: accountant ? "accountant" : "owner",
              }
            : useBot
              ? {
                  clientId,
                  message: q,
                  turnId,
                  history: prior,
                  audience: accountant ? "accountant" : "owner",
                }
              : {
                  clientId,
                  question: q,
                  turnId,
                  ...(accountant ? { audience: "accountant" } : {}),
                },
        ),
      });
    })();
    pending.catch(() => {});
    const timeout = new Promise((_, reject) => {
      timer = setTimeout(() => {
        controller.abort();
        const err = new Error(ASK_TIMEOUT_REPLY);
        err.name = "AbortError";
        reject(err);
      }, askTimeoutMs());
      if (timer && typeof timer.unref === "function") timer.unref();
    });

    try {
      const res = await Promise.race([pending, timeout]);
      if (gen !== requestGen) return;
      const turn = await readTurn(res);
      if (gen !== requestGen) return;
      if (!turn.ok) throw new Error(turn.error || "Something went wrong.");

      answer = turn.answer;
      precardCap = turn.precardCap || null;
      precardRemaining = turn.precardCap ? null : turn.precardRemaining ?? null;
      if (!precardCap && answer.includes("Your trial has ended, choose a plan")) {
        window.dispatchEvent(new CustomEvent("milon-starter-trial-ended"));
      }
      answerChips = precardCap ? [] : turn.chips;
      agentRun = turn.run;
      toolHints = turn.tools.map((t) => toolHint(t.name, t.status));
      const assistant = {
        role: "assistant",
        content: answer,
        ...(turn.precardCap && isPrecardLimitKind(turn.precardCap.limit)
          ? { precardCap: { limit: turn.precardCap.limit } }
          : {}),
      };
      history = [
        ...history.map((item) =>
          item.role === "user" && item.turnId === turnId
            ? { role: "user", content: item.content, turnId }
            : item,
        ),
        assistant,
      ];
      if (history.length > 16) history = history.slice(-16);
      writeThread(boundClientId || currentClientId(), history);
      signoffCtas = botSignoffCtas({
        tools: turn.tools,
        created: turn.created,
        run: turn.run,
      });
      try {
        if (turn.created && typeof onPersistedCreate === "function") {
          onPersistedCreate({ question: q, created: turn.created });
        }
      } catch {
        /* a side effect must not hide the reply */
      }
    } catch (e) {
      if (gen !== requestGen) return;
      const timedOut = Boolean(e && e.name === "AbortError");
      const message = timedOut
        ? ASK_TIMEOUT_REPLY
        : friendlyReachMessage(e, "Something went wrong.") || "Something went wrong.";
      const echoed = history.some((item) => item.role === "user" && item.turnId === turnId);
      history = history.map((item) =>
        item.role === "user" && item.turnId === turnId
          ? { role: "user", content: item.content, turnId, error: message }
          : item,
      );
      writeThread(boundClientId || currentClientId(), history);
      if (!echoed && !String(question || "").trim()) question = q;
      answer = "";
      precardCap = null;
      precardRemaining = null;
      answerChips = [];
      toolHints = [];
      agentRun = null;
      signoffCtas = [];
      errorMsg = "";
    } finally {
      clearTimeout(timer);
      if (gen !== requestGen) return;
      loading = false;
      pendingIntent = null;
      workingObjective = false;
      creatingDeliverable = false;
      safeRender(q);
    }
  }

  render();
}
