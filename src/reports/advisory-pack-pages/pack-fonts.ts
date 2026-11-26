/**
 * Advisory pack faces. Noto Sans for text, Cormorant Garamond for titles.
 *
 * A static `new URL` is resolved while this file is transformed. Node (and
 * vite-node) gets a file path. The browser build gets the hashed asset URL.
 * Call `registerPackFonts` from each template so the production bundle cannot
 * drop the registration. If a face cannot be registered or loaded, its sources
 * are pointed at built-in Helvetica (Helvetica-Bold / Helvetica-Oblique).
 */
import { Font } from "@react-pdf/renderer";

const notoRegular = new URL("../../assets/pdf-fonts/NotoSans-Regular.ttf", import.meta.url);
const notoBold = new URL("../../assets/pdf-fonts/NotoSans-Bold.ttf", import.meta.url);
const notoSemi = new URL("../../assets/pdf-fonts/NotoSans-SemiBold.ttf", import.meta.url);
const notoItalic = new URL("../../assets/pdf-fonts/NotoSans-Italic.ttf", import.meta.url);
const cormorantMedium = new URL(
  "../../assets/pdf-fonts/CormorantGaramond-Medium.ttf",
  import.meta.url,
);
const cormorantSemi = new URL(
  "../../assets/pdf-fonts/CormorantGaramond-SemiBold.ttf",
  import.meta.url,
);
const cormorantItalic = new URL(
  "../../assets/pdf-fonts/CormorantGaramond-Italic.ttf",
  import.meta.url,
);

export const NOTO_SANS = "Noto Sans";
export const CORMORANT = "Cormorant Garamond";
const HELVETICA = "Helvetica";

type Face = { fontWeight: number; fontStyle: "normal" | "italic" };

const NOTO_FACES: Face[] = [
  { fontWeight: 400, fontStyle: "normal" },
  { fontWeight: 600, fontStyle: "normal" },
  { fontWeight: 700, fontStyle: "normal" },
  { fontWeight: 400, fontStyle: "italic" },
];

const DISPLAY_FACES: Face[] = [
  { fontWeight: 500, fontStyle: "normal" },
  { fontWeight: 600, fontStyle: "normal" },
  { fontWeight: 500, fontStyle: "italic" },
];

function fontSrc(url: URL): string {
  if (url.protocol === "file:") return decodeURIComponent(url.pathname);
  return url.href;
}

function standardSrc(weight: number, style: string): string {
  const bold = weight >= 600;
  const italic = style === "italic";
  if (bold && italic) return "Helvetica-BoldOblique";
  if (bold) return "Helvetica-Bold";
  if (italic) return "Helvetica-Oblique";
  return "Helvetica";
}

type FontSourceRecord = {
  src: string;
  fontStyle?: string;
  fontWeight?: number;
  data: unknown;
  loadResultPromise: Promise<unknown> | null;
};

function sourcesOf(family: string): FontSourceRecord[] {
  const read = (Font as { getRegisteredFonts?: () => unknown }).getRegisteredFonts;
  if (typeof read !== "function") return [];
  const families = read() as Record<string, { sources?: FontSourceRecord[] }>;
  return families?.[family]?.sources ?? [];
}

/** Point an already-registered family at built-in Helvetica files. */
function pointAtHelvetica(family: string): void {
  for (const source of sourcesOf(family)) {
    source.src = standardSrc(source.fontWeight ?? 400, source.fontStyle ?? "normal");
    source.data = null;
    source.loadResultPromise = null;
  }
}

function registerStandard(family: string, faces: Face[]): void {
  Font.register({
    family,
    fonts: faces.map((face) => ({
      src: standardSrc(face.fontWeight, face.fontStyle),
      fontWeight: face.fontWeight,
      fontStyle: face.fontStyle,
    })),
  });
}

let registered = false;
let notoReady = false;
let displayReady = false;
let ensuring: Promise<void> | null = null;

export function registerPackFonts(): void {
  if (registered) return;
  registered = true;
  try {
    Font.register({
      family: NOTO_SANS,
      fonts: [
        { src: fontSrc(notoRegular), fontWeight: 400, fontStyle: "normal" },
        { src: fontSrc(notoSemi), fontWeight: 600, fontStyle: "normal" },
        { src: fontSrc(notoBold), fontWeight: 700, fontStyle: "normal" },
        { src: fontSrc(notoItalic), fontWeight: 400, fontStyle: "italic" },
      ],
    });
    notoReady = true;
  } catch {
    notoReady = false;
    try {
      registerStandard(NOTO_SANS, NOTO_FACES);
    } catch {
      // Helvetica stays available under its own family name.
    }
  }
  try {
    Font.register({
      family: CORMORANT,
      fonts: [
        { src: fontSrc(cormorantMedium), fontWeight: 500, fontStyle: "normal" },
        { src: fontSrc(cormorantSemi), fontWeight: 600, fontStyle: "normal" },
        { src: fontSrc(cormorantItalic), fontWeight: 500, fontStyle: "italic" },
      ],
    });
    displayReady = true;
  } catch {
    displayReady = false;
    try {
      registerStandard(CORMORANT, DISPLAY_FACES);
    } catch {
      // Titles use displayFamily(), which is Helvetica in this case.
    }
  }
}

/** Family name templates should use. Helvetica when Noto Sans did not load. */
export function sansFamily(): string {
  registerPackFonts();
  return notoReady ? NOTO_SANS : HELVETICA;
}

/** Family name for pack titles. Helvetica when Cormorant did not load. */
export function displayFamily(): string {
  registerPackFonts();
  return displayReady ? CORMORANT : HELVETICA;
}

async function loadFaces(family: string, faces: Face[]): Promise<void> {
  for (const face of faces) {
    await Font.load({
      fontFamily: family,
      fontWeight: face.fontWeight,
      fontStyle: face.fontStyle,
    });
  }
}

async function ensureOnce(): Promise<void> {
  registerPackFonts();
  if (notoReady) {
    try {
      await loadFaces(NOTO_SANS, NOTO_FACES);
    } catch {
      pointAtHelvetica(NOTO_SANS);
      notoReady = false;
      try {
        await loadFaces(NOTO_SANS, NOTO_FACES);
      } catch {
        // sansFamily() is now Helvetica.
      }
    }
  }
  if (displayReady) {
    try {
      await loadFaces(CORMORANT, DISPLAY_FACES);
    } catch {
      pointAtHelvetica(CORMORANT);
      displayReady = false;
      try {
        await loadFaces(CORMORANT, DISPLAY_FACES);
      } catch {
        // displayFamily() is now Helvetica.
      }
    }
  }
}

/** Register, then load. A failed load switches that family to Helvetica. */
export function ensurePackFonts(): Promise<void> {
  if (!ensuring) ensuring = ensureOnce();
  return ensuring;
}

registerPackFonts();
