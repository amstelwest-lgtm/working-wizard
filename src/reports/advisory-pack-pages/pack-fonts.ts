/**
 * Advisory pack type. Same families as the accountant portal
 * (Noto Sans for text, Cormorant Garamond for titles). Registered
 * only for this report so the other PDFs stay on Helvetica.
 *
 * vite-node imports the font as `/src/assets/...`. The browser build
 * imports a hashed URL. Font.register needs a file path in node and
 * that URL in the browser.
 */
import { Font } from "@react-pdf/renderer";
import cormorantItalic from "../../assets/pdf-fonts/CormorantGaramond-Italic.ttf";
import cormorantMedium from "../../assets/pdf-fonts/CormorantGaramond-Medium.ttf";
import cormorantSemi from "../../assets/pdf-fonts/CormorantGaramond-SemiBold.ttf";
import notoBold from "../../assets/pdf-fonts/NotoSans-Bold.ttf";
import notoRegular from "../../assets/pdf-fonts/NotoSans-Regular.ttf";
import notoSemi from "../../assets/pdf-fonts/NotoSans-SemiBold.ttf";

function fontSrc(imported: string): string {
  if (imported.startsWith("/src/assets/pdf-fonts/")) {
    const name = imported.split("/").pop() ?? imported;
    const file = new URL(`../../assets/pdf-fonts/${name}`, import.meta.url);
    if (file.protocol === "file:") return decodeURIComponent(file.pathname);
  }
  return imported;
}

let registered = false;

export function registerPackFonts(): void {
  if (registered) return;
  registered = true;
  Font.register({
    family: "Noto Sans",
    fonts: [
      { src: fontSrc(notoRegular), fontWeight: 400 },
      { src: fontSrc(notoSemi), fontWeight: 600 },
      { src: fontSrc(notoBold), fontWeight: 700 },
    ],
  });
  Font.register({
    family: "Cormorant Garamond",
    fonts: [
      { src: fontSrc(cormorantMedium), fontWeight: 500 },
      { src: fontSrc(cormorantSemi), fontWeight: 600 },
      { src: fontSrc(cormorantItalic), fontWeight: 500, fontStyle: "italic" },
    ],
  });
}

registerPackFonts();
