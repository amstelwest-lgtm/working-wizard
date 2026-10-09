/**
 * Shell for the public collateral pages.
 *
 * These double as the one-pagers referenced by Milōn Lighthouse: the print
 * stylesheet strips the chrome so "Save as PDF" produces the handout without
 * anyone having to open a design tool.
 */

import { createContext, useContext, useEffect, useState, type ComponentType, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { DUAL_MARKET_FOOTER, FIRM_CARD_TIMING } from "@/lib/firm-signup-copy";
import { LandingSignInButton } from "@/components/landing/landing-sign-in-button";
import { PREFERRED_SOURCE_HREF, PREFERRED_SOURCE_LABEL } from "@/lib/landing-assets";
import {
  applyVisitorMarketToDocument,
  type VisitorCopyPack,
} from "@/lib/market/marketing";
import { RegionCopy } from "@/components/region-copy";

export { RegionCopy };

const MarketingPackContext = createContext<VisitorCopyPack>("us");

/** Only the active pack is in the document. A hidden twin could be revealed by CSS. */
export function MarketCopy({ za, us }: { za: ReactNode; us: ReactNode }) {
  const pack = useContext(MarketingPackContext);
  return <>{pack === "za" ? za : us}</>;
}

/**
 * Same Sign in control as the homepage nav. The modal chunk (and Supabase)
 * load on click, not with this shell.
 */
function MarketingSignIn({ copyPack }: { copyPack: VisitorCopyPack }) {
  const [open, setOpen] = useState(false);
  const [Session, setSession] = useState<ComponentType<{
    onClose: () => void;
    copyPack?: VisitorCopyPack;
  }> | null>(null);
  // The header uses backdrop-filter, which traps position:fixed. Portal the
  // modal onto the page shell so it covers the viewport, same as the homepage.
  const [host, setHost] = useState<HTMLElement | null>(null);

  return (
    <>
      <LandingSignInButton
        className="mk-top-signin"
        onClick={() => {
          setHost(document.querySelector("[data-milon-marketing]"));
          setOpen(true);
          if (Session) return;
          void import("@/components/landing/landing-sign-in-session").then((mod) => {
            setSession(() => mod.LandingSignInSession);
          });
        }}
      />
      {open && Session && host
        ? createPortal(<Session copyPack={copyPack} onClose={() => setOpen(false)} />, host)
        : null}
    </>
  );
}

export function MarketingShell({
  eyebrow,
  title,
  lead,
  children,
  ctaTitle,
  ctaBody,
  ctaLabel = "Start free ✦",
  ctaHref = "/#register",
  navCtaLabel = "Start free",
  navCtaHref = "/#register",
  heroCta,
  heroTone = "default",
  footerLine,
  copyPack = "us",
  geoZa = false,
}: {
  eyebrow: string;
  title: ReactNode;
  lead: ReactNode;
  children: ReactNode;
  ctaTitle: ReactNode;
  ctaBody: ReactNode;
  ctaLabel?: string;
  ctaHref?: string;
  /** Top-bar pill. Owner pages stay on "Start free"; firm pages pass a trial label. */
  navCtaLabel?: string;
  navCtaHref?: string;
  /** Optional primary button under the hero lead. */
  heroCta?: { label: string; href: string };
  /** Quiet heading for legal notices that should not read as marketing. */
  heroTone?: "default" | "plain";
  /** Server-supplied line. The default footer has no second-country sentence. */
  footerLine?: string | null;
  /** Server geo pack. Ignored unless geoZa, so a missed prop cannot show rand. */
  copyPack?: VisitorCopyPack;
  /** True only when x-vercel-ip-country is ZA. */
  geoZa?: boolean;
}) {
  const pack: VisitorCopyPack = geoZa && copyPack === "za" ? "za" : "us";
  useEffect(() => {
    applyVisitorMarketToDocument(
      pack === "za" ? { country: "ZA", regionCode: null } : { country: "US", regionCode: null },
    );
  }, [pack]);

  return (
    <MarketingPackContext.Provider value={pack}>
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
        <a className="mk-top-link mk-top-hide-sm" href="/about">
          About
        </a>
        <a className="mk-top-link" href="/faq">
          Questions
        </a>
        <MarketingSignIn copyPack={pack} />
        <a className="mk-top-cta" href={navCtaHref}>
          {navCtaLabel}
        </a>
      </header>

      <div className="mk-wrap">
        <section className={heroTone === "plain" ? "mk-hero mk-hero-plain" : "mk-hero"}>
          <span className="mk-eyebrow">{eyebrow}</span>
          <h1>{title}</h1>
          <p className="mk-lead">{lead}</p>
          {heroCta ? (
            <div className="mk-hero-cta">
              <a className="mk-btn" href={heroCta.href}>
                {heroCta.label}
              </a>
            </div>
          ) : null}
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
          <span>{footerLine ?? DUAL_MARKET_FOOTER}</span>
          <span>{FIRM_CARD_TIMING}</span>
          <span>Works with QuickBooks Online and Xero.</span>
          <a href="/">milonfinance.com</a>
          <a href="/about">About</a>
          <a href="/faq">Questions</a>
          <a href="/privacy">Privacy</a>
          <a href="/terms">Terms</a>
          <a href="/ai">AI notice</a>
          <a href={PREFERRED_SOURCE_HREF} target="_blank" rel="noopener">
            {PREFERRED_SOURCE_LABEL}
          </a>
          {geoZa ? (
            <span className="mk-print-hide mk-market-switch">
              <a href={pack === "za" ? "?market=US" : "?market=ZA"}>
                {pack === "za" ? "United States" : "South Africa"}
              </a>
            </span>
          ) : null}
          <span className="mk-print-hide">Print this page to save it as a PDF.</span>
        </footer>
      </div>
    </div>
    </MarketingPackContext.Provider>
  );
}
