/**
 * Self-hosted landing faces and the night-sky image-set.
 * Injected as raw <style> text so Vite's ?inline CSS pipeline does not
 * rewrite the root-relative urls.
 *
 * Ō (U+014C) is in Bebas Neue latin-ext (glyph Omacron) and in the tiny
 * Noto macron subset used by the wordmark and body.
 */

export const BEBAS_LATIN_HREF = "/fonts/bebas-neue-400-latin-a7c90c89.woff2";
export const NOTO_LATIN_HREF = "/fonts/noto-sans-latin-51ca196f.woff2";
/** Ō in the hero lede. Preloaded so that glyph is not the late LCP swap. */
export const NOTO_MACRON_HREF = "/fonts/noto-sans-macron-3d40adc4.woff2";

const LATIN =
  "U+0000-00FF,U+0131,U+0152-0153,U+02BB-02BC,U+02C6,U+02DA,U+02DC,U+0304,U+0308,U+0329,U+2000-206F,U+20AC,U+2122,U+2191,U+2193,U+2212,U+2215,U+FEFF,U+FFFD";
const LATIN_EXT =
  "U+0100-02BA,U+02BD-02C5,U+02C7-02CC,U+02CE-02D7,U+02DD-02FF,U+0304,U+0308,U+0329,U+1D00-1DBF,U+1E00-1E9F,U+1EF2-1EFF,U+2020,U+20A0-20AB,U+20AD-20C4,U+2113,U+2C60-2C7F,U+A720-A7FF";

export const LANDING_FONT_CSS = `
@font-face{
  font-family:"Bebas Neue";
  font-style:normal;
  font-weight:400;
  font-display:swap;
  src:url("${BEBAS_LATIN_HREF}") format("woff2");
  unicode-range:${LATIN};
}
@font-face{
  font-family:"Bebas Neue";
  font-style:normal;
  font-weight:400;
  font-display:swap;
  src:url("/fonts/bebas-neue-400-latin-ext-16c95ce4.woff2") format("woff2");
  unicode-range:${LATIN_EXT};
}
@font-face{
  font-family:"Bebas Neue Fallback";
  src:local("Arial"),local("Liberation Sans"),local("Arimo"),local("Nimbus Sans");
  size-adjust:66.77%;
  ascent-override:134.77%;
  descent-override:44.92%;
  line-gap-override:0%;
  font-weight:400;
  font-style:normal;
  font-display:swap;
}
@font-face{
  font-family:"Cormorant Garamond";
  font-style:italic;
  font-weight:500 600;
  font-display:swap;
  src:url("/fonts/cormorant-garamond-italic-6f2f5c3b.woff2") format("woff2");
  unicode-range:${LATIN};
}
@font-face{
  font-family:"Noto Sans";
  font-style:normal;
  font-weight:400 700;
  font-display:swap;
  src:url("${NOTO_LATIN_HREF}") format("woff2");
  unicode-range:${LATIN};
}
@font-face{
  font-family:"Noto Sans";
  font-style:normal;
  font-weight:400 700;
  font-display:swap;
  src:url("${NOTO_MACRON_HREF}") format("woff2");
  unicode-range:U+014C-014D;
}
@font-face{
  font-family:"Noto Sans Fallback";
  src:local("Arial"),local("Liberation Sans"),local("Arimo"),local("Nimbus Sans");
  size-adjust:107.5%;
  ascent-override:92%;
  descent-override:24%;
  line-gap-override:0%;
  font-weight:400 700;
  font-style:normal;
  font-display:swap;
}
`;

export const LANDING_SKY_CSS = `
html[data-landing="1"] #landing-sky .landing-sky-photo{
  background-image:image-set(
    url("/landing-sky-2560-f9818ff0.avif") type("image/avif"),
    url("/landing-sky-2560-118f74a2.webp") type("image/webp")
  );
}
@media (max-width:767px){
  html[data-landing="1"] #landing-sky .landing-sky-photo{
    background-image:image-set(
      url("/landing-sky-1080-457c7958.avif") type("image/avif"),
      url("/landing-sky-1080-62f576e9.webp") type("image/webp")
    );
  }
}
`;

export const PREFERRED_SOURCE_HREF =
  "https://www.google.com/preferences/source?q=milonfinance.com";
export const PREFERRED_SOURCE_LABEL =
  "Add milonfinance.com as a Preferred Source in Google";
