import { createFileRoute } from "@tanstack/react-router";
import { MarketCopy, MarketingShell } from "@/components/marketing-shell";
import { LIST_PRICES, VISITOR_MARKET_BOOT_SCRIPT } from "@/lib/market";
import marketingCss from "../styles/marketing.css?inline";

export const Route = createFileRoute("/faq")({
  component: FaqPage,
  head: () => ({
    meta: [
      { title: "MILŌN — straight answers" },
      {
        name: "description",
        content:
          "Honest answers about Milōn: what it costs, where your data lives, what the AI does and does not see, and why it does not replace your accountant.",
      },
    ],
    styles: [{ children: marketingCss }],
    scripts: [{ children: VISITOR_MARKET_BOOT_SCRIPT }],
  }),
});

function Qa({ q, children }: { q: string; children: React.ReactNode }) {
  return (
    <div className="mk-qa">
      <h3>{q}</h3>
      {children}
    </div>
  );
}

function FaqPage() {
  return (
    <MarketingShell
      eyebrow="Straight answers"
      title={
        <>
          The questions people <span className="mk-gold">actually ask us</span>, answered without
          the marketing voice.
        </>
      }
      lead={
        <>
          If your question is not here, reply to whichever email brought you and ask it. A person
          answers, usually the one who wrote the software.
        </>
      }
      ctaTitle={<>Still the fastest way to decide</>}
      ctaBody={
        <>
          Upload your own figures and look at your own score. It costs nothing and takes less time
          than reading this page did.
        </>
      }
    >
      <h2>Money</h2>

      <Qa q="What does it cost?">
        <p className="mk-copy-za">
          Spark is free during early access and does not ask for a card. Two paid tiers are
          published — Orbit at {LIST_PRICES.za.orbit} a month and Constellation at{" "}
          {LIST_PRICES.za.constellation} a month — but neither is being billed yet. For practices,
          firm pricing is planned at {LIST_PRICES.za.firm150} a month up to 150 clients and{" "}
          {LIST_PRICES.za.firmUnlimited} a month for unlimited, also not yet billed.
        </p>
        <p className="mk-copy-us">
          Spark is free during early access and does not ask for a card. Two paid tiers are
          published — Orbit at {LIST_PRICES.us.orbit} a month and Constellation at{" "}
          {LIST_PRICES.us.constellation} a month — but neither is being billed yet. For practices,
          firm pricing is planned at {LIST_PRICES.us.firm150} a month up to 150 clients and{" "}
          {LIST_PRICES.us.firmUnlimited} a month for unlimited, also not yet billed.
        </p>
      </Qa>

      <Qa q="So what is the catch with free?">
        <p>
          You are early, and early users shape what gets built. We get real usage and honest
          feedback, you get the platform without paying while it is still being finished. When
          billing does start you will be told before it happens, not after.
        </p>
      </Qa>

      <Qa q="What happens if I stop using it?">
        <p>
          Nothing is held hostage. You can delete your account and its data from Settings, and
          deleting is immediate rather than a support ticket.
        </p>
      </Qa>

      <h2>Data and security</h2>

      <Qa q="Where does my data live?">
        <p>
          In a managed PostgreSQL database behind row-level security, which means access rules are
          enforced by the database itself rather than by application code remembering to check.
          Every table that holds client data has those rules on it.
        </p>
      </Qa>

      <Qa q="Who can see my figures?">
        <p>
          You, and anyone you explicitly invite. An accountant sees a client's workspace only when
          that client is linked to their firm. There is no browse-all view for other users, and
          sharing is something you do deliberately rather than something that happens by default.
        </p>
      </Qa>

      <Qa q="What does the AI see?">
        <p>
          We use AI. It is powered by Claude. Financial information sent to the model is anonymised
          — no company names and no raw amounts — with{" "}
          <MarketCopy za="VAT and account numbers" us="EIN / tax IDs and account numbers" />{" "}
          stripped before anything leaves the platform. Where an AI drafts a report for an
          accountant, a human reads and signs it before a client ever sees it. The{" "}
          <a href="/ai">AI notice</a> is the public version of that sentence.
        </p>
      </Qa>

      <Qa q="Do you store card details?">
        <p>No. Nothing is being billed yet, so there is nothing to store.</p>
      </Qa>

      <Qa q="Do you track how I use the product?">
        <p>
          We keep product-event keys — things like “report sent” or “task completed” — so we can
          tell whether the product is actually working. We do not store financial amounts, ID
          numbers, or employee emails in that log. Magic-link clicks are stored as a hash of the
          link, not a name. Those raw events are kept for 24 months; the weekly totals stay.
        </p>
      </Qa>

      <h2>The obvious objections</h2>

      <Qa q="My accountant already does this.">
        <p>
          Some of it, once a year, in a format built for compliance. The difference is frequency and
          direction: a score every month that points forward, instead of a set of statements that
          explains a year that has already happened. Most owners who try it end up inviting their
          accountant into the workspace, which is exactly what it is designed for.
        </p>
      </Qa>

      <Qa q="I already have accounting software.">
        <p className="mk-copy-za">
          Keep it. Milōn is not a ledger and does not want to be. It reads the output your books
          already produce — bank statements, Excel, or a PDF — and turns it into a score, a
          forecast, and a ranked list of what to do. QuickBooks Online and Xero can follow.
        </p>
        <p className="mk-copy-us">
          Keep it. Connect QuickBooks Online when you can; Excel, CSV, or a bank PDF also work. Xero
          is also on the list, not the lead path. Milōn is not a ledger — it turns the output your
          books already produce into a score, a forecast, and a ranked list of what to do.
        </p>
      </Qa>

      <Qa q="How accurate is the score?">
        <p>
          It is arithmetic on the figures you give it, so it is exactly as good as those figures.
          Every ratio shows the numbers behind it, so you can check any part of it yourself. Where
          the platform is guessing or a number is missing, it says so rather than quietly filling in
          a plausible value.
        </p>
      </Qa>

      <Qa q="How much work is this going to be?">
        <p>
          The first score comes from one upload. Keeping it current is a monthly habit measured in
          minutes, not a new system to run alongside your existing one.
        </p>
      </Qa>

      <div className="mk-copy-za">
        <Qa q="Is this built for South Africa or bolted on?">
          <p>
            Built for it. SARS and VAT timing, ZAR throughout, load-shedding as a real line item in
            the cost of doing business, and benchmarks drawn from South African context rather than
            from a US template with the currency symbol swapped.
          </p>
        </Qa>
      </div>
      <div className="mk-copy-us">
        <Qa q="Is this a South African product with a dollar sign glued on?">
          <p>
            No. Choosing the United States switches currency, dates, sales tax (not VAT), and the
            advice pack. It is not a rand product with the symbol swapped. US industry medians are
            still being built, so we show days and percentages rather than pretending SA bands are
            Texas ones.
          </p>
        </Qa>
      </div>

      <h2>The cold email</h2>

      <Qa q="Why did you email me?">
        <p>
          Because we found something specific about your business worth writing to you about, and
          the email should have said what it was. Every message we send is written and approved by a
          person, not blasted to a list.
        </p>
      </Qa>

      <Qa q="How do I make it stop?">
        <p>
          Use the unsubscribe link at the bottom of any email, or your mail client's own unsubscribe
          button — both work immediately and stop the whole sequence, including anything already
          drafted. Replying &ldquo;no thanks&rdquo; works too, and we will not argue with you.
        </p>
      </Qa>

      <div className="mk-note">
        If any answer on this page turns out to be wrong, tell us and we will fix the page. We would
        rather correct something publicly than defend it. Legal notices:{" "}
        <a href="/privacy">Privacy</a> · <a href="/terms">Terms</a> · <a href="/ai">AI notice</a>.
      </div>
    </MarketingShell>
  );
}
