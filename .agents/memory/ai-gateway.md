---
name: Lovable AI gateway pattern
description: How server-side AI calls work in this project
---

All AI calls go through the Lovable AI gateway, NOT directly to Gemini/Anthropic.

- Endpoint: `https://ai.gateway.lovable.dev/v1/chat/completions`
- Auth: `Authorization: Bearer ${process.env.LOVABLE_API_KEY}`
- Model: `google/gemini-2.5-flash`
- Pattern: `createServerFn` with `.middleware([requireSupabaseAuth])` + `.inputValidator(zod)`

**Why:** GEMINI_API_KEY is available in secrets but the project architecture routes through the Lovable gateway for billing/rate-limit management. Direct use of GEMINI_API_KEY will not work.

**How to apply:** Follow the `askYourNumbers` pattern in `src/lib/ai.functions.ts` for any new server-side AI feature.
