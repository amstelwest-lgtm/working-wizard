# brain-deliverable-draft

Deploy with the shared trial gate at `supabase/functions/_shared/starter-trial-gate.ts` (imported by `index.ts`). The gate imports the app billing modules under `src/lib`. No sibling `logic.ts`. Set `STRIPE_SECRET_KEY` or `STRIPE_RESTRICTED_KEY` on the function or the trial check fails open and generation still runs.

```bash
# Supabase CLI
supabase functions deploy brain-deliverable-draft

# MCP: deploy_edge_function with files["index.ts"] = contents of this index.ts
```

Requires `ANTHROPIC_API_KEY` (and standard Supabase secrets). Never deploy smoke stubs
(`smoke-bdd`, `{ ok: true, fn: "smoke-…" }`) — CI blocks them via `pnpm test:edge-no-smoke-stubs`.
