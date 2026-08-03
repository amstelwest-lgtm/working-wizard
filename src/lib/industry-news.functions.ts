import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { GEMINI_MODEL_GATEWAY } from "@/lib/gemini-config";

export type NewsItem = {
  headline: string;
  summary: string;
  tag: string;
  tagColor: "green" | "amber" | "red" | "blue";
};

const NewsSchema = z.object({
  industry: z.string().max(120),
});

export const fetchIndustryNews = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => NewsSchema.parse(input))
  .handler(async ({ data }) => {
    const apiKey = process.env.LOVABLE_API_KEY;
    if (!apiKey) throw new Error("AI not configured");

    const today = new Date().toLocaleDateString("en-ZA", {
      day: "numeric",
      month: "long",
      year: "numeric",
    });

    const prompt = `You are a South African business intelligence assistant. Today is ${today}.

Identify the 3 most relevant and recent news items for a South African SME operating in the "${data.industry}" sector. Consider:
- Regulatory or tax changes affecting ${data.industry} businesses in SA
- Macro conditions (interest rates, rand exchange rate, fuel levies) that affect ${data.industry} margins
- Industry-specific trends, logistics disruptions, or notable competitor moves

Respond ONLY with a valid JSON array — no preamble, no markdown fencing, no extra text:
[
  {
    "headline": "Concise punchy headline (max 10 words)",
    "summary": "One sentence: what happened and why it matters to an SME owner.",
    "tag": "Short relevance label, e.g. Affects margins | Regulatory | Watch this | Opportunity",
    "tagColor": "green or amber or red or blue"
  }
]`;

    const res = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: GEMINI_MODEL_GATEWAY,
        messages: [{ role: "user", content: prompt }],
      }),
    });

    if (res.status === 429) throw new Error("Rate limit hit — try again in a moment.");
    if (res.status === 402) throw new Error("AI credits exhausted.");
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(`AI error (${res.status}): ${text.slice(0, 200)}`);
    }

    const json = (await res.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
    };
    const raw = json.choices?.[0]?.message?.content?.trim() ?? "";

    try {
      const clean = raw.replace(/```json|```/g, "").trim();
      const items = JSON.parse(clean) as NewsItem[];
      return { items: Array.isArray(items) ? items.slice(0, 3) : [] };
    } catch {
      return { items: [] };
    }
  });
