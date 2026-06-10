import { useRef, type ChangeEvent } from "react";
import { toast } from "sonner";
import { Upload, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useAccountantProfile } from "@/contexts/accountant-profile";

const MAX_BYTES = 2 * 1024 * 1024; // 2 MB
const ACCEPTED = ["image/png", "image/jpeg", "image/svg+xml"];
const ACCEPTED_EXT = ".png,.jpg,.jpeg,.svg";

export function LogoUploader() {
  const { profile, updateProfile } = useAccountantProfile();
  const inputRef = useRef<HTMLInputElement>(null);

  const handleFile = (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (!ACCEPTED.includes(file.type)) {
      toast.error("Only PNG, JPG, or SVG files are accepted.");
      return;
    }
    if (file.size > MAX_BYTES) {
      toast.error("Logo must be under 2 MB.");
      return;
    }

    const reader = new FileReader();
    reader.onload = (ev) => {
      const result = ev.target?.result;
      if (typeof result === "string") {
        updateProfile({ logoUrl: result });
        toast.success("Logo uploaded.");
      }
    };
    reader.readAsDataURL(file);

    if (inputRef.current) inputRef.current.value = "";
  };

  const handleRemove = () => {
    updateProfile({ logoUrl: null });
    toast.success("Logo removed.");
  };

  return (
    <div className="space-y-3">
      <input
        ref={inputRef}
        type="file"
        accept={ACCEPTED_EXT}
        className="hidden"
        onChange={handleFile}
        aria-label="Upload firm logo"
      />

      {profile.logoUrl ? (
        <div className="flex items-start gap-4">
          <div className="relative flex h-20 w-40 shrink-0 items-center justify-center overflow-hidden rounded-lg border border-slate-700 bg-slate-900/60 p-2">
            <img
              src={profile.logoUrl}
              alt="Firm logo"
              className="max-h-full max-w-full object-contain"
            />
          </div>
          <div className="flex flex-col gap-2 pt-1">
            <Button
              size="sm"
              variant="outline"
              className="border-slate-700 text-slate-300 hover:text-slate-100 text-xs"
              onClick={() => inputRef.current?.click()}
            >
              <Upload className="mr-1.5 h-3 w-3" />
              Replace
            </Button>
            <Button
              size="sm"
              variant="ghost"
              className="text-rose-400 hover:text-rose-300 hover:bg-rose-950/30 text-xs"
              onClick={handleRemove}
            >
              <X className="mr-1.5 h-3 w-3" />
              Remove logo
            </Button>
          </div>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          className="flex w-full cursor-pointer flex-col items-center justify-center gap-2 rounded-lg border border-dashed border-slate-700 bg-slate-900/40 px-6 py-8 text-slate-400 transition-colors hover:border-slate-500 hover:bg-slate-800/40 hover:text-slate-300"
        >
          <Upload className="h-6 w-6" />
          <span className="text-sm font-medium">Click to upload logo</span>
          <span className="text-xs text-slate-500">PNG, JPG, SVG — max 2 MB</span>
        </button>
      )}

      {!profile.logoUrl && profile.firmName && (
        <p className="text-[11px] text-slate-500">
          No logo? Your firm name{" "}
          <span className="font-semibold text-slate-400">
            "{profile.firmName}"
          </span>{" "}
          will appear as styled text on all reports.
        </p>
      )}
    </div>
  );
}
