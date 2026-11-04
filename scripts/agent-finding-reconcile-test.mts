/**
 * Health finding reconcile server fn wiring.
 * Run: pnpm exec vite-node --config scripts/vite-test.config.ts scripts/agent-finding-reconcile-test.mts
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { persistReconciledFindingCopy, renderHealthNarrative, snapshotEvidenceFields } from "../src/lib/health-snapshot.ts";
import { ZA_MARKET } from "../src/lib/market/resolve.ts";
import { draftWhenLabel } from "../src/lib/milon-team-activity.ts";

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(msg);
}

const live = {
  overall: 54,
  pillars: [
    { id: "profit", label: "Profit", score: 46 },
    { id: "assets", label: "Assets", score: 84 },
    { id: "financing", label: "Financing", score: 60 },
    { id: "cash", label: "Cash", score: 25 },
  ],
  weakestLabel: "Cash",
  weakestScore: 25,
  periodLabel: "Full year on file",
};

const evidence = snapshotEvidenceFields(live);
const stored = `${renderHealthNarrative(live)} Figures changed since this was written, regenerate.`;
const persisted = persistReconciledFindingCopy({
  title: stored,
  detail: null,
  evidence,
  live,
});
assert(persisted.changed, "reconcile persist strips the marker");
assert(!persisted.title.includes("regenerate"), persisted.title);

const createdAt = "2026-10-19T08:00:00.000Z";
const seenAt = "2026-11-04T16:30:00.000Z";
const when = draftWhenLabel(createdAt, seenAt, ZA_MARKET);
assert(when.includes("Updated"), when);

const src = readFileSync(resolve("src/lib/agent-finding-reconcile.functions.ts"), "utf8");
const healthLine = readFileSync(resolve("src/components/health-narrative-line.tsx"), "utf8");
assert(src.includes("reconcileHealthFindingNarrative"), "server fn exists");
assert(src.includes("last_seen"), "persist bumps last_seen");
assert(src.includes("supabaseAdmin"), "persist uses admin client");
assert(healthLine.includes("reconcileHealthFindingNarrative"), "Regenerate calls the server fn");
assert(healthLine.includes("toast.error"), "Regenerate surfaces errors");

console.log("agent-finding-reconcile-test: ok");
