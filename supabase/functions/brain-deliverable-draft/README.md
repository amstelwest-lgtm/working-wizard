# brain-deliverable-draft

Self-contained edge function — deploy **`index.ts` only** (no sibling imports).

```bash
# Supabase CLI
supabase functions deploy brain-deliverable-draft

# MCP: deploy_edge_function with files["index.ts"] = contents of this index.ts
```

Requires `ANTHROPIC_API_KEY` (and standard Supabase secrets). Never deploy smoke stubs
(`smoke-bdd`, `{ ok: true, fn: "smoke-…" }`) — CI blocks them via `pnpm test:edge-no-smoke-stubs`.
