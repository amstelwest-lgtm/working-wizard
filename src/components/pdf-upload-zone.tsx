import { useCallback, useRef, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { extractPDFsWithAI } from "@/lib/extract-financials.functions";
import type { MergedExtractionResult } from "@/lib/extraction-types";
import { Button } from "@/components/ui/button";
import { X, FileText, Loader2, Upload, Info, AlertCircle } from "lucide-react";
import { useMarket } from "@/contexts/market";
import { selectionPayload } from "@/lib/market";
import { pdfTransport, transportPaths, unstage } from "@/lib/staged-upload-browser";

type Stage = "idle" | "uploading" | "reading" | "extracting" | "verifying" | "done" | "error";

const STAGE_LABELS: Record<Stage, string> = {
  idle: "",
  uploading: "Uploading document…",
  reading: "Reading document structure…",
  extracting: "Extracting financial figures…",
  verifying: "Verifying calculations…",
  done: "Done — please review the extracted values",
  error: "",
};

const STAGE_ORDER: Stage[] = ["uploading", "reading", "extracting", "verifying", "done"];

const CONFIDENCE_CHIP: Record<string, { cls: string; label: string }> = {
  high: {
    cls: "bg-emerald-950/60 text-emerald-400 border border-emerald-700",
    label: "High confidence extraction",
  },
  medium: {
    cls: "bg-amber-950/60 text-amber-400 border border-amber-700",
    label: "Medium confidence — please review carefully",
  },
  low: {
    cls: "bg-red-950/60 text-red-400 border border-red-700",
    label: "Low confidence — manual review required",
  },
};

interface UploadedFile {
  file: File;
  id: string;
}

interface Props {
  onComplete: (result: MergedExtractionResult) => void;
  onError?: (msg: string) => void;
}

function formatBytes(bytes: number) {
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

export function PDFUploadZone({ onComplete, onError }: Props) {
  const { selection } = useMarket();
  const doExtract = useServerFn(extractPDFsWithAI);
  const [files, setFiles] = useState<UploadedFile[]>([]);
  const [dragging, setDragging] = useState(false);
  const [stage, setStage] = useState<Stage>("idle");
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [result, setResult] = useState<MergedExtractionResult | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const addFiles = useCallback((incoming: FileList | null) => {
    if (!incoming) return;
    const pdfs = Array.from(incoming).filter(
      (f) => f.type === "application/pdf" || f.name.endsWith(".pdf"),
    );
    const nonPdf = Array.from(incoming).find(
      (f) => f.type !== "application/pdf" && !f.name.endsWith(".pdf"),
    );
    if (nonPdf) {
      setErrorMsg("Please upload PDF files only.");
      return;
    }
    const oversized = pdfs.find((f) => f.size > 32 * 1024 * 1024);
    if (oversized) {
      setErrorMsg(`"${oversized.name}" exceeds 32 MB. Please compress or split the file.`);
      return;
    }
    const empty = pdfs.find((f) => f.size < 400);
    if (empty) {
      setErrorMsg(`"${empty.name}" is too small to be a financial statement.`);
      return;
    }
    setErrorMsg(null);
    setFiles((prev) => {
      const combined = [...prev, ...pdfs.map((f) => ({ file: f, id: crypto.randomUUID() }))];
      return combined.slice(0, 3);
    });
  }, []);

  const removeFile = (id: string) => setFiles((prev) => prev.filter((f) => f.id !== id));

  const onDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setDragging(false);
      addFiles(e.dataTransfer.files);
    },
    [addFiles],
  );

  const runExtraction = async () => {
    if (!files.length) return;
    setStage("uploading");
    setErrorMsg(null);
    setResult(null);

    const stageTimer = (s: Stage, delay: number) => setTimeout(() => setStage(s), delay);

    const t1 = stageTimer("reading", 1500);
    const t2 = stageTimer("extracting", 3500);
    const t3 = stageTimer(
      "verifying",
      files.reduce((acc, f) => acc + f.file.size, 0) > 5 * 1024 * 1024 ? 12_000 : 8_000,
    );

    let filePayloads: Array<{ fileName: string; storagePath?: string; base64?: string }> = [];
    try {
      filePayloads = await Promise.all(
        files.map(async (f) => ({ fileName: f.file.name, ...(await pdfTransport(f.file)) })),
      );

      const extraction = await doExtract({
        data: { files: filePayloads, market: selectionPayload(selection) },
      });

      clearTimeout(t1);
      clearTimeout(t2);
      clearTimeout(t3);
      setStage("done");
      setResult(extraction as MergedExtractionResult);
      onComplete(extraction as MergedExtractionResult);
    } catch (e) {
      clearTimeout(t1);
      clearTimeout(t2);
      clearTimeout(t3);
      const msg = (e as Error).message ?? "Could not read this document automatically.";
      setStage("error");
      setErrorMsg(msg);
      onError?.(msg);
    } finally {
      await unstage(transportPaths(filePayloads));
    }
  };

  const isProcessing = ["uploading", "reading", "extracting", "verifying"].includes(stage);
  const currentStageIdx = STAGE_ORDER.indexOf(stage);
  const totalSize = files.reduce((acc, f) => acc + f.file.size, 0);
  const confidence = result?.data_quality?.overall_confidence;

  return (
    <div className="space-y-3">
      {/* Drop zone */}
      <div
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={onDrop}
        onClick={() => !isProcessing && inputRef.current?.click()}
        className={`relative rounded-xl border-2 border-dashed transition-colors cursor-pointer p-6 text-center
          ${dragging ? "border-violet-500 bg-violet-950/20" : "border-slate-700 hover:border-slate-500 bg-slate-900/40"}
          ${isProcessing ? "pointer-events-none opacity-70" : ""}`}
      >
        <input
          ref={inputRef}
          type="file"
          accept="application/pdf,.pdf"
          multiple
          className="hidden"
          onChange={(e) => {
            addFiles(e.target.files);
            e.target.value = "";
          }}
        />
        <Upload className="mx-auto h-8 w-8 text-slate-500 mb-2" />
        <p className="text-sm font-medium text-slate-300">
          {files.length === 0
            ? "Drop PDF statements here, or click to browse"
            : files.length >= 3
              ? "Maximum 3 files"
              : "Drop another PDF, or click to add more"}
        </p>
        <p className="text-xs text-slate-500 mt-1">PDF only · max 32 MB per file · up to 3 files</p>
        <p className="text-[11px] text-slate-500 mt-2 max-w-sm mx-auto">
          The quality of the financial information we produce depends on the accuracy of the
          information you upload.
        </p>

        {/* Tooltip */}
        <div className="absolute top-2 right-2 group">
          <Info className="h-3.5 w-3.5 text-slate-600 hover:text-slate-400 cursor-help" />
          <div className="absolute right-0 top-5 z-10 hidden group-hover:block w-56 rounded-lg bg-slate-800 border border-slate-700 text-xs text-slate-300 p-2.5 leading-relaxed shadow-xl">
            We use AI to read your statement. Your document is processed securely and is never
            stored on our servers.
          </div>
        </div>
      </div>

      {/* File list */}
      {files.length > 0 && (
        <div className="space-y-1.5">
          {files.map(({ file, id }) => (
            <div
              key={id}
              className="flex items-center gap-2 rounded-lg bg-slate-900 border border-slate-800 px-3 py-2"
            >
              <FileText className="h-4 w-4 text-violet-400 flex-shrink-0" />
              <span className="flex-1 text-xs text-slate-300 truncate">{file.name}</span>
              <span className="text-[10px] text-slate-500">{formatBytes(file.size)}</span>
              {!isProcessing && (
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    removeFile(id);
                  }}
                  className="ml-1 text-slate-500 hover:text-slate-300"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              )}
            </div>
          ))}
          {totalSize > 5 * 1024 * 1024 && !isProcessing && (
            <p className="text-[10px] text-amber-400 pl-1">
              Large file detected — this may take up to 30 seconds
            </p>
          )}
        </div>
      )}

      {/* Progress bar */}
      {isProcessing && (
        <div className="space-y-2">
          <div className="flex items-center gap-2">
            <Loader2 className="h-3.5 w-3.5 text-violet-400 animate-spin flex-shrink-0" />
            <span className="text-xs text-slate-300">{STAGE_LABELS[stage]}</span>
          </div>
          <div className="flex gap-1">
            {STAGE_ORDER.slice(0, -1).map((s, i) => (
              <div
                key={s}
                className={`flex-1 h-1 rounded-full transition-all duration-700 ${
                  i <= currentStageIdx - 1 ? "bg-violet-500" : "bg-slate-700"
                }`}
              />
            ))}
          </div>
        </div>
      )}

      {/* Done + confidence */}
      {stage === "done" && confidence && (
        <div className="flex items-center gap-2">
          <span
            className={`inline-flex items-center rounded-full px-2.5 py-1 text-xs font-semibold ${CONFIDENCE_CHIP[confidence]?.cls}`}
          >
            {CONFIDENCE_CHIP[confidence]?.label}
          </span>
        </div>
      )}

      {/* Error */}
      {errorMsg && (
        <div className="flex gap-2 rounded-lg bg-red-950/40 border border-red-800 px-3 py-2">
          <AlertCircle className="h-4 w-4 text-red-400 flex-shrink-0 mt-0.5" />
          <p className="text-xs text-red-300">{errorMsg}</p>
        </div>
      )}

      {/* Action button */}
      {files.length > 0 && stage !== "done" && (
        <Button
          onClick={runExtraction}
          disabled={isProcessing}
          className="w-full bg-violet-600 hover:bg-violet-700 text-white"
          size="sm"
        >
          {isProcessing ? (
            <>
              <Loader2 className="h-3.5 w-3.5 mr-2 animate-spin" />
              Processing…
            </>
          ) : (
            `Extract from ${files.length} document${files.length > 1 ? "s" : ""}`
          )}
        </Button>
      )}
    </div>
  );
}
