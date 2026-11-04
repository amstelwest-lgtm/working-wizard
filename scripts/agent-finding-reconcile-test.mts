/**
 * Health finding reconcile server fn wiring.
 * Run: pnpm exec vite-node --config scripts/vite-test.config.ts scripts/agent-finding-reconcile-test.mts
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  FIGURES_CHANGED_RELOAD,
  guardReconciledFindingWrite,
  healthSnapshotHash,
  persistReconciledFindingCopy,
  renderHealthNarrative,
  snapshotEvidenceFields,
} from "../src/lib/health-snapshot.ts";
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

const staleProfitTitle =
  "Profit is the weakest pillar at 60 against an overall health score of 74, and the Sep 2026 ratios need checking.";
const staleEvidence = {
  ...snapshotEvidenceFields({
    overall: 74,
    pillars: [
      { id: "profit", label: "Profit", score: 60 },
      { id: "assets", label: "Assets", score: 80 },
      { id: "financing", label: "Financing", score: 70 },
      { id: "cash", label: "Cash", score: 55 },
    ],
    weakestLabel: "Profit",
    weakestScore: 60,
    periodLabel: "Jan 1 – Sep 30, 2026",
  }),
};
const stalePersisted = persistReconciledFindingCopy({
  title: staleProfitTitle,
  detail: null,
  evidence: staleEvidence,
  live,
});
assert(stalePersisted.changed, "cited-figure disagreement persists live narrative");
assert(
  stalePersisted.title === renderHealthNarrative(live),
  `stale regen writes live sentence: ${stalePersisted.title}`,
);
assert(!stalePersisted.title.includes("Profit is the weakest pillar at 60"), stalePersisted.title);

const freshTitle = renderHealthNarrative(live);
const alreadyFresh = persistReconciledFindingCopy({
  title: freshTitle,
  detail: null,
  evidence,
  live,
});
assert(!alreadyFresh.changed, "already-fresh stored copy is not rewritten");

const server57 = {
  overall: 57,
  pillars: [
    { id: "profit" as const, label: "Profit", score: 60 },
    { id: "assets" as const, label: "Assets", score: 84 },
    { id: "financing" as const, label: "Financing", score: 60 },
    { id: "cash" as const, label: "Cash", score: 25 },
  ],
  weakestLabel: "Cash",
  weakestScore: 25,
  periodLabel: "Full year on file",
};
const serverSentence = renderHealthNarrative(server57);
const clientSentence = renderHealthNarrative(live);
assert(serverSentence.includes("57"), serverSentence);
assert(clientSentence.includes("54"), clientSentence);
assert(serverSentence !== clientSentence, "57 and 54 sentences differ");
const wouldWrite = persistReconciledFindingCopy({
  title: staleProfitTitle,
  detail: null,
  evidence: snapshotEvidenceFields(server57),
  live: server57,
});
assert(wouldWrite.changed, "server snapshot alone would persist a new title");
assert(wouldWrite.title === serverSentence, wouldWrite.title);
assert(wouldWrite.title !== clientSentence, "ungarded persist disagrees with the client sentence");
const refused = guardReconciledFindingWrite({
  server: server57,
  clientHash: healthSnapshotHash(live),
  liveSentence: clientSentence,
  title: wouldWrite.title,
});
assert(refused.write === false, "57 vs 54 refuses the write");
assert(refused.error === FIGURES_CHANGED_RELOAD, refused.error);
const aligned = guardReconciledFindingWrite({
  server: live,
  clientHash: healthSnapshotHash(live),
  liveSentence: clientSentence,
  title: clientSentence,
});
assert(aligned.write === true, "matching snapshot still writes");
assert(aligned.title === clientSentence, aligned.write ? aligned.title : aligned.error);
assert(!aligned.title.includes("57"), aligned.title);

const createdAt = "2026-10-19T08:00:00.000Z";
const seenAt = "2026-11-04T16:30:00.000Z";
const when = draftWhenLabel(createdAt, seenAt, ZA_MARKET);
assert(when.includes("Updated"), when);

const src = readFileSync(resolve("src/lib/agent-finding-reconcile.functions.ts"), "utf8");
const healthLine = readFileSync(resolve("src/components/health-narrative-line.tsx"), "utf8");
const card = readFileSync(resolve("src/components/owner-draft-card.tsx"), "utf8");
const desk = readFileSync(resolve("src/components/milon-team/milon-team-desk.tsx"), "utf8");
assert(src.includes("reconcileHealthFindingNarrative"), "server fn exists");
assert(src.includes("Nothing to regenerate"), "no-op regen throws before last_seen bump");
assert(src.includes("last_seen"), "persist bumps last_seen when changed");
assert(src.includes("supabaseAdmin"), "persist uses admin client");
assert(src.includes("scoreSnapshotHash"), "client snapshot hash is required");
assert(src.includes("liveSentence"), "client live sentence is required");
const guardAt = src.indexOf("if (!guard.write) throw new Error(guard.error)");
const updateAt = src.indexOf(".update(");
assert(
  guardAt !== -1 && updateAt !== -1 && guardAt < updateAt,
  "hash mismatch throws before the write",
);
assert(healthLine.includes("reconcileHealthFindingNarrative"), "Regenerate calls the server fn");
assert(healthLine.includes("toast.error"), "Regenerate surfaces errors");
assert(healthLine.includes("scoreSnapshotHash"), "Regenerate sends the snapshot hash");
assert(healthLine.includes("setShown(result.title)"), "Regenerate paints the saved title");
assert(healthLine.includes("result.title !== liveSentence"), "a disagreeing title is toasted");
assert(
  !healthLine.includes("result.title === liveSentence ? result.title : liveSentence"),
  "silent liveSentence fallback is gone",
);
assert(card.includes("healthSnapshotHash"), "draft card hashes the snapshot it rendered");
assert(card.includes("scoreSnapshotHash={snapshotHash}"), "draft card sends that hash");
assert(desk.includes("scoreSnapshotHash={scoreSnapshotHash}"), "desk sends the quote hash");

console.log("agent-finding-reconcile-test: ok");
