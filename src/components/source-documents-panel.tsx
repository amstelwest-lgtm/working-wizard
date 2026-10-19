/**
 * Source documents. Owners upload. The right person approves.
 * The button says Approve. Nothing here posts to a ledger.
 */
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type DragEvent,
} from "react";
import {
  SOURCE_DOC_ACCEPT,
  buildSourceDocumentsModel,
  type LedgerChoice,
  type SourceDocCard,
  type SourceDocSurface,
  type SourceDocViewer,
  type SourceDocumentsModel,
} from "@/lib/source-documents-ui";

const PRIMARY =
  "inline-flex min-h-11 w-full items-center justify-center rounded-lg bg-[#0B5FFF] px-4 py-2.5 text-sm font-semibold text-white hover:bg-[#2563EB] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#0B5FFF] disabled:cursor-not-allowed disabled:opacity-60 sm:w-auto";
const QUIET =
  "inline-flex min-h-11 w-full items-center justify-center rounded-lg border border-[#DBEAFE] bg-white px-4 py-2.5 text-sm font-semibold text-[#102A43] hover:bg-[#DBEAFE]/40 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#0B5FFF] disabled:cursor-not-allowed disabled:opacity-60 sm:w-auto";

export function SourceDocumentsPanel({
  clientId,
  surface,
  viewer,
  preview,
}: {
  clientId: string;
  surface: SourceDocSurface;
  viewer: SourceDocViewer;
  preview?: SourceDocumentsModel;
}) {
  if (preview) return <SourceDocumentsView model={preview} />;
  return <LiveSourceDocuments clientId={clientId} surface={surface} viewer={viewer} />;
}

export function SourceDocumentsView({
  model,
  busyId = null,
  notice = null,
  rejectId = null,
  rejectNote = "",
  onUpload,
  onLedger,
  onExtract,
  onApprove,
  onReject,
  onRejectNote,
}: {
  model: SourceDocumentsModel;
  busyId?: string | null;
  notice?: string | null;
  rejectId?: string | null;
  rejectNote?: string;
  onUpload?: (file: File, channel: "upload" | "camera") => void;
  onLedger?: (documentId: string, ledger: LedgerChoice) => void;
  onExtract?: (documentId: string, ledger: LedgerChoice) => void;
  onApprove?: (proposalId: string) => void;
  onReject?: (proposalId: string, note: string) => void;
  onRejectNote?: (value: string) => void;
}) {
  const fileRef = useRef<HTMLInputElement>(null);
  const cameraRef = useRef<HTMLInputElement>(null);
  const uploadIsPrimary = model.primaryId === "upload" || model.primaryId == null;

  const take = (event: ChangeEvent<HTMLInputElement>, channel: "upload" | "camera") => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (file) onUpload?.(file, channel);
  };

  const drop = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    const file = event.dataTransfer.files?.[0];
    if (file) onUpload?.(file, "upload");
  };

  return (
    <section
      data-source-documents={model.showUpload ? "upload" : "review"}
      className="w-full rounded-xl border border-[#DBEAFE] bg-white p-4 text-[#102A43] sm:p-5"
    >
      <h2 className="text-lg font-semibold tracking-tight text-[#102A43]">{model.heading}</h2>
      <p className="mt-1 max-w-xl text-sm leading-6 text-[#102A43]">{model.lede}</p>

      {model.duplicate ? (
        <p
          role="status"
          data-duplicate-notice
          className="mt-4 rounded-lg border border-[#DBEAFE] bg-[#DBEAFE] px-3 py-2 text-sm font-semibold text-[#102A43]"
        >
          Duplicate
        </p>
      ) : null}
      {notice ? (
        <p
          role="alert"
          className="mt-4 rounded-lg border border-[#DBEAFE] bg-white px-3 py-2 text-sm text-[#8E2430]"
        >
          {notice}
        </p>
      ) : null}

      {model.showUpload ? (
        <div className="mt-4" onDragOver={(event) => event.preventDefault()} onDrop={drop}>
          <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap">
            <button
              type="button"
              className={uploadIsPrimary ? PRIMARY : QUIET}
              onClick={() => fileRef.current?.click()}
              disabled={busyId === "upload"}
            >
              {busyId === "upload" ? "Saving…" : "Upload a document"}
            </button>
            <button
              type="button"
              className={QUIET}
              onClick={() => cameraRef.current?.click()}
              disabled={busyId === "upload"}
            >
              Take a photo
            </button>
          </div>
          <input
            ref={fileRef}
            type="file"
            className="sr-only"
            accept={SOURCE_DOC_ACCEPT}
            aria-label="Upload an invoice, bill, receipt, or bank statement"
            onChange={(event) => take(event, "upload")}
          />
          <input
            ref={cameraRef}
            type="file"
            className="sr-only"
            accept="image/*"
            capture="environment"
            aria-label="Photograph an invoice, bill, or receipt"
            onChange={(event) => take(event, "camera")}
          />
        </div>
      ) : null}

      {model.empty ? <p className="mt-4 text-sm leading-6 text-[#102A43]">{model.empty}</p> : null}

      <div className="mt-4 space-y-3">
        {model.cards.map((card) => (
          <DocumentCard
            key={card.id}
            card={card}
            primary={card.id === model.primaryId}
            busyId={busyId}
            rejecting={
              rejectId === (card.action.kind === "approve" ? card.action.proposalId : null)
            }
            rejectNote={rejectNote}
            onLedger={onLedger}
            onExtract={onExtract}
            onApprove={onApprove}
            onReject={onReject}
            onRejectNote={onRejectNote}
          />
        ))}
      </div>
    </section>
  );
}

function DocumentCard({
  card,
  primary,
  busyId,
  rejecting,
  rejectNote,
  onLedger,
  onExtract,
  onApprove,
  onReject,
  onRejectNote,
}: {
  card: SourceDocCard;
  primary: boolean;
  busyId: string | null;
  rejecting: boolean;
  rejectNote: string;
  onLedger?: (documentId: string, ledger: LedgerChoice) => void;
  onExtract?: (documentId: string, ledger: LedgerChoice) => void;
  onApprove?: (proposalId: string) => void;
  onReject?: (proposalId: string, note: string) => void;
  onRejectNote?: (value: string) => void;
}) {
  const action = card.action;
  const busy = busyId === card.id || (action.kind === "approve" && busyId === action.proposalId);
  return (
    <article
      className="rounded-lg border border-[#DBEAFE] bg-white p-3 sm:p-4"
      data-document={card.id}
    >
      <p className="truncate text-xs font-medium text-[#3D5270]">{card.fileName}</p>
      <h3
        className="mt-1 text-base font-semibold leading-6 text-[#102A43]"
        data-approved-by={
          card.approval && card.answer === card.approval ? card.approval : undefined
        }
      >
        {card.answer}
      </h3>
      {card.holding ? (
        <p
          data-holding="held_in_milon"
          className="mt-2 inline-flex rounded-md border border-[#DBEAFE] bg-[#DBEAFE] px-2 py-1 text-xs font-semibold text-[#102A43]"
        >
          {card.holding}
        </p>
      ) : null}
      {card.detail ? <p className="mt-2 text-sm leading-6 text-[#102A43]">{card.detail}</p> : null}
      {card.progress ? (
        <p data-clean-approvals className="mt-2 text-sm font-medium text-[#102A43]">
          {card.progress}
        </p>
      ) : null}
      {card.approval && card.answer !== card.approval ? (
        <p data-approved-by={card.approval} className="mt-2 text-sm font-medium text-[#102A43]">
          {card.approval}
        </p>
      ) : null}

      {card.rows.length > 0 ? (
        <dl className="mt-3 divide-y divide-[#DBEAFE] border-y border-[#DBEAFE]">
          {card.rows.map((row) => (
            <div
              key={row.label}
              className="grid grid-cols-1 gap-0.5 py-2 sm:grid-cols-[8.5rem_1fr] sm:gap-3"
            >
              <dt className="text-xs font-semibold uppercase tracking-wide text-[#3D5270]">
                {row.label}
              </dt>
              <dd className="break-words text-sm text-[#102A43]">{row.value}</dd>
            </div>
          ))}
        </dl>
      ) : null}

      {card.lines.length > 0 ? (
        <ul className="mt-3 space-y-1">
          {card.lines.map((line) => (
            <li
              key={`${line.description}-${line.amount}`}
              className="flex items-baseline justify-between gap-3 text-sm"
            >
              <span className="min-w-0 break-words">{line.description}</span>
              <span className="shrink-0 tabular-nums">{line.amount}</span>
            </li>
          ))}
        </ul>
      ) : null}

      {card.notes.length > 0 ? (
        <ul className="mt-3 space-y-1 text-sm text-[#102A43]">
          {card.notes.map((note) => (
            <li key={note}>{note}</li>
          ))}
        </ul>
      ) : null}

      {action.kind === "extract" ? (
        <div className="mt-3 space-y-2">
          {action.ledgerOptions.length > 0 ? (
            <label className="block text-sm text-[#102A43]">
              Ledger
              <select
                className="mt-1 min-h-11 w-full rounded-lg border border-[#DBEAFE] bg-white px-3 text-sm text-[#102A43]"
                value={action.ledger ?? ""}
                aria-label="Ledger"
                onChange={(event) =>
                  onLedger?.(action.documentId, event.target.value as LedgerChoice)
                }
              >
                {action.ledger == null ? <option value="">Choose a ledger</option> : null}
                {action.ledgerOptions.map((ledger) => (
                  <option key={ledger} value={ledger}>
                    {ledger === "xero" ? "Xero" : ledger === "qbo" ? "QuickBooks" : "Sage"}
                  </option>
                ))}
              </select>
            </label>
          ) : null}
          <p className="text-sm text-[#102A43]">{action.finalCopy}</p>
          <button
            type="button"
            className={primary ? PRIMARY : QUIET}
            disabled={busy || action.ledger == null}
            onClick={() => {
              if (action.ledger) onExtract?.(action.documentId, action.ledger);
            }}
          >
            {busy ? "Reading…" : action.button}
          </button>
        </div>
      ) : null}

      {action.kind === "approve" ? (
        <div className="mt-3 flex flex-col gap-2 sm:flex-row sm:flex-wrap">
          <button
            type="button"
            className={primary ? PRIMARY : QUIET}
            disabled={busy}
            onClick={() => onApprove?.(action.proposalId)}
          >
            {busy ? "Saving…" : action.button}
          </button>
          {rejecting ? (
            <div className="space-y-2">
              <label className="block text-sm text-[#102A43]">
                Note
                <textarea
                  value={rejectNote}
                  onChange={(event) => onRejectNote?.(event.target.value)}
                  rows={2}
                  className="mt-1 w-full rounded-lg border border-[#DBEAFE] bg-white px-3 py-2 text-sm text-[#102A43]"
                />
              </label>
              <button
                type="button"
                className={QUIET}
                disabled={busy}
                onClick={() => onReject?.(action.proposalId, rejectNote)}
              >
                Reject this proposal
              </button>
            </div>
          ) : (
            <button
              type="button"
              className={QUIET}
              disabled={busy}
              onClick={() => onReject?.(action.proposalId, "")}
            >
              Reject
            </button>
          )}
        </div>
      ) : null}
    </article>
  );
}

function LiveSourceDocuments({
  clientId,
  surface,
  viewer,
}: {
  clientId: string;
  surface: SourceDocSurface;
  viewer: SourceDocViewer;
}) {
  const [bundle, setBundle] = useState<Awaited<
    ReturnType<typeof import("@/lib/source-documents-browser").listSourceDocuments>
  > | null>(null);
  const [loading, setLoading] = useState(true);
  const [notice, setNotice] = useState<string | null>(null);
  const [duplicate, setDuplicate] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [ledgerChoice, setLedgerChoice] = useState<Partial<Record<string, LedgerChoice>>>({});
  const [rejectId, setRejectId] = useState<string | null>(null);
  const [rejectNote, setRejectNote] = useState("");
  const timeZone = useMemo(
    // Browser zone for upload grouping. Not a printed date.
    () => (typeof Intl === "undefined" ? "UTC" : Intl.DateTimeFormat().resolvedOptions().timeZone),
    [],
  );

  const load = useCallback(async () => {
    const api = await import("@/lib/source-documents-browser");
    const next = await api.listSourceDocuments(clientId);
    setBundle(next);
    setLoading(false);
  }, [clientId]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    void load().catch((error: unknown) => {
      if (cancelled) return;
      setLoading(false);
      setNotice(error instanceof Error ? error.message : "Documents could not be loaded.");
    });
    return () => {
      cancelled = true;
    };
  }, [load]);

  const model = useMemo(() => {
    if (!bundle) return null;
    return buildSourceDocumentsModel({
      surface,
      viewer: {
        ...viewer,
        userId: viewer.userId ?? bundle.viewerUserId,
        name: viewer.name ?? bundle.viewerName,
      },
      documents: bundle.documents,
      extractions: bundle.extractions,
      proposals: bundle.proposals,
      trust: bundle.trust,
      names: bundle.names,
      connectedLedgers: bundle.connectedLedgers,
      ledgerChoice,
      duplicate,
      timeZone,
    });
  }, [bundle, surface, viewer, ledgerChoice, duplicate, timeZone]);

  const upload = async (file: File, channel: "upload" | "camera") => {
    setBusyId("upload");
    setNotice(null);
    try {
      const api = await import("@/lib/source-documents-browser");
      const result = await api.uploadSourceDocument({ clientId, file, channel });
      if (!result.ok) {
        setNotice(result.message);
        return;
      }
      setDuplicate(result.duplicate);
      await load();
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "The file could not be saved. Try again.");
    } finally {
      setBusyId(null);
    }
  };

  const extract = async (documentId: string, ledger: LedgerChoice) => {
    setBusyId(documentId);
    setNotice(null);
    try {
      const api = await import("@/lib/source-documents-browser");
      const result = await api.extractSourceDocument({
        documentId,
        targetLedger: ledger,
        requestedMode: "draft",
      });
      if (!result.ok) {
        setNotice(result.message);
        return;
      }
      if (result.duplicate) setDuplicate(true);
      await load();
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "This file could not be read. Try again.");
    } finally {
      setBusyId(null);
    }
  };

  const approve = async (proposalId: string) => {
    setBusyId(proposalId);
    setNotice(null);
    try {
      const api = await import("@/lib/source-documents-browser");
      const result = await api.decideSourceProposal({ proposalId, decision: "approve" });
      if (!result.ok) {
        setNotice(result.message);
        return;
      }
      await load();
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "That didn't save. Try again.");
    } finally {
      setBusyId(null);
    }
  };

  const reject = async (proposalId: string, note: string) => {
    if (rejectId !== proposalId) {
      setRejectId(proposalId);
      setRejectNote("");
      return;
    }
    setBusyId(proposalId);
    setNotice(null);
    try {
      const api = await import("@/lib/source-documents-browser");
      const result = await api.decideSourceProposal({ proposalId, decision: "reject", note });
      if (!result.ok) {
        setNotice(result.message);
        return;
      }
      setRejectId(null);
      setRejectNote("");
      await load();
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "That didn't save. Try again.");
    } finally {
      setBusyId(null);
    }
  };

  if (loading && !model) {
    return (
      <section
        data-source-documents={surface}
        className="w-full rounded-xl border border-[#DBEAFE] bg-white p-4 text-sm text-[#102A43]"
      >
        Loading documents…
      </section>
    );
  }
  if (!model) {
    return (
      <section
        data-source-documents={surface}
        className="w-full rounded-xl border border-[#DBEAFE] bg-white p-4 text-sm text-[#102A43]"
      >
        {notice ?? "Documents could not be loaded."}
      </section>
    );
  }

  return (
    <SourceDocumentsView
      model={model}
      busyId={busyId}
      notice={notice}
      rejectId={rejectId}
      rejectNote={rejectNote}
      onUpload={(file, channel) => void upload(file, channel)}
      onLedger={(documentId, ledger) =>
        setLedgerChoice((current) => ({ ...current, [documentId]: ledger }))
      }
      onExtract={(documentId, ledger) => void extract(documentId, ledger)}
      onApprove={(proposalId) => void approve(proposalId)}
      onReject={(proposalId, note) => void reject(proposalId, note)}
      onRejectNote={setRejectNote}
    />
  );
}
