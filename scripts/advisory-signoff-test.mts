/**
 * One advisory sign-off. The pack version is the status the tab, the PDF,
 * and the Bot all read. A page-level advisory stamp is a mismatch sentence,
 * never a signed pack.
 * Run: pnpm test:advisory-signoff
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  advisoryLegacyMismatchLine,
  advisorySignoffLine,
  getAdvisorySignoffState,
  resolveAdvisorySignoffState,
  type AdvisorySignoffDb,
  type AdvisorySignoffQuery,
} from "../src/lib/advisory-signoff";

function assert(cond: boolean, msg: string) {
  if (!cond) throw new Error(msg);
}

const us = { locale: "en-US", timezone: "America/New_York" };

const draft = resolveAdvisorySignoffState({
  version: null,
  packStatus: null,
  zone: "America/New_York",
});
assert(draft.status === "draft" && draft.version === null, "no pack is a draft with no version");
assert(draft.signedBy === null && draft.signedAt === null, "a draft has no signer");
assert(draft.zone === "America/New_York", "zone is the practice zone");

const review = resolveAdvisorySignoffState({
  version: 12,
  packStatus: "in_review",
  signedBy: "James Fleming",
  firmName: "Ben Accountants",
  signedAt: "2026-10-08T12:19:00.000Z",
  zone: "America/New_York",
});
assert(review.status === "in_review" && review.version === 12, "in review stays in review");
assert(
  review.signedBy === null && review.firmName === null && review.signedAt === null,
  "an unsigned pack drops signer fields",
);

const signed = resolveAdvisorySignoffState({
  version: 12,
  packStatus: "approved",
  figuresChanged: false,
  signedBy: "James Fleming",
  firmName: "Ben Accountants",
  signedAt: "2026-10-08T12:19:00.000Z",
  reviewedByKind: "accountant",
  zone: "America/New_York",
});
assert(signed.status === "signed", "approved pack is signed");
assert(
  signed.signedBy === "James Fleming" && signed.firmName === "Ben Accountants",
  "signed names the accountant",
);
assert(signed.signedAt === "2026-10-08T12:19:00.000Z", "signed keeps the timestamp");

const stale = resolveAdvisorySignoffState({
  version: 12,
  packStatus: "approved",
  figuresChanged: true,
  signedBy: "James Fleming",
  firmName: "Ben Accountants",
  signedAt: "2026-10-08T12:19:00.000Z",
  reviewedByKind: "accountant",
  zone: "America/New_York",
});
assert(stale.status === "signed_stale", "moved figures stay signed_stale, not draft");
assert(stale.signedBy === "James Fleming", "a stale sign-off keeps the signer");
const staleLine = advisorySignoffLine(stale, us);
assert(staleLine?.includes("James Fleming") === true, "stale line names the signer");
assert(
  staleLine?.includes("figures have changed since") === true,
  "stale line says the figures moved",
);
assert(!staleLine?.toLowerCase().includes("draft"), "stale line is not a plain draft");

assert(
  resolveAdvisorySignoffState({ version: 3, packStatus: "changes_requested" }).status === "draft",
  "changes requested is not a sign-off",
);
assert(
  resolveAdvisorySignoffState({ version: 3, packStatus: "rejected" }).status === "draft",
  "rejected is not a sign-off",
);

const mismatch = advisoryLegacyMismatchLine({
  status: "in_review",
  version: 12,
  pageSignedAt: "2026-10-08T12:19:00.000Z",
  pageSignedBy: "James Fleming",
  pageFirmName: "Ben Accountants",
  market: us,
});
assert(
  mismatch ===
    "Advisory signed off Oct 8 by James Fleming, but pack v12 isn't signed; sign off v12",
  `mismatch copy: ${mismatch}`,
);
assert(
  advisoryLegacyMismatchLine({
    status: "signed",
    version: 12,
    pageSignedAt: "2026-10-08T12:19:00.000Z",
    pageSignedBy: "James Fleming",
  }) === null,
  "a signed pack does not also show the page stamp",
);
assert(
  advisoryLegacyMismatchLine({
    status: "draft",
    version: null,
    pageSignedAt: "2026-10-08T12:19:00.000Z",
    pageSignedBy: "James Fleming",
    market: us,
  })?.includes("no pack is on file") === true,
  "a page stamp with no pack says there is no pack",
);
assert(
  advisoryLegacyMismatchLine({
    status: "in_review",
    version: 12,
    pageSignedAt: "2026-10-08T12:19:00.000Z",
    pageSignedBy: "A. Sample",
    pageFirmName: "Sample Practice",
  }) === null,
  "a sample page stamp is not shown as a sign-off",
);

function fakeDb(
  tables: Record<string, Record<string, unknown>[]>,
): AdvisorySignoffDb & { seen: string[] } {
  const seen: string[] = [];
  return {
    seen,
    from(table: string) {
      seen.push(table);
      let rows = [...(tables[table] ?? [])];
      const query = {
        select() {
          return query;
        },
        eq(column: string, value: string) {
          rows = rows.filter((row) => row[column] === value);
          return query;
        },
        in() {
          return query;
        },
        order() {
          return query;
        },
        limit(count: number) {
          rows = rows.slice(0, count);
          return query;
        },
        maybeSingle: async () => ({ data: rows[0] ?? null, error: null }),
        then(onfulfilled: (value: { data: unknown; error: null }) => unknown) {
          return Promise.resolve({ data: rows, error: null }).then(onfulfilled);
        },
      };
      return query as AdvisorySignoffQuery;
    },
  };
}

const clientId = "3cc31b6a-10a6-4202-bec7-ebb32a4e1f7a";
const basePack = {
  id: "pack-1",
  client_id: clientId,
  version: 12,
  requires_review: true,
  period_label: "Oct 2026",
  generator: "rules",
  ai_draft: {},
  edit_stats: null,
  generated_at: "2026-10-08T12:00:00.000Z",
  reviewed_by: "user-1",
  reviewed_by_kind: "accountant",
  reviewed_at: "2026-10-08T12:19:00.000Z",
  meta: {},
  created_at: "2026-10-08T12:00:00.000Z",
  updated_at: "2026-10-08T12:19:00.000Z",
};

const quietContent = {
  sections: [{ key: "forecast", title: "Forecast", body: "Not enough data to call a runway." }],
};

const usClient = {
  id: clientId,
  firm_id: "firm-1",
  financials: null,
  cashflow: null,
  financials_updated_at: null,
  market: { country: "US", regionCode: "NY" },
  operating_profile: null,
};

const inReviewDb = fakeDb({
  advisory_packs: [{ ...basePack, status: "in_review", content: quietContent, reviewed_at: null }],
  clients: [usClient],
  client_financial_snapshots: [],
  firms: [{ id: "firm-1", name: "Ben Accountants" }],
  profiles: [{ id: "user-1", full_name: "James Fleming", email: "james@example.com" }],
  client_review_signoffs: [
    { client_id: clientId, scope: "advisory", signed_off_by_name: "James Fleming" },
  ],
});
const inReview = await getAdvisorySignoffState(clientId, inReviewDb);
assert(inReview.status === "in_review" && inReview.version === 12, "helper reads the open pack");
assert(inReview.signedBy === null, "helper does not treat a page stamp as signed");
assert(inReview.zone === "America/New_York", `zone: ${inReview.zone}`);
assert(
  !inReviewDb.seen.includes("client_review_signoffs"),
  "helper does not read the page-level table",
);

const signedDb = fakeDb({
  advisory_packs: [{ ...basePack, status: "approved", content: quietContent }],
  clients: [usClient],
  client_financial_snapshots: [],
  firms: [{ id: "firm-1", name: "Ben Accountants" }],
  profiles: [{ id: "user-1", full_name: "James Fleming", email: "james@example.com" }],
});
const signedState = await getAdvisorySignoffState(clientId, signedDb);
assert(signedState.status === "signed", `matching pack is signed, got ${signedState.status}`);
assert(signedState.signedBy === "James Fleming", "helper names the profile");
assert(signedState.firmName === "Ben Accountants", "helper names the firm");
assert(signedState.signedAt === "2026-10-08T12:19:00.000Z", "helper returns reviewed_at");
assert(signedState.version === 12, "helper returns the pack version");

const staleDb = fakeDb({
  advisory_packs: [
    {
      ...basePack,
      status: "approved",
      content: {
        sections: [{ key: "forecast", title: "Forecast", body: "Cash is fine." }],
        forecast: { openingBalance: 128450 },
      },
    },
  ],
  clients: [usClient],
  client_financial_snapshots: [],
  firms: [{ id: "firm-1", name: "Ben Accountants" }],
  profiles: [{ id: "user-1", full_name: "James Fleming", email: "james@example.com" }],
});
const staleState = await getAdvisorySignoffState(clientId, staleDb);
assert(staleState.status === "signed_stale", `drift is signed_stale, got ${staleState.status}`);
assert(staleState.signedBy === "James Fleming", "stale helper keeps the signer");

const none = await getAdvisorySignoffState(
  clientId,
  fakeDb({ advisory_packs: [], clients: [usClient], client_financial_snapshots: [] }),
);
assert(none.status === "draft" && none.version === null, "no row is a draft");

const clientSrc = readFileSync(resolve("src/routes/_authenticated/clients.$clientId.tsx"), "utf8");
assert(clientSrc.includes("AdvisoryTabSignoff"), "the advisory tab head uses the pack sign-off");
assert(clientSrc.includes("onSignoffAction={setPackSignoff}"), "the tab button signs the pack");
assert(
  !/id="pane-advisory"[\s\S]{0,900}scope="advisory"/.test(clientSrc),
  "the advisory tab no longer writes a separate page stamp",
);

const panelSrc = readFileSync(resolve("src/components/advisory-pack-panel.tsx"), "utf8");
assert(
  panelSrc.includes("headerOwnsSignOff"),
  "the pack hides its button when the tab head owns sign-off",
);
assert(
  panelSrc.includes("data-advisory-signoff={advisoryState.status}"),
  "the pack publishes the same status",
);
assert(panelSrc.includes("packDisplayedSignoffLine"), "a stale approval still shows the signer");

const tabSrc = readFileSync(resolve("src/components/advisory-tab-signoff.tsx"), "utf8");
assert(tabSrc.includes("SIGNOFF_GOLD_BTN"), "one gold primary");
assert(tabSrc.includes("data-advisory-mismatch"), "a leftover page stamp is shown as a mismatch");
assert(tabSrc.includes("data-approve"), "the gold button approves the pack");
assert(!tabSrc.includes("SIGNED OFF"), "the tab does not paint a bare SIGNED badge");

console.log("advisory-signoff-test: ok");
