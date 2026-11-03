/**
 * Library ingest and the bot read of that content.
 * Run: pnpm test:library-document-read
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { libraryDocBody } from "../src/lib/agent-shared-reads.ts";
import { askAiSessionTools } from "../src/lib/ask-ai-analyst-tools.ts";
import { parseFigureProposalArgs } from "../src/lib/figure-proposal.ts";
import {
  buildLibraryRead,
  figureDraftsFromLibraryRead,
  libraryHasReadableContent,
  libraryMetaPatch,
  libraryReadPending,
  sealLibraryReadForStorage,
} from "../src/lib/library-document-read.ts";
import { executeSharedDeliverableRead } from "../supabase/functions/_shared/agent-shared-reads.ts";
import { BOT_TOOLS } from "../supabase/functions/milon-bot/logic.ts";

function assert(cond: unknown, msg: string) {
  if (!cond) throw new Error(msg);
}

const CSV = `Date,Description,Debit,Credit,Balance
02/01/2026,Card payment,120.50,,4379.50
03/01/2026,Customer receipt,,2000.00,6379.50
`;

{
  const read = buildLibraryRead({
    text: CSV,
    fileName: "jan-statement.csv",
    documentType: "bank_statement",
  });
  assert(read.status === "read", "a csv bank statement is read");
  assert(read.statement?.transaction_count === 2, "both transactions are kept");
  assert(read.statement?.money_in === 2000, "money in is the credit");
  assert(read.statement?.money_out === 120.5, "money out is the debit");
  assert(read.statement?.closing_balance === 6379.5, "closing balance is the last running balance");
  assert(read.statement?.period_start === "2026-01-02", "the first date is day-first");
  const drafts = figureDraftsFromLibraryRead(read, "jan-statement.csv");
  const cash = drafts.find((row) => row.surface === "cash");
  assert(cash?.applied === false && cash.requires_human_approval === true, "the cash draft is not applied");
  const parsed = parseFigureProposalArgs({
    surface: cash?.surface,
    reason: cash?.reason,
    patch: cash?.patch,
  });
  assert(parsed.ok, "the cash draft matches the confirm tool");
  if (parsed.ok) assert(parsed.patch.openingBalance === "6379.5", "opening cash is the closing balance");
}

{
  const prose = buildLibraryRead({
    text: "02 Jan 2026  WOOLWORTHS  120.50  4,379.50\n03 Jan 2026  CUSTOMER  2,000.00  6,379.50\n",
    fileName: "statement.pdf",
    documentType: "bank_statement",
  });
  assert(prose.statement?.transaction_count === 2, "a text-layer statement keeps the rows");
  assert(prose.statement?.transactions[0].amount === -120.5 || prose.statement?.transactions[0].amount === 120.5, "the row amount is numeric");
}

{
  const accounts = buildLibraryRead({
    text: "Revenue          100000\nCost of sales    40000\nNet profit       20000\n",
    fileName: "management-accounts.pdf",
    documentType: "management_accounts",
  });
  assert(accounts.status === "read" && accounts.statement == null, "a profit-and-loss file is text, not a bank list");
  const waterfall = figureDraftsFromLibraryRead(accounts, "management-accounts.pdf").find(
    (row) => row.surface === "waterfall",
  );
  assert(waterfall?.patch.revenue === 100000 && waterfall.patch.cogs === 40000, "labelled figures become a waterfall draft");
  assert(waterfall?.applied === false, "the waterfall draft is not applied");
}

{
  const empty = buildLibraryRead({ text: "   ", fileName: "scan.pdf" });
  assert(empty.status === "unreadable" && empty.text == null, "a blank scan is not claimed as read");
  assert(figureDraftsFromLibraryRead(empty, "scan.pdf").length === 0, "an unread file has no figure draft");
}

{
  const sealed = sealLibraryReadForStorage(
    buildLibraryRead({
      text: "Date,Description,Amount,Balance\n2026-01-02,Account 123456789012,50.00,100.00\n2026-01-03,Rent,-10.00,90.00\n",
      documentType: "bank_statement",
      fileName: "bank.csv",
    }),
  );
  assert(sealed.text?.includes("[ACCOUNT]"), "an account number is not stored for the bot");
  assert(sealed.statement?.transactions.some((row) => row.description.includes("[ACCOUNT]")), "the transaction line is sealed");
  assert(sealed.text?.includes("50.00") || sealed.statement?.money_in === 50, "the amount stays");
}

{
  const read = buildLibraryRead({ text: CSV, documentType: "bank_statement", fileName: "jan.csv" });
  const patched = libraryMetaPatch(
    { file_name: "jan.csv", summary: "We couldn't read enough figures from this file to be useful." },
    read,
    "2026-11-03T00:00:00.000Z",
  );
  assert(patched.read_status === "read", "meta records that the file was read");
  assert(libraryHasReadableContent(patched), "the patched meta is readable");
  assert(!libraryReadPending(patched), "a finished read is not pending");
  assert(
    typeof patched.summary === "string" && !/couldn.t read enough/i.test(patched.summary),
    "a failed financials note is replaced by the statement summary",
  );
  const kept = libraryMetaPatch({ summary: "March pack from the client." }, read, "2026-11-03T00:00:00.000Z");
  assert(kept.summary === "March pack from the client.", "a useful library note stays");
  const body = libraryDocBody(
    { id: "a1", meta: patched, kind: "upload", created_at: "2026-11-03T00:00:00.000Z" },
    "artifact",
  );
  assert(body.read === true, "the tool says the file has been read");
  assert(typeof body.content === "string" && body.content.includes("Customer receipt"), "the tool returns the statement text");
  const statement = body.statement as { transaction_count: number };
  assert(statement.transaction_count === 2, "the tool returns the transactions");
  assert(!("storage_path" in body), "the tool does not return a storage path");
  const unread = libraryDocBody({ id: "a2", meta: { file_name: "scan.pdf" }, kind: "upload" }, "artifact");
  assert(unread.read === false, "a file with no extract is not marked read");
}

{
  const source = libraryDocBody(
    {
      id: "s1",
      mime: "application/pdf",
      status: "extracted",
      doc_type: "bank_statement",
      extraction: {
        doc_type: "bank_statement",
        line_items: [
          { description: "Card", amount: -40 },
          { description: "Invoice paid", amount: 800 },
        ],
        fields: { is_statement: { value: true } },
      },
    },
    "source",
  );
  assert(source.read === true, "an extracted bank statement source is read");
  const statement = source.statement as { money_in: number; money_out: number };
  assert(statement.money_in === 800 && statement.money_out === 40, "source lines are cash context without a bill proposal");
}

type Bucket = { data: unknown; error?: { message: string; code?: string } | null };

function fakeDb(tables: Record<string, Bucket>) {
  function chain(table: string) {
    const bucket = tables[table] ?? { data: [], error: { code: "42P01", message: "relation does not exist" } };
    const q = {
      select: () => q,
      eq: () => q,
      in: () => q,
      order: () => q,
      limit: () => q,
      is: () => q,
      maybeSingle: async () => {
        const rows = Array.isArray(bucket.data) ? bucket.data : [];
        return { data: rows[0] ?? null, error: bucket.error ?? null };
      },
      then: (resolve: (value: unknown) => unknown, reject?: (reason: unknown) => unknown) =>
        Promise.resolve({ data: bucket.data, error: bucket.error ?? null }).then(resolve, reject),
    };
    return q;
  }
  return { from: (table: string) => chain(table) };
}

{
  const id = "11111111-1111-4111-8111-111111111111";
  const tables: Record<string, Bucket> = {
    client_artifacts: {
      data: [{ id, kind: "upload", meta: { file_name: "pending.csv" }, visibility: "shared", created_at: "2026-11-03" }],
    },
  };
  let prepared = 0;
  const db = fakeDb(tables);
  const first = await executeSharedDeliverableRead(
    "get_client_library_doc",
    { id, origin: "artifact" },
    {
      db: db as never,
      clientId: "client-1",
      prepareLibraryArtifact: async () => {
        prepared += 1;
        tables.client_artifacts = {
          data: [
            {
              id,
              kind: "upload",
              meta: libraryMetaPatch(
                { file_name: "pending.csv" },
                buildLibraryRead({ text: CSV, documentType: "bank_statement", fileName: "pending.csv" }),
                "2026-11-03T00:00:00.000Z",
              ),
              visibility: "shared",
              created_at: "2026-11-03",
            },
          ],
        };
      },
    },
  );
  const file = (first as { file: { read: boolean; content: string } }).file;
  assert(prepared === 1, "the tool reads a pending upload by ingesting it");
  assert(file.read === true && file.content.includes("Customer receipt"), "the tool returns the ingested statement");

  const second = await executeSharedDeliverableRead(
    "get_client_library_doc",
    { id, origin: "artifact" },
    { db: fakeDb(tables) as never, clientId: "client-1", prepareLibraryArtifact: async () => { prepared += 1; } },
  );
  assert(prepared === 1, "a file that is already read is not ingested again");
  assert((second as { file: { read: boolean } }).file.read === true, "the second read still has the body");
}

{
  assert(BOT_TOOLS.includes("list_client_library") && BOT_TOOLS.includes("get_client_library_doc"), "milon-bot can list and read the library");
  const tax = askAiSessionTools("tax_specialist");
  assert(tax.length === 0, "the tax specialist chat does not gain library tools");
  const analyst = askAiSessionTools("analyst").map((tool) => tool.name);
  assert(analyst.includes("get_inbox") && analyst.includes("get_client_library_doc"), "the analyst keeps messaging and can read the library");
  const manager = askAiSessionTools("financial_manager").map((tool) => tool.name);
  assert(
    manager.includes("get_client_library_doc") && manager.includes("propose_figure_adjustment"),
    "the financial manager can read a file and propose",
  );
  assert(!manager.includes("send_agent_message"), "library tools do not add analyst messaging to the financial manager");
  const advisor = askAiSessionTools("advisor").map((tool) => tool.name);
  const plain = askAiSessionTools(null).map((tool) => tool.name);
  assert(
    advisor.includes("list_client_library") && plain.includes("get_client_library_doc"),
    "the advisor and the numbers chat can read the library",
  );
  assert(!advisor.includes("propose_figure_adjustment"), "the advisor cannot propose from this chat");
}

{
  const edge = readFileSync(resolve("supabase/functions/_shared/library-ingest.ts"), "utf8");
  const http = readFileSync(resolve("supabase/functions/ingest-library-document/index.ts"), "utf8");
  assert(edge.includes("CLAUDE_MODEL"), "statement vision uses CLAUDE_MODEL");
  assert(edge.includes("unpdf"), "pdf text uses the text layer first");
  assert(!edge.includes("figure_proposals") && !http.includes("ledger_post"), "ingest does not write a proposal or a ledger");
  assert(http.includes("has_client_access"), "a signed-in caller must have client access");
  const bot = readFileSync(resolve("supabase/functions/milon-bot/index.ts"), "utf8");
  const ask = readFileSync(resolve("supabase/functions/ask-ai/index.ts"), "utf8");
  assert(bot.includes("get_client_library_doc"), "milon-bot exposes the library read");
  assert(ask.includes("askAiSessionTools"), "ask-ai exposes the library read");
  assert(ask.includes("propose_figure_adjustment"), "ask-ai can propose through the existing tool");
}

console.log("library-document-read: ok");
