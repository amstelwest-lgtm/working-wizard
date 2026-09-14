import { createFileRoute } from "@tanstack/react-router";
import { MarketingShell } from "@/components/marketing-shell";
import { VISITOR_MARKET_BOOT_SCRIPT } from "@/lib/market";
import { pageHead, SEO_PAGES } from "@/lib/seo";
import marketingCss from "../styles/marketing.css?inline";

export const Route = createFileRoute("/about")({
  component: AboutPage,
  head: () => ({
    ...pageHead(SEO_PAGES.about),
    styles: [{ children: marketingCss }],
    scripts: [{ children: VISITOR_MARKET_BOOT_SCRIPT }],
  }),
});

function AboutPage() {
  return (
    <MarketingShell
      eyebrow="About"
      title={<>Why MILŌN exists</>}
      lead={
        <>
          Financial information should not be useful only to people with specialist financial
          training or access to expensive finance teams.
        </>
      }
      ctaTitle={<>See it on your own figures</>}
      ctaBody={
        <>
          Spark is free during early access and needs no card. Upload what you have and read your
          score before you decide whether any of this is worth your time.
        </>
      }
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
        MILŌN is built to make that level of financial understanding more accessible to small
        businesses, family-owned businesses, and the people who run them.
      </p>

      <h2>Built around financial health</h2>
      <p>
        MILŌN assesses a business across four pillars: <strong>profit, assets, financing, and
        cash</strong>.
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
        MILŌN also produces a 13-week cash forecast, giving a business a forward-looking view of its
        cash position alongside its historical financial information.
      </p>

      <h2>Built for owners and accountants</h2>
      <p>
        MILŌN is a dual product: one workspace for business owners and the accounting firms they
        already work with.
      </p>
      <p>
        Business owners get a clearer understanding of their financial position, while accountants
        get a structured way to analyze that position, develop recommendations, and work through
        actions with their clients.
      </p>
      <p>
        AI, powered by Claude, drafts analysis and recommendations using the financial information
        and context available in the workspace. A qualified accountant reviews and signs off before
        advice is shown to a client.
      </p>
      <p>MILŌN does not provide licensed financial advice.</p>
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

      <h2>Why we built it</h2>
      <p>
        MILŌN was built by a former EY auditor who worked on several large audits, including audits
        of multiple companies within the S&amp;P 100.
      </p>
      <p>
        His work included areas such as PPE and fixed assets, inventory, cost of sales, operating
        expenses, working capital, financing, and cash, across large and complex financial reporting
        environments.
      </p>
      <p>
        He later worked with small businesses and saw a different problem. The financial data was
        often there, but the level of technical analysis, financial understanding, and advisory
        guidance available to those businesses was not.
      </p>
      <p>
        MILŌN applies the analytical rigor and review discipline learned in that environment to
        businesses that cannot afford to build an audit-grade finance team.
      </p>
      <p>
        The goal is straightforward: take financial information that can otherwise feel technical,
        fragmented, or difficult to interpret, and turn it into something a business owner can
        understand and act on.
      </p>

      <div className="mk-note">
        MILŌN is an independent company. It is not affiliated with, endorsed by, or connected to EY
        or any other accounting network. References to prior professional experience describe the
        founder&apos;s employment history only.
      </div>
    </MarketingShell>
  );
}
