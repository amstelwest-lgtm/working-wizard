/**
 * Advisory pack panel (P1.1 / P1.2).
 *
 * One component for both seats. The accountant edits sections, comments,
 * requests changes, rejects or signs off; the owner reads (which counts as
 * delivery once the pack is approved) and, when no firm is attached, accepts
 * the pack themselves. Every action goes through `reviewAdvisoryPack`, so the
 * audit trail at the bottom is the source of truth for "who changed what".
 *
 * The panel never navigates; the host decides where it lives.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import {
  Check,
  ChevronDown,
  ChevronUp,
  Download,
  FileText,
  History,
  Loader2,
  Lock,
  MessageSquare,
  Pencil,
  RefreshCw,
  Undo2,
  X,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { TrialEndedActionNotice, useTrialEndedAction } from "@/components/trial-ended-plan-block";
import { useAccountantProfile } from "@/contexts/accountant-profile";
import { useMarket } from "@/contexts/market";
import { useAuth } from "@/hooks/use-auth";
import { useTrack } from "@/hooks/use-track";
import { recordedActorIdentity, type RecordedActor } from "@/lib/accountant-identity";
import { downloadAdvisoryPackPdf } from "@/lib/advisory-pack-pdf";
import { formatReviewDateTime } from "@/lib/market";
import {
  isSamplePracticeSignoff,
  packHeldSignoffLine,
  reviewActorLabel,
} from "@/lib/review-signoff-stamp";
import type { ResolvedMarket } from "@/lib/market";
import {
  hashFigures,
  recordDelivery,
  warnIfDeliveryFailed,
  warnIfPdfArchiveFailed,
} from "@/lib/advisory-deliveries";
import {
  ADVISORY_PACK_STALE_NOTE,
  HIGH_EDIT_RATE,
  advisoryPackSignOffGate,
  computeEditStats,
  diffPackSections,
  packStatusLabel,
  type AdvisoryPack,
  type PackReview,
  type PackSection,
} from "@/lib/advisory-pack";
import {
  generateAdvisoryPack,
  getLatestAdvisoryPack,
  reviewAdvisoryPack,
} from "@/lib/advisory-pack.functions";

type Props = {
  clientId: string | null;
  audience: "owner" | "accountant";
  /** Figures exist, so a pack can be built. */
  canGenerate: boolean;
  /** Firm attached → the accountant seat signs off; owner only reads. */
  hasFirm: boolean;
  onChanged?: () => void;
  refreshKey?: string | number;
  /** Firm that owns the client, so a trial block can open the plan picker. */
  firmId?: string | null;
  className?: string;
  /** Advisory sign-off row. The held line names this signer and firm. */
  signoff?: {
    signed_off_by_name: string;
    firm_name: string | null;
    signed_off_at: string;
  } | null;
  /** Live Overview figures. A stored pack that disagrees shows a regenerate note. */
  currentFigures?: {
    runwayLabel: string | null;
    cash: number | null;
    healthScore: number | null;
  } | null;
};

const STATUS_CLASS: Record<AdvisoryPack["status"], string> = {
  draft: "border-[#b7872a]/45 bg-[#d4a550]/15 text-[#7a5a0e] dark:text-[#f1d28b]",
  in_review: "border-sky-400/50 bg-sky-500/10 text-sky-700 dark:text-sky-300",
  changes_requested: "border-amber-400/60 bg-amber-500/10 text-amber-700 dark:text-amber-300",
  approved: "border-emerald-400/50 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
  rejected: "border-rose-400/50 bg-rose-500/10 text-rose-700 dark:text-rose-300",
  superseded: "border-slate-300/70 bg-slate-500/10 text-slate-600 dark:text-slate-300",
};

const GOLD_BTN =
  "inline-flex items-center gap-1.5 rounded-lg bg-gradient-to-b from-[#f3d98a] via-[#d4a550] to-[#b7872a] px-3 py-1.5 text-[12px] font-bold text-[#1b1300] disabled:opacity-50";
const GHOST_BTN =
  "inline-flex items-center gap-1.5 rounded-lg border border-slate-300/70 px-2.5 py-1.5 text-[12px] font-semibold text-slate-600 disabled:opacity-50 dark:border-white/15 dark:text-slate-300";

function fmtWhen(
  iso: string | null | undefined,
  market: Pick<ResolvedMarket, "locale" | "timezone">,
): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (!Number.isFinite(d.getTime())) return iso;
  return formatReviewDateTime(iso, market);
}

const ACTION_LABEL: Record<PackReview["action"], string> = {
  generated: "generated",
  edit: "edited",
  comment: "commented",
  approve: "signed off",
  invalidate: "cleared the sign-off",
  request_changes: "requested changes",
  reject: "rejected",
  deliver: "delivered",
  supersede: "superseded",
  read: "read",
};

export function AdvisoryPackPanel({
  clientId,
  audience,
  canGenerate,
  hasFirm,
  onChanged,
  refreshKey,
  firmId = null,
  className,
  currentFigures = null,
  signoff = null,
}: Props) {
  const track = useTrack();
  const { user } = useAuth();
  const { market } = useMarket();
  const { profile } = useAccountantProfile();
  const fetchLatest = useServerFn(getLatestAdvisoryPack);
  const generate = useServerFn(generateAdvisoryPack);
  const review = useServerFn(reviewAdvisoryPack);
  const trialBlock = useTrialEndedAction();

  const [pack, setPack] = useState<AdvisoryPack | null>(null);
  const [reviews, setReviews] = useState<PackReview[]>([]);
  const [actors, setActors] = useState<Record<string, RecordedActor>>({});
  const [versions, setVersions] = useState<Array<{ id: string; version: number; status: string }>>(
    [],
  );
  const [migrated, setMigrated] = useState(true);
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [draftBody, setDraftBody] = useState("");
  const [draftBullets, setDraftBullets] = useState("");
  const [note, setNote] = useState("");
  const [showTrail, setShowTrail] = useState(false);
  const [showDraft, setShowDraft] = useState<Record<string, boolean>>({});
  const [expanded, setExpanded] = useState(true);
  const [exportingPdf, setExportingPdf] = useState(false);
  const seq = useRef(0);
  const readMarked = useRef<string | null>(null);
  const staleCleared = useRef<string | null>(null);

  const signOffGate = useMemo(
    () =>
      advisoryPackSignOffGate(
        pack?.status ?? null,
        pack?.requires_review ?? false,
        pack?.content ?? null,
        currentFigures
          ? {
              runwayLabel: currentFigures.runwayLabel,
              cash: currentFigures.cash,
              healthScore: currentFigures.healthScore,
            }
          : null,
      ),
    [pack, currentFigures],
  );
  const shownStatus = pack ? signOffGate.presentedStatus : null;

  const load = useCallback(
    async (packId?: string) => {
      if (!clientId) return;
      const mine = ++seq.current;
      try {
        const res = await fetchLatest({ data: { clientId, packId } });
        if (mine !== seq.current) return;
        setMigrated(res.migrated);
        setPack(res.pack);
        setReviews(res.reviews);
        setActors(res.actors ?? {});
        setVersions(res.versions);
      } catch {
        if (mine !== seq.current) return;
        setPack(null);
      } finally {
        if (mine === seq.current) setLoaded(true);
      }
    },
    [clientId, fetchLatest],
  );

  useEffect(() => {
    if (!clientId) return;
    void load();
    // refreshKey is intentionally a dependency: hosts bump it after writes.
  }, [clientId, refreshKey, load]);

  // Owner opening an approved pack = delivery (recorded once per pack per mount).
  // A stale sign-off is not delivery — the figures no longer match Overview.
  useEffect(() => {
    if (!clientId || !pack || audience !== "owner") return;
    if (signOffGate.figuresChanged) return;
    if (pack.status !== "approved" || pack.delivered_at || readMarked.current === pack.id) return;
    readMarked.current = pack.id;
    void review({ data: { clientId, packId: pack.id, action: "read" } })
      .then((res) => {
        setPack(res.pack);
        setReviews(res.reviews);
        if (res.actors) setActors(res.actors);
        onChanged?.();
      })
      .catch(() => null);
  }, [clientId, pack, audience, review, onChanged, signOffGate.figuresChanged]);

  // Clear a stored SIGNED OFF once the baked snapshot drifts. Regenerate
  // builds a new version; sign-off stays blocked until that snapshot matches.
  useEffect(() => {
    if (!signOffGate.figuresChanged) {
      staleCleared.current = null;
      return;
    }
    if (!clientId || !pack || pack.status !== "approved") return;
    if (staleCleared.current === pack.id) return;
    staleCleared.current = pack.id;
    const seen = seq.current;
    void review({
      data: {
        clientId,
        packId: pack.id,
        action: "invalidate",
        liveFigures: currentFigures
          ? {
              runwayLabel: currentFigures.runwayLabel,
              cash: currentFigures.cash,
              healthScore: currentFigures.healthScore,
            }
          : undefined,
      },
    })
      .then((res) => {
        if (seq.current !== seen) return;
        setPack(res.pack);
        setReviews(res.reviews);
        if (res.actors) setActors(res.actors);
        onChanged?.();
      })
      .catch(() => null);
  }, [clientId, pack, currentFigures, review, onChanged, signOffGate.figuresChanged]);

  const isWriter = audience === "accountant" || !hasFirm;
  const canEdit =
    Boolean(pack) &&
    isWriter &&
    pack!.status !== "approved" &&
    pack!.status !== "rejected" &&
    pack!.status !== "superseded" &&
    (audience === "accountant" || !pack!.requires_review);
  const seatCanSign =
    Boolean(pack) &&
    ((pack!.requires_review && audience === "accountant") ||
      (!pack!.requires_review && audience === "owner"));
  const openStatus =
    shownStatus === "draft" || shownStatus === "in_review" || shownStatus === "changes_requested";
  const canSignOff = seatCanSign && openStatus;
  const signOffBlocked = signOffGate.signOffBlocked;
  const canOtherDecisions =
    seatCanSign &&
    pack!.status !== "approved" &&
    pack!.status !== "rejected" &&
    pack!.status !== "superseded";

  const diffs = useMemo(() => (pack ? diffPackSections(pack.ai_draft, pack.content) : []), [pack]);
  const changedByKey = useMemo(() => new Map(diffs.map((d) => [d.key, d])), [diffs]);
  const liveStats = useMemo(
    () => (pack ? (pack.edit_stats ?? computeEditStats(pack.ai_draft, pack.content)) : null),
    [pack],
  );

  const run = async (
    label: string,
    fn: () => Promise<{ pack: AdvisoryPack; reviews: PackReview[] } | null>,
    done?: string,
  ) => {
    if (busy) return;
    setBusy(label);
    if (label === "generate") trialBlock.reset();
    try {
      const res = await fn();
      if (res) {
        setPack(res.pack);
        setReviews(res.reviews);
        if ("actors" in res && res.actors) setActors(res.actors);
      }
      if (done) toast.success(done);
      onChanged?.();
    } catch (err: unknown) {
      if (label === "generate") {
        trialBlock.report(err, "Something went wrong.");
      } else {
        toast.error(err instanceof Error ? err.message : "Something went wrong.");
      }
    } finally {
      setBusy(null);
    }
  };

  const doGenerate = () =>
    run(
      "generate",
      async () => {
        if (!clientId) return null;
        // Drop an in-flight "figures changed" clear so it cannot put the old pack back.
        seq.current += 1;
        const res = await generate({ data: { clientId } });
        if (!res.ok) {
          toast.message(
            res.reason === "no_figures"
              ? "Upload at least one period of figures before building a pack."
              : "Advisory packs aren't enabled on this workspace yet.",
          );
          return null;
        }
        track("advisory_pack_generated", { clientId, audience, version: res.pack.version });
        await load(res.pack.id);
        return null;
      },
      "Pack generated",
    );

  const startEdit = (s: PackSection) => {
    setEditing(s.key);
    setDraftBody(s.body);
    setDraftBullets((s.bullets ?? []).join("\n"));
  };

  const saveEdit = (s: PackSection) =>
    run(
      "edit",
      async () => {
        if (!clientId || !pack) return null;
        const bullets = draftBullets
          .split("\n")
          .map((b) => b.trim())
          .filter(Boolean);
        const res = await review({
          data: {
            clientId,
            packId: pack.id,
            action: "edit",
            section: s.key,
            patch: {
              body: draftBody.trim(),
              bullets: bullets.length ? bullets : s.bullets ? [] : undefined,
            },
          },
        });
        track("advisory_pack_edited", { clientId, audience, section: s.key });
        setEditing(null);
        return res;
      },
      "Section saved",
    );

  const decide = (action: "approve" | "reject" | "request_changes") =>
    run(
      action,
      async () => {
        if (!clientId || !pack) return null;
        if (action === "approve" && signOffGate.signOffBlocked) {
          toast.message(ADVISORY_PACK_STALE_NOTE);
          return null;
        }
        if (action !== "approve" && !note.trim()) {
          toast.message("Add a short note so the trail explains why.");
          return null;
        }
        const res = await review({
          data: {
            clientId,
            packId: pack.id,
            action,
            note: note.trim() || undefined,
            liveFigures: currentFigures
              ? {
                  runwayLabel: currentFigures.runwayLabel,
                  cash: currentFigures.cash,
                  healthScore: currentFigures.healthScore,
                }
              : undefined,
          },
        });
        track("advisory_pack_decided", {
          clientId,
          audience,
          action,
          editRate: liveStats?.edit_rate ?? null,
        });
        setNote("");
        return res;
      },
      action === "approve"
        ? hasFirm
          ? "Pack signed off"
          : "Pack accepted"
        : action === "reject"
          ? "Pack rejected"
          : "Changes requested",
    );

  const exportPdf = async () => {
    if (!clientId || !pack || exportingPdf) return;
    setExportingPdf(true);
    try {
      const exportPack =
        pack.status === "approved" && signOffGate.figuresChanged && shownStatus
          ? {
              ...pack,
              status: shownStatus,
              reviewed_by: null,
              reviewed_by_kind: null,
              reviewed_at: null,
              review_note: null,
            }
          : pack;
      const recordedSigner = identityFor(exportPack.reviewed_by);
      const { blob, filename, signed } = await downloadAdvisoryPackPdf({
        pack: exportPack,
        profile,
        userId: user?.id ?? null,
        user,
        market,
        recordedSigner,
      });
      track("advisory_pack_pdf_exported", {
        clientId,
        audience,
        status: exportPack.status,
        signed,
        filename,
      });
      toast.success("Advisory pack PDF downloaded");
      if (user) {
        const logged = await recordDelivery({
          clientId,
          firmId,
          channel: "pdf_download",
          kind: signed ? "report_pdf" : "advisory_draft",
          reportKey: "advisory_pack",
          subject: `${pack.content.clientName || "Client"} advisory pack v${pack.version}`,
          snapshotId: pack.snapshot_id,
          figuresHash: hashFigures({
            version: pack.version,
            status: pack.status,
            sections: pack.content.sections.map((s) => s.body),
          }),
          periodLabel: pack.period_label,
          createdBy: user.id,
          pdfBlob: blob,
        });
        warnIfDeliveryFailed(logged.error);
        warnIfPdfArchiveFailed(logged.pdfError);
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "PDF export failed");
    } finally {
      setExportingPdf(false);
    }
  };

  const comment = () =>
    run(
      "comment",
      async () => {
        if (!clientId || !pack || !note.trim()) return null;
        const res = await review({
          data: { clientId, packId: pack.id, action: "comment", note: note.trim() },
        });
        setNote("");
        return res;
      },
      "Comment added",
    );

  if (!clientId || !loaded || !migrated) return null;
  if (!pack && audience === "owner" && !canGenerate) return null;

  const identityFor = (actorId: string | null | undefined): RecordedActor | null => {
    if (!actorId) return null;
    const recorded = actors[actorId];
    if (recorded?.name) return recorded;
    if (!user || user.id !== actorId) {
      if (
        signoff?.signed_off_by_name &&
        pack?.reviewed_by === actorId &&
        !isSamplePracticeSignoff({
          name: signoff.signed_off_by_name,
          firmName: signoff.firm_name,
        })
      ) {
        return { name: signoff.signed_off_by_name, firmName: signoff.firm_name };
      }
      return null;
    }
    const meta = (user.user_metadata ?? {}) as { full_name?: unknown; name?: unknown };
    return recordedActorIdentity({
      authFullName: typeof meta.full_name === "string" ? meta.full_name : null,
      authName: typeof meta.name === "string" ? meta.name : null,
      email: user.email,
      clientFirmName: profile.firmName,
    });
  };

  const signerIdentity = identityFor(pack?.reviewed_by);
  const headerSignoffLine = packHeldSignoffLine({
    signedOff: signOffGate.signOffHolds,
    reviewedByKind: pack?.reviewed_by_kind,
    reviewedAt: pack?.reviewed_at,
    name: signerIdentity?.name ?? signoff?.signed_off_by_name,
    firmName: signerIdentity?.firmName ?? signoff?.firm_name,
    market,
  });

  const shell = [
    "rounded-2xl border border-[#b7872a]/25 bg-white/70 p-4 shadow-sm dark:border-[#d4a550]/20 dark:bg-white/[0.035]",
    className,
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <section
      className={shell}
      id="advisory-pack"
      data-audience={audience}
      data-status={shownStatus ?? "none"}
      data-signoff-blocked={signOffBlocked ? "true" : "false"}
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <span className="block text-[9.5px] font-bold uppercase tracking-[0.22em] text-[#9a7014] dark:text-[#e1b85e]">
            Advisory pack
          </span>
          <h3 className="mt-0.5 flex flex-wrap items-center gap-2 text-[15px] font-bold leading-tight text-slate-900 dark:text-[#f4e7c2]">
            {pack ? (
              <>
                <span>
                  v{pack.version}
                  {pack.period_label ? ` · ${pack.period_label}` : ""}
                </span>
                <span
                  className={`rounded-full border px-2 py-[1px] text-[9.5px] font-bold uppercase tracking-[0.12em] ${STATUS_CLASS[shownStatus ?? pack.status]}`}
                >
                  {packStatusLabel(shownStatus ?? pack.status, pack.requires_review)}
                </span>
                {signOffGate.figuresChanged ? (
                  <span className="text-[12px] font-semibold normal-case tracking-normal text-amber-700 dark:text-amber-300">
                    {ADVISORY_PACK_STALE_NOTE}
                  </span>
                ) : null}
              </>
            ) : (
              "No pack yet"
            )}
          </h3>
          {headerSignoffLine ? (
            <p
              className="mt-1 text-[12.5px] font-semibold leading-snug text-slate-900 dark:text-[#f4e7c2]"
              data-signoff-line
            >
              {headerSignoffLine}
            </p>
          ) : null}
          <p className="mt-1 max-w-[64ch] text-[12px] leading-relaxed text-slate-600 dark:text-slate-300/80">
            {pack
              ? audience === "accountant"
                ? "Diagnosis, forecast, moves and gaps in one place. Edit what you disagree with — the client only reads what you sign off."
                : hasFirm
                  ? "Your accountant reviews this before you act on it."
                  : "Built from your figures. Read it, then accept it to move on to the recommendations."
              : audience === "accountant"
                ? "Wrap the current diagnosis, forecast and proposed moves into one reviewable pack."
                : "MILŌN can turn the current figures into a short, plain-language pack."}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {versions.length > 1 ? (
            <select
              value={pack?.id ?? ""}
              onChange={(e) => void load(e.target.value)}
              className="rounded-md border border-slate-300/70 bg-white px-2 py-1 text-[12px] text-slate-700 dark:border-white/15 dark:bg-transparent dark:text-slate-200"
              aria-label="Pack version"
            >
              {versions.map((v) => (
                <option key={v.id} value={v.id}>
                  v{v.version} ·{" "}
                  {(v.id === pack?.id && shownStatus ? shownStatus : v.status).replace("_", " ")}
                </option>
              ))}
            </select>
          ) : null}
          {isWriter && canGenerate ? (
            <button
              type="button"
              onClick={() => void doGenerate()}
              disabled={busy !== null}
              className={pack ? GHOST_BTN : GOLD_BTN}
              data-generate
            >
              {busy === "generate" ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
              ) : (
                <RefreshCw className="h-3.5 w-3.5" aria-hidden />
              )}
              {pack ? "Regenerate" : "Generate pack"}
            </button>
          ) : null}
          {pack ? (
            <Button
              id="advisory-pack-export-pdf"
              type="button"
              size="sm"
              variant="outline"
              className="h-7 gap-1.5 border-[#d4a550]/40 bg-[#d4a550]/10 px-2.5 text-[10px] text-[#b8860b] hover:bg-[#d4a550]/20 dark:text-[#d4a550]"
              disabled={exportingPdf || busy !== null}
              onClick={() => void exportPdf()}
              data-export-pdf
            >
              {exportingPdf ? (
                <Loader2 className="h-3 w-3 animate-spin" aria-hidden />
              ) : (
                <Download className="h-3 w-3" aria-hidden />
              )}
              {exportingPdf ? "Preparing…" : "Export PDF"}
            </Button>
          ) : null}
          {pack ? (
            <button
              type="button"
              onClick={() => setExpanded((v) => !v)}
              className={GHOST_BTN}
              aria-expanded={expanded}
            >
              {expanded ? (
                <ChevronUp className="h-3.5 w-3.5" aria-hidden />
              ) : (
                <ChevronDown className="h-3.5 w-3.5" aria-hidden />
              )}
              {expanded ? "Collapse" : "Read"}
            </button>
          ) : null}
        </div>
      </div>

      <TrialEndedActionNotice firmId={firmId} open={trialBlock.open} error={trialBlock.error} />

      {pack && liveStats && liveStats.edit_rate >= HIGH_EDIT_RATE && audience === "accountant" ? (
        <p
          className="mt-3 rounded-lg border border-amber-400/50 bg-amber-500/10 px-3 py-2 text-[12px] text-amber-800 dark:text-amber-200"
          data-high-edit-rate
        >
          {Math.round(liveStats.edit_rate * 100)}% of the draft has been rewritten (
          {liveStats.sections_changed} of {liveStats.sections_total} sections). That is the signal
          MILŌN watches — if this keeps happening, the draft is not ready to send unreviewed.
        </p>
      ) : null}

      {pack && pack.status === "changes_requested" && pack.review_note ? (
        <p className="mt-3 rounded-lg border border-amber-400/50 bg-amber-500/10 px-3 py-2 text-[12px] text-amber-800 dark:text-amber-200">
          Changes requested: {pack.review_note}
        </p>
      ) : null}

      {pack && expanded ? (
        <ol className="mt-4 space-y-3">
          {pack.content.sections.map((s) => {
            const diff = changedByKey.get(s.key);
            const isEditing = editing === s.key;
            return (
              <li
                key={s.key}
                data-section={s.key}
                className="rounded-xl border border-[#b7872a]/20 bg-white/60 p-3 dark:border-white/10 dark:bg-white/[0.03]"
              >
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <h4 className="flex items-center gap-1.5 text-[12.5px] font-bold uppercase tracking-[0.08em] text-[#7a5a0e] dark:text-[#f1d28b]">
                    {s.key === "disclosure" ? (
                      <Lock className="h-3 w-3" aria-hidden />
                    ) : (
                      <FileText className="h-3 w-3" aria-hidden />
                    )}
                    {s.title}
                    {diff?.changed ? (
                      <span className="rounded-full border border-sky-400/50 bg-sky-500/10 px-1.5 py-[1px] text-[9px] font-bold uppercase tracking-[0.1em] text-sky-700 dark:text-sky-300">
                        edited
                      </span>
                    ) : null}
                  </h4>
                  <div className="flex items-center gap-1.5">
                    {diff?.changed ? (
                      <button
                        type="button"
                        onClick={() => setShowDraft((m) => ({ ...m, [s.key]: !m[s.key] }))}
                        className="text-[11px] font-semibold text-slate-500 underline-offset-2 hover:underline dark:text-slate-400"
                      >
                        {showDraft[s.key] ? "Hide AI draft" : "Show AI draft"}
                      </button>
                    ) : null}
                    {canEdit && !s.locked && !isEditing ? (
                      <button
                        type="button"
                        onClick={() => startEdit(s)}
                        className="inline-flex items-center gap-1 text-[11px] font-semibold text-[#7a5a0e] dark:text-[#f1d28b]"
                        data-edit-section={s.key}
                      >
                        <Pencil className="h-3 w-3" aria-hidden /> Edit
                      </button>
                    ) : null}
                  </div>
                </div>

                {isEditing ? (
                  <div className="mt-2 space-y-2">
                    <textarea
                      value={draftBody}
                      onChange={(e) => setDraftBody(e.target.value)}
                      rows={4}
                      className="w-full rounded-md border border-slate-300/70 bg-white px-2 py-1.5 text-[13px] leading-relaxed text-slate-900 dark:border-white/15 dark:bg-transparent dark:text-slate-100"
                    />
                    {s.bullets !== undefined || draftBullets ? (
                      <textarea
                        value={draftBullets}
                        onChange={(e) => setDraftBullets(e.target.value)}
                        rows={Math.max(3, draftBullets.split("\n").length)}
                        placeholder="One bullet per line"
                        className="w-full rounded-md border border-slate-300/70 bg-white px-2 py-1.5 text-[12.5px] leading-relaxed text-slate-900 dark:border-white/15 dark:bg-transparent dark:text-slate-100"
                      />
                    ) : null}
                    <div className="flex gap-2">
                      <button
                        type="button"
                        onClick={() => void saveEdit(s)}
                        disabled={busy !== null}
                        className={GOLD_BTN}
                      >
                        {busy === "edit" ? (
                          <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
                        ) : (
                          <Check className="h-3.5 w-3.5" aria-hidden />
                        )}
                        Save section
                      </button>
                      <button type="button" onClick={() => setEditing(null)} className={GHOST_BTN}>
                        <Undo2 className="h-3.5 w-3.5" aria-hidden /> Cancel
                      </button>
                    </div>
                  </div>
                ) : (
                  <>
                    <p className="mt-1.5 text-[13.5px] leading-relaxed text-slate-800 dark:text-slate-100/90">
                      {s.body}
                    </p>
                    {s.bullets?.length ? (
                      <ul className="mt-1.5 list-disc space-y-1 pl-5 text-[13px] leading-relaxed text-slate-700 dark:text-slate-200/85">
                        {s.bullets.map((b, i) => (
                          <li key={i}>{b}</li>
                        ))}
                      </ul>
                    ) : null}
                    {diff?.changed && showDraft[s.key] ? (
                      <pre
                        className="mt-2 whitespace-pre-wrap rounded-md border border-dashed border-slate-300/70 bg-slate-500/5 p-2 text-[11.5px] leading-relaxed text-slate-500 dark:border-white/15 dark:text-slate-400"
                        data-ai-draft
                      >
                        {diff.before}
                      </pre>
                    ) : null}
                  </>
                )}
              </li>
            );
          })}
        </ol>
      ) : null}

      {pack ? (
        <div className="mt-4 flex flex-col gap-2 rounded-xl border border-dashed border-[#b7872a]/35 p-3">
          <label className="text-[11px] font-semibold text-slate-600 dark:text-slate-300">
            {canSignOff && !signOffBlocked && audience === "accountant"
              ? "Note (required to request changes or reject; optional on sign-off)"
              : "Comment"}
            <textarea
              value={note}
              onChange={(e) => setNote(e.target.value)}
              rows={2}
              maxLength={2000}
              className="mt-1 w-full rounded-md border border-slate-300/70 bg-white px-2 py-1.5 text-[12.5px] font-normal text-slate-900 dark:border-white/15 dark:bg-transparent dark:text-slate-100"
            />
          </label>
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => void comment()}
              disabled={busy !== null || !note.trim()}
              className={GHOST_BTN}
              data-comment
            >
              <MessageSquare className="h-3.5 w-3.5" aria-hidden /> Add comment
            </button>
            {canSignOff ? (
              <>
                <button
                  type="button"
                  onClick={() => {
                    if (signOffBlocked) return;
                    void decide("approve");
                  }}
                  disabled={busy !== null || signOffBlocked}
                  title={signOffBlocked ? ADVISORY_PACK_STALE_NOTE : undefined}
                  className={GOLD_BTN}
                  data-approve
                  data-signoff-blocked={signOffBlocked ? "true" : "false"}
                >
                  {busy === "approve" ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
                  ) : (
                    <Check className="h-3.5 w-3.5" aria-hidden />
                  )}
                  {hasFirm ? "Sign off pack" : "Accept pack"}
                </button>
                {canOtherDecisions && audience === "accountant" ? (
                  <>
                    <button
                      type="button"
                      onClick={() => void decide("request_changes")}
                      disabled={busy !== null}
                      className={GHOST_BTN}
                      data-request-changes
                    >
                      <Undo2 className="h-3.5 w-3.5" aria-hidden /> Request changes
                    </button>
                    <button
                      type="button"
                      onClick={() => void decide("reject")}
                      disabled={busy !== null}
                      className="inline-flex items-center gap-1.5 rounded-lg border border-rose-400/40 px-2.5 py-1.5 text-[12px] font-semibold text-rose-700 disabled:opacity-50 dark:text-rose-300"
                      data-reject
                    >
                      <X className="h-3.5 w-3.5" aria-hidden /> Reject
                    </button>
                  </>
                ) : null}
              </>
            ) : null}
            <button
              type="button"
              onClick={() => setShowTrail((v) => !v)}
              className="ml-auto inline-flex items-center gap-1 text-[11px] font-semibold text-slate-500 dark:text-slate-400"
              aria-expanded={showTrail}
            >
              <History className="h-3.5 w-3.5" aria-hidden /> {showTrail ? "Hide" : "Show"} trail (
              {reviews.length})
            </button>
          </div>
        </div>
      ) : null}

      {pack && showTrail ? (
        <ol className="mt-3 space-y-1.5 text-[12px] text-slate-600 dark:text-slate-300" data-trail>
          {reviews.map((r) => (
            <li key={r.id} className="flex flex-wrap items-baseline gap-x-2">
              <span className="text-slate-400">{fmtWhen(r.created_at, market)}</span>
              <span className="font-semibold">
                {reviewActorLabel({
                  name: identityFor(r.actor_id)?.name,
                  firmName: identityFor(r.actor_id)?.firmName,
                  actorKind: r.actor_kind,
                })}
              </span>
              <span>{ACTION_LABEL[r.action]}</span>
              {r.section ? (
                <span className="text-slate-500">· {r.section.replace(/_/g, " ")}</span>
              ) : null}
              {r.note ? <span className="italic text-slate-500">— {r.note}</span> : null}
            </li>
          ))}
        </ol>
      ) : null}
    </section>
  );
}
