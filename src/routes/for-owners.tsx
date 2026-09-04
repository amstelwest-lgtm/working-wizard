import { createFileRoute } from "@tanstack/react-router";
import { MarketCopy, MarketingShell } from "@/components/marketing-shell";
import { VISITOR_MARKET_BOOT_SCRIPT } from "@/lib/market";
import marketingCss from "../styles/marketing.css?inline";

export const Route = createFileRoute("/for-owners")({
  component: ForOwnersPage,
  head: () => ({
    meta: [
      { title: "MILŌN for business owners — know your numbers, sleep at night" },
      {
        name: "description",
        content:
          "What a South African business owner gets from Milōn in the first week: one health score, a 13-week cash forecast, and a ranked list of what to fix first.",
      },
    ],
    styles: [{ children: marketingCss }],
    scripts: [{ children: VISITOR_MARKET_BOOT_SCRIPT }],
  }),
});

function ForOwnersPage() {
  return (
    <MarketingShell
      eyebrow="For business owners"
      title={
        <>
          Your numbers, <span className="mk-gold">in plain language</span>, before it is too late to
          act on them.
        </>
      }
      lead={
        <>
          Most owners find out how the business is really doing months after the fact, in a set of
          annual financial statements written for <MarketCopy za="SARS" us="the IRS" /> rather than
          for them. Milōn turns the same figures into a score, a cash forecast, and a short list of
          what to do next.
        </>
      }
      ctaTitle={<>Start with your own figures</>}
      ctaBody={
        <>
          Spark is free during early access and needs no card. Upload what you have and see your
          score before you decide whether any of this is worth your time.
        </>
      }
    >
      <h2>What you get in the first week</h2>
      <ul className="mk-list">
        <li>
          <strong>One health score.</strong> Thirty-one ratios and four pillar scores collapsed into
          a single number you can actually hold in your head, with the workings still there when you
          want them.
        </li>
        <li>
          <strong>A 13-week cash forecast.</strong> The shortfall weeks show up while there is still
          time to do something about them, rather than on the morning the{" "}
          <MarketCopy za="debit order" us="ACH" /> bounces.
        </li>
        <li>
          <strong>A ranked list of fixes.</strong> Over nine hundred moves in the playbook, filtered
          to your situation and sorted by what would move your number most.
        </li>
        <li>
          <strong>An action plan you can work from.</strong> The next moves become tasks, so the
          insight does not die in a PDF.
        </li>
        <li>
          <strong>A shared workspace.</strong> Invite your accountant in so the two of you are
          finally looking at the same screen.
        </li>
      </ul>

      <h2>How it works</h2>
      <ol className="mk-steps">
        <li>
          <div>
            <h3>Give it your figures</h3>
            <p>
              Upload financials or a bank statement. You do not need a clean, finalised set — the
              point is to start from what you actually have.
            </p>
          </div>
        </li>
        <li>
          <div>
            <h3>Read your score</h3>
            <p>
              Profitability, liquidity, efficiency and leverage each get a pillar score, and every
              ratio shows the number behind it.
            </p>
          </div>
        </li>
        <li>
          <div>
            <h3>Work the top three moves</h3>
            <p>
              Not the whole playbook. The three that would change your score the most, in the order
              that makes sense for your cash position.
            </p>
          </div>
        </li>
      </ol>

      <h2>The gap this actually closes</h2>
      <p>
        Your accountant already has your numbers. You are the one who has to make decisions with
        them. In most businesses those two facts never meet in the same month — the figures get
        prepared, filed, and explained once a year in a meeting you half remember.
      </p>
      <p>
        Milōn puts both of you on one screen. Your accountant works where they already work, and
        what they produce reaches you as a score you can read in a minute, whenever you want to
        look. Their notes land on the exact number they refer to, so advice stops living in an email
        thread.
      </p>

      <h2>What Milōn is not</h2>
      <div className="mk-grid">
        <div className="mk-card">
          <h3>Not accounting software</h3>
          <p>
            It does not replace your books or file anything with{" "}
            <MarketCopy za="SARS" us="the IRS" />. It reads what your books already say and tells
            you what it means.
          </p>
        </div>
        <div className="mk-card">
          <h3>Not a replacement for your accountant</h3>
          <p>
            It is the thing you and your accountant argue over together. Most owners get more out of
            their accountant after using it, not less.
          </p>
        </div>
        <div className="mk-card">
          <h3>Not a crystal ball</h3>
          <p>
            The forecast is arithmetic on your own numbers and assumptions, shown honestly. Change
            an assumption and you see the effect immediately.
          </p>
        </div>
      </div>

      <div className="mk-note">
        We are early, and we would rather say so. Spark is free while we build alongside our first
        users, paid plans are not being billed yet, and if something in the product is not finished
        we tell you inside the product rather than hiding it.
      </div>

      <h2>The short version</h2>
      <p>
        If you cannot answer &ldquo;how many weeks of cash do I have, and what is the one thing that
        would most improve it&rdquo; without phoning someone, that is the gap this fills. It takes
        one upload to find out.
      </p>
    </MarketingShell>
  );
}
