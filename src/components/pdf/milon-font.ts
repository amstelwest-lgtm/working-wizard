/**
 * Noto Sans for the Milōn wordmark. Report header and footer register it.
 * The tax sheet does not import this file, so it stays on the drawn mark.
 *
 * vite-node imports the font as `/src/assets/...`. The browser build imports
 * a hashed URL. Font.register needs a file path in node and that URL in
 * the browser. Same rule as the advisory pack fonts.
 */
import { Font } from "@react-pdf/renderer";
import notoBold from "../../assets/pdf-fonts/NotoSans-Bold.ttf";
import notoRegular from "../../assets/pdf-fonts/NotoSans-Regular.ttf";
import { MILON_WORDMARK_FONT } from "./milon-wordmark";

function fontSrc(imported: string): string {
  if (imported.startsWith("/src/assets/pdf-fonts/")) {
    const name = imported.split("/").pop() ?? imported;
    const file = new URL(`../../assets/pdf-fonts/${name}`, import.meta.url);
    if (file.protocol === "file:") return decodeURIComponent(file.pathname);
  }
  return imported;
}

let registered = false;

export function registerMilonWordmarkFont(): void {
  if (registered) return;
  registered = true;
  Font.register({
    family: MILON_WORDMARK_FONT,
    fonts: [
      { src: fontSrc(notoRegular), fontWeight: 400 },
      { src: fontSrc(notoBold), fontWeight: 700 },
    ],
  });
}
