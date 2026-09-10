import type { ReactNode } from "react";
import { Link } from "@tanstack/react-router";

type ShellProps = {
  children: ReactNode;
  /** Compact badge shown in the header (e.g. "Accountant portal"). */
  badge?: string | null;
  loading?: boolean;
  loadingMessage?: string;
};

/**
 * Firm-grade shell for public auth entry surfaces (/auth, OAuth callback, verify).
 * Matches the landing token palette (near-black, gold accent, glass card) without
 * coupling to the invite-flow components in PR #156.
 */
export function AuthEntryShell({
  children,
  badge,
  loading,
  loadingMessage = "Please wait…",
}: ShellProps) {
  return (
    <main className="auth-entry flex min-h-screen flex-col bg-[#0a0c0b] text-[#e8ede9]">
      <div className="mx-auto flex w-full max-w-md flex-1 flex-col px-5 pb-10 pt-8">
        <header className="mb-8 flex items-center justify-between gap-4">
          <Link
            to="/"
            className="text-sm font-black tracking-[0.35em] text-[#d4a550] hover:opacity-90"
          >
            MILŌN
          </Link>
          {badge ? (
            <span className="max-w-[55%] truncate rounded-full border border-white/10 px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.16em] text-[#8a938c]">
              {badge}
            </span>
          ) : null}
        </header>

        {loading ? (
          <div className="flex flex-1 flex-col items-center justify-center gap-4 py-16">
            <AuthEntrySpinner />
            <p className="text-sm text-[#8a938c]">{loadingMessage}</p>
          </div>
        ) : (
          children
        )}
      </div>
    </main>
  );
}

export function AuthEntrySpinner() {
  return (
    <div
      className="h-6 w-6 animate-spin rounded-full border-2 border-[#d4a550]/25 border-t-[#d4a550]"
      aria-hidden
    />
  );
}

export function AuthEntryCard({
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

export function AuthEntryEyebrow({ children }: { children: ReactNode }) {
  return (
    <p className="text-[10px] font-bold uppercase tracking-[0.3em] text-[#8a938c]">{children}</p>
  );
}

export function AuthEntryTitle({ children }: { children: ReactNode }) {
  return (
    <h1 className="mt-2 text-[22px] font-semibold tracking-tight text-[#e8ede9]">{children}</h1>
  );
}

export function AuthEntryLead({ children }: { children: ReactNode }) {
  return <p className="mt-2 text-sm leading-relaxed text-[#8a938c]">{children}</p>;
}

export function AuthEntryFieldLabel({
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

export function AuthEntryInput(props: React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      {...props}
      className={`mt-2 w-full rounded-xl border border-white/10 bg-[#0a0c0b] px-4 py-3 text-sm text-[#e8ede9] placeholder:text-[#8a938c]/55 focus:border-[#d4a550]/50 focus:outline-none focus:ring-2 focus:ring-[#d4a550]/15 ${props.className ?? ""}`}
    />
  );
}

export function AuthEntryPrimaryButton({
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

export function AuthEntryGhostButton({
  children,
  className = "",
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      type="button"
      {...props}
      className={`inline-flex h-11 w-full items-center justify-center rounded-xl border border-white/15 px-5 text-xs font-bold uppercase tracking-[0.14em] text-[#c9d0cb] transition-colors hover:border-white/25 hover:text-[#e8ede9] disabled:cursor-not-allowed disabled:opacity-60 ${className}`}
    >
      {children}
    </button>
  );
}

export function AuthEntryLink({
  to,
  href,
  children,
  className = "",
}: {
  to?: string;
  href?: string;
  children: ReactNode;
  className?: string;
}) {
  const cls = `text-sm font-medium text-[#d4a550] underline underline-offset-4 hover:text-[#fdee79] ${className}`;
  if (href) {
    return (
      <a href={href} className={cls}>
        {children}
      </a>
    );
  }
  return (
    <Link to={to ?? "/"} className={cls}>
      {children}
    </Link>
  );
}

export function AuthEntryTabs({
  value,
  onChange,
  options,
}: {
  value: string;
  onChange: (next: string) => void;
  options: { value: string; label: string }[];
}) {
  return (
    <div className="mb-5 grid grid-cols-2 gap-2 rounded-xl border border-white/10 bg-[#0a0c0b] p-1">
      {options.map((opt) => (
        <button
          key={opt.value}
          type="button"
          onClick={() => onChange(opt.value)}
          className={`rounded-lg px-3 py-2.5 text-[11px] font-bold uppercase tracking-[0.12em] transition-colors ${
            value === opt.value
              ? "bg-gradient-to-r from-[#ac8400]/90 via-[#d4af37]/90 to-[#fdee79]/90 text-[#1b1300]"
              : "text-[#8a938c] hover:text-[#c9d0cb]"
          }`}
        >
          {opt.label}
        </button>
      ))}
    </div>
  );
}

export function AuthEntryFootnote({ children }: { children: ReactNode }) {
  return <p className="pt-3 text-center text-[11px] leading-relaxed text-[#8a938c]">{children}</p>;
}
