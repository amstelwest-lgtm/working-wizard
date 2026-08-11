import { useRef, useState, type ChangeEvent } from "react";
import { toast } from "sonner";
import { Upload, X, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useAccountantProfile } from "@/contexts/accountant-profile";
import { removeFirmLogo, uploadFirmLogo } from "@/lib/firm-brand";

const MAX_BYTES = 2 * 1024 * 1024; // 2 MB
const ACCEPTED = ["image/png", "image/jpeg", "image/svg+xml"];
const ACCEPTED_EXT = ".png,.jpg,.jpeg,.svg";

export function LogoUploader() {
  const { profile, updateProfile, firmId, canEditBrand } = useAccountantProfile();
  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);

  const handleFile = async (e: ChangeEvent<HTMLInputElement>) => {
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
    if (!canEditBrand) {
      toast.error("Only the firm owner can change the logo.");
      return;
    }

    setBusy(true);
    try {
      if (firmId) {
        const { url, error } = await uploadFirmLogo(firmId, file);
        updateProfile({ logoUrl: url });
        if (error) toast.message("Logo ready", { description: error });
        else toast.success("Logo uploaded.");
      } else {
        // No firm row yet — keep as data URL until firm exists / Save creates link.
        const dataUrl = await new Promise<string>((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => {
            if (typeof reader.result === "string") resolve(reader.result);
            else reject(new Error("read failed"));
          };
          reader.onerror = () => reject(new Error("read failed"));
          reader.readAsDataURL(file);
        });
        updateProfile({ logoUrl: dataUrl });
        toast.success("Logo ready — Save settings to store it on your firm.");
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Logo upload failed");
    } finally {
      setBusy(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  };

  const handleRemove = async () => {
    if (!canEditBrand) {
      toast.error("Only the firm owner can change the logo.");
      return;
    }
    setBusy(true);
    try {
      if (firmId) await removeFirmLogo(firmId, profile.logoUrl);
      updateProfile({ logoUrl: null });
      toast.success("Logo removed.");
    } finally {
      setBusy(false);
    }
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
        disabled={!canEditBrand || busy}
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
              disabled={!canEditBrand || busy}
            >
              {busy ? (
                <Loader2 className="mr-1.5 h-3 w-3 animate-spin" />
              ) : (
                <Upload className="mr-1.5 h-3 w-3" />
              )}
              Replace
            </Button>
            <Button
              size="sm"
              variant="ghost"
              className="text-rose-400 hover:text-rose-300 hover:bg-rose-950/30 text-xs"
              onClick={handleRemove}
              disabled={!canEditBrand || busy}
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
          disabled={!canEditBrand || busy}
          className="flex w-full cursor-pointer flex-col items-center justify-center gap-2 rounded-lg border border-dashed border-slate-700 bg-slate-900/40 px-6 py-8 text-slate-400 transition-colors hover:border-slate-500 hover:bg-slate-800/40 hover:text-slate-300 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {busy ? <Loader2 className="h-6 w-6 animate-spin" /> : <Upload className="h-6 w-6" />}
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
