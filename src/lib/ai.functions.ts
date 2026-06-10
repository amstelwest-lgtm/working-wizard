import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { assertClientScope } from "@/lib/assert-client-scope";

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
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => InputSchema.parse(input))
  .handler(async ({ data, context }) => {
    const apiKey = process.env.LOVABLE_API_KEY;
    if (!apiKey) throw new Error("AI not configured");

    // If a client id is provided, verify access (RLS will filter).
    // assertClientScope enforces that queries stay within the validated impersonation scope.
    assertClientScope(context.actingAsClientId, data.clientId);
    if (data.clientId) {
      const { data: client } = await context.supabase
        .from("clients")
        .select("id")
        .eq("id", data.clientId)
        .maybeSingle();
      if (!client) throw new Error("Client not accessible");
    }

    const ctx = data.context ?? {};
    const sys = `You are a sharp, concise SME CFO copilot for "${ctx.clientName ?? "the business"}".
Use the structured data provided to give grounded, specific answers. Prefer concrete numbers over generic advice.
Be direct (3–6 short sentences or a tight bullet list). If the data is missing for a question, say so plainly and suggest the one input needed.
Never fabricate numbers. Currency is the user's local currency.`;

    const user = `QUESTION: ${data.question}

BUSINESS CONTEXT (JSON):
${JSON.stringify(ctx, null, 2)}`;

    const res = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "google/gemini-2.5-flash",
        messages: [
          { role: "system", content: sys },
          { role: "user", content: user },
        ],
      }),
    });

    if (res.status === 429) throw new Error("Rate limit hit. Try again in a moment.");
    if (res.status === 402) throw new Error("AI credits exhausted — top up Lovable AI to continue.");
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(`AI error (${res.status}): ${text.slice(0, 200)}`);
    }
    const json = (await res.json()) as { choices?: Array<{ message?: { content?: string } }> };
    const answer = json.choices?.[0]?.message?.content?.trim() ?? "";
    return { answer };
  });
