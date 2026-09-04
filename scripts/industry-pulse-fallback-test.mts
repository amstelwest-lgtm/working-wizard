/**
 * Smoke test: Industry Pulse fallback always returns a renderable payload.
 * Run: pnpm exec vite-node --config scripts/vite-test.config.ts scripts/industry-pulse-fallback-test.mts
 */
import { fallbackIndustryPulse, resolveNewsUrl } from "../src/lib/industry-news.functions";
import { resolveMarket, ZA_MARKET } from "../src/lib/market";

function assert(cond: unknown, msg: string) {
  if (!cond) throw new Error(msg);
}

const sectors = [
  "Retail / Ecommerce",
  "Construction",
  "Hospitality",
  "Manufacturing",
  "Logistics",
  "SaaS / Software",
  "Professional Services",
  "Something Else Entirely",
];

for (const industry of sectors) {
  const pulse = fallbackIndustryPulse(industry);
  assert(pulse.headline.trim().length > 0, `${industry}: missing headline`);
  assert(pulse.metrics.length >= 3, `${industry}: expected ≥3 metrics`);
  assert(pulse.items.length >= 3, `${industry}: expected ≥3 news items`);
  for (const m of pulse.metrics) {
    assert(m.label && m.value, `${industry}: metric incomplete`);
    assert(["up", "down", "flat"].includes(m.direction), `${industry}: bad direction`);
    assert(["good", "bad", "neutral"].includes(m.sentiment), `${industry}: bad sentiment`);
  }
  const adviceVerbs =
    /^(ask|send|cut|turn on|review|offer|lock|update|add|fill|use|match|check|push|run|take|follow up)\b/i;
  for (const item of pulse.items) {
    assert(item.headline && item.summary && item.tag, `${industry}: news incomplete`);
    assert(
      !adviceVerbs.test(item.summary.trim()),
      `${industry}: news summary looks like advice ("${item.summary}")`,
    );
    assert(
      !/affects cash|affects profit|opportunity|watch this/i.test(item.tag),
      `${industry}: news tag still advice-flavoured ("${item.tag}")`,
    );
    const href = resolveNewsUrl(item);
    assert(href.startsWith("http"), `${industry}: bad news url`);
  }
}

const tx = resolveMarket({ country: "US", regionCode: "TX" });
const saasUs = fallbackIndustryPulse("SaaS / Software", tx);
assert(saasUs.items.length >= 3, "US saas fallback has items");
assert(
  !/\brand\b/i.test(saasUs.items.map((i) => `${i.headline} ${i.summary}`).join(" ")),
  "US saas fallback must not mention rand",
);
assert(
  !/businesslive\.co\.za|moneyweb\.co\.za|news24\.com/i.test(
    saasUs.items.map((i) => i.url ?? "").join(" "),
  ),
  "US saas fallback must not keep SA news hosts",
);
const missingUrl = resolveNewsUrl({ headline: "foo", url: null }, tx);
assert(missingUrl.includes("gl=US"), `US news search fallback ${missingUrl}`);
assert(resolveNewsUrl({ headline: "foo", url: null }, ZA_MARKET).includes("gl=ZA"), "ZA gl");

console.log(`ok — ${sectors.length} industry fallback packs validated (+ US saas)`);
