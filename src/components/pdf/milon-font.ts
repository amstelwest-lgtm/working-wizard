/**
 * Noto Sans for the Milōn wordmark. Report header and footer register it.
 * The tax sheet does not import this file, so it stays on the drawn mark.
 *
 * The path is a static `new URL`, not a `import x from "./font.ttf"`.
 * vite-node closes its server when the test module finishes, and a separate
 * font-module request started after that close fails the report scripts.
 * A literal URL is resolved while this file is transformed. Node gets a
 * file path. The browser build gets the hashed asset URL.
 */
import { Font } from "@react-pdf/renderer";
import { MILON_WORDMARK_FONT } from "./milon-wordmark";

const regularUrl = new URL("../../assets/pdf-fonts/NotoSans-Regular.ttf", import.meta.url);
const boldUrl = new URL("../../assets/pdf-fonts/NotoSans-Bold.ttf", import.meta.url);

function fontSrc(url: URL): string {
  if (url.protocol === "file:") return decodeURIComponent(url.pathname);
  return url.href;
}

let registered = false;

export function registerMilonWordmarkFont(): void {
  if (registered) return;
  registered = true;
  Font.register({
    family: MILON_WORDMARK_FONT,
    fonts: [
      { src: fontSrc(regularUrl), fontWeight: 400 },
      { src: fontSrc(boldUrl), fontWeight: 700 },
    ],
  });
}
