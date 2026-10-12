import { createFileRoute } from "@tanstack/react-router";
import { MarketingShell } from "@/components/marketing-shell";
import { readMarketingVisitor } from "@/lib/geo-country.functions";
import {
  FAQ_NOT_A_BOOKKEEPER_ANSWER,
  FAQ_NOT_A_BOOKKEEPER_QUESTION,
  FAQ_OWNER_COST_US,
  FAQ_OWNER_PLAN_US,
  publicFaqItems,
} from "@/lib/public-faq";
import { readSaPricingCopy } from "@/lib/pricing/za-pricing.functions";
import { visitorMarketBootScript } from "@/lib/market/marketing";
import {
  ACCOUNTING_SOFTWARE_ANSWER,
  LEDGER_CONNECT_ANSWER,
  LEDGER_CONNECT_QUESTION,
} from "@/lib/marketing-faq";
import { faqPageJson, pageHead, SEO_PAGES } from "@/lib/seo";
import marketingCss from "../styles/marketing.css?inline";

export const Route = createFileRoute("/faq")({
  loader: async () => {
    const visitor = await readMarketingVisitor();
    const saPricing = visitor.showSaPricing ? await readSaPricingCopy() : null;
    return { ...visitor, saPricing };
  },
  component: FaqPage,
  head: async ({ loaderData }) => {
    const showSaPricing = loaderData?.showSaPricing === true;
    const { publicFaqItems: faqItems } = await import("@/lib/public-faq");
    return {
      ...pageHead(SEO_PAGES.faq),
      styles: [{ children: marketingCss }],
      scripts: [
        { children: visitorMarketBootScript(loaderData?.copyPack) },
        { type: "application/ld+json", children: faqPageJson(faqItems(showSaPricing)) },
      ],
    };
  },
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
  const { showSaPricing, copyPack, geoZa, saPricing } = Route.useLoaderData();
  const cost = publicFaqItems(false).find((item) => item.question === "What does it cost?");
  const ai = publicFaqItems(false).find((item) => item.question === "What does the AI see?");
  const costAnswer =
    showSaPricing && saPricing?.faqCostLead && cost
      ? cost.answer.replace(FAQ_OWNER_COST_US, saPricing.faqCostLead)
      : cost?.answer;
  const ownerAnswer = showSaPricing && saPricing?.ownerPlanAnswer ? saPricing.ownerPlanAnswer : FAQ_OWNER_PLAN_US;
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
          Upload your own figures and look at your own score. It takes less time than reading this
          page did.
        </>
      }
      copyPack={copyPack}
      geoZa={geoZa}
    >
      <h2>Money</h2>

      <Qa q="What does it cost?">
        <p>{costAnswer}</p>
      </Qa>

      <Qa q="What does the owner plan cost?">
        <p>{ownerAnswer}</p>
      </Qa>

      <Qa q="What happens if I stop using it?">
        <p>
          You can leave whenever you want. The workspace stays available through the end of the
          period you have already paid for, including the packs your accountant has approved.
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
        <p>{ai?.answer}</p>
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

      <Qa q={FAQ_NOT_A_BOOKKEEPER_QUESTION}>
        <p>{FAQ_NOT_A_BOOKKEEPER_ANSWER}</p>
      </Qa>

      <Qa q="My accountant already does this.">
        <p>
          Some of it, once a year, in a format built for compliance. The difference is frequency and
          direction: a score every month that points forward, instead of a set of statements that
          explains a year that has already happened. Most owners who try it end up inviting their
          accountant into the workspace, which is exactly what it is designed for.
        </p>
      </Qa>

      <Qa q="I already have accounting software.">
        <p>{ACCOUNTING_SOFTWARE_ANSWER}</p>
      </Qa>

      <Qa q={LEDGER_CONNECT_QUESTION}>
        <p>{LEDGER_CONNECT_ANSWER}</p>
      </Qa>

      <Qa q="How accurate is the score?">
        <p>
          It is arithmetic on the figures you give it, so it is exactly as good as those figures.
          Every ratio shows the numbers behind it, so you can check any part of it yourself.
        </p>
      </Qa>

      <Qa q="How much work is this going to be?">
        <p>
          The first score comes from one upload. Keeping it current is a monthly habit measured in
          minutes, not a new system to run alongside your existing one.
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
        rather correct something publicly than defend it. Legal notices:{" "}
        <a href="/privacy">Privacy</a> · <a href="/terms">Terms</a> · <a href="/ai">AI notice</a>.
      </div>
    </MarketingShell>
  );
}
