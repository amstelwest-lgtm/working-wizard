import { UPLOAD_QUALITY_DISCLAIMER } from "@/lib/upload-quality";

export function UploadQualityDisclaimer({
  accepted,
  onChange,
  className = "",
  label = UPLOAD_QUALITY_DISCLAIMER,
  inputId = "upload-quality-confirm",
}: {
  accepted: boolean;
  onChange: (next: boolean) => void;
  className?: string;
  /** Visible label. Defaults to the accuracy disclaimer. */
  label?: string;
  inputId?: string;
}) {
  return (
    <label
      htmlFor={inputId}
      className={`flex items-start gap-2 text-xs leading-relaxed text-[var(--ink,#e7e5e4)] ${className}`}
    >
      <input
        id={inputId}
        type="checkbox"
        checked={accepted}
        onChange={(e) => onChange(e.target.checked)}
        aria-label={label}
        className="mt-0.5 h-3.5 w-3.5 shrink-0 accent-amber-500"
      />
      <span>{label}</span>
    </label>
  );
}
