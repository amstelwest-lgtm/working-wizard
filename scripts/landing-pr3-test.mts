/**
 * Landing PR 3: self-hosted fonts, light gold ink, sky image-set,
 * lazy chunks, preferred source, contrast, a11y hooks, LH budgets.
 * Run: pnpm test:landing-pr3
 */
import { existsSync, readFileSync, statSync } from "node:fs";
import { resolve } from "node:path";

function assert(cond: boolean, msg: string) {
  if (!cond) throw new Error(msg);
}

const root = resolve(".");
const index = readFileSync(resolve(root, "src/routes/index.tsx"), "utf8");
const css = readFileSync(resolve(root, "src/styles/landing.css"), "utf8");
const assets = readFileSync(resolve(root, "src/lib/landing-assets.ts"), "utf8");
const rootRoute = readFileSync(resolve(root, "src/routes/__root.tsx"), "utf8");
const quiz = readFileSync(resolve(root, "src/lib/landing-quiz.ts"), "utf8");
const signIn = readFileSync(resolve(root, "src/components/landing/sign-in-modal.tsx"), "utf8");
const register = readFileSync(resolve(root, "src/components/landing/register-form.tsx"), "utf8");
const install = readFileSync(resolve(root, "src/components/share/install-instructions.tsx"), "utf8");
const lazyInstall = readFileSync(resolve(root, "src/components/share/lazy-install.tsx"), "utf8");
const vercel = readFileSync(resolve(root, "vercel.json"), "utf8");
const lh = JSON.parse(readFileSync(resolve(root, "lighthouserc.json"), "utf8")) as {
  ci: { assert: { assertions: Record<string, [string, { minScore?: number; maxNumericValue?: number }]> } };
  budgets: {
    mobilePerformanceMin: number;
    accessibilityMin: number;
    desktopLcpMs: number;
    mobileLcpMs: number;
    clsMax: number;
    landingJsTransferBytes: number;
    fontTransferBytes: number;
  };
};

const fontFiles = [
  "public/fonts/bebas-neue-400-latin-a7c90c89.woff2",
  "public/fonts/bebas-neue-400-latin-ext-16c95ce4.woff2",
  "public/fonts/cormorant-garamond-italic-6f2f5c3b.woff2",
  "public/fonts/noto-sans-latin-51ca196f.woff2",
  "public/fonts/noto-sans-macron-3d40adc4.woff2",
];
let fontBytes = 0;
for (const file of fontFiles) {
  assert(existsSync(resolve(root, file)), `${file} is self-hosted`);
  fontBytes += statSync(resolve(root, file)).size;
}
assert(fontBytes <= 120 * 1024, `landing font transfer is ${fontBytes} bytes, over 120KB`);
assert(assets.includes('font-display:swap'), "self-hosted faces use font-display: swap");
assert(assets.includes("U+014C-014D"), "Noto macron subset covers Ō");
assert(assets.includes("bebas-neue-400-latin-ext"), "Bebas latin-ext is available for Ō");
assert(index.includes("BEBAS_LATIN_HREF"), "homepage preloads Bebas");
assert(index.includes("NOTO_LATIN_HREF"), "homepage preloads Noto");
assert(!index.includes("fonts.googleapis.com"), "homepage does not request Google Fonts CSS");
assert(!index.includes("fonts.gstatic.com"), "homepage does not preload a Google Fonts file");
assert(css.includes('"Bebas Neue"'), "H1 and H2 use Bebas Neue");
assert(css.includes("html[data-landing=\"1\"] h1,html[data-landing=\"1\"] h2{"), "Bebas is limited to headings");
assert(!css.includes("html[data-landing=\"1\"] h3{font-family:\"Bebas"), "H3 stays off Bebas");
assert(css.includes("Noto Sans Fallback"), "Noto has a size-adjusted fallback");
assert(rootRoute.includes('String(entry.routeId) === "/"'), "root head can detect the homepage");
assert(rootRoute.includes("onLanding"), "root skips shared fonts on the homepage");
const googleFonts = rootRoute.indexOf("fonts.googleapis.com/css2");
const onLanding = rootRoute.indexOf("const onLanding");
assert(googleFonts !== -1 && onLanding !== -1 && onLanding < googleFonts, "Google Fonts stay behind the landing guard");

assert(css.includes("--gold-ink:#d4af37"), "dark gold ink stays brand gold");
assert(css.includes("--gold-ink:#7d5f0f"), "light gold ink is #7d5f0f");
const lightToken = css.indexOf('html[data-landing="1"][data-theme="light"]{');
const darkTokenEnd = css.indexOf("--gold-ink:#d4af37");
assert(lightToken !== -1 && darkTokenEnd !== -1 && darkTokenEnd < lightToken, "#7d5f0f is not the dark token");
assert(css.includes("background-color:var(--gold)"), "gold fills stay #d4af37");
assert(!css.includes("background-color:var(--gold-ink)"), "gold fills do not use the text token");
assert(!css.includes("border-color:var(--gold-ink)"), "gold borders do not use the text token");

const skies = {
  "public/landing-sky-2560-f9818ff0.avif": 140_000,
  "public/landing-sky-2560-118f74a2.webp": 140_000,
  "public/landing-sky-1080-457c7958.avif": 60_000,
  "public/landing-sky-1080-62f576e9.webp": 60_000,
};
for (const [file, cap] of Object.entries(skies)) {
  const size = statSync(resolve(root, file)).size;
  assert(size <= cap, `${file} is ${size} bytes, over ${cap}`);
}
assert(!existsSync(resolve(root, "public/landing-sky.jpg")), "jpeg sky is removed");
assert(assets.includes("image-set("), "sky uses image-set");
assert(assets.includes("max-width:767px"), "mobile sky is a separate image-set");
assert(vercel.includes('"/fonts/(.*)"'), "font files are cached immutable");
assert(vercel.includes('"/landing-sky-(.*)"'), "hashed sky files are cached immutable");

assert(index.includes('import("@/lib/landing-quiz")'), "quiz engine is dynamically imported");
assert(index.includes("LandingSignInModal"), "sign-in modal is lazy");
assert(index.includes("LandingRegisterForm"), "register form is lazy");
assert(index.includes("registerReady"), "register chunk waits for the section");
assert(quiz.includes("mountLandingQuiz"), "quiz module exports a mount function");
assert(signIn.includes("PasswordResetPanel"), "password reset is a nested lazy panel");
assert(lazyInstall.includes("if (!open) return null"), "PWA overlay unmounts while hidden");
assert(install.includes("if (!open) return null"), "install instructions unmount while hidden");
assert(register.includes("PREFERRED_SOURCE") === false, "register form does not own the preferred source link");

assert(index.includes('className="skip-link"'), "skip link is present");
assert(index.includes(">Skip to main content<") || index.includes("Skip to main content"), "skip link label is Skip to main content");
assert(index.includes('<main id="main">'), "main landmark exists");
assert(index.includes('className="marquee-toggle"'), "marquee has a pause control");
assert(index.includes("aria-pressed={marqueePaused}"), "marquee pause exposes aria-pressed");
assert(index.includes('marqueePaused ? "Play" : "Pause"'), "marquee control labels are Pause and Play");
assert(css.includes(".marquee.is-paused"), "paused marquee stops the animation");
assert(css.includes("prefers-reduced-motion:reduce") && css.includes(".marquee{animation:none"), "reduced motion stops the marquee");
assert(signIn.includes('role="dialog"'), "sign-in is a dialog");
assert(signIn.includes('aria-modal="true"'), "sign-in is modal");
assert(signIn.includes("aria-labelledby={titleId}"), "sign-in names its title");
assert(signIn.includes('htmlFor="si-email"'), "sign-in email has a label");
assert(signIn.includes('htmlFor="si-password"'), "sign-in password has a label");
assert(!index.includes("#6f6a60"), "landing drops the low-contrast dim hex");
assert(css.includes("#c9c3b6"), "dark section ledes over the sky are lighter");
assert(css.includes("rgba(5,5,7,.55)"), "narrow hero copy has a scrim");

assert(lh.budgets.mobilePerformanceMin === 0.8, "LH mobile performance budget is 80");
assert(lh.budgets.accessibilityMin === 1, "LH accessibility budget is 100");
assert(lh.budgets.desktopLcpMs === 2500, "desktop LCP budget is 2.5s");
assert(lh.budgets.mobileLcpMs === 4000, "mobile LCP budget is 4s");
assert(lh.budgets.clsMax === 0.1, "CLS budget is 0.1");
assert(lh.budgets.landingJsTransferBytes === 350 * 1024, "homepage JS transfer budget is 350 KiB");
assert(lh.ci.assert.assertions["categories:accessibility"][1].minScore === 1, "LHCI a11y assertion is 100");
assert(lh.ci.assert.assertions["categories:performance"][1].minScore === 0.8, "LHCI performance assertion is 80");
assert(
  lh.ci.assert.assertions["largest-contentful-paint"][1].maxNumericValue === 4000,
  "LHCI LCP assertion matches the mobile ceiling",
);

console.log(`landing-pr3-test: ok (${fontBytes} font bytes)`);
