import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { MarketingShell } from "@/components/marketing-shell";
import { FirmBandPricingTable } from "@/components/firm-band-pricing";
import { VISITOR_MARKET_BOOT_SCRIPT, visitorCopyPack, readVisitorDraft } from "@/lib/market";
import { stashPendingCheckout } from "@/lib/pending-checkout";
import { type FirmCheckoutBand, type FirmInterval } from "@/lib/stripe-plans";
import { FOUNDING_CALLOUT, WATCHLIST_DEFINITION } from "@/lib/marketing-faq";
import { pageHead, SEO_PAGES } from "@/lib/seo";
import marketingCss from "../styles/marketing.css?inline";

export const Route = createFileRoute("/for-accountants")({
  component: ForAccountantsPage,
  head: () => ({
    ...pageHead(SEO_PAGES.forAccountants),
    styles: [{ children: marketingCss }],
    scripts: [{ children: VISITOR_MARKET_BOOT_SCRIPT }],
  }),
});

function ForAccountantsPage() {
  const navigate = useNavigate();
  const [interval, setInterval] = useState<FirmInterval>("month");

  const startBand = (plan: FirmCheckoutBand, nextInterval: FirmInterval) => {
    const market = visitorCopyPack(readVisitorDraft());
    stashPendingCheckout({ plan, interval: nextInterval, market });
    void navigate({ to: "/auth", search: { signup: true } });
  };

  return (
    <MarketingShell
      eyebrow="For accounting and advisory practices"
      title={
        <>
          Advisory work that <span className="mk-gold">scales across the whole book</span>, not one
          client at a time.
        </>
      }
      lead={
        <>
          Every practice knows which clients need a real conversation. The problem is that finding
          out takes a morning per client, so it only happens at year-end, and by then the advice is
          history rather than help.
        </>
      }
      ctaTitle={<>Run it over your own client book</>}
      ctaBody={
        <>
          Set up a firm account and load a few clients you already worry about. If the triage view
          does not tell you something you did not already know, you have lost an afternoon.
        </>
      }
      ctaLabel="Set up your firm account ✦"
      ctaHref="/auth"
    >
      <h2>Works with QuickBooks Online and Xero</h2>
      <p>
        Connect QuickBooks Online or Xero for a client. MILŌN reads the profit and loss and balance
        sheet into the same workspace as an upload, and you review and sign off. The books stay in
        QuickBooks or Xero — MILŌN is not a ledger.
      </p>
      <div className="mk-grid">
        <div className="mk-card">
          <h3>QuickBooks Online</h3>
          <p>Connect a client&apos;s company and read the statements you already keep there.</p>
        </div>
        <div className="mk-card">
          <h3>Xero</h3>
          <p>
            Connect a Xero organisation the same way. Upload still works when the books live
            somewhere else.
          </p>
        </div>
      </div>

      <h2>What changes in the practice</h2>
      <ul className="mk-list">
        <li>
          <strong>Portfolio triage.</strong> Live health across every client on one screen, so the
          question becomes &ldquo;who needs me this month&rdquo; rather than &ldquo;who has phoned
          me.&rdquo;
        </li>
        <li>
          <strong>Drafted advisory reports.</strong> Claude writes the first draft from the client's
          actual numbers. You correct, sign off, and send — the judgement stays yours.
        </li>
        <li>
          <strong>White-label output.</strong> Your logo, your colors, your name on the report.
          Milōn is the engine, not the brand on the cover.
        </li>
        <li>
          <strong>A risk radar.</strong> Deteriorating clients surface before the crisis call, which
          is the difference between advisory and cleanup.
        </li>
        <li>
          <strong>A recurring reason to talk.</strong> A monthly number and a monthly conversation
          is what turns compliance work into a retainer.
        </li>
      </ul>

      <h2>The gap this actually closes</h2>
      <p>
        Your clients do not think they need advisory. They think they need to understand their own
        numbers more than once a year — and right now the only way to give them that is to spend an
        afternoon per client producing it by hand.
      </p>
      <p>
        Milōn is the channel between the two of you. You work where you already work; the client
        gets a monthly score they can read in a minute, with your notes attached to the figures they
        refer to. It is the difference between being the person who files their returns and the
        person who tells them what to do next.
      </p>

      <h2>The practice economics</h2>
      <p>
        The honest version: we are not going to quote you a time saving we have not measured across
        real practices yet. What we can tell you is where the time goes today — pulling figures,
        computing the same ratios by hand, and writing the same narrative in slightly different
        words for each client — and that all three of those are what the platform does automatically
        from the moment a client's figures are in.
      </p>
      <div className="mk-grid">
        <div className="mk-card">
          <h3>Compliance work</h3>
          <p>Priced per job, capped by your hours, and competed down every year.</p>
        </div>
        <div className="mk-card">
          <h3>Advisory work</h3>
          <p>Priced monthly, capped by how many clients you can actually keep an eye on.</p>
        </div>
        <div className="mk-card">
          <h3>What we change</h3>
          <p>The second cap. Everything in the platform exists to raise it.</p>
        </div>
      </div>

      <h2>How a client moves through it</h2>
      <ol className="mk-steps">
        <li>
          <div>
            <h3>Invite or add the client</h3>
            <p>
              They get their own workspace under your firm, or you run it for them. Both work, and
              the client can be handed over later either way.
            </p>
          </div>
        </li>
        <li>
          <div>
            <h3>Figures in, score out</h3>
            <p>
              Connect QuickBooks Online or Xero, or upload the statements. Nineteen ratios, four
              pillars, one score, and a 13-week cash forecast — computed the same way for every
              client, every month.
            </p>
          </div>
        </li>
        <li>
          <div>
            <h3>Draft, review, send</h3>
            <p>
              The advisory report is drafted for you and waits for your sign-off. Nothing reaches a
              client without a partner putting their name to it.
            </p>
          </div>
        </li>
      </ol>

      <h2>Pricing for firms</h2>
      <p>
        Flat USD monthly or annual bands by active client count. {WATCHLIST_DEFINITION} South
        African firms can pay ZAR at Checkout via Adaptive Pricing — we do not publish a separate
        rand catalog.
      </p>
      <FirmBandPricingTable
        interval={interval}
        onIntervalChange={setInterval}
        onSelectBand={startBand}
      />
      <ul className="mk-list">
        <li>
          <strong>Starter</strong> is free (up to 3 active clients) so every firm has a
          subscription from day one.
        </li>
        <li>{FOUNDING_CALLOUT}</li>
        <li>
          White-label onboarding support is included. Your branding on every report and portal.
        </li>
      </ul>

      <div className="mk-note">
        Where we are honest about being early: our first pilots are running now, so we are not
        showing you case studies from firms that do not exist. If you want to be one of the first
        and have your feedback shape what gets built, that is genuinely the offer on the table.
      </div>
    </MarketingShell>
  );
}
