import { createFileRoute } from "@tanstack/react-router";
import { MarketingShell } from "@/components/marketing-shell";
import { LEGAL_EFFECTIVE, LEGAL_ENTITY } from "@/lib/legal";
import marketingCss from "../styles/marketing.css?inline";

export const Route = createFileRoute("/terms")({
  component: TermsPage,
  head: () => ({
    meta: [
      { title: "Terms of use — MILŌN" },
      {
        name: "description",
        content:
          "Terms for using Milōn during early access: your figures stay yours, AI is powered by Claude, and this is not a substitute for your accountant.",
      },
    ],
    styles: [{ children: marketingCss }],
  }),
});

function TermsPage() {
  return (
    <MarketingShell
      eyebrow="Terms of use"
      title={
        <>
          Early access, <span className="mk-gold">plain rules</span>, and what this product is not.
        </>
      }
      lead={
        <>
          These terms cover the Milōn workspace run by {LEGAL_ENTITY}. They are a first public
          version, written for early access. Effective {LEGAL_EFFECTIVE}.
        </>
      }
      ctaTitle={<>Privacy and the AI notice sit next to this</>}
      ctaBody={
        <>
          How we hold figures, and how Claude is used, are on their own pages — not buried in this
          one.
        </>
      }
      ctaLabel="Privacy ✦"
      ctaHref="/privacy"
    >
      <p className="mk-legal-updated">Effective {LEGAL_EFFECTIVE} · South Africa</p>

      <h2>The service</h2>
      <p>
        Milōn is a financial-health workspace: a score, a forecast, and a ranked list of what to
        do next. It is not a ledger, not a tax filing system, and not a substitute for an
        accountant, attorney, or registered financial adviser. Keep the books you already have.
      </p>
      <p>
        Spark is free during early access and does not ask for a card. Published paid tiers are
        not being billed yet. When billing starts you will be told before it happens, not after.
      </p>

      <h2>Your account</h2>
      <p>
        You must give a real name and a work email you control. You are responsible for who you
        invite into a workspace. An accountant sees a client only when that client is linked to
        their firm. If you stop using Milōn you can delete the account from Settings; deletion is
        immediate.
      </p>

      <h2>Your figures</h2>
      <p>
        The numbers you enter or upload remain yours. You are responsible for their accuracy. The
        score is arithmetic on those figures — it is exactly as good as what you give it. Where
        the platform is guessing or a number is missing, it says so.
      </p>

      <h2>AI</h2>
      <p>
        Some features use AI. They are powered by <strong>Claude</strong>.{" "}
        <strong>Financial information sent to the model is anonymised</strong> — no company names
        and no raw amounts, with VAT and account numbers stripped. The{" "}
        <a href="/ai">AI notice</a> is the full version of that sentence. AI output can be wrong;
        you (or the accountant who signs a draft) remain responsible for what you send a client.
      </p>

      <h2>Acceptable use</h2>
      <ul className="mk-list">
        <li>Do not upload information you have no right to hold or share.</li>
        <li>Do not try to break access rules, scrape other workspaces, or use the product to harm someone.</li>
        <li>Do not present Milōn output as a signed-off audit, a SARS filing, or independent advice.</li>
      </ul>

      <h2>Availability</h2>
      <p>
        Early access means the product is still being finished. We work to keep it up; we do not
        promise it will never break. If we have to withdraw a feature, we will say so in the
        product rather than quietly deleting it under you.
      </p>

      <h2>Liability</h2>
      <p>
        Milōn is a decision-support tool. We are not liable for business decisions you take from
        a score, a forecast, or an AI draft, or for losses that follow from figures you uploaded.
        Nothing in these terms limits liability that South African law does not allow us to limit.
      </p>

      <h2>South African law</h2>
      <p>
        These terms are governed by the law of the Republic of South Africa. If a dispute cannot
        be resolved by talking to us, the courts of South Africa have jurisdiction.
      </p>

      <h2>Changes</h2>
      <p>
        We may update these terms as the product leaves early access. The effective date on this
        page is the date that applies. Material changes will be obvious on this page, not hidden
        in a changelog.
      </p>

      <div className="mk-note">
        Related: <a href="/privacy">Privacy</a> · <a href="/ai">AI notice</a> ·{" "}
        <a href="/faq">Questions</a>
      </div>
    </MarketingShell>
  );
}
