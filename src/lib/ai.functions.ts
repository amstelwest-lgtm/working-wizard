/**
 * DEPRECATED — superseded by the `ask-ai` Supabase Edge Function.
 *
 * This function sent unconstrained context (including company name and raw financials)
 * to the Lovable AI gateway. The edge function provides:
 *   - Privacy-by-design (anonymised ratio context, no company names or raw amounts)
 *   - Classifier-based disclosure tiering (none / summary / focused / full)
 *   - Shared cache for definitional answers
 *   - Rate limiting (30 questions / user / hour via DB function)
 *   - Sanitisation of VAT numbers, account numbers, and prompt-injection patterns
 *   - Audit log (token counts + latency, no text fields)
 *
 * Do not delete this export yet — callers may still import it.
 * Remove once all call sites have been migrated to the widget.
 */

import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

const InputSchema = z.object({
  clientId: z.string().uuid().optional(),
  question: z.string().min(1).max(2000),
  context: z
    .object({
      clientName: z.string().max(200).optional(),
      businessType: z.string().max(80).optional(),
      cashRunwayWeeks: z.number().nullable().optional(),
      ratios: z.record(z.string(), z.union([z.number(), z.string(), z.null()])).optional(),
      financials: z.record(z.string(), z.union([z.number(), z.string(), z.null()])).optional(),
      alerts: z.array(z.string()).max(20).optional(),
    })
    .optional(),
});

export const askYourNumbers = createServerFn({ method: "POST" })
  .inputValidator((input) => InputSchema.parse(input))
  .handler(async () => {
    throw new Error(
      "askYourNumbers is deprecated. Use the ask-ai edge function via the chat widget instead.",
    );
  });
