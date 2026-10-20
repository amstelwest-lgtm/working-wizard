import type { ReactNode } from "react";

type Props = {
  children: ReactNode;
  /** Optional business name shown as a compact badge in the header. */
  businessName?: string | null;
  /** When true, the card body shows a centered loading state. */
  loading?: boolean;
  loadingMessage?: string;
};

/**
 * Light brand shell for invite accept / signup surfaces.
 * White canvas, navy text, pale borders. Gold stays on the wordmark only.
 */
export function OwnerInviteShell({
  children,
  businessName,
  loading,
  loadingMessage = "Loading invitation…",
}: Props) {
  return (
    <main className="invite-ink flex min-h-screen flex-col bg-white text-[#102A43]">
      <div className="mx-auto flex w-full max-w-md flex-1 flex-col px-5 pb-10 pt-8">
        <header className="mb-8 flex items-center justify-between gap-4">
          <span className="logo-word text-sm font-black tracking-[0.35em] text-[#7D5F0F]">MILŌN</span>
          {businessName ? (
            <span
              className="max-w-[55%] truncate rounded-full border border-[#DBEAFE] px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.16em] text-[#3D5270]"
              title={businessName}
            >
              {businessName}
            </span>
          ) : null}
        </header>

        {loading ? (
          <div className="flex flex-1 flex-col items-center justify-center gap-4 py-16">
            <div
              className="h-6 w-6 animate-spin rounded-full border-2 border-[#DBEAFE] border-t-[#0B5FFF]"
              aria-hidden
            />
            <p className="text-sm text-[#3D5270]">{loadingMessage}</p>
          </div>
        ) : (
          children
        )}
      </div>
    </main>
  );
}

/** Card wrapper used inside OwnerInviteShell. */
export function OwnerInviteCard({
  children,
  className = "",
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={`rounded-2xl border border-[#DBEAFE] bg-white p-7 shadow-[0_8px_24px_rgba(16,42,67,0.06)] sm:p-8 ${className}`}
    >
      {children}
    </div>
  );
}

export function OwnerInviteEyebrow({ children }: { children: ReactNode }) {
  return (
    <p className="text-[10px] font-bold uppercase tracking-[0.3em] text-[#0B5FFF]">{children}</p>
  );
}

export function OwnerInviteFieldLabel({
  htmlFor,
  children,
}: {
  htmlFor?: string;
  children: ReactNode;
}) {
  return (
    <label
      htmlFor={htmlFor}
      className="mt-4 block text-[11px] font-semibold uppercase tracking-[0.14em] text-[#3D5270] first:mt-0"
    >
      {children}
    </label>
  );
}

export function OwnerInviteInput(props: React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      {...props}
      className={`mt-2 w-full rounded-xl border border-[#DBEAFE] bg-white px-4 py-3 text-sm text-[#102A43] placeholder:text-[#3D5270]/55 focus:border-[#0B5FFF] focus:outline-none focus:ring-2 focus:ring-[#0B5FFF]/30 ${props.className ?? ""}`}
    />
  );
}

export function OwnerInvitePrimaryButton({
  children,
  className = "",
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      type="button"
      {...props}
      className={`inline-flex h-11 w-full items-center justify-center rounded-xl bg-[#0B5FFF] px-5 text-xs font-bold uppercase tracking-[0.14em] text-white transition-colors hover:bg-[#2563EB] disabled:cursor-not-allowed disabled:opacity-60 ${className}`}
    >
      {children}
    </button>
  );
}

export function OwnerInviteGhostButton({
  children,
  className = "",
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      type="button"
      {...props}
      className={`inline-flex h-11 items-center justify-center rounded-xl border border-[#0B5FFF] bg-transparent px-5 text-xs font-bold uppercase tracking-[0.14em] text-[#0B5FFF] transition-colors hover:bg-[#DBEAFE] disabled:cursor-not-allowed disabled:opacity-60 ${className}`}
    >
      {children}
    </button>
  );
}

export function OwnerInviteNote({ children, tone = "muted" }: { children: ReactNode; tone?: "muted" | "warn" }) {
  return (
    <p
      className={`text-xs leading-relaxed ${tone === "warn" ? "text-[#9A3412]" : "text-[#3D5270]"}`}
    >
      {children}
    </p>
  );
}
