# Stale health numbers in agent text

AQA failed this twice on client 1020B (`7b111d2a`). Live books were Profit 75 / Assets 63 / Financing 81 / Cash 34, overall 63, weakest Cash. The Analyst card still read as if two different scorecards were true at once, and the period badge said January while the next card said September.

## Cause

Narratives are stored once (finding title and detail, draft title and detail, pack section body) and shown later. #672 tried to repair them at display time by rewriting two phrases in `preferLiveHealthProse`: “X is the weakest pillar at N” and “overall health score of N”. Everything else in the same paragraph was left as stored.

On 1020B that produced: “Cash is the weakest pillar at 34, against an overall health score of 63. Assets scores 83, Financing 81 and Cash 78, so Profit pulls the overall score down.” The first sentence matched the live books. The other pillar scores and the “pulls the score down” clause did not, so the card contradicted itself.

Drafts were worse. `quoteLiveDraftProse` called the same helper with `weakestLabel: null`, so only the overall was replaced. The home draft became “Profit, the weakest pillar at 58 against an overall health score of 63”: the overall was live, the weakest pillar was not.

The Analyst badge used a second source. `findingPeriod` reads `evidence.period_label` or `as_of`, and `monthShort` takes the first month in that string. A January label on the finding became “Jan figures”. The next card used the statement period, which ends in September.

New writes stored a margin/overall `figures_hash` only. They did not store the pillar scores, the weakest pillar, or the statement period, and the prompts were not given one snapshot to quote.

## Files

- `src/lib/score-prose.ts` — the phrase rewrite (#672).
- `src/lib/draft-figures.ts` — drafts called that rewrite with no weakest pillar.
- `src/lib/owner-needs.ts` — home draft titles and bodies.
- `src/lib/milon-team-activity.ts` — `findingSentence`, `handoffLine`, `figuresCheckedLine`, `findingPeriod`.
- `src/components/milon-team/milon-team-desk.tsx` — Analyst card and badge.
- `src/lib/milon-team-feed.ts` — `healthQuote` carried overall and weakest only.
- `src/lib/agent-draft.ts` — draft evidence stored `figures_hash`, not a score snapshot.
- `supabase/functions/agent-analyst/execute.ts` — `record_finding` and `get_health`.
- `supabase/functions/_shared/agent-desk.ts` — Advisor and Financial Manager drafts.
- `supabase/functions/_shared/agent-prompts/analyst.ts`, `advisor.ts`, `financial-manager.ts` — “quote the tool result”, with no single snapshot.
- `supabase/functions/milon-bot/execute.ts` and `logic.ts` — bot health tool and overview rules.
- `supabase/functions/brain-propose/index.ts` and `brain-deliverable-draft/index.ts` — generation context.
- `supabase/functions/_shared/agent-core/job.ts` — owner-handoff draft row.
- `src/lib/advisory-pack.ts` — pack and PDF body kept stored scores.

## Why #672 missed it

The repair was a sentence-level substitute for two patterns. It never compared the rest of the paragraph, never treated “Assets scores 83” or “Profit pulls the score down” as score claims, and never ran the weakest-pillar half on drafts. A stored narrative can name every pillar. Patching the first clause leaves the others free to disagree with the books. The period badge was a different field (`evidence.period_label` / `as_of`) and was not part of that change.

## Fix

One live score snapshot (pillars, overall, weakest, statement period from `figuresPeriodLabelFrom` with the client market) is the only score source. A sentence made only of the known templates — weakest pillar, overall score, pillar list, “X pulls the score down”, period label — is re-rendered from that snapshot. “Figures changed since this was written, regenerate” is kept for free-form prose that still quotes a score the templates cannot rewrite. New findings and drafts store `score_snapshot` and `score_snapshot_hash` inside the existing `evidence` jsonb. Prompts and `get_health` receive that snapshot. The period badge uses the statement period’s end month.

## Verification

`scripts/health-narrative-snapshot-test.mts` uses the 1020B numbers. The Analyst paragraph is re-rendered as Cash weakest at 34, overall 63, Profit 75, Assets 63, Financing 81, with no regenerate marker. A free-form sentence that still quotes a stale score gets the marker. The period badge for “1 Jan 2026 – 30 Sep 2026” is September, not January.
