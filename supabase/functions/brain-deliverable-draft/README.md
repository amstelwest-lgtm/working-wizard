# brain-deliverable-draft

Deploy with the shared trial gate at `supabase/functions/_shared/starter-trial-gate.ts` (imported by `index.ts`). The gate reads `firms.starter_trial_generation_blocked`. It does not need a billing secret. No sibling `logic.ts`. Apply migration `20261005213000_firm_starter_trial_generation_blocked.sql` before relying on the block. Until a Vercel sync writes the column, the check fails open.

```bash
# Supabase CLI
supabase functions deploy brain-deliverable-draft

# MCP: deploy_edge_function with files["index.ts"] = contents of this index.ts
```

Requires `ANTHROPIC_API_KEY` (and standard Supabase secrets). Never deploy smoke stubs
(`smoke-bdd`, `{ ok: true, fn: "smoke-…" }`) — CI blocks them via `pnpm test:edge-no-smoke-stubs`.
