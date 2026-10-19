/**
 * Local shots for the accountant walkthrough. Real components and the
 * shared books sentence. Not part of the production build.
 */
import { useState } from "react";
import landingCss from "@/styles/landing.css?url";
import { MarketPicker } from "@/components/market-picker";
import { SIGNOFF_GOLD_BTN } from "@/components/review-signoff";
import { booksAnswerSentence } from "@/lib/books-answer";
import { formatMoney } from "@/lib/market/format";
import { ZA_MARKET } from "@/lib/market/resolve";
import type { DraftMarket } from "@/lib/market/types";

const SNAPSHOT = "Snapshot on file · Sep 2026";
const SYNC = "Last sync 1 Oct 2026, 09:00 · Xero · Sep 2026";

export function WalkthroughPreview() {
  const [draft, setDraft] = useState<DraftMarket>({ country: "ZA", regionCode: null });
  if (typeof document !== "undefined") {
    document.documentElement.dataset.landing = "1";
    document.documentElement.dataset.theme = "light";
    if (!document.querySelector("link[data-walkthrough-landing]")) {
      const link = document.createElement("link");
      link.rel = "stylesheet";
      link.href = landingCss;
      link.dataset.walkthroughLanding = "true";
      document.head.appendChild(link);
    }
  }
  return (
    <div className="accountant-portal" style={{ background: "#f4f7fb", minHeight: "100vh", padding: 28 }}>
      <section id="books-sentences" style={{ display: "grid", gap: 12, maxWidth: 720 }}>
        <p data-books="snapshot">{booksAnswerSentence({ freshness: SNAPSHOT })}</p>
        <p data-books="sync">{booksAnswerSentence({ freshness: SYNC })}</p>
        <p data-books="empty">{booksAnswerSentence({ freshness: null })}</p>
      </section>
      <section id="signup-country" style={{ marginTop: 28, maxWidth: 420, background: "#fff", padding: 16 }}>
        <MarketPicker
          value={draft}
          onChange={setDraft}
          variant="landing"
          audience="practice"
          vatCopy={false}
          taxWording={draft.country === "US"}
        />
      </section>
      <section id="rand-format" style={{ marginTop: 28 }}>
        <p data-rand="starter">{formatMoney(299, ZA_MARKET)}/mo</p>
        <p data-rand="scale">{formatMoney(1199, ZA_MARKET)}</p>
      </section>
      <section id="signoff" style={{ marginTop: 28 }}>
        <button type="button" className={SIGNOFF_GOLD_BTN}>
          Sign off
        </button>
        <button type="button" className={SIGNOFF_GOLD_BTN} style={{ marginLeft: 8 }}>
          Submit for review
        </button>
      </section>
      <footer className="mk-foot" style={{ marginTop: 28 }}>
        <span>QuickBooks Online, Xero and Sage.</span>
      </footer>
    </div>
  );
}
