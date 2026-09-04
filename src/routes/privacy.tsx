import { createFileRoute } from "@tanstack/react-router";
import { MarketCopy, MarketingShell } from "@/components/marketing-shell";
import {
  LEGAL_ADDRESS_LINES,
  LEGAL_EFFECTIVE,
  LEGAL_ENTITY,
  LEGAL_INFORMATION_OFFICER,
} from "@/lib/legal";
import { VISITOR_MARKET_BOOT_SCRIPT } from "@/lib/market";
import marketingCss from "../styles/marketing.css?inline";

export const Route = createFileRoute("/privacy")({
  component: PrivacyPage,
  head: () => ({
    meta: [
      { title: "Privacy — MILŌN" },
      {
        name: "description",
        content:
          "How Milōn holds your figures, who can see them, and how AI is used. Financial information sent to Claude is anonymised.",
      },
    ],
    styles: [{ children: marketingCss }],
    scripts: [{ children: VISITOR_MARKET_BOOT_SCRIPT }],
  }),
});

function PrivacyPage() {
  return (
    <MarketingShell
      eyebrow="Privacy"
      title={
        <>
          Your figures stay <span className="mk-gold">yours</span>. We say what we keep, and what
          the AI never sees.
        </>
      }
      lead={
        <MarketCopy
          za={
            <>
              {LEGAL_ENTITY} runs Milōn. This notice is the first public version — written in the
              same voice as the product, not in borrowed American boilerplate. Effective{" "}
              {LEGAL_EFFECTIVE}.
            </>
          }
          us={
            <>
              {LEGAL_ENTITY}, a South African company, runs Milōn for US businesses in early access.
              This notice says what we keep and what the AI never sees. Effective {LEGAL_EFFECTIVE}.
            </>
          }
        />
      }
      ctaTitle={<>Read how the AI is used</>}
      ctaBody={
        <>
          We use Claude. Financial information sent to it is anonymised — no company names, no raw
          amounts. The short notice is one page.
        </>
      }
      ctaLabel="AI notice ✦"
      ctaHref="/ai"
    >
      <p className="mk-legal-updated">
        Effective {LEGAL_EFFECTIVE} ·{" "}
        <MarketCopy za="South Africa" us="US early access · RSA company" />
      </p>

      <h2>Who we are</h2>
      <div className="mk-copy-za">
        <p>
          {LEGAL_ENTITY} is a South African company. We trade as Milōn — a financial-health
          workspace for business owners and the accountants they invite. The responsible party for
          personal information processed on this platform is {LEGAL_ENTITY}.
        </p>
        <p>
          The Information Officer is {LEGAL_INFORMATION_OFFICER}. Write to him at the address below,
          reply to the email that brought you here, or write from inside the product.
        </p>
      </div>
      <div className="mk-copy-us">
        <p>
          {LEGAL_ENTITY} is a South African company trading as Milōn. US workspaces are early
          access: the same product, offered by the same company, from the same address. We have not
          formed a US legal entity.
        </p>
        <p>
          The privacy contact is {LEGAL_INFORMATION_OFFICER}. Write to him at the address below,
          reply to the email that brought you here, or write from inside the product.
        </p>
      </div>
      <p className="mk-legal-address">
        {LEGAL_ENTITY}
        <br />
        {LEGAL_ADDRESS_LINES.map((line) => (
          <span key={line}>
            {line}
            <br />
          </span>
        ))}
      </p>

      <h2>What we collect</h2>
      <ul className="mk-list">
        <li>
          <strong>Account details</strong> — name, email, password (hashed), and the business or
          firm name you give us.
        </li>
        <li>
          <strong>Financial figures you enter or upload</strong> — period P&amp;L, weekly inputs,
          budgets, forecasts, bank extracts, and the action plan you keep in the workspace. These
          sit on your client record.
        </li>
        <li>
          <strong>Invites and collaboration</strong> — who you asked in, notes you left, and
          sign-off history between owner and accountant.
        </li>
        <li>
          <strong>Product events</strong> — keys such as “report sent”, not financial amounts, ID
          numbers, or employee emails. Kept so we can tell whether the product works. Raw events are
          kept for 24 months; weekly totals stay.
        </li>
      </ul>

      <h2>Who can see your figures</h2>
      <p>
        You, and anyone you explicitly invite. An accountant sees a client workspace only when that
        client is linked to their firm. There is no browse-all view for other users. Sharing is
        something you do on purpose.
      </p>
      <p>
        Figures live in a managed PostgreSQL database behind row-level security — access rules are
        enforced by the database, not by application code remembering to check.
      </p>

      <h2>How AI is used</h2>
      <p>
        Milōn uses AI. It is powered by <strong>Claude</strong> (Anthropic).{" "}
        <strong>Financial information sent to the model is anonymised</strong> — no company names,{" "}
        <MarketCopy
          za="no raw rand amounts, and VAT numbers and account numbers are stripped"
          us="no raw dollar amounts, and EIN / tax IDs and account numbers are stripped"
        />{" "}
        before anything leaves the platform. What remains is ratio context and industry labels, so
        the assistant can talk about the shape of the business without seeing who you are or the
        exact figures.
      </p>
      <p>
        Where AI drafts a report for an accountant, a human reads and signs it before a client ever
        sees it. The longer version of this is on the <a href="/ai">AI notice</a>.
      </p>

      <h2>What we do not do</h2>
      <ul className="mk-list">
        <li>We do not sell your figures, your email list, or your client book.</li>
        <li>
          We do not store card details. Nothing is being billed yet, so there is nothing to store.
        </li>
        <li>We do not use your financials to train a public model of our own.</li>
      </ul>

      <h2>How long we keep it</h2>
      <p>
        Account and workspace data stay for as long as the account is open. You can delete the
        account from Settings; deletion is immediate rather than a support ticket. Product-event
        keys follow the 24-month rule above.
      </p>

      <h2>Your rights</h2>
      <div className="mk-copy-za">
        <p>
          Under the Protection of Personal Information Act you can ask what we hold, ask us to
          correct it, or ask us to delete it. The fastest path for deletion is Settings. For
          anything else, write to {LEGAL_INFORMATION_OFFICER} (Information Officer) at the address
          above, or reply to the email that brought you. You can also lodge a complaint with the{" "}
          <a href="https://inforegulator.org.za" target="_blank" rel="noreferrer">
            Information Regulator
          </a>
          .
        </p>
      </div>
      <div className="mk-copy-us">
        <p>
          You can ask what we hold, ask us to correct it, or ask us to delete it. The fastest path
          for deletion is Settings. For anything else, write to {LEGAL_INFORMATION_OFFICER} (privacy
          contact) at the address above, or reply to the email that brought you. We do not sell
          personal information. If you are a California resident, the same requests go to the same
          contact — we will respond; this is not a claim that we are a CCPA “business” with a full
          statutory notice yet.
        </p>
      </div>

      <h2>Cookies and local storage</h2>
      <p>
        We use a session so you stay signed in, and we remember theme and tour progress on this
        device. There is no advertising cookie stack and no third-party ad tracker on these pages.
      </p>

      <h2>Changes</h2>
      <p>
        When this notice changes in a way that matters, we will update the effective date on this
        page. If any sentence here turns out to be wrong, tell us and we will fix the page.
      </p>

      <div className="mk-note">
        Related: <a href="/ai">AI notice</a> · <a href="/terms">Terms of use</a> ·{" "}
        <a href="/faq">Questions</a>
      </div>
    </MarketingShell>
  );
}
