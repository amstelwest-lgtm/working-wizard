/**
 * Tax pack drafts on the client profile. The Tax Specialist drafts a pack
 * from the documents of a finished send; the accountant reads every line,
 * ticks the checks, and approves or discards it here. Nothing is filed —
 * the accountant submits via eFiling outside Milōn.
 */
import { useCallback, useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { supabase } from "@/integrations/supabase/client";
import { parseAssumptionChecklist, type AssumptionItem } from "@/lib/client-brain";
import { TAX_PACK_KIND } from "@/lib/tax-deliverable";
import { draftTaxPackFromSend, type DraftTaxPackResult } from "@/lib/tax-deliverable.functions";

export type TaxPackDraftRow = {
  id: string;
  body: string;
  status: string;
  checks: AssumptionItem[];
};

const PRIMARY =
  "inline-flex min-h-11 items-center justify-center rounded-full bg-[#0B5FFF] px-4 text-sm font-semibold text-white hover:bg-[#2563EB] disabled:opacity-60";
const SECONDARY =
  "inline-flex min-h-11 items-center justify-center rounded-full border border-[#0B5FFF] bg-white px-4 text-sm font-semibold text-[#102A43] hover:bg-[#F4F8FF] disabled:opacity-60";

export const TAX_PACK_PANEL_BODY =
  "A draft only. Every figure cites the client document it was read from; anything the Tax Specialist could not trace is a query, not a number. Check each line against the source before you use it — you file via eFiling, Milōn does not.";

export function taxPackStatusLabel(status: string): string {
  if (status === "ready") return "Approved";
  if (status === "discarded") return "Discarded";
  if (status === "sent") return "Signed off";
  return "Draft";
}

const MODEL_NOTICE = "The drafting model did not answer. Try again in a minute.";
const TIMEOUT_NOTICE =
  "Reading the documents took too long. Try again — it helps to save passwords so large scans can be read as text.";
const AI_NOT_CONFIGURED_NOTICE = "Drafting is not configured on this environment.";
const TRUNCATED_NOTICE = "The draft was cut off before it finished. Try again in a minute.";
const REJECTED_NOTICE =
  "The drafter rejected this pack. Open any large scans yourself, then draft again.";
const RATE_LIMITED_NOTICE = "Drafting is rate limited. Try again in a minute.";
const OVERLOADED_NOTICE = "The drafting service is overloaded. Try again in a minute.";
const CONTEXT_TOO_LARGE_NOTICE =
  "These documents are too large to draft together. Open the biggest files yourself, then draft again.";

function lockedFileNotice(names: readonly string[] | undefined, fallback: string): string {
  const listed = (names ?? []).join(", ");
  return listed
    ? `These files need their password saved first: ${listed}. Save each password in the Files list above, then draft again.`
    : fallback;
}

export function draftTaxPackNotice(result: DraftTaxPackResult): string | null {
  if (result.ok) return null;
  switch (result.reason) {
    case "not_ready":
      return "The pack can be drafted once the client has finished the link.";
    case "no_files":
      return "No readable documents on this send yet.";
    case "passwords_needed":
      return lockedFileNotice(
        result.passwordNeeded,
        "The documents need their passwords saved first. Save them in the Files list above, then draft again.",
      );
    case "already_open":
      return "A pack for this send is already open below.";
    case "draft_limit":
      return "Close an open pack before drafting another.";
    case "ai_not_configured":
      return AI_NOT_CONFIGURED_NOTICE;
    case "model":
      return lockedFileNotice(result.passwordNeeded, MODEL_NOTICE);
    case "timeout":
      return lockedFileNotice(result.passwordNeeded, TIMEOUT_NOTICE);
    case "truncated":
      return lockedFileNotice(result.passwordNeeded, TRUNCATED_NOTICE);
    case "rejected":
      return lockedFileNotice(result.passwordNeeded, REJECTED_NOTICE);
    case "rate_limited":
      return lockedFileNotice(result.passwordNeeded, RATE_LIMITED_NOTICE);
    case "overloaded":
      return lockedFileNotice(result.passwordNeeded, OVERLOADED_NOTICE);
    case "context_too_large":
      return lockedFileNotice(result.passwordNeeded, CONTEXT_TOO_LARGE_NOTICE);
    case "unavailable":
      return "Drafting is unavailable right now. Try again in a minute.";
    case "empty":
      return "Nothing in the documents could be traced into a pack.";
    default:
      return "The pack could not be drafted.";
  }
}

/** Presentational card — all data in, all actions out. */
export function TaxPackCard({
  drafts,
  canDraft,
  busy,
  notice,
  onDraft,
  onApprove,
  onDiscard,
}: {
  drafts: TaxPackDraftRow[];
  canDraft: boolean;
  busy: boolean;
  notice: string | null;
  onDraft: () => void;
  onApprove: (draftId: string) => void;
  onDiscard: (draftId: string) => void;
}) {
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  if (!canDraft && drafts.length === 0) return null;
  return (
    <div className="flex flex-col gap-3" data-tax-pack-panel="">
      <h3 className="text-sm font-semibold">Tax pack</h3>
      <p className="text-sm leading-6 text-[#3D5270]">{TAX_PACK_PANEL_BODY}</p>
      {canDraft ? (
        <button
          type="button"
          className={`${PRIMARY} w-full`}
          data-draft-tax-pack=""
          disabled={busy}
          onClick={onDraft}
        >
          Draft tax pack
        </button>
      ) : null}
      {drafts.map((draft) => {
        const long = draft.body.length > 600 && !expanded[draft.id];
        return (
          <article
            key={draft.id}
            className="flex flex-col gap-2 rounded-xl border border-[#DBEAFE] p-3"
            data-tax-pack-draft={draft.id}
          >
            <p className="text-sm font-semibold">{taxPackStatusLabel(draft.status)}</p>
            <p className="text-sm whitespace-pre-wrap text-[#102A43]">
              {long ? `${draft.body.slice(0, 600)}…` : draft.body}
            </p>
            {draft.body.length > 600 ? (
              <button
                type="button"
                className={`${SECONDARY} w-full`}
                onClick={() => setExpanded((prev) => ({ ...prev, [draft.id]: !prev[draft.id] }))}
              >
                {expanded[draft.id] ? "Show less" : "Show the full pack"}
              </button>
            ) : null}
            {draft.checks.length > 0 ? (
              <ul className="flex flex-col gap-1" data-tax-pack-checks="">
                {draft.checks.map((item) => (
                  <li key={item.id} className="text-sm text-[#3D5270]">
                    {item.checked ? "☑" : "☐"} {item.text}
                  </li>
                ))}
              </ul>
            ) : null}
            {draft.status === "draft" ? (
              <div className="flex flex-col gap-2">
                <button
                  type="button"
                  className={`${PRIMARY} w-full`}
                  data-approve-tax-pack=""
                  disabled={busy}
                  onClick={() => onApprove(draft.id)}
                >
                  Approve
                </button>
                <button
                  type="button"
                  className={`${SECONDARY} w-full`}
                  data-discard-tax-pack=""
                  disabled={busy}
                  onClick={() => onDiscard(draft.id)}
                >
                  Discard
                </button>
              </div>
            ) : draft.status === "ready" ? (
              <button
                type="button"
                className={`${SECONDARY} w-full`}
                data-discard-tax-pack=""
                disabled={busy}
                onClick={() => onDiscard(draft.id)}
              >
                Discard
              </button>
            ) : null}
          </article>
        );
      })}
      {notice ? (
        <p className="text-sm" role="status">
          {notice}
        </p>
      ) : null}
    </div>
  );
}

function parseDraftRows(data: unknown): TaxPackDraftRow[] {
  if (!Array.isArray(data)) return [];
  return (data as Array<Record<string, unknown>>).flatMap((row) => {
    const id = typeof row.id === "string" ? row.id : "";
    const body = typeof row.body === "string" ? row.body : "";
    const status = typeof row.status === "string" ? row.status : "draft";
    if (!id || !body || status === "discarded") return [];
    return [
      {
        id,
        body,
        status,
        checks: parseAssumptionChecklist(row.assumption_checklist),
      },
    ];
  });
}

/** Loads the client's tax packs and wires drafting and approval. */
export function TaxPackPanel({ clientId, sendId }: { clientId: string; sendId: string | null }) {
  const draftPack = useServerFn(draftTaxPackFromSend);
  const [drafts, setDrafts] = useState<TaxPackDraftRow[]>([]);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  const reload = useCallback(async () => {
    const { data, error } = await supabase
      .from("deliverable_drafts")
      .select("id, body, status, assumption_checklist")
      .eq("client_id", clientId)
      .eq("kind", TAX_PACK_KIND)
      .order("created_at", { ascending: false })
      .limit(10);
    if (!error) setDrafts(parseDraftRows(data));
  }, [clientId]);

  useEffect(() => {
    let alive = true;
    void supabase
      .from("deliverable_drafts")
      .select("id, body, status, assumption_checklist")
      .eq("client_id", clientId)
      .eq("kind", TAX_PACK_KIND)
      .order("created_at", { ascending: false })
      .limit(10)
      .then(({ data, error }) => {
        if (alive && !error) setDrafts(parseDraftRows(data));
      });
    return () => {
      alive = false;
    };
  }, [clientId]);

  const onDraft = async () => {
    if (!sendId) return;
    setBusy(true);
    setNotice(null);
    try {
      const result = await draftPack({ data: { clientId, sendId } });
      setNotice(draftTaxPackNotice(result));
      if (result.ok) await reload();
    } catch {
      setNotice("The pack could not be drafted.");
    } finally {
      setBusy(false);
    }
  };

  const setStatus = async (draftId: string, from: string, to: string) => {
    setBusy(true);
    setNotice(null);
    try {
      const { error } = await supabase
        .from("deliverable_drafts")
        .update({ status: to })
        .eq("id", draftId)
        .eq("client_id", clientId)
        .eq("status", from);
      if (error) {
        setNotice("That could not be saved.");
        return;
      }
      await reload();
    } catch {
      setNotice("That could not be saved.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <TaxPackCard
      drafts={drafts}
      canDraft={sendId != null}
      busy={busy}
      notice={notice}
      onDraft={() => void onDraft()}
      onApprove={(draftId) => void setStatus(draftId, "draft", "ready")}
      onDiscard={(draftId) => {
        const current = drafts.find((row) => row.id === draftId);
        void setStatus(draftId, current?.status ?? "draft", "discarded");
      }}
    />
  );
}
