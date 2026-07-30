// server.ts
// Minimal Express server exposing POST /api/extract-financials.
// This is the easy Replit-runnable version. If you're wiring this into your
// TanStack Start app instead, see the note at the bottom — the core logic
// (extractFinancials + validateFigures) is framework-agnostic and stays the same.

import express from "express";
import cors from "cors";
import { extractFinancials } from "./lib/extractFinancials";
import { validateFigures, isClean } from "./lib/validateFinancials";

const app = express();

// Financial statement PDFs are small, but base64 inflates size ~33%.
// 25mb covers virtually all AFS. Bigger files should use Gemini's File API.
app.use(express.json({ limit: "25mb" }));
app.use(cors()); // tighten to your app's origin in production

app.post("/api/extract-financials", async (req, res) => {
  try {
    const { pdfBase64, mimeType } = req.body ?? {};

    if (!pdfBase64 || typeof pdfBase64 !== "string") {
      return res.status(400).json({ error: "pdfBase64 (string) is required." });
    }

    // 1. Extract with Gemini.
    const data = await extractFinancials({ pdfBase64, mimeType });

    // 2. Validate the current period arithmetic.
    const issues = validateFigures(data.current_period.figures);

    // 3. Return everything — the client shows figures + issues for human sign-off.
    return res.json({
      data,
      issues,
      autoImportSafe: isClean(issues), // false => a human MUST review before import
    });
  } catch (err) {
    console.error("extract-financials failed:", err);
    return res
      .status(500)
      .json({ error: "Extraction failed. " + (err as Error).message });
  }
});

const PORT = process.env.PORT ? Number(process.env.PORT) : 3000;
app.listen(PORT, () => {
  console.log(`Financial extraction API listening on :${PORT}`);
});

/*
-------------------------------------------------------------------------------
Wiring into TanStack Start / Cloudflare Workers instead of Express
-------------------------------------------------------------------------------
The two files under /lib have no Express dependency. In TanStack Start, create a
server route (or server function) and call them directly:

  // app/routes/api/extract-financials.ts  (illustrative)
  import { json } from "@tanstack/start";
  import { extractFinancials } from "~/lib/extractFinancials";
  import { validateFigures, isClean } from "~/lib/validateFinancials";

  export const POST = async ({ request }) => {
    const { pdfBase64, mimeType } = await request.json();
    const data = await extractFinancials({ pdfBase64, mimeType });
    const issues = validateFigures(data.current_period.figures);
    return json({ data, issues, autoImportSafe: isClean(issues) });
  };

On Cloudflare Workers the @google/genai SDK works over fetch, so the same two
functions run unchanged — just read GEMINI_API_KEY from the Worker env binding
instead of process.env.
-------------------------------------------------------------------------------
*/
