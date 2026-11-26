/** Pack-only colour and type. Brand system v1.1. Other reports keep theme.ts. */
import { displayFamily, sansFamily } from "./pack-fonts";

export const P = {
  navy: "#102A43",
  cobalt: "#0B5FFF",
  royal: "#2563EB",
  ice: "#38BDF8",
  line: "#DBEAFE",
  mist: "#F5F9FF",
  white: "#FFFFFF",
  body: "#3B4F66",
  muted: "#64748B",
  gold: "#B0893E",
} as const;

/** Noto Sans after registration, or Helvetica if that face did not load. */
export const SANS = sansFamily();
/** Cormorant Garamond after registration, or Helvetica if that face did not load. */
export const DISPLAY = displayFamily();
