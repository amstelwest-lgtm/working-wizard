/**
 * Warm demo outreach. Render with scripts/render-try-outreach.mts.
 * This file does not send mail.
 *
 * Outlook-safe: live text, one table button with a VML roundrect for
 * Outlook desktop, and no images. Motion stays on /try.
 * The scorecard and roadmap JPEGs from #355 and #381 stay off this email.
 */
import { Fragment } from "react";
import { Body, Head, Html } from "react-email";
import { buildTrialBoard, trialReading } from "../src/lib/trial-demo";

export const TRY_OUTREACH_SUBJECT = "Meet your AI finance team";
export const TRY_OUTREACH_OPENING =
  "Milōn gives accountants and their business-owner clients an AI finance team: the Financial Manager, the Analyst and the Advisor. We've loaded a sample business's financial statements. The agents analyze them and give a health score, key ratios and next steps.";
export const TRY_OUTREACH_PREVIEW =
  "The Milōn AI finance team: the Financial Manager, the Analyst and the Advisor. Sample statements are loaded. The agents analyze them and give a health score, key ratios and next steps.";
export const TRY_OUTREACH_TRY_URL = "https://www.milonfinance.com/try?utm_source=email";
export const TRY_OUTREACH_CTA_LABEL = "Talk to your AI finance team";
/**
 * Accountant Starter, monthly. Firms must not land on Solo.
 * Matches firmSignupHref("starter") plus the email utm.
 */
export const TRY_OUTREACH_SIGNUP_URL =
  "https://www.milonfinance.com/auth?signup=true&plan=starter&interval=month&utm_source=email";
export const TRY_OUTREACH_SIGNUP_LABEL = "Start free trial";
export const TRY_OUTREACH_UNSUBSCRIBE_URL = "https://www.milonfinance.com/unsubscribe";
export const TRY_OUTREACH_ADDRESS =
  "Milon, Inc., 800 N King Street, Suite 304, PMB 3836, Wilmington, DE 19801";
export const TRY_OUTREACH_SIGN_OFF = "The MILŌN Team";
/** Sentences that used to live only inside the example-result image. */
export const TRY_OUTREACH_EXAMPLE_NOTE =
  "A services sample. No books connected. Cash runway is not measured, because there is no cash balance.";
export const TRY_OUTREACH_HEADERS = {
  "List-Unsubscribe": `<${TRY_OUTREACH_UNSUBSCRIBE_URL}>, <mailto:hello@milonfinance.com?subject=unsubscribe>`,
  "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
} as const;

export const WARM_DEMO_WORDMARK = "MILŌN";
/** Serif fallback already used for report titles. No web font. */
export const WARM_DEMO_WORDMARK_FONT =
  'Georgia, "Palatino Linotype", Palatino, "Times New Roman", serif';

export type WarmDemoAgent = "financial_manager" | "analyst" | "advisor";

/** TODO(Eng1): one-agent link. Financial Manager is the default. */
export const WARM_DEMO_AGENT: WarmDemoAgent = "financial_manager";

/**
 * TODO(Eng1): point each agent at the one-agent route Eng1 is building.
 * Until that route exists, every agent opens the public demo this template
 * already links to.
 */
export function warmDemoCtaUrl(agent: WarmDemoAgent = WARM_DEMO_AGENT): string {
  const oneAgentHref: Record<WarmDemoAgent, string> = {
    financial_manager: TRY_OUTREACH_TRY_URL,
    analyst: TRY_OUTREACH_TRY_URL,
    advisor: TRY_OUTREACH_TRY_URL,
  };
  return oneAgentHref[agent];
}

const AGENTS = [
  {
    name: "Milōn Financial Manager",
    line: "Holds the 13-week cash line and the profit bridge.",
  },
  {
    name: "Milōn Analyst",
    line: "Reads the ratios, the margins, and what is drifting.",
  },
  {
    name: "Milōn Advisor",
    line: "Turns that reading into the next move.",
  },
] as const;

const INK = "#102A43";
const MUTED = "#3D5270";
const QUIET = "#5C7190";
const BLUE = "#0B5FFF";
const GOLD = "#d4af37";
const GOLD_EDGE = "#8d6a16";
const CANVAS = "#E6EEF8";
const CARD = "#F7F9FC";
const LINE = "#D5DEEA";
const FONT = "Segoe UI, Arial, sans-serif";

const EXAMPLE_BOARD = buildTrialBoard("US");
const EXAMPLE_READING = trialReading(EXAMPLE_BOARD, new Date("2026-10-14T00:00:00Z"));

export const TRY_OUTREACH_EXAMPLE_CLOSE = `13-week estimate closes at ${EXAMPLE_READING.cashClose}.`;

const EXAMPLE_LINES = [
  `Health ${EXAMPLE_BOARD.health.score ?? "—"}, ${EXAMPLE_BOARD.health.label}.`,
  `Gross margin ${EXAMPLE_READING.grossMargin}.`,
  `Net margin ${EXAMPLE_READING.netMargin}.`,
  `Current ratio ${EXAMPLE_READING.currentRatio}.`,
  `Debtor days ${EXAMPLE_READING.debtorDays}.`,
] as const;

export const TRY_OUTREACH_EXAMPLE_ALT = ["Example result.", ...EXAMPLE_LINES].join(" ");

export const TRY_OUTREACH_TEXT = [
  TRY_OUTREACH_SUBJECT,
  "",
  TRY_OUTREACH_OPENING,
  "",
  ...AGENTS.map((agent) => `${agent.name}. ${agent.line}`),
  "",
  TRY_OUTREACH_EXAMPLE_ALT,
  TRY_OUTREACH_EXAMPLE_NOTE,
  TRY_OUTREACH_EXAMPLE_CLOSE,
  "",
  `${TRY_OUTREACH_CTA_LABEL}: ${warmDemoCtaUrl()}`,
  `${TRY_OUTREACH_SIGNUP_LABEL}: ${TRY_OUTREACH_SIGNUP_URL}`,
  "",
  TRY_OUTREACH_SIGN_OFF,
  "",
  `Unsubscribe: ${TRY_OUTREACH_UNSUBSCRIBE_URL}`,
  TRY_OUTREACH_ADDRESS,
].join("\n");

function esc(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function bulletproofCta(href: string, label: string): string {
  const url = esc(href);
  const text = esc(label);
  return `<!--[if mso]>
<v:roundrect xmlns:v="urn:schemas-microsoft-com:vml" xmlns:w="urn:schemas-microsoft-com:office:word" href="${url}" style="height:48px;v-text-anchor:middle;width:320px;" arcsize="50%" stroke="t" strokecolor="${GOLD_EDGE}" fillcolor="${GOLD}">
<w:anchorlock/>
<center style="color:${INK};font-family:${FONT};font-size:16px;font-weight:bold;">${text}</center>
</v:roundrect>
<![endif]-->
<!--[if !mso]><!-->
<a href="${url}" class="cta-link" style="display:inline-block;background-color:${GOLD};color:${INK};border:1px solid ${GOLD_EDGE};border-radius:999px;font-family:${FONT};font-size:16px;font-weight:700;line-height:20px;text-align:center;text-decoration:none;padding:14px 28px;">${text}</a>
<!--<![endif]-->`;
}

const DARK_CSS = `
  :root { color-scheme: light dark; }
  .email-bg { background-color: ${CANVAS}; }
  .email-card { background-color: ${CARD}; }
  @media only screen and (max-width: 620px) {
    .email-card { width: 100% !important; }
    .pad { padding-left: 18px !important; padding-right: 18px !important; }
  }
  @media (prefers-color-scheme: dark) {
    .email-bg { background-color: #0E1C2E !important; }
    .email-card { background-color: #16304A !important; }
    .ink { color: #F3F6FA !important; }
    .muted { color: #D5DEEA !important; }
    .quiet { color: #C5D0DE !important; }
    .link { color: #9CC4FF !important; }
    .rule { border-top-color: #2A4664 !important; }
    .cta-bg, .cta-link { background-color: ${GOLD} !important; color: ${INK} !important; }
    .wordmark { color: ${GOLD} !important; }
  }
  [data-ogsc] .email-bg { background-color: #0E1C2E !important; }
  [data-ogsc] .email-card { background-color: #16304A !important; }
  [data-ogsc] .ink { color: #F3F6FA !important; }
  [data-ogsc] .muted { color: #D5DEEA !important; }
  [data-ogsc] .quiet { color: #C5D0DE !important; }
  [data-ogsc] .link { color: #9CC4FF !important; }
  [data-ogsc] .rule { border-top-color: #2A4664 !important; }
  [data-ogsc] .cta-bg, [data-ogsc] .cta-link { background-color: ${GOLD} !important; color: ${INK} !important; }
  [data-ogsc] .wordmark { color: ${GOLD} !important; }
`;

export default function TryOutreachEmail() {
  const ctaHref = warmDemoCtaUrl();
  return (
    <Html lang="en" dir="ltr">
      <Head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <meta name="color-scheme" content="light dark" />
        <meta name="supported-color-schemes" content="light dark" />
        <title>{TRY_OUTREACH_SUBJECT}</title>
        <style>{DARK_CSS}</style>
      </Head>
      <Body
        className="email-bg"
        style={{
          margin: 0,
          padding: 0,
          color: INK,
          fontFamily: FONT,
        }}
      >
        <div
          dangerouslySetInnerHTML={{
            __html: `<div style="display:none;font-size:1px;line-height:1px;max-height:0;max-width:0;opacity:0;overflow:hidden;mso-hide:all;color:${INK};background-color:${CANVAS}">${esc(TRY_OUTREACH_PREVIEW)} ${"&zwnj;&nbsp;".repeat(40)}</div>`,
          }}
        />
        <table
          role="presentation"
          width="100%"
          cellPadding={0}
          cellSpacing={0}
          border={0}
          className="email-bg"
          bgcolor={CANVAS}
          style={{ backgroundColor: CANVAS, width: "100%" }}
        >
          <tbody>
            <tr>
              <td align="center" style={{ padding: "24px 12px" }}>
                <table
                  role="presentation"
                  width="600"
                  cellPadding={0}
                  cellSpacing={0}
                  border={0}
                  className="email-card"
                  bgcolor={CARD}
                  style={{
                    width: "100%",
                    maxWidth: 600,
                    backgroundColor: CARD,
                  }}
                >
                  <tbody>
                    <tr>
                      <td
                        className="pad"
                        lang="en"
                        dir="ltr"
                        style={{ padding: "32px 28px 28px", fontFamily: FONT, color: INK }}
                      >
                        <p
                          className="wordmark"
                          style={{
                            margin: 0,
                            fontFamily: WARM_DEMO_WORDMARK_FONT,
                            fontSize: 22,
                            lineHeight: "28px",
                            fontWeight: 700,
                            letterSpacing: "0.28em",
                            color: GOLD,
                          }}
                        >
                          {WARM_DEMO_WORDMARK}
                        </p>

                        <h1
                          className="ink"
                          style={{
                            margin: "28px 0 0",
                            fontFamily: FONT,
                            fontSize: 32,
                            lineHeight: "38px",
                            fontWeight: 700,
                            letterSpacing: "-0.03em",
                            color: INK,
                          }}
                        >
                          Meet your AI finance team
                        </h1>
                        <p
                          className="muted"
                          style={{
                            margin: "12px 0 0",
                            fontFamily: FONT,
                            fontSize: 16,
                            lineHeight: "24px",
                            color: MUTED,
                          }}
                        >
                          {TRY_OUTREACH_OPENING}
                        </p>

                        {AGENTS.map((agent) => (
                          <Fragment key={agent.name}>
                            <h2
                              className="ink"
                              style={{
                                margin: "18px 0 0",
                                fontFamily: FONT,
                                fontSize: 16,
                                lineHeight: "22px",
                                fontWeight: 700,
                                color: INK,
                              }}
                            >
                              {agent.name}
                            </h2>
                            <p
                              className="muted"
                              style={{
                                margin: "4px 0 0",
                                fontFamily: FONT,
                                fontSize: 15,
                                lineHeight: "22px",
                                color: MUTED,
                              }}
                            >
                              {agent.line}
                            </p>
                          </Fragment>
                        ))}

                        <h2
                          className="ink"
                          style={{
                            margin: "28px 0 0",
                            fontFamily: FONT,
                            fontSize: 16,
                            lineHeight: "22px",
                            fontWeight: 700,
                            color: INK,
                          }}
                        >
                          Example result
                        </h2>
                        {EXAMPLE_LINES.map((line) => (
                          <p
                            key={line}
                            className="ink"
                            style={{
                              margin: "8px 0 0",
                              fontFamily: FONT,
                              fontSize: 15,
                              lineHeight: "22px",
                              color: INK,
                            }}
                          >
                            {line}
                          </p>
                        ))}
                        <p
                          className="muted"
                          style={{
                            margin: "12px 0 0",
                            fontFamily: FONT,
                            fontSize: 15,
                            lineHeight: "22px",
                            color: MUTED,
                          }}
                        >
                          {TRY_OUTREACH_EXAMPLE_NOTE}
                        </p>
                        <p
                          className="muted"
                          style={{
                            margin: "8px 0 0",
                            fontFamily: FONT,
                            fontSize: 15,
                            lineHeight: "22px",
                            color: MUTED,
                          }}
                        >
                          {TRY_OUTREACH_EXAMPLE_CLOSE}
                        </p>

                        <table
                          role="presentation"
                          cellPadding={0}
                          cellSpacing={0}
                          border={0}
                          align="center"
                          style={{ marginTop: 28 }}
                        >
                          <tbody>
                            <tr>
                              <td
                                align="center"
                                bgcolor={GOLD}
                                className="cta-bg"
                                style={{
                                  backgroundColor: GOLD,
                                  borderRadius: 999,
                                  color: INK,
                                }}
                                dangerouslySetInnerHTML={{
                                  __html: bulletproofCta(ctaHref, TRY_OUTREACH_CTA_LABEL),
                                }}
                              />
                            </tr>
                          </tbody>
                        </table>

                        <p
                          className="muted"
                          style={{
                            margin: "14px 0 0",
                            fontFamily: FONT,
                            fontSize: 14,
                            lineHeight: "20px",
                            textAlign: "center",
                            color: MUTED,
                          }}
                        >
                          Ready to run it on your own clients?{" "}
                          <a
                            href={TRY_OUTREACH_SIGNUP_URL}
                            className="link"
                            style={{ color: BLUE, fontWeight: 700, textDecoration: "underline" }}
                          >
                            {TRY_OUTREACH_SIGNUP_LABEL}
                          </a>
                        </p>

                        <p
                          className="muted"
                          style={{
                            margin: "28px 0 0",
                            fontFamily: FONT,
                            fontSize: 14,
                            lineHeight: "20px",
                            color: MUTED,
                          }}
                        >
                          {TRY_OUTREACH_SIGN_OFF}
                        </p>

                        <table
                          role="presentation"
                          width="100%"
                          cellPadding={0}
                          cellSpacing={0}
                          border={0}
                          style={{ marginTop: 24 }}
                        >
                          <tbody>
                            <tr>
                              <td
                                className="rule"
                                style={{
                                  borderTop: `1px solid ${LINE}`,
                                  fontSize: 0,
                                  lineHeight: 0,
                                }}
                              >
                                &nbsp;
                              </td>
                            </tr>
                          </tbody>
                        </table>

                        <p
                          className="quiet"
                          style={{
                            margin: "16px 0 0",
                            fontFamily: FONT,
                            fontSize: 12,
                            lineHeight: "18px",
                            color: QUIET,
                          }}
                        >
                          <a
                            href={TRY_OUTREACH_UNSUBSCRIBE_URL}
                            className="link"
                            style={{ color: BLUE, textDecoration: "underline" }}
                          >
                            Unsubscribe
                          </a>
                        </p>
                        <p
                          className="quiet"
                          style={{
                            margin: "8px 0 0",
                            fontFamily: FONT,
                            fontSize: 12,
                            lineHeight: "18px",
                            color: QUIET,
                          }}
                        >
                          {TRY_OUTREACH_ADDRESS}
                        </p>
                      </td>
                    </tr>
                  </tbody>
                </table>
              </td>
            </tr>
          </tbody>
        </table>
      </Body>
    </Html>
  );
}
