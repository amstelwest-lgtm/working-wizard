/**
 * Soft-archive a practice client. Sets active=false, hides them from active
 * lists, and does not delete the row.
 * Run: pnpm test:archive-client
 */
import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { RemoveClientDialog } from "../src/components/client-file-settings";
import { forgetPaintedBooks, readPaintedBook, rememberPaintedBook } from "../src/lib/practice-book-cache.ts";
import {
  ACTIVE_CLIENTS_OR,
  archiveClient,
  isActiveClient,
  removeClientConfirm,
  visibleActiveClients,
} from "../src/lib/archive-client.ts";

function assert(cond: unknown, msg: string) {
  if (!cond) throw new Error(msg);
}

const COPY = "Removes Northwind from your practice. Data kept; you can restore from Archived.";
assert(
  removeClientConfirm("Northwind") === COPY,
  "confirm copy names the client and keeps the data",
);
assert(removeClientConfirm("  ").includes("this client"), "a blank name still has a label");
assert(!COPY.toLowerCase().includes("delete"), "the confirm copy is not a delete");

assert(isActiveClient({ active: true }) === true, "active clients stay");
assert(isActiveClient({ active: null }) === true, "a null flag stays visible");
assert(isActiveClient({}) === true, "a missing flag stays visible");
assert(isActiveClient({ active: false }) === false, "archived clients drop out");

const visible = visibleActiveClients([
  { id: "live", active: true },
  { id: "archived", active: false },
  { id: "legacy", active: null },
]).map((row) => row.id);
assert(visible.join(",") === "live,legacy", "the active list hides archived rows");
rememberPaintedBook("archive-user", "archive-firm", [{ id: "archived" }]);
forgetPaintedBooks();
assert(readPaintedBook("archive-user", "archive-firm") === null, "archive drops the painted active list");
assert(ACTIVE_CLIENTS_OR === "active.is.null,active.eq.true", "the query keeps null and true");

const calls: string[] = [];
await archiveClient("11111111-1111-4111-8111-111111111111", {
  from(table) {
    calls.push(`from:${table}`);
    return {
      update(patch) {
        assert(patch.active === false, "archive sets active=false");
        calls.push("update");
        return {
          eq(column, value) {
            calls.push(`eq:${column}:${value}`);
            return {
              async select(columns) {
                calls.push(`select:${columns}`);
                return { data: [{ id: value }], error: null };
              },
            };
          },
        };
      },
    };
  },
});
assert(calls.includes("from:clients"), "archive writes the clients row");
assert(calls.includes("update"), "archive is an update");
assert(!calls.some((call) => call.includes("delete")), "archive does not delete");

let deleted = false;
await archiveClient("abc", {
  from() {
    return {
      update() {
        return {
          eq() {
            return {
              async select() {
                return { data: [], error: null };
              },
            };
          },
        };
      },
      delete() {
        deleted = true;
        return Promise.resolve({ error: null });
      },
    };
  },
}).then(
  () => {
    throw new Error("a missed update must not look successful");
  },
  (err: unknown) => {
    assert(err instanceof Error && err.message === "Could not remove this client", String(err));
  },
);
assert(deleted === false, "a missed update still does not delete");

const dialog = renderToStaticMarkup(
  createElement(RemoveClientDialog, {
    clientName: "Northwind",
    open: true,
    onConfirm: () => {},
    onClose: () => {},
  }),
);
assert(dialog.includes('data-remove-client-dialog=""'), "confirm is a dialog");
assert(dialog.includes(COPY), "the dialog shows the confirm copy");
assert(dialog.includes('data-remove-client-confirm=""'), "confirm is an explicit action");
assert(!dialog.toLowerCase().includes("permanently"), "the dialog does not describe a hard delete");

const closed = renderToStaticMarkup(
  createElement(RemoveClientDialog, {
    clientName: "Northwind",
    open: false,
    onConfirm: () => {},
    onClose: () => {},
  }),
);
assert(closed === "", "a closed confirm renders nothing");

const read = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const archiveSrc = read("src/lib/archive-client.ts");
assert(!archiveSrc.includes(".delete("), "the archive module has no delete call");
assert(archiveSrc.includes("active: false"), "the archive module sets active=false");

const migration = read("supabase/migrations/20261102120000_clients_active.sql");
assert(
  migration.includes("ADD COLUMN IF NOT EXISTS active boolean NOT NULL DEFAULT true"),
  "the migration adds clients.active",
);
assert(!/DELETE FROM\s+public\.clients/i.test(migration), "the migration does not delete clients");
assert(migration.includes("CoS applies this file"), "CoS is told to apply the migration");

for (const path of [
  "src/components/practice-board.tsx",
  "src/lib/portfolio.functions.ts",
  "src/lib/firm-client-list.ts",
  "src/lib/practice-access.functions.ts",
  "src/lib/firm-client-gate.ts",
  "src/lib/smart-landing.server.ts",
  "src/routes/_authenticated/reports-studio.tsx",
  "src/routes/_authenticated/settings.brand.tsx",
  "src/routes/_authenticated/settings.index.tsx",
]) {
  assert(read(path).includes("onlyActiveClients"), `${path} hides archived clients`);
}

for (const path of [
  "src/lib/firm-client-cap.server.ts",
  "src/lib/firm-client-create.server.ts",
  "src/lib/firm-billing-open.server.ts",
]) {
  const src = read(path);
  assert(src.includes("isActiveClient"), `${path} drops archived clients from the active book`);
  assert(src.includes("active"), `${path} reads the active flag`);
}

const settings = read("src/components/client-file-settings.tsx");
assert(settings.includes("Remove client"), "Client Settings has Remove client");
assert(settings.includes("removeClientConfirm"), "Client Settings uses the confirm copy");
assert(!settings.includes(".delete("), "Client Settings does not delete");

const host = read("src/components/client-owner-invite-dialog.tsx");
assert(host.includes("archiveClient(clientId)"), "confirm archives the open client");
assert(host.includes('to: "/clients"'), "the client leaves the open file for the active list");
assert(host.includes("forgetPaintedBooks"), "the painted book does not keep the archived client");
assert(!host.includes('.from("clients").delete'), "the settings host does not delete the client");

console.log("archive-client-test: ok");
