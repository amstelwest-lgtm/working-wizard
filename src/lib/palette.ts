/** Milōn colour system. Ice is for charts, highlights, and focus — never for text. */

export const PALETTE = {
  white: "#FFFFFF",
  navy: "#102A43",
  cobalt: "#0B5FFF",
  royal: "#2563EB",
  ice: "#38BDF8",
  pale: "#DBEAFE",
  canvasDark: "#0B1B2B",
  surfaceDark: "#102A43",
  inkDark: "#F4F7FB",
  inkDim: "#3D5270",
  inkDimDark: "#C5D4E4",
  healthy: "#16845B",
  attention: "#B7791F",
  critical: "#C43D4B",
  /** Darker status inks. The spec swatches fail AA as small text on pale blue. */
  healthyInk: "#0E5C40",
  attentionInk: "#8A5A12",
  criticalInk: "#8E2430",
} as const;

export const ICE = PALETTE.ice;
