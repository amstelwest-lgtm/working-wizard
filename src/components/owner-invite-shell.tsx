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
 * Firm-grade shell for owner invite accept / signup surfaces.
 * Matches the token-page palette (near-black, gold accent, glass card).
 */
export function OwnerInviteShell({
  children,
  businessName,
  loading,
  loadingMessage = "Loading invitation…",
}: Props) {
  return (
    <main className="flex min-h-screen flex-col bg-[#0a0c0b] text-[#e8ede9]">
      <div className="mx-auto flex w-full max-w-md flex-1 flex-col px-5 pb-10 pt-8">
        <header className="mb-8 flex items-center justify-between gap-4">
          <span className="text-sm font-black tracking-[0.35em] text-[#d4a550]">MILŌN</span>
          {businessName ? (
            <span
              className="max-w-[55%] truncate rounded-full border border-white/10 px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.16em] text-[#8a938c]"
              title={businessName}
            >
              {businessName}
            </span>
          ) : null}
        </header>

        {loading ? (
          <div className="flex flex-1 flex-col items-center justify-center gap-4 py-16">
            <div
              className="h-6 w-6 animate-spin rounded-full border-2 border-[#d4a550]/25 border-t-[#d4a550]"
              aria-hidden
            />
            <p className="text-sm text-[#8a938c]">{loadingMessage}</p>
          </div>
        ) : (
          children
        )}
      </div>
    </main>
  );
}

/** Glass card wrapper used inside OwnerInviteShell. */
export function OwnerInviteCard({
  children,
  className = "",
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={`rounded-2xl border border-white/10 bg-[#10130f] p-7 shadow-[0_24px_70px_rgba(0,0,0,0.45)] sm:p-8 ${className}`}
    >
      {children}
    </div>
  );
}

export function OwnerInviteEyebrow({ children }: { children: ReactNode }) {
  return (
    <p className="text-[10px] font-bold uppercase tracking-[0.3em] text-[#8a938c]">{children}</p>
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
      className="mt-4 block text-[11px] font-semibold uppercase tracking-[0.14em] text-[#8a938c] first:mt-0"
    >
      {children}
    </label>
  );
}

export function OwnerInviteInput(props: React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      {...props}
      className={`mt-2 w-full rounded-xl border border-white/10 bg-[#0a0c0b] px-4 py-3 text-sm text-[#e8ede9] placeholder:text-[#8a938c]/55 focus:border-[#d4a550]/50 focus:outline-none focus:ring-2 focus:ring-[#d4a550]/15 ${props.className ?? ""}`}
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
      className={`inline-flex h-11 w-full items-center justify-center rounded-xl bg-gradient-to-r from-[#ac8400] via-[#d4af37] to-[#fdee79] px-5 text-xs font-bold uppercase tracking-[0.14em] text-[#1b1300] transition-opacity disabled:cursor-not-allowed disabled:opacity-60 ${className}`}
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
      className={`inline-flex h-11 items-center justify-center rounded-xl border border-white/15 px-5 text-xs font-bold uppercase tracking-[0.14em] text-[#c9d0cb] transition-colors hover:border-white/25 disabled:cursor-not-allowed disabled:opacity-60 ${className}`}
    >
      {children}
    </button>
  );
}

export function OwnerInviteNote({ children, tone = "muted" }: { children: ReactNode; tone?: "muted" | "warn" }) {
  return (
    <p
      className={`text-xs leading-relaxed ${tone === "warn" ? "text-[#e8b34b]" : "text-[#8a938c]"}`}
    >
      {children}
    </p>
  );
}
