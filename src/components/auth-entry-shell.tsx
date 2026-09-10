import type { ReactNode } from "react";
import { useEffect } from "react";
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
  useEffect(() => {
    const el = document.documentElement;
    const hadDark = el.classList.contains("dark");
    const hadTheme = el.getAttribute("data-theme");
    el.classList.add("dark");
    el.removeAttribute("data-theme");
    return () => {
      if (!hadDark) el.classList.remove("dark");
      if (hadTheme) el.setAttribute("data-theme", hadTheme);
      else el.removeAttribute("data-theme");
    };
  }, []);

  return (
    <main className="auth-entry flex min-h-screen flex-col">
      <div className="mx-auto flex w-full max-w-md flex-1 flex-col px-5 pb-10 pt-8">
        <header className="mb-8 flex items-center justify-between gap-4">
          <Link to="/" className="auth-entry__logo">
            MILŌN
          </Link>
          {badge ? <span className="auth-entry__badge">{badge}</span> : null}
        </header>

        {loading ? (
          <div className="flex flex-1 flex-col items-center justify-center gap-4 py-16">
            <AuthEntrySpinner />
            <p className="auth-entry__muted text-sm">{loadingMessage}</p>
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
      className="auth-entry__spinner h-6 w-6 animate-spin rounded-full border-2"
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
  return <div className={`auth-entry__card rounded-2xl p-7 sm:p-8 ${className}`}>{children}</div>;
}

export function AuthEntryEyebrow({ children }: { children: ReactNode }) {
  return <p className="auth-entry__eyebrow">{children}</p>;
}

export function AuthEntryTitle({ children }: { children: ReactNode }) {
  return <h1 className="auth-entry__title">{children}</h1>;
}

export function AuthEntryLead({ children }: { children: ReactNode }) {
  return <p className="auth-entry__lead">{children}</p>;
}

export function AuthEntryFieldLabel({
  htmlFor,
  children,
}: {
  htmlFor?: string;
  children: ReactNode;
}) {
  return (
    <label htmlFor={htmlFor} className="auth-entry__field-label">
      {children}
    </label>
  );
}

export function AuthEntryInput(props: React.InputHTMLAttributes<HTMLInputElement>) {
  return <input {...props} className={`auth-entry__input ${props.className ?? ""}`} />;
}

export function AuthEntryPrimaryButton({
  children,
  className = "",
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button type="button" {...props} className={`auth-entry__primary-btn ${className}`}>
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
    <button type="button" {...props} className={`auth-entry__ghost-btn ${className}`}>
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
  const cls = `auth-entry__link ${className}`;
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
    <div className="auth-entry__tabs">
      {options.map((opt) => (
        <button
          key={opt.value}
          type="button"
          onClick={() => onChange(opt.value)}
          className={value === opt.value ? "auth-entry__tab auth-entry__tab--active" : "auth-entry__tab"}
        >
          {opt.label}
        </button>
      ))}
    </div>
  );
}

export function AuthEntryFootnote({ children }: { children: ReactNode }) {
  return <p className="auth-entry__footnote">{children}</p>;
}

export function AuthEntrySuccessIcon() {
  return (
    <div className="auth-entry__success-icon" aria-hidden>
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
        <polyline points="20 6 9 17 4 12" />
      </svg>
    </div>
  );
}
