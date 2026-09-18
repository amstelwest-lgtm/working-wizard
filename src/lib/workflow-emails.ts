/**
 * Workflow emails — pure module (P1.3).
 *
 * Advisory events → email, deterministically. `planWorkflowEmails` looks at a
 * small set of facts and returns the sends that are due; `dropAlreadySent`
 * removes anything the log says went out; `renderWorkflowEmail` produces the
 * copy. No clock reads (`now` is injected), no I/O.
 *
 * Emails return people to the platform. They never carry a token that
 * mutates on GET — every link is a plain route on the owner board or the
 * accountant studio.
 *
 * Kinds mirror supabase/migrations/20260918170000_workflow_emails.sql
 * (test-guarded).
 */
import { CASH_RUNWAY_THRESHOLD_RAND } from "@/lib/cash-runway";
import { fmtMoney } from "@/lib/advisory-pack";

export const WORKFLOW_EMAIL_KINDS = [
  "pack_ready_for_review",
  "pack_signed_off",
  "pack_changes_requested",
  "forecast_break",
  "cycle_restarted",
  // P3 — marketplace
  "accountant_request_received",
  "accountant_attached",
  "accountant_request_declined",
] as const;
export type WorkflowEmailKind = (typeof WORKFLOW_EMAIL_KINDS)[number];

/** `requested_firm` = members of the firm a request targets (not attached yet). */
export type WorkflowRecipientRole = "owner" | "accountant" | "requested_firm";

export type WorkflowFacts = {
  clientId: string;
  clientName: string;
  hasFirm: boolean;
  firmName: string | null;
  /** Latest non-superseded pack, or null. */
  pack: {
    id: string;
    version: number;
    status: "draft" | "in_review" | "changes_requested" | "approved" | "rejected";
    requiresReview: boolean;
    reviewedAt: string | null;
    reviewNote: string | null;
    deliveredAt: string | null;
  } | null;
  /** Saved forecast: weekly closings + when it was published. */
  forecast: { lastForecastAt: string; closings: number[] } | null;
  /** Most recent cycle.restarted advisory event, if any. */
  lastRestart: { eventId: number | string; at: string } | null;
  /** P3: marketplace requests for this client (any status, newest first). */
  accountantRequests?: Array<{
    id: string;
    firmId: string;
    firmName: string | null;
    status: "open" | "accepted" | "declined" | "withdrawn" | "expired";
    createdAt: string;
    respondedAt: string | null;
    responseNote: string | null;
  }>;
  /** Pre-data states get no workflow mail; upload is the whole story there. */
  pastDataCollection: boolean;
  now: string;
};

export type WorkflowEmailIntent = {
  kind: WorkflowEmailKind;
  /** Uniqueness key: the same (kind, ref) is never sent twice to a recipient. */
  refKey: string;
  audience: WorkflowRecipientRole;
  /** Data the renderer needs; kept small and serialisable. */
  data: Record<string, string | number | boolean | null>;
  /** For `requested_firm` audiences: which request's firm to resolve. */
  requestId?: string;
};

/** Restarts older than this are history, not news. */
export const RESTART_NEWS_WINDOW_DAYS = 14;

const DAY_MS = 86_400_000;

function daysOld(iso: string, now: string): number | null {
  const a = Date.parse(iso);
  const b = Date.parse(now);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return Math.floor((b - a) / DAY_MS);
}

/**
 * What is due right now. Order is stable (most consequential first) so a
 * capped sender still sends the right thing.
 */
export function planWorkflowEmails(f: WorkflowFacts): WorkflowEmailIntent[] {
  const out: WorkflowEmailIntent[] = [];
  if (!f.pastDataCollection) return out;

  // Cash break outranks everything: both seats hear about it once per forecast.
  if (f.forecast && f.forecast.closings.length > 0) {
    let lowest = Number.POSITIVE_INFINITY;
    let week = 0;
    f.forecast.closings.forEach((c, i) => {
      if (c < lowest) {
        lowest = c;
        week = i + 1;
      }
    });
    if (lowest < 0) {
      const data = { lowest, week, horizon: f.forecast.closings.length };
      out.push({
        kind: "forecast_break",
        refKey: f.forecast.lastForecastAt,
        audience: "owner",
        data,
      });
      if (f.hasFirm) {
        out.push({
          kind: "forecast_break",
          refKey: f.forecast.lastForecastAt,
          audience: "accountant",
          data,
        });
      }
    }
  }

  if (f.pack) {
    const p = f.pack;
    if (p.status === "in_review" && p.requiresReview && f.hasFirm) {
      out.push({
        kind: "pack_ready_for_review",
        refKey: p.id,
        audience: "accountant",
        data: { version: p.version },
      });
    }
    if (p.status === "approved" && p.requiresReview && !p.deliveredAt) {
      out.push({
        kind: "pack_signed_off",
        refKey: p.id,
        audience: "owner",
        data: { version: p.version, firmName: f.firmName },
      });
    }
    if (p.status === "changes_requested" && p.reviewedAt) {
      out.push({
        kind: "pack_changes_requested",
        refKey: `${p.id}:${p.reviewedAt}`,
        audience: "owner",
        data: { version: p.version, note: p.reviewNote, firmName: f.firmName },
      });
    }
  }

  // P3 — marketplace. Requests are news for the firm while open, and for the
  // owner once answered (within the same window as restarts).
  for (const r of f.accountantRequests ?? []) {
    if (r.status === "open") {
      out.push({
        kind: "accountant_request_received",
        refKey: r.id,
        audience: "requested_firm",
        requestId: r.id,
        data: {},
      });
    } else if (r.status === "accepted" && r.respondedAt) {
      const age = daysOld(r.respondedAt, f.now);
      if (age !== null && age <= RESTART_NEWS_WINDOW_DAYS) {
        out.push({
          kind: "accountant_attached",
          refKey: r.id,
          audience: "owner",
          data: { firmName: r.firmName },
        });
      }
    } else if (r.status === "declined" && r.respondedAt) {
      const age = daysOld(r.respondedAt, f.now);
      if (age !== null && age <= RESTART_NEWS_WINDOW_DAYS) {
        out.push({
          kind: "accountant_request_declined",
          refKey: r.id,
          audience: "owner",
          data: { firmName: r.firmName, note: r.responseNote },
        });
      }
    }
  }

  if (f.lastRestart) {
    const age = daysOld(f.lastRestart.at, f.now);
    if (age !== null && age <= RESTART_NEWS_WINDOW_DAYS) {
      out.push({
        kind: "cycle_restarted",
        refKey: String(f.lastRestart.eventId),
        audience: "owner",
        data: {},
      });
    }
  }

  return out;
}

export type SentLogEntry = {
  kind: string;
  ref_key: string;
  recipient_email: string;
  status: string;
};

export function dropAlreadySent<
  T extends { kind: WorkflowEmailKind; refKey: string; email: string },
>(planned: T[], log: SentLogEntry[]): T[] {
  const sent = new Set(
    log
      .filter((l) => l.status === "sent")
      .map((l) => `${l.kind}|${l.ref_key}|${l.recipient_email.toLowerCase()}`),
  );
  return planned.filter((p) => !sent.has(`${p.kind}|${p.refKey}|${p.email.toLowerCase()}`));
}

// ── Templates ────────────────────────────────────────────────────────────────

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export type RenderedEmail = { subject: string; html: string; text: string; href: string };

export type RenderInput = {
  intent: WorkflowEmailIntent;
  clientId: string;
  clientName: string;
  recipientName: string | null;
  siteUrl: string;
};

/** Where each email lands. Owner → board tab; accountant → studio tab. Plain routes only. */
export function workflowEmailHref(
  kind: WorkflowEmailKind,
  audience: WorkflowRecipientRole,
  clientId: string,
  siteUrl: string,
): string {
  const base = siteUrl.replace(/\/$/, "");
  if (audience === "requested_firm") return `${base}/dashboard#accountant-inbox`;
  if (audience === "accountant") {
    const tab = kind === "forecast_break" ? "cash" : "advisory";
    return `${base}/clients/${clientId}?tab=${tab}`;
  }
  const tab = kind === "forecast_break" ? "cash" : kind === "cycle_restarted" ? "today" : "next";
  return `${base}/app?tab=${tab}`;
}

export function renderWorkflowEmail(input: RenderInput): RenderedEmail {
  const { intent, clientName } = input;
  const href = workflowEmailHref(intent.kind, intent.audience, input.clientId, input.siteUrl);
  const hi = input.recipientName ? `Hi ${input.recipientName},` : "Hi,";
  let subject = "";
  let lines: string[] = [];
  let cta = "Open MILŌN";

  switch (intent.kind) {
    case "pack_ready_for_review": {
      subject = `${clientName}: advisory pack v${intent.data.version} is ready for your review`;
      lines = [
        `MILŌN has built advisory pack v${intent.data.version} for ${clientName} from the current figures: where the business stands, what changed, what matters, the cash forecast and the proposed moves.`,
        "Nothing reaches the owner until you sign it off. Edit the sections you disagree with, comment, or send it back for changes.",
      ];
      cta = "Review the pack";
      break;
    }
    case "pack_signed_off": {
      const who = intent.data.firmName ? String(intent.data.firmName) : "Your accountant";
      subject = `${clientName}: your advisory pack has been signed off`;
      lines = [
        `${who} has reviewed and signed off advisory pack v${intent.data.version}.`,
        "It explains where the business stands, what changed since last time and which moves are on the table. Once you have read it, accept the moves you will act on and MILŌN turns each into a dated action.",
      ];
      cta = "Read the pack";
      break;
    }
    case "pack_changes_requested": {
      const who = intent.data.firmName ? String(intent.data.firmName) : "Your accountant";
      subject = `${clientName}: ${who} asked for changes to the advisory pack`;
      lines = [
        `${who} has looked at advisory pack v${intent.data.version} and sent it back for changes${
          intent.data.note ? ":" : "."
        }`,
        ...(intent.data.note ? [`"${String(intent.data.note)}"`] : []),
        "You may be asked for a document or a correction. MILŌN will rebuild the pack once the figures are updated.",
      ];
      cta = "See what was asked";
      break;
    }
    case "forecast_break": {
      const lowest = Number(intent.data.lowest);
      const week = Number(intent.data.week);
      subject =
        intent.audience === "accountant"
          ? `${clientName}: cash forecast goes negative in week ${week}`
          : `${clientName}: your cash forecast goes negative in week ${week}`;
      lines = [
        `On the saved assumptions, the 13-week cash forecast reaches ${fmtMoney(lowest)} in week ${week} — below zero, and well under the ${fmtMoney(
          CASH_RUNWAY_THRESHOLD_RAND,
        )} comfort line.`,
        intent.audience === "accountant"
          ? "The owner has been told too. The recommendations MILŌN proposes are judged first on whether they move that week."
          : "That is the number every recommendation is judged against. Check the assumptions — a late debtor or an early supplier bill is often the difference — then look at the moves MILŌN proposes.",
      ];
      cta = "Open the cash forecast";
      break;
    }
    case "accountant_request_received": {
      subject = `${clientName} has asked your firm to review their advisory pack`;
      lines = [
        `${clientName} runs MILŌN on their own and would like an accountant in the loop. They have sent you their current advisory pack — the diagnosis, cash forecast and proposed moves — not raw statements.`,
        "Accept and the client is attached to your firm: their packs come to you for sign-off, their data gaps and overdue actions show in your portfolio, and MILŌN keeps the numbers current between meetings. Decline and they simply hear that you are not a fit right now.",
      ];
      cta = "Open the request";
      break;
    }
    case "accountant_attached": {
      const who = intent.data.firmName ? String(intent.data.firmName) : "The firm";
      subject = `${clientName}: ${who} has accepted your request`;
      lines = [
        `${who} is now your accountant on MILŌN. From here your advisory packs go to them for review before you act on them, and they see the same Next Step you do.`,
        "Nothing else changes: your figures, forecast and actions stay exactly where they are.",
      ];
      cta = "See what's next";
      break;
    }
    case "accountant_request_declined": {
      const who = intent.data.firmName ? String(intent.data.firmName) : "The firm";
      subject = `${clientName}: ${who} can't take you on right now`;
      lines = [
        `${who} has declined your review request${intent.data.note ? `: "${String(intent.data.note)}"` : "."}`,
        "MILŌN keeps working for you without an accountant. You can ask another listed firm whenever you like.",
      ];
      cta = "See other firms";
      break;
    }
    case "cycle_restarted": {
      subject = `${clientName}: a new advisory cycle has started`;
      lines = [
        "New figures have landed, so MILŌN has closed the last cycle and started a fresh one. The diagnosis, forecast and recommendations will be rebuilt from the new numbers.",
        "The next pack will show what changed since the last one, including whether the actions you took moved the numbers.",
      ];
      cta = "See what's next";
      break;
    }
  }

  const text = [hi, "", ...lines.flatMap((l) => [l, ""]), `${cta}: ${href}`, "", "— MILŌN"].join(
    "\n",
  );
  const html = `<!doctype html><html><body style="font-family:Inter,Arial,sans-serif;color:#0f172a;line-height:1.5;max-width:560px;margin:0 auto;padding:24px">
<p>${escapeHtml(hi)}</p>
${lines.map((l) => `<p>${escapeHtml(l)}</p>`).join("\n")}
<p><a href="${escapeHtml(href)}" style="display:inline-block;background:#b7872a;color:#1b1300;font-weight:700;padding:10px 16px;border-radius:8px;text-decoration:none">${escapeHtml(cta)}</a></p>
<p style="color:#64748b;font-size:13px">— MILŌN</p>
</body></html>`;
  return { subject, html, text, href };
}
