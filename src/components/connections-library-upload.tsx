/**
 * Upload files on Connections.
 *
 * Same read as UploadFinancials (`extractFinancialsFromPDF`, Claude Sonnet 5.5)
 * and the same archive as the statement and bank packs (`archiveUploads` →
 * client_artifacts). The row shows up on Client library. This does not apply
 * figures to the books — Upload statements still does that.
 */
import { useRef, useState, type DragEvent } from "react";
import { Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { FileText, Loader2, Upload } from "lucide-react";
import { toast } from "sonner";
import { extractFinancialsFromPDF } from "@/lib/extractFinancials.server";
import { archiveUploads, describeArchiveFailures } from "@/lib/client-documents-browser";
import {
  LIBRARY_DOCUMENT_TYPES,
  LIBRARY_UPLOAD_ACCEPT,
  libraryFileKind,
  libraryProcessingSummary,
  librarySaveAfterReadError,
  libraryUploadLabel,
  type LibraryDocumentTypeId,
} from "@/lib/connections-library-upload";
import { fileToText } from "@/lib/spreadsheet-text";
import { pdfTransport, unstage, type PdfTransport } from "@/lib/staged-upload-browser";
import { preflightUploadFile } from "@/lib/upload-quality";
import { accountantClientTabSearch } from "@/lib/client-route-search";
import { selectionPayload } from "@/lib/market";
import { useMarketFormat } from "@/contexts/market";

const PRIMARY =
  "inline-flex min-h-11 items-center justify-center rounded-lg bg-[#0B5FFF] px-4 py-2.5 text-sm font-semibold text-white hover:bg-[#2563EB] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#0B5FFF] disabled:cursor-not-allowed disabled:opacity-60";

type ReadResult = {
  data?: {
    entity_name?: string | null;
    extraction_notes?: string | null;
    current_period?: { period_end?: string | null };
  };
};

export function ConnectionsLibraryUpload({ clientId }: { clientId: string }) {
  const { selection } = useMarketFormat();
  const extract = useServerFn(extractFinancialsFromPDF);
  const inputRef = useRef<HTMLInputElement>(null);
  const [typeId, setTypeId] = useState<LibraryDocumentTypeId>("financial_statement");
  const [label, setLabel] = useState("Financial statement");
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState<{ fileName: string; summary: string } | null>(null);

  const chooseType = (next: LibraryDocumentTypeId) => {
    const previous = libraryUploadLabel(typeId, "") ?? "";
    setTypeId(next);
    setLabel((current) => {
      const trimmed = current.trim();
      if (!trimmed || trimmed === previous) return libraryUploadLabel(next, "") ?? "";
      return current;
    });
    setSaved(null);
  };

  const take = (incoming: File | null) => {
    if (!incoming) return;
    if (!libraryFileKind(incoming)) {
      toast.error("Use a PDF, CSV, or Excel file.");
      return;
    }
    if (libraryFileKind(incoming) === "pdf") {
      const pre = preflightUploadFile(incoming);
      if (pre) {
        toast.error(pre);
        return;
      }
    } else if (incoming.size === 0) {
      toast.error("That file is empty.");
      return;
    } else if (incoming.size > 32 * 1024 * 1024) {
      toast.error("That file is larger than 32 MB.");
      return;
    }
    setFile(incoming);
    setSaved(null);
  };

  const onDrop = (event: DragEvent<HTMLButtonElement>) => {
    event.preventDefault();
    if (busy) return;
    take(event.dataTransfer.files?.[0] ?? null);
  };

  const run = async () => {
    if (!file || busy) return;
    const kind = libraryFileKind(file);
    const named = libraryUploadLabel(typeId, label);
    if (!kind || !named) {
      toast.error(
        typeId === "other" ? "Name what you are uploading." : "Choose a PDF, CSV, or Excel file.",
      );
      return;
    }
    setBusy(true);
    setSaved(null);
    let staged: PdfTransport | null = null;
    let summary = "";
    let readable = false;
    try {
      const market = selectionPayload(selection);
      let res: ReadResult;
      if (kind === "pdf") {
        staged = await pdfTransport(file);
        res = (await extract({
          data: {
            storagePath: staged.storagePath,
            pdfBase64: staged.base64,
            fileName: file.name,
            market,
          },
        })) as ReadResult;
      } else {
        res = (await extract({
          data: { text: await fileToText(file), fileName: file.name, market },
        })) as ReadResult;
      }
      readable = true;
      summary = libraryProcessingSummary({
        entityName: res.data?.entity_name,
        periodEnd: res.data?.current_period?.period_end,
        notes: res.data?.extraction_notes,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Could not read that file.";
      if (!librarySaveAfterReadError(message)) {
        toast.error(message);
        setBusy(false);
        await unstage([staged?.storagePath]);
        return;
      }
      summary = message;
    }

    try {
      const archived = await archiveUploads({
        clientId,
        visibility: "shared",
        source: "connections",
        items: [{ file, accountLabel: named, documentType: typeId, summary }],
      });
      const problem = describeArchiveFailures(archived);
      if (!archived.archived.length) {
        toast.error(problem ?? "Could not save that file to Client library.");
        return;
      }
      if (problem) toast.warning(problem);
      setSaved({ fileName: file.name, summary });
      setFile(null);
      if (inputRef.current) inputRef.current.value = "";
      toast.success(
        readable
          ? "Saved to Client library."
          : "Saved to Client library. Milōn could not pull figures from it.",
      );
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Could not save that file to Client library.",
      );
    } finally {
      setBusy(false);
      await unstage([staged?.storagePath]);
    }
  };

  const ready = Boolean(file && libraryUploadLabel(typeId, label));

  return (
    <section
      data-connections-upload
      className="mt-6 rounded-xl border border-[#DBEAFE] bg-white p-4 text-[#102A43] sm:p-5"
    >
      <h2 className="text-lg font-semibold tracking-tight">Upload files</h2>
      <p className="mt-1 max-w-xl text-sm leading-6 text-[#3D5270]">
        PDF, CSV, or Excel. Name the file, and Milōn reads it into Client library.
      </p>

      <label className="mt-4 block text-sm font-semibold" htmlFor="library-upload-type">
        What are you uploading?
        <select
          id="library-upload-type"
          className="mt-1 min-h-11 w-full rounded-lg border border-[#DBEAFE] bg-white px-3 text-sm font-normal text-[#102A43]"
          value={typeId}
          disabled={busy}
          onChange={(event) => chooseType(event.target.value as LibraryDocumentTypeId)}
        >
          {LIBRARY_DOCUMENT_TYPES.map((row) => (
            <option key={row.id} value={row.id}>
              {row.label}
            </option>
          ))}
        </select>
      </label>

      <label className="mt-3 block text-sm font-semibold" htmlFor="library-upload-label">
        Label
        <input
          id="library-upload-label"
          className="mt-1 min-h-11 w-full rounded-lg border border-[#DBEAFE] bg-white px-3 text-sm font-normal text-[#102A43]"
          value={label}
          maxLength={80}
          disabled={busy}
          placeholder={typeId === "other" ? "Name this file" : "Label on the library row"}
          onChange={(event) => {
            setLabel(event.target.value);
            setSaved(null);
          }}
        />
      </label>

      <button
        type="button"
        className="mt-4 flex w-full flex-col items-center gap-2 rounded-xl border-2 border-dashed border-[#DBEAFE] px-6 py-8 text-sm hover:border-[#0B5FFF] disabled:cursor-default disabled:opacity-70"
        onClick={() => inputRef.current?.click()}
        onDragOver={(event) => event.preventDefault()}
        onDrop={onDrop}
        disabled={busy}
      >
        {busy ? (
          <>
            <Loader2 className="h-6 w-6 animate-spin text-[#0B5FFF]" />
            <span>Reading the file…</span>
          </>
        ) : file ? (
          <>
            <FileText className="h-6 w-6 text-[#0B5FFF]" />
            <span className="font-semibold">{file.name}</span>
            <span className="text-xs text-[#3D5270]">
              Choose a different file, or save this one.
            </span>
          </>
        ) : (
          <>
            <Upload className="h-6 w-6 text-[#0B5FFF]" />
            <span className="font-semibold">Drop a PDF, CSV, or Excel file</span>
            <span className="text-xs text-[#3D5270]">One file at a time, up to 32 MB.</span>
          </>
        )}
      </button>
      <input
        ref={inputRef}
        type="file"
        accept={LIBRARY_UPLOAD_ACCEPT}
        className="sr-only"
        aria-label="Upload a PDF, CSV, or Excel file"
        onChange={(event) => {
          take(event.target.files?.[0] ?? null);
          event.target.value = "";
        }}
      />

      <div className="mt-4 flex flex-wrap items-center gap-3">
        <button
          type="button"
          className={PRIMARY}
          disabled={!ready || busy}
          onClick={() => void run()}
        >
          {busy ? "Reading…" : "Read and save to Client library"}
        </button>
        <Link
          to="/clients/$clientId"
          params={{ clientId }}
          search={(prev) => accountantClientTabSearch(prev, "portal", { section: "documents" })}
          className="text-sm font-semibold text-[#0B5FFF] underline-offset-2 hover:underline"
        >
          Open Client library
        </Link>
      </div>

      {saved ? (
        <p
          role="status"
          className="mt-4 rounded-lg border border-[#DBEAFE] bg-[#F4F8FF] px-3 py-2 text-sm"
          data-library-saved
        >
          <span className="font-semibold">{saved.fileName}</span> is in Client library.{" "}
          {saved.summary}
        </p>
      ) : null}
    </section>
  );
}
