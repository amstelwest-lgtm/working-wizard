/**
 * Report design system — single source of truth for the redesigned PDF suite.
 *
 * Palette: finance blues (primary), red strictly for negative/risk, green for
 * positive, minimal gold used only as thin accent hairlines / small flourishes.
 * White background, generous whitespace, strong typographic hierarchy.
 */

import type { AccountantProfile } from "@/contexts/accountant-profile";

// ── Palette ────────────────────────────────────────────────────────────────

export const C = {
  // Neutrals / typography
  ink: "#0c1a2e",       // near-black navy — headings
  body: "#3b4a5e",      // body copy
  muted: "#64748b",     // secondary text
  faint: "#94a3b8",     // tertiary / captions
  line: "#e2e8f0",      // borders
  hairline: "#eef2f6",  // subtle dividers
  soft: "#f8fafc",      // panel background
  softBlue: "#f2f6fb",  // tinted panel background
  white: "#ffffff",

  // Finance blues
  blue: "#1e5b9e",      // primary data blue
  blueDeep: "#0c2f57",  // deep navy — emphasis fills
  blueLight: "#7ea8d4", // secondary series
  blueSoft: "#e6eef7",  // blue tint fills

  // Signals
  green: "#0f9d6b",
  greenSoft: "#e7f6ef",
  greenDeep: "#0a6b4a",
  red: "#d64550",
  redSoft: "#fbecee",
  redDeep: "#a32b35",
  amber: "#d98a06",
  amberSoft: "#fbf3e2",
  amberDeep: "#92600a",

  // Minimal gold — hairlines and small flourishes only, never large fills
  gold: "#b2913f",
} as const;

// ── Milōn default brand ────────────────────────────────────────────────────

export const MILON = {
  name: "Milōn",
  accent: "#0c2f57",
} as const;

/** Legacy default accents that should be treated as "no client brand chosen". */
const LEGACY_DEFAULT_ACCENTS = ["#0f3460", "#1a1a2e", "#16213e"];

export type ReportTheme = {
  /** Accent used for brand touches (header rule, table headers, emphasis). */
  accent: string;
  /** True when the client supplied a real brand (logo or custom accent). */
  hasClientBrand: boolean;
  firmName: string;
  logoUrl: string | null;
  tagline: string | null;
  accountantEmail: string;
};

/**
 * Merge client brand assets with Milōn defaults into one theme object.
 * If the client set a custom accent or logo, their brand drives the report;
 * otherwise the polished Milōn navy theme is used.
 */
export function resolveTheme(profile: AccountantProfile): ReportTheme {
  const raw = (profile.accentColor || "").trim().toLowerCase();
  const hasCustomAccent =
    /^#[0-9a-f]{6}$/.test(raw) && !LEGACY_DEFAULT_ACCENTS.includes(raw);
  const hasClientBrand = Boolean(profile.logoUrl) || hasCustomAccent;
  return {
    accent: hasCustomAccent ? raw : MILON.accent,
    hasClientBrand,
    firmName: profile.firmName || "",
    logoUrl: profile.logoUrl,
    tagline: profile.tagline,
    accountantEmail: profile.accountantEmail || "",
  };
}

// ── Typography scale (Helvetica family — built into every PDF viewer) ──────

export const T = {
  display: { fontSize: 30, fontFamily: "Helvetica-Bold", color: C.ink },
  h1: { fontSize: 19, fontFamily: "Helvetica-Bold", color: C.ink },
  h2: { fontSize: 12, fontFamily: "Helvetica-Bold", color: C.ink },
  kicker: {
    fontSize: 7,
    fontFamily: "Helvetica-Bold",
    color: C.muted,
    letterSpacing: 1.6,
    textTransform: "uppercase" as const,
  },
  body: { fontSize: 8.5, fontFamily: "Helvetica", color: C.body, lineHeight: 1.55 },
  small: { fontSize: 7.5, fontFamily: "Helvetica", color: C.muted },
  caption: { fontSize: 6.5, fontFamily: "Helvetica", color: C.faint },
  num: { fontFamily: "Helvetica-Bold", color: C.ink },
} as const;

// ── Tier helpers ───────────────────────────────────────────────────────────

export type Tier = "critical" | "at_risk" | "healthy";

export const TIER_META: Record<
  Tier,
  { label: string; color: string; soft: string; deep: string }
> = {
  healthy: { label: "HEALTHY", color: C.green, soft: C.greenSoft, deep: C.greenDeep },
  at_risk: { label: "WATCH", color: C.amber, soft: C.amberSoft, deep: C.amberDeep },
  critical: { label: "CRITICAL", color: C.red, soft: C.redSoft, deep: C.redDeep },
};

export function tierForScore(score?: number | null): Tier {
  if (score == null || !Number.isFinite(score)) return "at_risk";
  if (score >= 65) return "healthy";
  if (score >= 40) return "at_risk";
  return "critical";
}

export function scoreColor(score?: number | null): string {
  return TIER_META[tierForScore(score)].color;
}

// ── Formatting helpers ─────────────────────────────────────────────────────

export function fmtRand(value: number): string {
  const abs = Math.abs(Math.round(value));
  return (value < 0 ? "-R " : "R ") + abs.toLocaleString("en-ZA");
}

export function fmtRandCompact(value: number): string {
  const abs = Math.abs(value);
  const sign = value < 0 ? "-" : "";
  if (abs >= 1_000_000) return `${sign}R${(abs / 1_000_000).toFixed(1)}m`;
  if (abs >= 1_000) return `${sign}R${Math.round(abs / 1_000)}k`;
  return `${sign}R${Math.round(abs)}`;
}

export function fmtPct(value: number, dp = 1): string {
  if (!Number.isFinite(value)) return "n/m";
  return `${(value * 100).toFixed(dp)}%`;
}
