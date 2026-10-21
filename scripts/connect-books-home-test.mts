/**
 * Accountant client Home connect card.
 * No ledger shows the card. A connected ledger hides it.
 * Run: pnpm test:connect-books-home
 */
import { Window } from "happy-dom";
import { beginLedgerConnect } from "../src/lib/connect-books-start.ts";
import {
  CONNECT_BOOKS_BODY,
  CONNECT_BOOKS_TITLE,
  connectBooksHomeVisible,
} from "../src/lib/connect-books-copy.ts";

function assert(cond: boolean, msg: string) {
  if (!cond) throw new Error(msg);
}

const dom = new Window({ url: "http://127.0.0.1:5000/clients/demo", width: 1280, height: 800 });
for (const key of [
  "window",
  "document",
  "HTMLElement",
  "HTMLButtonElement",
  "Node",
  "Document",
] as const) {
  Object.defineProperty(globalThis, key, {
    configurable: true,
    writable: true,
    value: dom[key as keyof Window],
  });
}
Object.defineProperty(globalThis, "IS_REACT_ACT_ENVIRONMENT", {
  configurable: true,
  writable: true,
  value: true,
});

const { createElement, act } = await import("react");
const { createRoot } = await import("react-dom/client");
const { ConnectBooksHomeCard } = await import("../src/components/connect-books-card.tsx");

function Home({
  xero,
  qbo,
  sage,
  clicks,
}: {
  xero: unknown;
  qbo: unknown;
  sage: unknown;
  clicks: string[];
}) {
  const visible = connectBooksHomeVisible({ xero, qbo, sage });
  return createElement(
    "div",
    { className: "owner-door", "data-client-home": "true", id: "pane-overview" },
    visible
      ? createElement(ConnectBooksHomeCard, {
          onXero: () => clicks.push("xero"),
          onQuickBooks: () => clicks.push("qbo"),
          onSage: () => clicks.push("sage"),
        })
      : null,
  );
}

async function paint(props: { xero: unknown; qbo: unknown; sage: unknown }) {
  const clicks: string[] = [];
  const host = document.createElement("div");
  document.body.appendChild(host);
  const root = createRoot(host);
  await act(async () => {
    root.render(createElement(Home, { ...props, clicks }));
  });
  return { host, clicks, root };
}

const none = await paint({ xero: null, qbo: null, sage: null });
const open = none.host.querySelector('[data-connect-books="home"]');
assert(Boolean(open), "no ledger shows the card on Home");
assert(
  none.host.innerHTML.includes(CONNECT_BOOKS_TITLE),
  "card title is Connect Xero or QuickBooks",
);
assert(none.host.innerHTML.includes(CONNECT_BOOKS_BODY), "card uses the read-only approval copy");
assert(
  none.host.querySelector('[data-connect-books="xero"]')?.textContent === "Xero",
  "Xero button",
);
assert(
  none.host.querySelector('[data-connect-books="quickbooks"]')?.textContent === "QuickBooks",
  "QuickBooks button",
);
assert(
  none.host.querySelector('[data-connect-books="sage"]')?.textContent === "Connect Sage",
  "Sage link",
);

await act(async () => {
  none.host.querySelector<HTMLButtonElement>('[data-connect-books="xero"]')!.click();
  none.host.querySelector<HTMLButtonElement>('[data-connect-books="quickbooks"]')!.click();
  none.host.querySelector<HTMLButtonElement>('[data-connect-books="sage"]')!.click();
});
assert(none.clicks.join(",") === "xero,qbo,sage", "one click starts each existing connect");
await act(async () => {
  none.root.unmount();
});
none.host.remove();

for (const ledgers of [
  { xero: { tenantId: "t" }, qbo: null, sage: null },
  { xero: null, qbo: { realmId: "r" }, sage: null },
  { xero: null, qbo: null, sage: { companyId: "1" } },
] as const) {
  const painted = await paint(ledgers);
  assert(
    painted.host.querySelector('[data-connect-books="home"]') == null,
    "a connected ledger hides the card on Home",
  );
  assert(painted.host.querySelector('[data-client-home="true"]'), "Home stays mounted");
  await act(async () => {
    painted.root.unmount();
  });
  painted.host.remove();
}

let went = "";
const held = await beginLedgerConnect({
  configured: async () => false,
  authUrl: async () => "https://login.example/oauth",
  go: (url) => {
    went = url;
  },
});
assert(held === "unconfigured", "unconfigured workspace does not leave Home");
assert(went === "", "unconfigured workspace does not redirect");

const started = await beginLedgerConnect({
  configured: async () => true,
  authUrl: async () => "https://login.xero.com/identity/connect/authorize?x=1",
  go: (url) => {
    went = url;
  },
});
assert(started === "redirect", "a configured connect follows the existing auth URL");
assert(went.includes("login.xero.com"), "redirect uses the URL the connect card already returns");

console.log("ok  connect books home");
