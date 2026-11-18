/**
 * The gate chunk may download before chrome exists. It must not render until
 * the chrome providers have mounted.
 * Run: pnpm test:shell-gate-order
 */
import { Window } from "happy-dom";

function assert(cond: boolean, msg: string) {
  if (!cond) throw new Error(msg);
}

const dom = new Window({
  url: "http://127.0.0.1:5000/clients/79c4c485-9fa7-4499-9139-e1bb7cb40649",
  settings: {
    disableJavaScriptEvaluation: true,
    disableJavaScriptFileLoading: true,
    disableCSSFileLoading: true,
  },
});
for (const key of ["window", "document", "navigator", "HTMLElement", "Node", "Element", "Document"] as const) {
  Object.defineProperty(globalThis, key, { configurable: true, writable: true, value: dom[key as keyof Window] });
}
Object.defineProperty(globalThis, "IS_REACT_ACT_ENVIRONMENT", { configurable: true, writable: true, value: true });

const { act, createElement: reactCreate } = await import("react");
const { createRoot } = await import("react-dom/client");
const { AppChromeReadyContext } = await import("../src/contexts/app-chrome-ready.tsx");
const { AuthenticatedShell, setAuthenticatedGateLoaderForTests } = await import(
  "../src/routes/_authenticated.tsx"
);

let downloads = 0;
let release: ((mod: { AuthGate: () => ReturnType<typeof reactCreate> }) => void) | null = null;
setAuthenticatedGateLoaderForTests(
  () =>
    new Promise((resolve) => {
      downloads += 1;
      release = resolve;
    }),
);

const host = document.createElement("div");
document.body.appendChild(host);
const root = createRoot(host);
const paint = (chrome: boolean) =>
  reactCreate(AppChromeReadyContext.Provider, { value: chrome }, reactCreate(AuthenticatedShell));

await act(async () => {
  root.render(paint(false));
});
await act(async () => {
  await new Promise((resolve) => setTimeout(resolve, 0));
});
assert(downloads === 1, "the gate chunk starts downloading before chrome mounts");
assert(!document.body.innerHTML.includes("data-gate"), "the gate is not rendered before chrome mounts");

release?.({ AuthGate: () => reactCreate("p", { "data-gate": "ready" }, "Gate ready") });
await act(async () => {
  await new Promise((resolve) => setTimeout(resolve, 0));
});
assert(!document.body.innerHTML.includes("data-gate"), "a resolved gate chunk still waits for chrome");

await act(async () => {
  root.render(paint(true));
});
await act(async () => {
  await new Promise((resolve) => setTimeout(resolve, 0));
});
assert(document.body.innerHTML.includes('data-gate="ready"'), "the gate renders after chrome mounts");

setAuthenticatedGateLoaderForTests(null);
await act(async () => {
  root.unmount();
});
console.log("shell-gate-order ok");
