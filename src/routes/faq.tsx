import { createFileRoute } from "@tanstack/react-router";
import { MarketingShell } from "@/components/marketing-shell";
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
        <p>
          Spark is free during early access and does not ask for a card. Two paid tiers are
          published — Orbit at R699 a month and Constellation at R1 299 a month — but neither is
          being billed yet. For practices, firm pricing is planned at R4 500 a month up to 150
          clients and R7 200 a month for unlimited, also not yet billed.
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
          The in-app assistant works from anonymised ratio context — no company names and no raw
          amounts — with VAT and account numbers stripped before anything leaves the platform. Where
          an AI drafts a report for an accountant, a human reads and signs it before a client ever
          sees it.
        </p>
      </Qa>

      <Qa q="Do you store card details?">
        <p>No. Nothing is being billed yet, so there is nothing to store.</p>
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
        <p>
          Keep it. Milōn is not a ledger and does not want to be. It reads the output your books
          already produce and turns it into a score, a forecast, and a ranked list of what to do —
          which is the part accounting software has never really tried to do.
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

      <Qa q="Is this built for South Africa or bolted on?">
        <p>
          Built for it. SARS and VAT timing, ZAR throughout, load-shedding as a real line item in
          the cost of doing business, and benchmarks drawn from South African context rather than
          from a US template with the currency symbol swapped.
        </p>
      </Qa>

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
        rather correct something publicly than defend it.
      </div>
    </MarketingShell>
  );
}
