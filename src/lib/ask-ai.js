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
  fmClientReportRoute,
  isDeliverableRecommendationQuestion,
  parseAgentObjective,
  persistedCreateIntent,
  routeMilonIntent,
} from "./milon-bot-copy.ts";
import {
  clientReportChatOutcome,
  deriveFinancialManagerEndpoint,
  unnamedClientReportReply,
} from "./client-report-prepare.ts";
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
  precardBotLastQuestionHint,
  precardBotRemainingLabel,
  precardCapReason,
} from "./precard-cap.ts";
import { billingStartPath, peekPendingCheckout } from "./pending-checkout.ts";
import { firmSignupCheckoutIntent } from "./stripe-plans.ts";
import { loadStarterMonthlyLabel, STARTER_PLAN_ONLY } from "./trial-card-price.ts";
import { botSignoffCtas, botSignoffDestination, botSignoffStateLine } from "./bot-signoff-path.ts";
import { stripMilonProjection } from "./milon-projection.ts";
import { supabase } from "../integrations/supabase/client.ts";
import { authRetryPlanFromResponse } from "./edge-auth-retry.ts";
import {
  STARTER_TRIAL_ENDED_MESSAGE,
  isStarterTrialEndedMessage,
} from "./starter-trial-generation.ts";
import { OWNER_ACCOUNTANT_TRIAL_NOTE } from "./owner-trial-ended.ts";
import {
  TRIAL_ENDED_BILLING_LABEL,
  trialEndedBillingHref,
  trialEndedOwnerAsksAccountant,
} from "./trial-ended-billing.ts";
import { startBrowserSpeech, VOICE_MISSED, VOICE_UNAVAILABLE } from "./browser-speech.ts";
import { figureDecisionError, figureProposalCardCopy, figureProposalTurn } from "./figure-proposal.ts";

export {
  routeMilonIntent,
  MILON_BOT_TITLE,
  MILON_BOT_SUBTITLE,
  MILON_BOT_ACCOUNTANT_CHIPS,
  MILON_BOT_OWNER_CHIPS,
};

const SPARKLES_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9.937 15.5A2 2 0 0 0 8.5 14.063l-6.135-1.582a.5.5 0 0 1 0-.962L8.5 9.936A2 2 0 0 0 9.937 8.5l1.582-6.135a.5.5 0 0 1 .963 0L14.063 8.5A2 2 0 0 0 15.5 9.937l6.135 1.581a.5.5 0 0 1 0 .964L15.5 14.063a2 2 0 0 0-1.437 1.437l-1.582 6.135a.5.5 0 0 1-.963 0z"/></svg>`;

const SEND_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m22 2-7 20-4-9-9-4Z"/><path d="M22 2 11 13"/></svg>`;

const MIC_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><rect x="9" y="3" width="6" height="11" rx="3"/><path d="M6 11a6 6 0 0 0 12 0M12 17v3M8 20h8"/></svg>`;

const TOOL_LABELS = {
  get_invite_status: "Invite status",
  list_blockers: "Blockers",
  propose_next_steps: "Propose",
  draft_deliverable: "Draft",
  answer_from_brain: "Brain",
};

function storedProposal(raw) {
  if (!raw || typeof raw !== "object") return null;
  const id = typeof raw.id === "string" ? raw.id.trim() : "";
  const surface = raw.surface;
  if (!id || (surface !== "cash" && surface !== "budget" && surface !== "waterfall")) return null;
  if (!raw.patch || typeof raw.patch !== "object" || Array.isArray(raw.patch)) return null;
  return {
    id,
    surface,
    note: typeof raw.note === "string" ? raw.note : "",
    patch: raw.patch,
    beforeValues: raw.beforeValues && typeof raw.beforeValues === "object" ? raw.beforeValues : {},
    canDecide: raw.canDecide !== false,
    status: raw.status === "decided" ? "decided" : "pending",
  };
}

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
    // Called on a 401 before the single automatic retry. Absent mounts refresh here.
    refreshSession = null,
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
  let proposingFigure = false;
  let errorMsg = "";
  let history = [];
  let signoffCtas = [];
  let lastQuestion = "";
  let starterMonthly = "";
  let starterMonthlyStarted = false;
  let boundClientId = null;
  let boundAgent = "";
  let boundForecastKey = "";
  let requestGen = 0;
  let trialMountGen = 0;
  let listening = false;
  let speechSession = null;
  let listenGen = 0;
  const trialCleanups = [];

  const THREAD_PREFIX = "milon-bot-thread:";
  const THREAD_AGENTS = new Set(["financial_manager", "analyst", "advisor"]);

  function currentClientId() {
    return (
      container.dataset.clientId || (typeof window !== "undefined" && window.__askAiClientId) || ""
    );
  }

  function currentAgent() {
    const agent = container.dataset.agent || "";
    return THREAD_AGENTS.has(agent) ? agent : "";
  }

  function threadStorageKey(clientId, agent) {
    if (!clientId) return "";
    return agent ? THREAD_PREFIX + clientId + ":" + agent : THREAD_PREFIX + clientId;
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

  function currentForecastKey() {
    return container.dataset.forecastKey || "";
  }

  function readThread(clientId, agent) {
    if (!clientId) return [];
    try {
      const store = sessionStore();
      if (!store) return [];
      const scoped = agent || "";
      const key = threadStorageKey(clientId, scoped);
      let raw = store.getItem(key);
      // A thread written before agents were split stays with Financial Manager.
      if (!raw && scoped === "financial_manager") {
        const legacy = store.getItem(THREAD_PREFIX + clientId);
        if (legacy) {
          store.setItem(key, legacy);
          raw = legacy;
        }
      }
      if (!raw) return [];
      let parsed = JSON.parse(raw);
      const forecastKey = currentForecastKey();
      if (parsed && !Array.isArray(parsed) && Array.isArray(parsed.turns)) {
        if (forecastKey && parsed.key !== forecastKey) return [];
        parsed = parsed.turns;
      } else if (Array.isArray(parsed) && forecastKey) {
        // An answer stored before the forecast key is stale once figures are keyed.
        return [];
      }
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
          if (turn.trialEnded === true) next.trialEnded = true;
          const proposal = storedProposal(turn.proposal);
          if (proposal) next.proposal = proposal;
          const download = turn.reportDownload;
          if (
            download &&
            typeof download.href === "string" &&
            download.href.startsWith("/clients/") &&
            download.href.includes("action=download")
          ) {
            next.reportDownload = {
              href: download.href,
              label:
                typeof download.label === "string" && download.label.trim()
                  ? download.label.trim().slice(0, 80)
                  : "Download the report",
            };
          }
          return next;
        })
        .slice(-16);
    } catch {
      return [];
    }
  }

  function writeThread(clientId, turns, agent, forecastKey) {
    if (!clientId) return;
    try {
      const store = sessionStore();
      if (!store) return;
      const key = threadStorageKey(clientId, agent == null ? boundAgent : agent);
      if (!turns.length) {
        store.removeItem(key);
        return;
      }
      store.setItem(
        key,
        JSON.stringify({
          key: forecastKey == null ? currentForecastKey() : forecastKey,
          turns: turns.slice(-16),
        }),
      );
    } catch {
      /* private mode or a full store — the in-memory thread still shows */
    }
  }

  function syncThreadClient() {
    const id = String(currentClientId() || "");
    const agent = currentAgent();
    const forecastKey = currentForecastKey();
    if (id === boundClientId && agent === boundAgent && forecastKey === boundForecastKey) return;
    const switchingThread = boundClientId && (id !== boundClientId || agent !== boundAgent);
    if (switchingThread) writeThread(boundClientId, history, boundAgent, boundForecastKey);
    boundClientId = id;
    boundAgent = agent;
    boundForecastKey = forecastKey;
    history = readThread(id, agent);
  }

  function speechLang() {
    const lang = typeof navigator !== "undefined" ? navigator.language : "";
    return lang || "en";
  }

  function stopSpeech() {
    listenGen += 1;
    const session = speechSession;
    speechSession = null;
    listening = false;
    if (session) session.stop();
  }

  // Speak writes the draft only. Ask / Send is still the thing that submits.
  function speak() {
    if (loading) return;
    if (listening) {
      stopSpeech();
      render();
      return;
    }
    const gen = ++listenGen;
    const session = startBrowserSpeech({
      lang: speechLang(),
      onTranscript(said) {
        if (gen !== listenGen) return;
        question = said;
        errorMsg = "";
        const ta = container.querySelector(".ask-ai-textarea");
        if (ta) ta.value = said;
        const sendBtn = container.querySelector(".ask-ai-send");
        if (sendBtn) sendBtn.disabled = loading || !said.trim();
      },
      onMissed() {
        if (gen !== listenGen) return;
        listening = false;
        speechSession = null;
        errorMsg = VOICE_MISSED;
        render();
      },
      onEnd() {
        if (gen !== listenGen) return;
        const wasListening = listening;
        listening = false;
        speechSession = null;
        if (wasListening) render();
      },
    });
    if (!session) {
      errorMsg = VOICE_UNAVAILABLE;
      listening = false;
      render();
      return;
    }
    speechSession = session;
    errorMsg = "";
    listening = true;
    render();
  }

  function refreshThreadFromContext() {
    const id = String(currentClientId() || "");
    const agent = currentAgent();
    const forecastKey = currentForecastKey();
    if (id === boundClientId && agent === boundAgent && forecastKey === boundForecastKey) return;
    stopSpeech();
    syncThreadClient();
    question = "";
    answer = "";
    errorMsg = "";
    render();
  }

  function mark(el, name, value) {
    if (typeof el?.setAttribute === "function") el.setAttribute(name, value);
  }

  function dropTrialMounts() {
    trialMountGen += 1;
    const pending = trialCleanups.splice(0, trialCleanups.length);
    for (const cleanup of pending) {
      try {
        cleanup();
      } catch {
        /* the host is already gone */
      }
    }
  }

  function signalIsTrialEnded(message, code) {
    const text = typeof message === "string" ? message : "";
    const extra = typeof code === "string" ? code : "";
    return isStarterTrialEndedMessage(text) || (extra !== "" && isStarterTrialEndedMessage(extra));
  }

  function turnIsTrialEnded(turn) {
    if (!turn) return false;
    if (turn.trialEnded === true) return true;
    if (turn.role === "user") return signalIsTrialEnded(turn.error, turn.code);
    if (turn.role === "assistant" && !capLimitForTurn(turn)) {
      return signalIsTrialEnded(turn.content, null);
    }
    return false;
  }

  function firmIdForTrial() {
    const id = container.dataset && container.dataset.firmId;
    return typeof id === "string" && id.trim() ? id.trim() : null;
  }

  function notifyTrialEnded() {
    try {
      if (typeof window === "undefined" || typeof window.dispatchEvent !== "function") return;
      window.dispatchEvent(new CustomEvent("milon-starter-trial-ended"));
    } catch {
      /* the card in the thread still stands */
    }
  }

  // Same sentences as TrialEndedPlanCard. The React card replaces this shell
  // once it mounts. If that chunk fails, keep the title and the note. An
  // accountant, or an owner on their own plan, gets Plan & billing. An owner
  // whose firm is an accountant firm gets the renewal note and no plan link.
  // A real ask failure still keeps the red Retry row.
  function paintTrialEndedShell(host) {
    const section = document.createElement("section");
    section.className = "trial-ended-block";
    section.role = "region";
    if (section.dataset) section.dataset.trialEnded = "plan";
    const title = document.createElement("p");
    title.className = "trial-ended-title";
    title.textContent = STARTER_TRIAL_ENDED_MESSAGE;
    const note = document.createElement("p");
    note.className = "trial-ended-note";
    note.textContent = "Loading plans…";
    section.appendChild(title);
    section.appendChild(note);
    host.appendChild(section);
    return { note, section };
  }

  function appendTrialEndedBillingLink(section) {
    if (!section || typeof section.appendChild !== "function") return;
    const link = document.createElement("a");
    link.className = "trial-ended-billing";
    const href = trialEndedBillingHref(accountant ? "accountant" : "owner");
    if (typeof link.setAttribute === "function") link.setAttribute("href", href);
    link.href = href;
    link.textContent = TRIAL_ENDED_BILLING_LABEL;
    section.appendChild(link);
  }

  function mountTrialEnded(parent) {
    const host = document.createElement("div");
    host.className = "ask-ai-trial-ended-host";
    if (host.dataset) host.dataset.trialEnded = "1";
    const shell = paintTrialEndedShell(host);
    const note = shell.note;
    const section = shell.section;
    parent.appendChild(host);
    const gen = trialMountGen;
    if (typeof HTMLElement === "undefined" || !(host instanceof HTMLElement)) return host;
    const firmId = firmIdForTrial();
    const loadTrialChunk =
      options && typeof options.loadTrialChunk === "function"
        ? options.loadTrialChunk
        : () => import("./chat-trial-ended-mount.ts");
    Promise.resolve()
      .then(() => loadTrialChunk())
      .then((mod) => {
        if (gen !== trialMountGen) return;
        if (typeof host.isConnected === "boolean" && !host.isConnected) return;
        if (typeof host.replaceChildren === "function") host.replaceChildren();
        const cleanup = mod.mountChatTrialEndedPlan(
          host,
          firmId,
          accountant ? "accountant" : "owner",
        );
        if (typeof cleanup !== "function") return;
        if (gen !== trialMountGen) {
          cleanup();
          return;
        }
        trialCleanups.push(cleanup);
      })
      .catch(() => {
        const asksAccountant = trialEndedOwnerAsksAccountant(
          accountant ? "accountant" : "owner",
          firmId,
        );
        if (note) {
          note.textContent = asksAccountant
            ? OWNER_ACCOUNTANT_TRIAL_NOTE
            : "Plans could not be loaded. Refresh and try again.";
        }
        if (asksAccountant && section?.dataset) section.dataset.ownerTrialEnded = "accountant";
        if (
          section &&
          section.parentElement !== host &&
          typeof host.replaceChildren === "function"
        ) {
          host.replaceChildren(section);
        }
        if (!asksAccountant) appendTrialEndedBillingLink(section);
      });
    return host;
  }

  function settleFigure(proposal, content) {
    history = history.map((turn) =>
      turn.proposal && turn.proposal.id === proposal.id
        ? { ...turn, content, proposal: { ...turn.proposal, status: "decided" } }
        : turn,
    );
    writeThread(boundClientId || currentClientId(), history);
    if (typeof window !== "undefined") {
      window.dispatchEvent(
        new CustomEvent("figure-proposals-changed", {
          detail: { clientId: currentClientId(), surface: proposal.surface },
        }),
      );
    }
  }

  async function decideFigure(proposal, confirm) {
    const { error } = await supabase.rpc(
      confirm ? "apply_figure_proposal" : "reject_figure_proposal",
      confirm ? { p_id: proposal.id, p_confirm: true } : { p_id: proposal.id },
    );
    if (error) {
      errorMsg = figureDecisionError(error.message || "");
      render();
      return;
    }
    const content = confirm
      ? "Saved. The change is on file."
      : "Proposal rejected. The saved figures were not changed.";
    answer = content;
    errorMsg = "";
    settleFigure(proposal, content);
    render();
  }

  function buildFigureCard(turns) {
    const pending = [...turns].reverse().find((turn) => turn.proposal && turn.proposal.status === "pending");
    if (!pending) return null;
    const proposal = pending.proposal;
    const copy = figureProposalCardCopy({
      surface: proposal.surface,
      patch: proposal.patch,
      beforeValues: proposal.beforeValues || {},
      canDecide: proposal.canDecide !== false,
    });
    const card = document.createElement("section");
    card.className = "ask-ai-figure-card";
    card.dataset.figureProposals = proposal.surface;
    card.dataset.figureProposal = proposal.id;
    card.setAttribute("aria-label", copy.title);
    const title = document.createElement("h3");
    title.className = "ask-ai-figure-title";
    title.textContent = copy.title;
    card.appendChild(title);
    if (proposal.note) {
      const note = document.createElement("p");
      note.className = "ask-ai-figure-note";
      note.textContent = proposal.note;
      card.appendChild(note);
    }
    if (copy.lines.length) {
      const list = document.createElement("ul");
      list.className = "ask-ai-figure-lines";
      copy.lines.forEach((text) => {
        const li = document.createElement("li");
        li.textContent = text;
        list.appendChild(li);
      });
      card.appendChild(list);
    }
    if (copy.actions.length) {
      const row = document.createElement("div");
      row.className = "ask-ai-figure-actions";
      copy.actions.forEach((label) => {
        const btn = document.createElement("button");
        btn.type = "button";
        btn.className = label.indexOf("Confirm") === 0 ? "ask-ai-figure-confirm" : "ask-ai-figure-reject";
        btn.textContent = label;
        btn.addEventListener("click", () => {
          btn.disabled = true;
          void decideFigure(proposal, label.indexOf("Confirm") === 0);
        });
        row.appendChild(btn);
      });
      card.appendChild(row);
    }
    return card;
  }

  function render() {
    dropTrialMounts();
    container.innerHTML = "";
    syncThreadClient();

    const widget = document.createElement("div");
    widget.className = studio ? "ask-ai-widget ask-ai-studio" : "ask-ai-widget";
    const lastTurn = history[history.length - 1];
    const unanswered = !loading && history.length > 0 && lastTurn?.role === "user";
    const trialEnded =
      !loading && (signalIsTrialEnded(errorMsg, null) || turnIsTrialEnded(lastTurn));
    widget.dataset.askState = loading
      ? "thinking"
      : trialEnded
        ? "trial-ended"
        : unanswered || errorMsg
          ? "error"
          : answer
            ? "answer"
            : "idle";
    mark(widget, "aria-busy", loading ? "true" : "false");

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
      sendBtn.innerHTML = `${SEND_SVG} ${loading ? "Thinking…" : studio ? "Send" : "Ask"}`;
      sendBtn.addEventListener("click", () => {
        submit();
      });

      // Textarea
      const ta = document.createElement("textarea");
      ta.className = "ask-ai-textarea";
      ta.placeholder = listening ? "Listening." : placeholder;
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

      // Actions row. Speak fills the draft; Ask / Send is unchanged.
      const actions = document.createElement("div");
      actions.className = "ask-ai-actions";
      if (accountant) {
        const micBtn = document.createElement("button");
        micBtn.type = "button";
        micBtn.className = listening ? "ask-ai-mic is-on" : "ask-ai-mic";
        micBtn.disabled = loading;
        micBtn.innerHTML = MIC_SVG;
        mark(micBtn, "aria-pressed", listening ? "true" : "false");
        mark(micBtn, "aria-label", listening ? "Stop listening" : "Speak");
        micBtn.addEventListener("click", () => {
          speak();
        });
        actions.appendChild(micBtn);
      }
      actions.appendChild(sendBtn);

      const cancelBtn = document.createElement("button");
      cancelBtn.type = "button";
      cancelBtn.className = "ask-ai-cancel";
      cancelBtn.textContent = studio ? "Clear" : "Cancel";
      cancelBtn.addEventListener("click", () => {
        stopSpeech();
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
        thinking.textContent = proposingFigure
          ? "Saving the proposal…"
          : creatingDeliverable
            ? "Saving the draft…"
            : workingObjective
              ? "Working the objective…"
              : pendingIntent === "milon-bot"
                ? "Checking what's on file…"
                : "Analysing your numbers…";
        panel.appendChild(thinking);
      }

      // Error. A trial-ended block is the plan card, not a red Retry.
      if (errorMsg) {
        if (signalIsTrialEnded(errorMsg, null)) {
          mountTrialEnded(panel);
        } else {
          const err = document.createElement("div");
          err.className = "ask-ai-error";
          err.role = "alert";
          err.textContent = errorMsg;
          panel.appendChild(err);
        }
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
        let capCard = null;
        shown.forEach((turn, index) => {
          const capLimit = capLimitForTurn(turn);
          if (capLimit && capCard) return;
          const trialAnswer = turn.role === "assistant" && turnIsTrialEnded(turn);
          const latest = index === shown.length - 1 && !loading;
          const latestAssistant =
            turn.role === "assistant" && latest && Boolean(answer) && !capLimit && !trialAnswer;
          const bubble = document.createElement("div");
          bubble.className =
            turn.role === "user"
              ? "ask-ai-turn ask-ai-turn-user"
              : capLimit
                ? "ask-ai-turn ask-ai-answer precard-cap-card"
                : trialAnswer
                  ? "ask-ai-turn ask-ai-trial-ended"
                  : "ask-ai-turn ask-ai-answer";
          if (latestAssistant || (turn.role === "assistant" && latest)) bubble.dataset.latest = "1";
          if (capLimit) {
            capCard = bubble;
            ensureStarterMonthly();
            bubble.dataset.precardCap = capLimit;
            const reason = document.createElement("p");
            reason.className = "precard-cap-reason";
            reason.textContent = precardCapReason(capLimit);
            const title = document.createElement("p");
            title.className = "precard-cap-title";
            title.textContent = PRECARD_CAP_MESSAGE;
            bubble.appendChild(reason);
            bubble.appendChild(title);
            if (starterMonthly) {
              const price = document.createElement("p");
              price.className = "precard-cap-price";
              price.dataset.trialPrice = "1";
              price.textContent = starterMonthly;
              bubble.appendChild(price);
            }
            const link = document.createElement("a");
            link.className = "precard-cap-button";
            link.href = billingStartPath(peekPendingCheckout() ?? firmSignupCheckoutIntent());
            link.textContent = "Add a card";
            bubble.appendChild(link);
          } else if (turn.role === "user") {
            bubble.textContent = stripMilonProjection(turn.content);
          } else if (trialAnswer) {
            mountTrialEnded(bubble);
          } else {
            bubble.innerHTML = renderMarkdown(stripMilonProjection(turn.content));
            appendReportDownload(bubble, turn);
          }
          if (latestAssistant) {
            decorateLatestAnswer(bubble);
            const left =
              typeof precardRemaining === "number"
                ? precardBotRemainingLabel(precardRemaining)
                : null;
            const lastHint =
              typeof precardRemaining === "number"
                ? precardBotLastQuestionHint(precardRemaining)
                : null;
            if (left) {
              const note = document.createElement("p");
              note.className = "precard-cap-remaining";
              note.textContent = left;
              bubble.appendChild(note);
            }
            if (lastHint) {
              const hint = document.createElement("p");
              hint.className = "precard-cap-remaining";
              hint.dataset.lastQuestion = "1";
              hint.textContent = lastHint;
              bubble.appendChild(hint);
            }
          }
          thread.appendChild(bubble);
          if (turn.role === "user" && latest) {
            thread.appendChild(inlineTurnError(turn));
          }
        });
        if (loading) {
          const typing = document.createElement("div");
          typing.className = "ask-ai-turn ask-ai-typing";
          mark(typing, "role", "status");
          mark(typing, "aria-live", "polite");
          typing.innerHTML =
            '<span class="ask-ai-typing-dots" aria-hidden="true"><i></i><i></i><i></i></span><span>Working on a reply…</span>';
          thread.appendChild(typing);
        }
        const figureCard = buildFigureCard(shown);
        if (figureCard) panel.appendChild(figureCard);
        panel.appendChild(thread);
        if (figureCard && typeof figureCard.scrollIntoView === "function") {
          figureCard.scrollIntoView({ block: "nearest" });
        } else if (capCard && typeof capCard.scrollIntoView === "function") {
          capCard.scrollIntoView({ block: "nearest" });
        } else {
          thread.scrollTop = thread.scrollHeight;
        }
      }

      widget.appendChild(panel);

      // Focus textarea after render
      requestAnimationFrame(() => ta && ta.focus({ preventScroll: true }));
    }

    container.appendChild(widget);
  }

  function appendReportDownload(bubble, turn) {
    const download = turn && turn.reportDownload;
    if (!download || typeof download.href !== "string") return;
    if (!download.href.startsWith("/clients/") || !download.href.includes("action=download"))
      return;
    const go = document.createElement("a");
    go.className = "ask-ai-handoff";
    go.dataset.reportDownload = "1";
    go.href = download.href;
    go.textContent =
      typeof download.label === "string" && download.label.trim()
        ? download.label
        : "Download the report";
    go.style.textDecoration = "none";
    go.style.display = "inline-block";
    bubble.appendChild(go);
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
        return {
          ok: false,
          error: friendlyReachMessage(e, "Couldn't read Milōn's reply. Try again."),
        };
      }
    }
    if (res && typeof res.json === "function") {
      try {
        return parseAskAiBody(status, await res.json(), ok);
      } catch (e) {
        return {
          ok: false,
          error: friendlyReachMessage(e, "Couldn't read Milōn's reply. Try again."),
        };
      }
    }
    return parseAskAiPayload(status, "", ok);
  }

  function capLimitForTurn(turn) {
    if (!turn || turn.role !== "assistant") return null;
    if (turn.precardCap && isPrecardLimitKind(turn.precardCap.limit)) return turn.precardCap.limit;
    if (typeof turn.content === "string" && turn.content.trim() === PRECARD_CAP_MESSAGE)
      return "bot";
    return null;
  }

  function oneCapCard(items) {
    let seen = false;
    return items.filter((item) => {
      if (!capLimitForTurn(item)) return true;
      if (seen) return false;
      seen = true;
      return true;
    });
  }

  function trimKeepingCap(items) {
    const tail = items.slice(-16);
    if (tail.some((item) => capLimitForTurn(item))) return tail;
    const card = items.find((item) => capLimitForTurn(item));
    if (!card) return tail;
    return [card, ...tail.slice(0, 15)];
  }

  function applyStarterMonthly(next) {
    const shown = next || STARTER_PLAN_ONLY;
    if (shown === starterMonthly) return;
    starterMonthly = shown;
    safeRender(lastQuestion);
  }

  function ensureStarterMonthly() {
    if (starterMonthly || starterMonthlyStarted) return;
    const load =
      options && typeof options.getStarterMonthly === "function"
        ? options.getStarterMonthly
        : loadStarterMonthlyLabel;
    starterMonthlyStarted = true;
    Promise.resolve()
      .then(() => load())
      .then((label) => {
        applyStarterMonthly(typeof label === "string" ? label.trim() : "");
      })
      .catch(() => {
        applyStarterMonthly("");
      });
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
    if (turnIsTrialEnded(turn)) {
      const slot = document.createElement("div");
      slot.className = "ask-ai-trial-ended";
      mountTrialEnded(slot);
      return slot;
    }
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
    dropTrialMounts();
    const text = message || "Something went wrong.";
    try {
      container.innerHTML = "";
      if (lastQuestion) {
        const echo = document.createElement("p");
        echo.className = "ask-ai-turn ask-ai-turn-user";
        echo.textContent = lastQuestion;
        container.appendChild(echo);
      }
      if (signalIsTrialEnded(text, null)) {
        mountTrialEnded(container);
        return;
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
    stopSpeech();
    const turnId = retryId || newTurnId();
    const objective = parseAgentObjective(q);
    const threadAgent = currentAgent();
    const threadAudience = accountant ? "accountant" : "owner";
    const reportRoute = fmClientReportRoute({
      question: q,
      agent: threadAgent,
      audience: threadAudience,
    });
    const createIntent = persistedCreateIntent(q, { agent: threadAgent, audience: threadAudience });
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
    const figureTurn = figureProposalTurn(currentAgent(), q);
    if (figureTurn?.kind === "refuse") {
      answer = figureTurn.answer;
      lastQuestion = q;
      history = [...history, { role: "assistant", content: figureTurn.answer }];
      if (history.length > 16) history = history.slice(-16);
      writeThread(boundClientId || currentClientId(), history);
      loading = false;
      proposingFigure = false;
      safeRender(q);
      return;
    }
    proposingFigure = figureTurn?.kind === "propose";
    if (proposingFigure && !botEndpoint) {
      errorMsg = "The proposal was not saved.";
      lastQuestion = q;
      loading = false;
      proposingFigure = false;
      safeRender(q);
      return;
    }
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

    async function askForClientReport(controller, setTimer) {
      if (reportRoute.kind === "unnamed") return { text: unnamedClientReportReply() };
      const clientId =
        container.dataset.clientId ||
        new URLSearchParams(window.location.search).get("clientId") ||
        window.__askAiClientId;
      if (!clientId) throw new Error("No client context found.");
      const url = deriveFinancialManagerEndpoint(endpoint);
      if (!url) throw new Error("The Financial Manager runner is not available from this chat.");
      let token = await getToken();
      if (!token) throw new Error("Not signed in — please reload and try again.");
      const body = JSON.stringify({
        mode: "prepare_client_report",
        clientId,
        reportKey: reportRoute.key,
        message: q,
        turnId,
      });
      const send = (bearer) =>
        fetch(url, {
          method: "POST",
          signal: controller.signal,
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${bearer}`,
          },
          body,
        });
      const timeout = new Promise((_, reject) => {
        const id = setTimeout(() => {
          controller.abort();
          const err = new Error(ASK_TIMEOUT_REPLY);
          err.name = "AbortError";
          reject(err);
        }, askTimeoutMs());
        if (id && typeof id.unref === "function") id.unref();
        setTimer(id);
      });
      const raced = (bearer) => Promise.race([send(bearer), timeout]);
      let res = await raced(token);
      const plan = await authRetryPlanFromResponse(res);
      if (plan) {
        if (plan === "refresh") {
          try {
            const next =
              typeof refreshSession === "function"
                ? await refreshSession()
                : (await supabase.auth.refreshSession()).data?.session?.access_token;
            if (next) token = next;
          } catch {
            /* the one retry still goes out with the token we have */
          }
        }
        res = await raced(token);
      }
      let payload = null;
      if (res && typeof res.json === "function") {
        try {
          payload = await res.json();
        } catch {
          payload = null;
        }
      }
      const status = typeof res?.status === "number" ? res.status : 0;
      return clientReportChatOutcome({
        clientId,
        key: reportRoute.key,
        httpOk: Boolean(res?.ok) && status >= 200 && status < 300,
        body: payload,
      });
    }

    if (reportRoute) {
      const controller = new AbortController();
      let timer = 0;
      try {
        const outcome = await askForClientReport(controller, (id) => {
          timer = id;
        });
        if (gen !== requestGen) return;
        if (outcome.error) throw new Error(outcome.error);
        answer = outcome.text;
        const assistant = { role: "assistant", content: outcome.text };
        if (outcome.href) {
          assistant.reportDownload = {
            href: outcome.href,
            label: outcome.label || "Download the report",
          };
        }
        const mapped = history.map((item) =>
          item.role === "user" && item.turnId === turnId
            ? { role: "user", content: item.content, turnId }
            : item,
        );
        history = [...mapped, assistant];
        if (history.length > 16) history = history.slice(-16);
        writeThread(boundClientId || currentClientId(), history);
      } catch (e) {
        if (gen !== requestGen) return;
        const timedOut = Boolean(e && e.name === "AbortError");
        const message = timedOut
          ? ASK_TIMEOUT_REPLY
          : friendlyReachMessage(e, "Something went wrong.") || "Something went wrong.";
        const trialEnded = !timedOut && signalIsTrialEnded(message, e && e.code);
        history = history.map((item) =>
          item.role === "user" && item.turnId === turnId
            ? {
                role: "user",
                content: item.content,
                turnId,
                error: message,
                ...(trialEnded ? { trialEnded: true } : {}),
              }
            : item,
        );
        writeThread(boundClientId || currentClientId(), history);
        answer = "";
        errorMsg = "";
        if (trialEnded) notifyTrialEnded();
      } finally {
        clearTimeout(timer);
        if (gen !== requestGen) return;
        loading = false;
        pendingIntent = null;
        workingObjective = false;
        creatingDeliverable = false;
        safeRender(q);
      }
      return;
    }

    const controller = new AbortController();
    let timer = 0;
    const pending = (async () => {
      let token = await getToken();
      if (!token) throw new Error("Not signed in — please reload and try again.");

      const clientId =
        container.dataset.clientId ||
        new URLSearchParams(window.location.search).get("clientId") ||
        window.__askAiClientId;

      if (!clientId) throw new Error("No client context found.");

      const useFigure = figureTurn?.kind === "propose" && Boolean(botEndpoint);
      const useAgent = !useFigure && Boolean(objective) && !createIntent && Boolean(botEndpoint);
      const useCreate = !useFigure && Boolean(createIntent) && Boolean(botEndpoint);
      const useBot = !useFigure && (useAgent || useCreate || pendingIntent === "milon-bot") && botEndpoint;
      const url = useFigure || useBot ? botEndpoint : endpoint;
      const prior = priorTurns(turnId);
      const agent = currentAgent();
      const body = JSON.stringify(
        useFigure
          ? {
              clientId,
              mode: "figure-proposal",
              message: q,
              turnId,
              audience: accountant ? "accountant" : "owner",
              agent,
            }
          : useCreate
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
                  agent,
                }
              : {
                  clientId,
                  question: q,
                  turnId,
                  agent,
                  ...(accountant ? { audience: "accountant" } : {}),
                },
      );
      const send = (bearer) => {
        return fetch(url, {
          method: "POST",
          signal: controller.signal,
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${bearer}`,
          },
          body,
        });
      };
      let res = await send(token);
      const plan = await authRetryPlanFromResponse(res);
      if (!plan) return res;
      if (plan === "refresh") {
        try {
          const next =
            typeof refreshSession === "function"
              ? await refreshSession()
              : (await supabase.auth.refreshSession()).data?.session?.access_token;
          if (next) token = next;
        } catch {
          /* the one retry still goes out with the token we have */
        }
      }
      return send(token);
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
      if (!turn.ok) {
        const err = new Error(turn.error || "Something went wrong.");
        if (typeof turn.code === "string" && turn.code) err.code = turn.code;
        throw err;
      }

      answer = turn.answer;
      precardCap = turn.precardCap || null;
      precardRemaining = turn.precardCap ? null : (turn.precardRemaining ?? null);
      if (!precardCap && isStarterTrialEndedMessage(answer)) {
        notifyTrialEnded();
      }
      answerChips = precardCap ? [] : turn.chips;
      agentRun = turn.run;
      toolHints = turn.tools.map((t) => toolHint(t.name, t.status));
      const capped = Boolean(turn.precardCap && isPrecardLimitKind(turn.precardCap.limit));
      const hasCard = history.some((item) => capLimitForTurn(item));
      const proposal = storedProposal(turn.proposal);
      const assistant = {
        role: "assistant",
        content: answer,
        ...(capped ? { precardCap: { limit: turn.precardCap.limit } } : {}),
        ...(proposal ? { proposal } : {}),
      };
      if (proposal && proposal.status === "pending" && typeof window !== "undefined") {
        window.dispatchEvent(
          new CustomEvent("figure-proposals-changed", {
            detail: { clientId: currentClientId(), surface: proposal.surface },
          }),
        );
      }
      const mapped = history.map((item) =>
        item.role === "user" && item.turnId === turnId
          ? { role: "user", content: item.content, turnId }
          : item,
      );
      history = oneCapCard(capped && hasCard ? mapped : [...mapped, assistant]);
      if (history.length > 16) history = trimKeepingCap(history);
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
      const trialEnded = !timedOut && signalIsTrialEnded(message, e && e.code);
      const echoed = history.some((item) => item.role === "user" && item.turnId === turnId);
      history = history.map((item) =>
        item.role === "user" && item.turnId === turnId
          ? {
              role: "user",
              content: item.content,
              turnId,
              error: message,
              ...(trialEnded ? { trialEnded: true } : {}),
            }
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
      if (trialEnded) notifyTrialEnded();
    } finally {
      clearTimeout(timer);
      if (gen !== requestGen) return;
      loading = false;
      pendingIntent = null;
      workingObjective = false;
      creatingDeliverable = false;
      proposingFigure = false;
      safeRender(q);
    }
  }

  render();

  if (container.__askContextRefresh && typeof container.removeEventListener === "function") {
    container.removeEventListener("ask-ai-context", container.__askContextRefresh);
  }
  container.__askContextRefresh = refreshThreadFromContext;
  container.addEventListener("ask-ai-context", refreshThreadFromContext);
  try {
    if (
      container.__askThreadObserver &&
      typeof container.__askThreadObserver.disconnect === "function"
    ) {
      container.__askThreadObserver.disconnect();
    }
    if (typeof MutationObserver === "function") {
      const observer = new MutationObserver(() => refreshThreadFromContext());
      observer.observe(container, {
        attributes: true,
        attributeFilter: ["data-agent", "data-client-id", "data-forecast-key"],
      });
      container.__askThreadObserver = observer;
    }
  } catch {
    /* the event above is enough when the host cannot observe attributes */
  }
}
