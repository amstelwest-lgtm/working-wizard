import { UPLOAD_QUALITY_DISCLAIMER } from "@/lib/upload-quality";

export function UploadQualityDisclaimer({
  accepted,
  onChange,
  className = "",
}: {
  accepted: boolean;
  onChange: (next: boolean) => void;
  className?: string;
}) {
  return (
    <label className={`flex items-start gap-2 text-xs leading-relaxed text-muted-foreground ${className}`}>
      <input
        type="checkbox"
        checked={accepted}
        onChange={(e) => onChange(e.target.checked)}
        className="mt-0.5 h-3.5 w-3.5 shrink-0 accent-amber-500"
      />
      <span>{UPLOAD_QUALITY_DISCLAIMER}</span>
    </label>
  );
}
