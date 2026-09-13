/**
 * History upload sheet — wide “what we can take”, history-only by default.
 */

import { useRef, useState } from "react";
import { Upload } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import {
  PAST_PERIOD_UPLOAD_ACCEPTS,
  PAST_PERIOD_UPLOAD_LEAD,
  PAST_PERIOD_UPLOAD_NOTE,
  PAST_PERIOD_UPLOAD_TITLE,
} from "@/lib/history-coverage";
import { UPLOAD_ACCEPT, UPLOAD_FORMATS_LABEL } from "@/lib/spreadsheet-text";

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onFiles?: (files: File[], opts: { replaceLive: boolean }) => void;
  /** When set, the gold button continues into an existing uploader instead of picking here. */
  onContinue?: (opts: { replaceLive: boolean }) => void;
};

export function PastPeriodUploadDialog({ open, onOpenChange, onFiles, onContinue }: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [replaceLive, setReplaceLive] = useState(false);

  const handleFiles = (list: FileList | null) => {
    const files = list ? [...list] : [];
    if (!files.length) return;
    onFiles?.(files, { replaceLive });
    setReplaceLive(false);
    onOpenChange(false);
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) setReplaceLive(false);
        onOpenChange(next);
      }}
    >
      <DialogContent className="max-w-lg overflow-hidden border border-[#d4a550]/25 bg-[radial-gradient(circle_at_90%_0%,rgba(212,165,80,0.12),transparent_42%),linear-gradient(180deg,#fffdf8,#f7f1e4)] text-[#1b1608] dark:border-[#d4a550]/20 dark:bg-[radial-gradient(circle_at_90%_0%,rgba(212,165,80,0.12),transparent_42%),linear-gradient(180deg,#141b28,#0b1220)] dark:text-slate-100">
        <div className="pointer-events-none absolute inset-x-0 top-0 h-0.5 bg-gradient-to-r from-[#b7872a] via-[#f1d28b] to-transparent" />
        <DialogHeader>
          <DialogTitle className="text-[15px] font-semibold tracking-tight">
            {PAST_PERIOD_UPLOAD_TITLE}
          </DialogTitle>
          <DialogDescription className="text-[13px] leading-relaxed text-[#6b5a38] dark:text-slate-400">
            {PAST_PERIOD_UPLOAD_LEAD}
          </DialogDescription>
        </DialogHeader>
        <ul className="mt-1 list-disc space-y-1 pl-4 text-[13px] text-[#4a3d22] dark:text-slate-300">
          {PAST_PERIOD_UPLOAD_ACCEPTS.map((line) => (
            <li key={line}>{line}</li>
          ))}
        </ul>
        <p className="text-[11px] leading-relaxed text-[#7a6a4a] dark:text-slate-500">
          {PAST_PERIOD_UPLOAD_NOTE} {UPLOAD_FORMATS_LABEL} all work.
        </p>
        <label className="flex items-start gap-2 text-[12px] text-[#4a3d22] dark:text-slate-300">
          <input
            type="checkbox"
            className="mt-0.5 accent-[#b7872a]"
            checked={replaceLive}
            onChange={(e) => setReplaceLive(e.target.checked)}
          />
          <span>This is the current period — update the live board too.</span>
        </label>
        <input
          ref={inputRef}
          type="file"
          accept={UPLOAD_ACCEPT}
          multiple
          className="sr-only"
          onChange={(e) => {
            handleFiles(e.target.files);
            e.target.value = "";
          }}
        />
        <div className="flex flex-wrap gap-2">
          <Button
            type="button"
            className="bg-[#d4a550] text-[#0a0e1a] hover:bg-[#c4963e]"
            onClick={() => {
              if (onContinue) {
                onContinue({ replaceLive });
                setReplaceLive(false);
                onOpenChange(false);
                return;
              }
              inputRef.current?.click();
            }}
          >
            <Upload className="mr-2 h-4 w-4" />
            {onContinue ? "Continue to upload" : "Choose files"}
          </Button>
          <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
            Not now
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
