/**
 * Client library. Horizontal tabs match the cash forecast menu.
 * Client brain is not a tab here.
 */
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactNode,
} from "react";
import { toast } from "sonner";
import { SourceDocumentsPanel } from "@/components/source-documents-panel";
import { useMarketFormat } from "@/contexts/market";
import "@/components/cash/cash-paged.css";
import {
  clientDocumentDownloadUrl,
  deleteClientDocument,
  listClientDocuments,
  setClientDocumentVisibility,
  type ClientDocumentRow,
} from "@/lib/client-documents-browser";
import { parseDocumentMeta } from "@/lib/client-documents";
import {
  classifyLibraryFile,
  clientSendLibraryFlags,
  CLIENT_LIBRARY_DEFAULT_TAB,
  CLIENT_LIBRARY_TAB_LABEL,
  CLIENT_LIBRARY_TAB_SENTENCE,
  CLIENT_LIBRARY_TABS,
  groupLibraryFilesByYear,
  libraryEmptyCopy,
  libraryFileWithVisibility,
  libraryFilesForTab,
  libraryFilesFromSourceRows,
  libraryReviewCount,
  type ClientLibraryTab,
  type LibraryFile,
} from "@/lib/client-library";

function fileFromUpload(row: ClientDocumentRow): LibraryFile {
  const meta = parseDocumentMeta(row.meta);
  const raw = row.meta && typeof row.meta === "object" ? (row.meta as Record<string, unknown>) : {};
  const sent = clientSendLibraryFlags(raw);
  return classifyLibraryFile({
    id: row.id,
    name: meta.file_name ?? row.storage_path?.split("/").pop() ?? "File",
    at: row.created_at,
    visibility: row.visibility,
    source: meta.source,
    documentType: meta.document_type,
    itemKey: typeof raw.item_key === "string" ? raw.item_key : null,
    accountLabel: meta.account_label,
    summary: meta.summary,
    periodLabel: row.period_label, // date-ok: year bucket only, not a printed range
    bytes: meta.bytes,
    storagePath: row.storage_path,
    origin: "upload",
    uploadId: row.id,
    ...(sent
      ? {
          fromClient: sent.fromClient,
          needsReview: sent.needsReview,
          statusLabel: sent.statusLabel,
        }
      : {}),
  });
}

export function ClientLibraryMenu({
  value,
  reviewCount,
  onChange,
}: {
  value: ClientLibraryTab;
  reviewCount: number;
  onChange: (tab: ClientLibraryTab) => void;
}) {
  const buttons = useRef<Array<HTMLButtonElement | null>>([]);

  const select = (index: number) => {
    const tab = CLIENT_LIBRARY_TABS[index];
    if (!tab) return;
    onChange(tab);
    buttons.current[index]?.focus();
  };

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const current = Math.max(0, CLIENT_LIBRARY_TABS.indexOf(value));
    const last = CLIENT_LIBRARY_TABS.length - 1;
    if (event.key === "ArrowRight") {
      event.preventDefault();
      select(current === last ? 0 : current + 1);
    } else if (event.key === "ArrowLeft") {
      event.preventDefault();
      select(current === 0 ? last : current - 1);
    } else if (event.key === "Home") {
      event.preventDefault();
      select(0);
    } else if (event.key === "End") {
      event.preventDefault();
      select(last);
    }
  };

  return (
    <div
      role="tablist"
      aria-label="Client library"
      className="cash-menu"
      data-client-library-menu=""
      onKeyDown={onKeyDown}
    >
      {CLIENT_LIBRARY_TABS.map((tab, index) => {
        const on = tab === value;
        return (
          <button
            key={tab}
            ref={(node) => {
              buttons.current[index] = node;
            }}
            type="button"
            role="tab"
            id={`library-menu-${tab}`}
            aria-selected={on}
            aria-controls={`library-pane-${tab}`}
            tabIndex={on ? 0 : -1}
            className="cash-menu__tab"
            data-library-tab={tab}
            onClick={() => onChange(tab)}
          >
            {CLIENT_LIBRARY_TAB_LABEL[tab]}
            {tab === "review" && reviewCount > 0 ? (
              <span
                className="cash-menu__badge"
                data-library-review-badge=""
                aria-label={`${reviewCount} to review`}
              >
                {reviewCount}
              </span>
            ) : null}
          </button>
        );
      })}
    </div>
  );
}

export function ClientLibraryView({
  files,
  tab,
  query,
  onTab,
  onQuery,
  audience,
  formatWhen,
  busyId = null,
  reviewQueue = null,
  onOpen,
  onVisibility,
  onRemove,
}: {
  files: readonly LibraryFile[];
  tab: ClientLibraryTab;
  query: string;
  onTab: (tab: ClientLibraryTab) => void;
  onQuery: (query: string) => void;
  audience: "accountant" | "owner";
  formatWhen: (iso: string) => string;
  busyId?: string | null;
  reviewQueue?: ReactNode;
  onOpen?: (file: LibraryFile) => void;
  onVisibility?: (file: LibraryFile) => void;
  onRemove?: (file: LibraryFile) => void;
}) {
  const shown = libraryFilesForTab(files, tab, query);
  const groups = groupLibraryFilesByYear(shown);
  const reviewCount = libraryReviewCount(files);

  return (
    <div className="cash-paged client-library" data-client-library={tab}>
      <ClientLibraryMenu value={tab} reviewCount={reviewCount} onChange={onTab} />
      <p className="cash-paged__sentence" data-library-sentence="">
        {CLIENT_LIBRARY_TAB_SENTENCE[tab]}
      </p>
      <label className="client-library__search">
        Search
        <input
          type="search"
          value={query}
          placeholder="Search by name, type, or year"
          data-library-search=""
          onChange={(event) => onQuery(event.target.value)}
        />
      </label>
      <div
        role="tabpanel"
        id={`library-pane-${tab}`}
        aria-labelledby={`library-menu-${tab}`}
        className="cash-paged__pane"
        data-library-pane={tab}
      >
        {groups.length === 0 ? (
          <p className="client-library__empty" data-library-empty="">
            {libraryEmptyCopy(tab, query)}
          </p>
        ) : (
          <div className="client-library__groups">
            {groups.map((group) => (
              <section key={group.year} data-library-year={group.year}>
                <h3 className="client-library__year">{group.label}</h3>
                <div className="client-library__scroll">
                  <table className="client-library__table">
                    <thead>
                      <tr>
                        <th scope="col">File</th>
                        <th scope="col">Type</th>
                        <th scope="col">When</th>
                        <th scope="col">
                          <span className="client-library__sr">Actions</span>
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {group.files.map((file) => {
                        const meta = [
                          file.sourceLabel,
                          file.visibilityLabel,
                          file.statusLabel,
                          file.bytesLabel,
                        ].filter(Boolean);
                        const busy = busyId === file.id;
                        return (
                          <tr key={file.id} data-library-file={file.id}>
                            <td data-label="File">
                              <div className="client-library__name">{file.name}</div>
                              {meta.length ? (
                                <p className="client-library__meta">{meta.join(" · ")}</p>
                              ) : null}
                              {file.summary ? (
                                <p className="client-library__meta">{file.summary}</p>
                              ) : null}
                            </td>
                            <td data-label="Type">{file.typeLabel}</td>
                            <td data-label="When">{file.at ? formatWhen(file.at) : "—"}</td>
                            <td data-label="">
                              <div className="client-library__actions">
                                {file.storagePath && onOpen ? (
                                  <button
                                    type="button"
                                    className="client-library__open"
                                    disabled={busy}
                                    onClick={() => onOpen(file)}
                                  >
                                    {busy ? "Opening…" : "Open"}
                                  </button>
                                ) : null}
                                {audience === "owner" && file.uploadId && onVisibility ? (
                                  <button
                                    type="button"
                                    className="client-library__open"
                                    disabled={busy}
                                    onClick={() => onVisibility(file)}
                                  >
                                    {file.visibility === "shared"
                                      ? "Make private"
                                      : "Share with accountant"}
                                  </button>
                                ) : null}
                                {audience === "owner" && file.uploadId && onRemove ? (
                                  <button
                                    type="button"
                                    className="client-library__open"
                                    disabled={busy}
                                    onClick={() => onRemove(file)}
                                  >
                                    Remove
                                  </button>
                                ) : null}
                              </div>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </section>
            ))}
          </div>
        )}
        {tab === "review" && reviewQueue ? (
          <div className="client-library__queue" data-library-review-queue="">
            <h3 className="client-library__year">
              {audience === "owner" ? "Upload a bill or statement" : "Approval queue"}
            </h3>
            {reviewQueue}
          </div>
        ) : null}
      </div>
    </div>
  );
}

export function ClientLibrary({
  clientId,
  audience,
  clientHasFirm = false,
  refreshKey,
}: {
  clientId: string;
  audience: "accountant" | "owner";
  clientHasFirm?: boolean;
  refreshKey?: unknown;
}) {
  const { date } = useMarketFormat();
  const [files, setFiles] = useState<LibraryFile[]>([]);
  const [tab, setTab] = useState<ClientLibraryTab>(CLIENT_LIBRARY_DEFAULT_TAB);
  const [query, setQuery] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const uploadsPromise = listClientDocuments(clientId);
      const sourcePromise = import("@/lib/source-documents-browser")
        .then((api) => api.listSourceDocuments(clientId))
        .then((bundle) =>
          libraryFilesFromSourceRows({
            documents: bundle.documents,
            extractions: bundle.extractions,
            proposals: bundle.proposals,
          }),
        )
        .catch(() => [] as LibraryFile[]);
      const [uploads, source] = await Promise.all([uploadsPromise, sourcePromise]);
      setFiles([...uploads.map(fileFromUpload), ...source]);
      setError(null);
    } catch (e) {
      const message = e instanceof Error ? e.message : "The library could not be loaded.";
      if (/visibility|client_artifacts|42703|42P01/.test(message)) {
        setFiles([]);
        setError(null);
      } else {
        setError(message);
      }
    } finally {
      setLoading(false);
    }
  }, [clientId]);

  useEffect(() => {
    setLoading(true);
    void load();
  }, [load, refreshKey]);

  const open = async (file: LibraryFile) => {
    if (!file.storagePath) return;
    setBusyId(file.id);
    try {
      const url = await clientDocumentDownloadUrl(file.storagePath);
      window.open(url, "_blank", "noopener");
    } catch (e) {
      toast.error(`Could not open the file: ${e instanceof Error ? e.message : "Try again."}`);
    } finally {
      setBusyId(null);
    }
  };

  const flip = async (file: LibraryFile) => {
    if (!file.uploadId) return;
    const next = file.visibility === "shared" ? "private" : "shared";
    setBusyId(file.id);
    try {
      await setClientDocumentVisibility(file.uploadId, next);
      setFiles((prev) =>
        prev.map((row) => (row.id === file.id ? libraryFileWithVisibility(row, next) : row)),
      );
      toast.success(next === "shared" ? "Shared with your accountant." : "Now private.");
    } catch (e) {
      toast.error(`Could not change visibility: ${e instanceof Error ? e.message : "Try again."}`);
    } finally {
      setBusyId(null);
    }
  };

  const remove = async (file: LibraryFile) => {
    if (!file.uploadId) return;
    if (!window.confirm(`Remove "${file.name}" from your client library?`)) return;
    setBusyId(file.id);
    try {
      await deleteClientDocument({ id: file.uploadId, storage_path: file.storagePath });
      setFiles((prev) => prev.filter((row) => row.id !== file.id));
    } catch (e) {
      toast.error(`Could not remove the file: ${e instanceof Error ? e.message : "Try again."}`);
    } finally {
      setBusyId(null);
    }
  };

  if (loading && files.length === 0) {
    return <p className="client-library__empty">Loading the library…</p>;
  }
  if (error) return <p className="client-library__empty">{error}</p>;

  return (
    <ClientLibraryView
      files={files}
      tab={tab}
      query={query}
      onTab={setTab}
      onQuery={setQuery}
      audience={audience}
      formatWhen={(iso) => date(iso)}
      busyId={busyId}
      onOpen={(file) => void open(file)}
      onVisibility={audience === "owner" ? (file) => void flip(file) : undefined}
      onRemove={audience === "owner" ? (file) => void remove(file) : undefined}
      reviewQueue={
        <SourceDocumentsPanel
          clientId={clientId}
          surface={audience === "owner" ? "upload" : "review"}
          viewer={{
            clientHasFirm,
            isOwner: audience === "owner",
            isFirmMemberWithAccess: audience === "accountant" && clientHasFirm,
          }}
        />
      }
    />
  );
}
