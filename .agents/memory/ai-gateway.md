---
name: AI provider reality (Claude direct, not Gemini)
description: Where LLM calls actually go in this project and what is dead code
---

All live AI calls go **directly to Anthropic** (`https://api.anthropic.com/v1/messages`)
with `ANTHROPIC_API_KEY`. Model is `CLAUDE_MODEL` (default `claude-sonnet-4-6`).

- Numbers Q&A: Supabase Edge Function `supabase/functions/ask-ai/` (`anthropic.ts`),
  tiered disclosure + sanitiser + cache + rate limit. Client: `src/lib/ask-ai.js`.
- Client Brain / tool calls: Edge Function `supabase/functions/milon-bot/` (`claude.ts`).
- Server-side extraction / drafting: `src/lib/claude-messages.ts` and the
  `*.functions.ts` that import it (extraction, briefing, brain propose/deliverable).

**Dead / misleading paths — do not extend them:**
- `src/lib/ai.functions.ts` `askYourNumbers` is deprecated (superseded by `ask-ai`).
- The Lovable AI gateway (`ai.gateway.lovable.dev`, `LOVABLE_API_KEY`) is no longer
  called by anything live.
- `@google/genai` is in `package.json` but unused; Gemini code exists only under
  `attached_assets/` (not part of the app). `GEMINI_API_KEY` is not read by the app.

**Cost rule (advisory OS):** workflow/Next Step is deterministic (no LLM);
LLM only for extraction, diagnosis narrative, recommendation drafting and Ask AI.
Planned tiering: Haiku-class for clean PDF/CSV extraction, Sonnet for scan/merge
fallback. Never embed full statements on every chat turn.

**How to apply:** for a new server-side AI feature, follow an existing
`createServerFn` + `.middleware([requireSupabaseAuth])` + `.inputValidator(zod)`
file that imports `claude-messages.ts`; for owner/accountant Q&A, add to `ask-ai`.
