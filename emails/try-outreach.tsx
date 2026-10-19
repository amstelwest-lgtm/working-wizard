/**
 * Outreach for the public sample. Render with scripts/render-try-outreach.mts.
 * This file does not send mail.
 */
import {
  Body,
  Column,
  Container,
  Head,
  Heading,
  Hr,
  Html,
  Img,
  Link,
  Preview,
  Row,
  Section,
  Text,
} from "react-email";
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
export const TRY_OUTREACH_INCENTIVES_KICKER = "In our tests";
export const TRY_OUTREACH_INCENTIVES = [
  "80% time saved",
  "70% lower cost to serve a retainer advisory client",
  "a better client experience",
  "advisory becomes packageable",
] as const;
export const TRY_OUTREACH_SIGNUP_LABEL = "Start free trial";
export const TRY_OUTREACH_UNSUBSCRIBE_URL = "https://www.milonfinance.com/unsubscribe";
export const TRY_OUTREACH_ADDRESS =
  "Milon, Inc., 800 N King Street, Suite 304, PMB 3836, Wilmington, DE 19801";
export const TRY_OUTREACH_SIGN_OFF = "The MILŌN Team";
export const TRY_OUTREACH_EXAMPLE_SRC = "https://www.milonfinance.com/email/example-result.png";
export const TRY_OUTREACH_HEADERS = {
  "List-Unsubscribe": `<${TRY_OUTREACH_UNSUBSCRIBE_URL}>, <mailto:hello@milonfinance.com?subject=unsubscribe>`,
  "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
} as const;

const EXAMPLE_BOARD = buildTrialBoard("US");
const EXAMPLE_READING = trialReading(EXAMPLE_BOARD, new Date("2026-10-14T00:00:00Z"));

export const TRY_OUTREACH_EXAMPLE_ALT = [
  "Example result.",
  `Health ${EXAMPLE_BOARD.health.score ?? "—"}, ${EXAMPLE_BOARD.health.label}.`,
  `Gross margin ${EXAMPLE_READING.grossMargin}.`,
  `Net margin ${EXAMPLE_READING.netMargin}.`,
  `Current ratio ${EXAMPLE_READING.currentRatio}.`,
  `Debtor days ${EXAMPLE_READING.debtorDays}.`,
  "Cash runway is not measured.",
].join(" ");

const AGENTS = [
  {
    src: "https://www.milonfinance.com/email/fm.png",
    alt: "Milōn Financial Manager",
    role: "Financial Manager",
    line: "Holds the 13-week cash line and the profit bridge.",
  },
  {
    src: "https://www.milonfinance.com/email/analyst.png",
    alt: "Milōn Analyst",
    role: "Analyst",
    line: "Reads the ratios, the margins, and what is drifting.",
  },
  {
    src: "https://www.milonfinance.com/email/advisor.png",
    alt: "Milōn Advisor",
    role: "Advisor",
    line: "Turns that reading into the next move.",
  },
] as const;

const INK = "#102A43";
const MUTED = "#3D5270";
const QUIET = "#5C7190";
const BLUE = "#0B5FFF";
const LINE = "#DBEAFE";
const FONT = "Segoe UI, Arial, sans-serif";

export const TRY_OUTREACH_TEXT = [
  TRY_OUTREACH_SUBJECT,
  "",
  TRY_OUTREACH_OPENING,
  "",
  "Financial Manager. Holds the 13-week cash line and the profit bridge.",
  "Analyst. Reads the ratios, the margins, and what is drifting.",
  "Advisor. Turns that reading into the next move.",
  "",
  TRY_OUTREACH_INCENTIVES_KICKER,
  ...TRY_OUTREACH_INCENTIVES,
  "",
  TRY_OUTREACH_EXAMPLE_ALT,
  "",
  `${TRY_OUTREACH_CTA_LABEL}: ${TRY_OUTREACH_TRY_URL}`,
  `${TRY_OUTREACH_SIGNUP_LABEL}: ${TRY_OUTREACH_SIGNUP_URL}`,
  "",
  TRY_OUTREACH_SIGN_OFF,
  "",
  `Unsubscribe: ${TRY_OUTREACH_UNSUBSCRIBE_URL}`,
  TRY_OUTREACH_ADDRESS,
].join("\n");

export default function TryOutreachEmail() {
  return (
    <Html lang="en">
      <Head>
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <style>{`
          @media only screen and (max-width: 600px) {
            .email-pad { padding-left: 18px !important; padding-right: 18px !important; }
          }
        `}</style>
      </Head>
      <Body style={{ margin: 0, backgroundColor: "#ffffff", fontFamily: FONT, color: INK }}>
        <Preview>{TRY_OUTREACH_PREVIEW}</Preview>
        <Container
          className="email-pad"
          style={{
            width: "100%",
            maxWidth: 600,
            margin: "0 auto",
            backgroundColor: "#ffffff",
            padding: "32px 28px 28px",
          }}
        >
          <Text
            style={{
              margin: 0,
              fontFamily: FONT,
              fontSize: 20,
              lineHeight: "24px",
              fontWeight: 700,
              letterSpacing: "-0.03em",
              color: INK,
            }}
          >
            Milōn
          </Text>

          <Heading
            as="h1"
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
          </Heading>
          <Text
            style={{
              margin: "12px 0 0",
              fontFamily: FONT,
              fontSize: 16,
              lineHeight: "24px",
              color: MUTED,
            }}
          >
            {TRY_OUTREACH_OPENING}
          </Text>

          {AGENTS.map((agent) => (
            <Section key={agent.role} style={{ marginTop: 18 }}>
              <Row>
                <Column style={{ width: 72, verticalAlign: "middle" }}>
                  <Img
                    src={agent.src}
                    width="64"
                    height="64"
                    alt={agent.alt}
                    style={{
                      display: "block",
                      width: 64,
                      height: 64,
                      borderRadius: 32,
                      border: `1px solid ${LINE}`,
                    }}
                  />
                </Column>
                <Column style={{ verticalAlign: "middle", paddingLeft: 8 }}>
                  <Text
                    style={{
                      margin: 0,
                      fontFamily: FONT,
                      fontSize: 11,
                      lineHeight: "14px",
                      fontWeight: 700,
                      letterSpacing: "0.08em",
                      textTransform: "uppercase",
                      color: BLUE,
                    }}
                  >
                    Milōn
                  </Text>
                  <Text
                    style={{
                      margin: "2px 0 0",
                      fontFamily: FONT,
                      fontSize: 16,
                      lineHeight: "20px",
                      fontWeight: 700,
                      color: INK,
                    }}
                  >
                    {agent.role}
                  </Text>
                  <Text
                    style={{
                      margin: "2px 0 0",
                      fontFamily: FONT,
                      fontSize: 14,
                      lineHeight: "20px",
                      color: MUTED,
                    }}
                  >
                    {agent.line}
                  </Text>
                </Column>
              </Row>
            </Section>
          ))}

          <Section
            style={{
              marginTop: 28,
              border: `1px solid ${LINE}`,
              borderRadius: 16,
              padding: 12,
            }}
          >
            <Img
              src={TRY_OUTREACH_EXAMPLE_SRC}
              width="520"
              height="350"
              alt={TRY_OUTREACH_EXAMPLE_ALT}
              style={{
                display: "block",
                width: "100%",
                maxWidth: 520,
                height: "auto",
                border: 0,
                outline: "none",
              }}
            />
          </Section>

          <Text
            style={{
              margin: "28px 0 0",
              fontFamily: FONT,
              fontSize: 12,
              lineHeight: "16px",
              fontWeight: 700,
              letterSpacing: "0.12em",
              textTransform: "uppercase",
              color: BLUE,
            }}
          >
            {TRY_OUTREACH_INCENTIVES_KICKER}
          </Text>
          {TRY_OUTREACH_INCENTIVES.map((line) => (
            <Text
              key={line}
              style={{
                margin: "8px 0 0",
                fontFamily: FONT,
                fontSize: 16,
                lineHeight: "22px",
                fontWeight: 700,
                color: INK,
              }}
            >
              {line}
            </Text>
          ))}

          <div
            style={{ marginTop: 28 }}
            dangerouslySetInnerHTML={{
              __html: `<!--[if mso]>
<v:roundrect xmlns:v="urn:schemas-microsoft-com:vml" xmlns:w="urn:schemas-microsoft-com:office:word" href="${TRY_OUTREACH_TRY_URL}" style="height:48px;v-text-anchor:middle;width:544px;" arcsize="50%" stroke="t" strokecolor="#8d6a16" fillcolor="#d4af37">
<w:anchorlock/>
<center style="color:#1b1300;font-family:Segoe UI, Arial, sans-serif;font-size:16px;font-weight:bold;">${TRY_OUTREACH_CTA_LABEL}</center>
</v:roundrect>
<![endif]-->
<!--[if !mso]><!-- -->
<a href="${TRY_OUTREACH_TRY_URL}" style="display:block;background-color:#d4af37;background-image:linear-gradient(180deg,#fdee79 0%,#f0d56a 32%,#d4af37 64%,#b8891a 100%);color:#1b1300;border:1px solid #8d6a16;border-radius:999px;font-family:Segoe UI, Arial, sans-serif;font-size:16px;font-weight:700;line-height:20px;text-align:center;text-decoration:none;padding:14px 28px;">${TRY_OUTREACH_CTA_LABEL}</a>
<!--<![endif]-->`,
            }}
          />

          <Text
            style={{
              margin: "14px 0 0",
              fontFamily: FONT,
              fontSize: 14,
              lineHeight: "20px",
              textAlign: "center" as const,
              color: MUTED,
            }}
          >
            Ready to run it on your own clients?{" "}
            <Link
              href={TRY_OUTREACH_SIGNUP_URL}
              style={{ color: BLUE, fontWeight: 700, textDecoration: "underline" }}
            >
              {TRY_OUTREACH_SIGNUP_LABEL}
            </Link>
          </Text>

          <Text
            style={{
              margin: "28px 0 0",
              fontFamily: FONT,
              fontSize: 14,
              lineHeight: "20px",
              color: MUTED,
            }}
          >
            {TRY_OUTREACH_SIGN_OFF}
          </Text>

          <Hr
            style={{
              margin: "24px 0",
              borderColor: LINE,
              borderStyle: "solid",
              borderWidth: "1px 0 0",
            }}
          />

          <Text
            style={{ margin: 0, fontFamily: FONT, fontSize: 12, lineHeight: "18px", color: QUIET }}
          >
            <Link
              href={TRY_OUTREACH_UNSUBSCRIBE_URL}
              style={{ color: BLUE, textDecoration: "underline" }}
            >
              Unsubscribe
            </Link>
          </Text>
          <Text
            style={{
              margin: "8px 0 0",
              fontFamily: FONT,
              fontSize: 12,
              lineHeight: "18px",
              color: QUIET,
            }}
          >
            {TRY_OUTREACH_ADDRESS}
          </Text>
        </Container>
      </Body>
    </Html>
  );
}
