import { createFileRoute } from "@tanstack/react-router";
import { MarketingShell } from "@/components/marketing-shell";
import { LEGAL_EFFECTIVE } from "@/lib/legal";
import marketingCss from "../styles/marketing.css?inline";

export const Route = createFileRoute("/ai")({
  component: AiNoticePage,
  head: () => ({
    meta: [
      { title: "AI notice — MILŌN" },
      {
        name: "description",
        content:
          "Milōn uses AI, powered by Claude. Financial information sent to the model is anonymised — no company names and no raw amounts.",
      },
    ],
    styles: [{ children: marketingCss }],
  }),
});

function AiNoticePage() {
  return (
    <MarketingShell
      heroTone="plain"
      eyebrow="AI notice"
      title="Use of an AI model"
      lead="Milōn uses an AI model (Claude, from Anthropic). Financial information sent to the model is anonymised. This page records what that means."
      ctaTitle={<>The rest of the legal pages</>}
      ctaBody={<>Privacy covers what we store. Terms cover how the workspace may be used.</>}
      ctaLabel="Privacy ✦"
      ctaHref="/privacy"
    >
      <p className="mk-legal-updated">Effective {LEGAL_EFFECTIVE}</p>

      <h2>What we send — and what we do not</h2>
      <p>
        When you ask the in-app assistant a question, or when the platform needs model help to
        talk about a business, the financial information that leaves Milōn for Claude is
        anonymised first.
      </p>
      <ul className="mk-list">
        <li>
          <strong>No company names.</strong> The model does not get the trading name, the
          registered name, or the people on the account.
        </li>
        <li>
          <strong>No raw amounts.</strong> It does not see “R 4 312 088 of revenue”. It sees
          ratio context and bands — margins, days, a health score — not the rand figure from the
          statement.
        </li>
        <li>
          <strong>VAT and account numbers are stripped</strong> from the question and the context
          before anything is sent.
        </li>
      </ul>
      <p>
        What remains is enough for the assistant to be useful — industry, the shape of the
        ratios, a revenue band — and not enough to reconstruct the books or identify the
        business from the payload.
      </p>

      <h2>The model</h2>
      <p>
        The model is Claude, supplied by Anthropic. That is a processing fact, not an endorsement
        line. The same statement appears in the site footer.
      </p>

      <h2>A person still signs the work that leaves the firm</h2>
      <p>
        Where AI drafts an advisory note for an accountant, a human reads it and signs it before
        a client ever sees it. The model does not send mail to your clients. It does not file
        anything with SARS. It does not replace the accountant you already have.
      </p>

      <h2>You can use Milōn without talking to it</h2>
      <p>
        The score, the waterfall, the forecast, and the action plan do not require you to open
        the assistant. Asking a question is optional. Uploading figures into your own workspace
        is how the product gets its arithmetic — that store is covered by the{" "}
        <a href="/privacy">privacy notice</a>, under row-level security, visible only to you and
        the people you invite.
      </p>

      <h2>What this is not</h2>
      <ul className="mk-list">
        <li>It is not a promise that every sentence the model writes is correct.</li>
        <li>It is not independent financial, tax, or legal advice.</li>
        <li>It is not a way for other customers to see your books.</li>
      </ul>

      <div className="mk-note">
        If a sentence on this page turns out to be wrong, tell us and we will fix the page. We
        would rather correct it than defend it. Related: <a href="/privacy">Privacy</a> ·{" "}
        <a href="/terms">Terms</a> · <a href="/faq">Questions</a>
      </div>
    </MarketingShell>
  );
}
