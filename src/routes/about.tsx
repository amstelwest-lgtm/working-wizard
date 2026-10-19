import { createFileRoute } from "@tanstack/react-router";
import { MarketingShell } from "@/components/marketing-shell";
import { readMarketingVisitor } from "@/lib/geo-country.functions";
import { OWNER_PLAN_EARLY_US } from "@/lib/landing-copy";
import { visitorMarketBootScript } from "@/lib/market";
import { readSaPricingCopy } from "@/lib/pricing/za-pricing.functions";
import { pageHead, SEO_PAGES } from "@/lib/seo";
import marketingCss from "../styles/marketing.css?inline";

export const Route = createFileRoute("/about")({
  loader: async () => {
    const visitor = await readMarketingVisitor();
    const saPricing = visitor.showSaPricing ? await readSaPricingCopy() : null;
    return { ...visitor, saPricing };
  },
  component: AboutPage,
  head: ({ loaderData }) => ({
    ...pageHead(SEO_PAGES.about),
    styles: [{ children: marketingCss }],
    scripts: [{ children: visitorMarketBootScript(loaderData?.copyPack) }],
  }),
});

function AboutPage() {
  const { copyPack, geoZa, saPricing } = Route.useLoaderData();
  return (
    <MarketingShell
      copyPack={copyPack}
      geoZa={geoZa}
      eyebrow="About"
      title={<>Why Milōn exists</>}
      lead={
        <>
          Financial information should not be useful only to people with specialist financial
          training or access to expensive finance teams.
        </>
      }
      ctaTitle={<>See it on your own figures</>}
      ctaBody={<>{saPricing?.ownerEarly ?? OWNER_PLAN_EARLY_US}</>}
    >
      <p>
        Most businesses already have financial data. The harder problem is having the technical
        knowledge, analysis, and advisory experience needed to understand what that data is really
        saying and what to do about it.
      </p>
      <p>
        We believe that information is power. When financial information is turned into something
        clear and understandable, business owners gain more than a set of numbers. They gain greater
        visibility, confidence, and freedom to make better decisions for themselves and their
        businesses.
      </p>
      <p>
        Milōn is built to make that level of financial understanding more accessible to small
        businesses, family-owned businesses, and the people who run them.
      </p>

      <h2>Built around financial health</h2>
      <p>
        Milōn assesses a business across four pillars:{" "}
        <strong>profit, assets, financing, and cash</strong>.
      </p>
      <p>
        The assessment uses 19 financial ratios that provide a broad and technically meaningful view
        of financial health. Each ratio includes its underlying workings so that the result can be
        understood and reviewed, rather than treated as a black box.
      </p>
      <p>
        This includes more sophisticated analysis such as <strong>DuPont analysis</strong>, which
        breaks profitability down into its underlying drivers. In that sense, the analysis works
        more like a diagnostic tool: it helps identify where a problem is coming from, rather than
        simply telling you that something is wrong.
      </p>
      <p>
        Milōn also produces a 13-week cash forecast, giving a business a forward-looking view of its
        cash position alongside its historical financial information.
      </p>

      <h2>Built for owners and accountants</h2>
      <p>
        Milōn is a dual product: one workspace for business owners and the accounting firms they
        already work with.
      </p>
      <p>
        Business owners get a clearer understanding of their financial position, while accountants
        get a structured way to analyze that position, develop recommendations, and work through
        actions with their clients.
      </p>
      <p>
        QuickBooks Online and Xero, plug-and-play. Sage is coming soon. Milōn Financial
        Manager, Milōn Analyst and Milōn Advisor prepare the work. The accountant reviews and
        signs off.
      </p>
      <p>Milōn does not provide licensed financial advice.</p>
      <p>
        The product can currently ingest a P&amp;L and balance sheet as a PDF, Excel file, or CSV,
        as well as a bank statement.
      </p>

      <h2>What this is not</h2>
      <div className="mk-grid">
        <div className="mk-card">
          <h3>Not a ledger</h3>
          <p>
            It is not intended to replace the accounting system where financial records are
            maintained.
          </p>
        </div>
        <div className="mk-card">
          <h3>Not a replacement for the accountant</h3>
          <p>
            It is designed to give accountants a structured way to analyze financial health, guide
            clients, and follow through on recommendations.
          </p>
        </div>
        <div className="mk-card">
          <h3>Not a CPA opinion</h3>
          <p>
            It is not an audit or licensed financial advice. Accountant review and sign-off remain
            part of the workflow.
          </p>
        </div>
      </div>
    </MarketingShell>
  );
}
