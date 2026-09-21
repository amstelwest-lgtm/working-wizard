import type { ButtonHTMLAttributes } from "react";

type Brand = "quickbooks" | "xero";

type Props = {
  brand: Brand;
  /** OAuth redirect in progress — keeps the brand chrome, swaps the label. */
  busy?: boolean;
  busyLabel?: string;
} & Omit<ButtonHTMLAttributes<HTMLButtonElement>, "children">;

const LABEL: Record<Brand, string> = {
  quickbooks: "Connect to QuickBooks",
  xero: "Connect to Xero",
};

/**
 * White circle with a simple “xero” wordmark in Xero blue.
 * No official logo file ships in the repo, so this is the standard
 * connect-button pattern: word in a badge, not a redrawn trademark.
 */
function XeroMark() {
  return (
    <svg className="brand-connect__mark" viewBox="0 0 100 100" aria-hidden="true" focusable="false">
      <circle cx="50" cy="50" r="50" fill="#ffffff" />
      <path
        fill="#13B5EA"
        d="M14.01 61.14 19.93 51.70 14.37 42.75H19.70L21.37 45.64Q21.86 46.56 22.30 47.46Q22.73 48.36 23.14 49.23Q23.55 48.36 23.99 47.45Q24.43 46.55 24.95 45.64L26.68 42.75H31.91L26.24 51.76L32.17 61.14H26.88L24.84 57.67Q24.33 56.78 23.88 55.89Q23.44 55.00 23.03 54.15Q22.63 55.00 22.21 55.89Q21.79 56.78 21.28 57.67L19.24 61.14ZM43.28 61.50Q40.47 61.50 38.43 60.35Q36.39 59.20 35.29 57.08Q34.20 54.95 34.20 52.04Q34.20 49.19 35.29 47.06Q36.39 44.92 38.37 43.72Q40.35 42.52 43.03 42.52Q45.43 42.52 47.39 43.54Q49.35 44.56 50.51 46.63Q51.67 48.70 51.67 51.84V53.23H39.08Q39.17 55.48 40.33 56.63Q41.50 57.78 43.36 57.78Q44.66 57.78 45.59 57.23Q46.52 56.68 46.92 55.61L51.39 56.45Q50.72 58.74 48.60 60.12Q46.49 61.50 43.28 61.50ZM39.12 50.13H46.92Q46.73 48.34 45.76 47.29Q44.79 46.23 43.08 46.23Q41.31 46.23 40.29 47.33Q39.27 48.42 39.12 50.13ZM55.04 61.14V42.75H59.81V45.95H60.01Q60.52 44.26 61.71 43.38Q62.91 42.50 64.45 42.50Q65.29 42.50 66.05 42.66V47.07Q65.72 46.97 65.09 46.90Q64.45 46.83 63.91 46.83Q62.20 46.83 61.09 47.90Q59.98 48.96 59.98 50.68V61.14ZM76.99 61.50Q74.23 61.50 72.20 60.31Q70.18 59.12 69.08 56.98Q67.99 54.85 67.99 52.02Q67.99 49.18 69.08 47.04Q70.18 44.90 72.20 43.71Q74.23 42.52 76.99 42.52Q79.75 42.52 81.78 43.71Q83.80 44.90 84.89 47.04Q85.99 49.18 85.99 52.02Q85.99 54.85 84.89 56.98Q83.80 59.12 81.78 60.31Q79.75 61.50 76.99 61.50ZM76.99 57.62Q78.96 57.62 79.97 56.02Q80.97 54.43 80.97 52.01Q80.97 49.57 79.97 47.99Q78.96 46.40 76.99 46.40Q75.01 46.40 74.02 47.99Q73.02 49.57 73.02 52.01Q73.02 54.43 74.02 56.02Q75.01 57.62 76.99 57.62Z"
      />
    </svg>
  );
}

export function BrandConnectButton({
  brand,
  busy = false,
  busyLabel,
  className,
  disabled,
  type = "button",
  ...rest
}: Props) {
  const label = busy
    ? (busyLabel ?? (brand === "quickbooks" ? "Opening QuickBooks…" : "Opening Xero…"))
    : LABEL[brand];

  return (
    <button
      type={type}
      className={["brand-connect", `brand-connect--${brand}`, className].filter(Boolean).join(" ")}
      disabled={disabled || busy}
      aria-busy={busy || undefined}
      {...rest}
    >
      {brand === "xero" ? <XeroMark /> : null}
      {busy ? <span className="brand-connect__spinner" aria-hidden="true" /> : null}
      <span className="brand-connect__label">{label}</span>
    </button>
  );
}
