/**
 * Shell for the public collateral pages.
 *
 * These double as the one-pagers referenced by Milōn Lighthouse: the print
 * stylesheet strips the chrome so "Save as PDF" produces the handout without
 * anyone having to open a design tool.
 */

import type { ReactNode } from "react";

export function MarketingShell({
  eyebrow,
  title,
  lead,
  children,
  ctaTitle,
  ctaBody,
  ctaLabel = "Start free ✦",
  ctaHref = "/#register",
}: {
  eyebrow: string;
  title: ReactNode;
  lead: ReactNode;
  children: ReactNode;
  ctaTitle: ReactNode;
  ctaBody: ReactNode;
  ctaLabel?: string;
  ctaHref?: string;
}) {
  return (
    <div className="mk" data-milon-marketing>
      <header className="mk-top">
        <a className="mk-logo" href="/">
          MIL<span>Ō</span>N
        </a>
        <span className="mk-top-spacer" />
        <a className="mk-top-link mk-top-hide-sm" href="/for-owners">
          For owners
        </a>
        <a className="mk-top-link mk-top-hide-sm" href="/for-accountants">
          For accountants
        </a>
        <a className="mk-top-link" href="/faq">
          Questions
        </a>
        <a className="mk-top-cta" href="/#register">
          Start free
        </a>
      </header>

      <div className="mk-wrap">
        <section className="mk-hero">
          <span className="mk-eyebrow">{eyebrow}</span>
          <h1>{title}</h1>
          <p className="mk-lead">{lead}</p>
        </section>

        {children}

        <section className="mk-cta">
          <h2>{ctaTitle}</h2>
          <p>{ctaBody}</p>
          <div style={{ marginTop: 18 }}>
            <a className="mk-btn" href={ctaHref}>
              {ctaLabel}
            </a>
            <a className="mk-btn-ghost mk-print-hide" href="/">
              See the full site
            </a>
          </div>
        </section>

        <footer className="mk-foot">
          <span>Milōn — financial health for South African businesses.</span>
          <a href="/">milon.co.za</a>
          <a href="/faq">Questions</a>
          <a href="/privacy">Privacy</a>
          <a href="/terms">Terms</a>
          <a href="/ai">AI notice</a>
          <span className="mk-print-hide">Print this page to save it as a PDF.</span>
        </footer>
      </div>
    </div>
  );
}
