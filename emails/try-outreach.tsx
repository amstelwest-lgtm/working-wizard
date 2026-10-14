/**
 * Outreach for the public sample. Render with scripts/render-try-outreach.mts.
 * This file does not send mail.
 */
import {
  Body,
  Button,
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
  Tailwind,
  Text,
  pixelBasedPreset,
} from "react-email";

export const TRY_OUTREACH_SUBJECT = "See a health score on sample figures";
export const TRY_OUTREACH_TRY_URL = "https://milonfinance.com/try?utm_source=email";
export const TRY_OUTREACH_UNSUBSCRIBE_URL = "https://milonfinance.com/unsubscribe";
export const TRY_OUTREACH_ADDRESS =
  "Milon, Inc., 800 N King Street, Suite 304, PMB 3836, Wilmington, DE 19801";
export const TRY_OUTREACH_SIGN_OFF = "The MILŌN Team";
export const TRY_OUTREACH_HEADERS = {
  "List-Unsubscribe": `<${TRY_OUTREACH_UNSUBSCRIBE_URL}>, <mailto:hello@milonfinance.com?subject=unsubscribe>`,
  "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
} as const;

const STILLS = [
  {
    src: "https://milonfinance.com/email/fm.png",
    alt: "Milōn Financial Manager",
    role: "Financial Manager",
  },
  {
    src: "https://milonfinance.com/email/analyst.png",
    alt: "Milōn Analyst",
    role: "Analyst",
  },
  {
    src: "https://milonfinance.com/email/advisor.png",
    alt: "Milōn Advisor",
    role: "Advisor",
  },
] as const;

export const TRY_OUTREACH_TEXT = [
  "See a health score on sample figures.",
  "",
  "One services business, in your market. No books to connect. The board stays marked SAMPLE.",
  "",
  "The Milōn Financial Manager, Analyst, and Advisor read the sample with you.",
  "",
  `Try Milōn: ${TRY_OUTREACH_TRY_URL}`,
  "",
  TRY_OUTREACH_SIGN_OFF,
  "",
  `Unsubscribe: ${TRY_OUTREACH_UNSUBSCRIBE_URL}`,
  TRY_OUTREACH_ADDRESS,
].join("\n");

export default function TryOutreachEmail() {
  return (
    <Html lang="en">
      <Tailwind config={{ presets: [pixelBasedPreset] }}>
        <Head />
        <Body className="m-0 bg-white font-sans text-[#102A43]">
          <Preview>A sample health score, with the Milōn team. No books to connect.</Preview>
          <Container className="mx-auto my-0 max-w-[600px] bg-white px-6 py-8">
            <Section>
              <Row>
                <Column>
                  <Text className="m-0 text-[20px] font-bold leading-6 tracking-tight text-[#102A43]">
                    Milōn
                  </Text>
                </Column>
                <Column align="right">
                  <Text className="m-0 text-right text-[11px] font-bold uppercase tracking-[0.14em] text-[#0B5FFF]">
                    Sample
                  </Text>
                </Column>
              </Row>
            </Section>

            <Section className="mt-8 rounded-[20px] border border-solid border-[#DBEAFE] bg-[#F4F8FF] px-4 py-5">
              <Row>
                {STILLS.map((still) => (
                  <Column key={still.src} align="center" className="w-1/3 px-1 align-top">
                    <Img
                      src={still.src}
                      width="96"
                      height="96"
                      alt={still.alt}
                      className="mx-auto rounded-full"
                      style={{ objectFit: "cover" }}
                    />
                    <Text className="m-0 mt-2 text-center text-[11px] font-bold uppercase tracking-[0.08em] text-[#0B5FFF]">
                      Milōn
                    </Text>
                    <Text className="m-0 mt-1 text-center text-[13px] font-bold leading-4 text-[#102A43]">
                      {still.role}
                    </Text>
                  </Column>
                ))}
              </Row>
            </Section>

            <Heading className="mb-0 mt-8 text-[28px] font-bold leading-8 tracking-tight text-[#102A43]">
              See a health score on sample figures.
            </Heading>
            <Text className="mb-0 mt-3 text-[16px] leading-6 text-[#3D5270]">
              One services business, in your market. No books to connect. The board stays marked SAMPLE.
            </Text>
            <Text className="mb-0 mt-3 text-[16px] leading-6 text-[#3D5270]">
              The Milōn Financial Manager, Analyst, and Advisor read the sample with you.
            </Text>

            <Section className="mt-6">
              <Button
                href={TRY_OUTREACH_TRY_URL}
                className="box-border w-full rounded-full px-7 py-3 text-center text-[16px] font-bold no-underline"
                style={{
                  width: "100%",
                  backgroundColor: "#d4af37",
                  backgroundImage:
                    "linear-gradient(180deg,#fdee79 0%,#f0d56a 32%,#d4af37 64%,#b8891a 100%)",
                  color: "#1b1300",
                  border: "1px solid #8d6a16",
                }}
              >
                Try Milōn
              </Button>
            </Section>

            <Text className="mb-0 mt-8 text-[14px] text-[#3D5270]">{TRY_OUTREACH_SIGN_OFF}</Text>

            <Hr className="my-6 border-solid border-[#DBEAFE]" />

            <Text className="m-0 text-[12px] leading-5 text-[#5C7190]">
              <Link href={TRY_OUTREACH_UNSUBSCRIBE_URL} className="text-[#0B5FFF] underline">
                Unsubscribe
              </Link>
            </Text>
            <Text className="mb-0 mt-2 text-[12px] leading-5 text-[#5C7190]">{TRY_OUTREACH_ADDRESS}</Text>
          </Container>
        </Body>
      </Tailwind>
    </Html>
  );
}
