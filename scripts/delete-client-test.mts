/**
 * Hard-delete a practice client. Soft-archive stays the reversible Remove path.
 * Run: pnpm test:delete-client
 */
import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { DeleteClientDialog } from "../src/components/client-file-settings";
import {
  DELETE_PERMANENTLY_PHRASE,
  deleteClientConfirm,
  deleteClientPermanently,
  deleteConfirmExpected,
  deleteConfirmMatches,
} from "../src/lib/delete-client.ts";

function assert(cond: unknown, msg: string) {
  if (!cond) throw new Error(msg);
}

const COPY =
  "Permanently deletes Northwind from the firm, including memberships, books, packs, and files. This cannot be undone.";
assert(deleteClientConfirm("Northwind") === COPY, "confirm copy names the client and says it cannot be undone");
assert(deleteClientConfirm("  ").includes("this client"), "a blank name still has a label");
assert(COPY.toLowerCase().includes("permanently"), "the copy says the delete is permanent");
assert(COPY.toLowerCase().includes("cannot be undone"), "the copy says the delete is irreversible");
assert(deleteConfirmExpected("Northwind") === "Northwind", "the typed confirm is the client name");
assert(
  deleteConfirmExpected("  ") === DELETE_PERMANENTLY_PHRASE,
  "a blank name uses the explicit phrase",
);
assert(deleteConfirmMatches("northwind", "Northwind"), "the name match ignores case and surrounding space");
assert(!deleteConfirmMatches("North", "Northwind"), "a partial name does not confirm");
assert(
  deleteConfirmMatches("delete permanently", ""),
  "a blank client name confirms with Delete permanently",
);

const calls: string[] = [];
await deleteClientPermanently("11111111-1111-4111-8111-111111111111", "Northwind", "Northwind", {
  async rpc(fn, args) {
    calls.push(`${fn}:${args.p_client_id}:${args.p_confirm}`);
    return { data: args.p_client_id, error: null };
  },
});
assert(
  calls.join(",") ===
    "delete_practice_client:11111111-1111-4111-8111-111111111111:Northwind",
  "delete calls the practice-client RPC with the typed name",
);

let called = false;
await deleteClientPermanently("abc", "nope", "Northwind", {
  async rpc() {
    called = true;
    return { data: "abc", error: null };
  },
}).then(
  () => {
    throw new Error("a mismatched name must not delete");
  },
  (err: unknown) => {
    assert(err instanceof Error && err.message === "Type the client name to confirm", String(err));
  },
);
assert(called === false, "a mismatched name never calls the RPC");

await deleteClientPermanently("abc", "Northwind", "Northwind", {
  async rpc() {
    return { data: null, error: { message: "You cannot delete this client" } };
  },
}).then(
  () => {
    throw new Error("a refused delete must not look successful");
  },
  (err: unknown) => {
    assert(err instanceof Error && err.message === "You cannot delete this client", String(err));
  },
);

const dialog = renderToStaticMarkup(
  createElement(DeleteClientDialog, {
    clientName: "Northwind",
    open: true,
    onConfirm: () => {},
    onClose: () => {},
  }),
);
assert(dialog.includes('data-delete-client-dialog=""'), "delete confirm is a dialog");
assert(dialog.includes(COPY), "the dialog shows the irreversible copy");
assert(dialog.includes('data-delete-client-name=""'), "the dialog asks for the client name");
assert(dialog.includes("Delete permanently"), "the confirm action is explicit");
assert(dialog.includes("disabled"), "confirm stays off until the name matches");

const closed = renderToStaticMarkup(
  createElement(DeleteClientDialog, {
    clientName: "Northwind",
    open: false,
    onConfirm: () => {},
    onClose: () => {},
  }),
);
assert(closed === "", "a closed delete confirm renders nothing");

const read = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const migration = read("supabase/migrations/20261102143000_delete_practice_client.sql");
assert(migration.includes("delete_practice_client"), "the migration names the delete function");
assert(migration.includes("is_client_writer"), "only a writer can delete");
assert(migration.includes("DELETE FROM public.clients"), "the function deletes the client row");
assert(migration.includes("ON DELETE CASCADE") === false, "cascade stays on the existing foreign keys");
assert(migration.includes("CoS applies this file"), "CoS is told to apply the migration");
assert(migration.includes("storage.objects"), "files keyed by the client are removed with the row");

const settings = read("src/components/client-file-settings.tsx");
assert(settings.includes("Remove client"), "soft Remove stays");
assert(settings.includes("Delete permanently"), "hard Delete sits with Remove");
assert(settings.includes("deleteConfirmMatches"), "the button waits for the typed name");

const host = read("src/components/client-owner-invite-dialog.tsx");
assert(host.includes("deleteClientPermanently(clientId, typedName, clientName)"), "confirm deletes the open client");
assert(host.includes('to: "/clients"'), "a deleted client leaves the open file");
assert(host.includes("forgetPaintedBooks"), "the painted book does not keep a deleted client");
assert(host.includes("archiveClient(clientId)"), "Remove still soft-archives");

console.log("delete-client-test: ok");
