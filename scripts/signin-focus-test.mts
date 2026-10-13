/**
 * Typing an email and password must not move focus onto a close button.
 *
 * The landing sign-in modal (owner homepage and accountant marketing pages)
 * re-ran its focus effect on every keystroke because `onClose` was inline.
 * That effect focused the first control, the Close button, so the password
 * field stopped accepting letters such as e, s, x, m and Space.
 *
 * Covers the owner modal, the accountant modal, and the /auth email and
 * password fields (with a closed phone drawer and a dialog close button on
 * the same document) at desktop and 390px.
 *
 * Run: pnpm test:signin-focus
 */
import { Window } from "happy-dom";

const EMAIL = "sam.example@milon.test";
const PASSWORD = "Pass mex x";

process.env.SUPABASE_URL ??= "https://example.supabase.co";
process.env.SUPABASE_PUBLISHABLE_KEY ??= "test-anon-key";
process.env.VITE_SUPABASE_URL ??= process.env.SUPABASE_URL;
process.env.VITE_SUPABASE_PUBLISHABLE_KEY ??= process.env.SUPABASE_PUBLISHABLE_KEY;

function assert(cond: boolean, msg: string) {
  if (!cond) throw new Error(msg);
}

function describe(node: Element | null) {
  if (!node) return "nothing";
  const label = node.getAttribute("aria-label");
  const id = node.id ? `#${node.id}` : "";
  return `${node.tagName}${id}${label ? `[${label}]` : ""}`;
}

const view = { width: 1280 };
const window = new Window({
  url: "http://127.0.0.1:5000/auth",
  width: view.width,
  height: 800,
  settings: {
    disableJavaScriptEvaluation: true,
    disableJavaScriptFileLoading: true,
    disableCSSFileLoading: true,
  },
});
for (const key of [
  "window",
  "document",
  "navigator",
  "HTMLElement",
  "HTMLInputElement",
  "HTMLButtonElement",
  "HTMLFormElement",
  "Element",
  "Node",
  "Document",
  "DocumentFragment",
  "KeyboardEvent",
  "MouseEvent",
  "InputEvent",
  "FocusEvent",
  "Event",
  "getComputedStyle",
  "requestAnimationFrame",
  "cancelAnimationFrame",
  "MutationObserver",
  "sessionStorage",
  "localStorage",
] as const) {
  Object.defineProperty(globalThis, key, {
    configurable: true,
    writable: true,
    value: window[key],
  });
}
Object.defineProperty(globalThis, "IS_REACT_ACT_ENVIRONMENT", {
  configurable: true,
  writable: true,
  value: true,
});
Object.defineProperty(window, "innerWidth", {
  configurable: true,
  get: () => view.width,
});

const { createElement, useState } = await import("react");
const { act } = await import("react");
const { createRoot } = await import("react-dom/client");
const { DrawerCloseButton, useAccountantDrawer } = await import("../src/components/accountant-nav");
const { AuthEntryInput } = await import("../src/components/auth-entry-shell");
const { LandingSignInModal } = await import("../src/components/landing/sign-in-modal");

type FormEventLike = { preventDefault: () => void; currentTarget: HTMLInputElement };

async function tick() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

async function typeInto(input: HTMLInputElement, text: string) {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
  assert(!!setter, "input value setter exists");
  let value = "";
  for (const ch of text) {
    value += ch;
    input.focus();
    await act(async () => {
      setter!.call(input, value);
      input.dispatchEvent(new InputEvent("input", { bubbles: true, data: ch, inputType: "insertText" }));
      input.dispatchEvent(new KeyboardEvent("keydown", { key: ch, bubbles: true }));
    });
    await tick();
    const active = document.activeElement;
    assert(
      active === input,
      `focus left #${input.id} on ${JSON.stringify(ch)} and landed on ${describe(active)}`,
    );
    assert(
      input.value === value,
      `#${input.id} value is ${JSON.stringify(input.value)} after ${JSON.stringify(ch)}`,
    );
  }
}

function modalProps(
  email: string,
  password: string,
  setEmail: (value: string) => void,
  setPassword: (value: string) => void,
  onClose: () => void,
) {
  return {
    fpMode: false,
    fpDone: false,
    fpEmail: "",
    fpBusy: false,
    siEmail: email,
    siPassword: password,
    siBusy: false,
    siError: "",
    siUnconfirmed: false,
    resendBusy: false,
    resendCooldown: 0,
    inviteClientId: null,
    regClientCode: "",
    copyMarket: { copyPack: "us" as const },
    onClose,
    onSiEmailChange: setEmail,
    onSiPasswordChange: setPassword,
    onSubmit: (event: { preventDefault: () => void }) => event.preventDefault(),
    onGoogleError: () => {},
    onForgotPassword: () => {},
    onFpEmailChange: () => {},
    onForgotSubmit: (event: { preventDefault: () => void }) => event.preventDefault(),
    onBackToSignIn: () => {},
    onResend: () => {},
    onCreateAccount: () => {},
  };
}

function OwnerSignIn() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  return createElement(
    LandingSignInModal,
    modalProps(email, password, setEmail, setPassword, () => {
      setEmail("");
    }),
  );
}

function AccountantSignIn() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  return createElement(
    LandingSignInModal,
    modalProps(email, password, setEmail, (value) => setPassword(value), () => {
      setEmail("");
      setPassword("");
    }),
  );
}

function AuthPageFields() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  useAccountantDrawer(false, () => {});
  return createElement(
    "form",
    { id: "auth-form" },
    createElement(AuthEntryInput, {
      id: "auth-email",
      type: "email",
      value: email,
      autoComplete: "username",
      onChange: (event: FormEventLike) => setEmail(event.currentTarget.value),
    }),
    createElement(AuthEntryInput, {
      id: "auth-password",
      type: "password",
      value: password,
      autoComplete: "current-password",
      onChange: (event: FormEventLike) => setPassword(event.currentTarget.value),
    }),
    createElement(
      "nav",
      { className: "deliverable-rail", "aria-label": "Accountant" },
      createElement(DrawerCloseButton, { onClose: () => {} }),
    ),
    createElement("button", { type: "button", "aria-label": "Close", className: "dialog-close" }, "×"),
  );
}

async function mount(node: ReturnType<typeof createElement>) {
  const host = document.createElement("div");
  document.body.appendChild(host);
  const root = createRoot(host);
  await act(async () => {
    root.render(node);
  });
  await tick();
  return async () => {
    await act(async () => {
      root.unmount();
    });
    host.remove();
  };
}

async function typePair(emailId: string, passwordId: string, label: string) {
  const email = document.getElementById(emailId);
  const password = document.getElementById(passwordId);
  assert(email instanceof HTMLInputElement, `${label} email field is mounted`);
  assert(password instanceof HTMLInputElement, `${label} password field is mounted`);
  email.focus();
  await tick();
  assert(
    document.activeElement === email,
    `${label} email keeps focus before typing, not ${describe(document.activeElement)}`,
  );
  await typeInto(email, EMAIL);
  password.focus();
  await tick();
  assert(
    document.activeElement === password,
    `${label} password keeps focus before typing, not ${describe(document.activeElement)}`,
  );
  await typeInto(password, PASSWORD);
  assert(email.value === EMAIL, `${label} email value`);
  assert(password.value === PASSWORD, `${label} password value`);
  assert(document.activeElement === password, `${label} focus stays in the password field`);
  const labelOf = document.activeElement?.getAttribute("aria-label");
  assert(labelOf !== "Close" && labelOf !== "Close menu", `${label} does not leave focus on a close button`);
}

async function runWidth(width: number) {
  view.width = width;
  const happy = (window as unknown as { happyDOM?: { setViewport?: (next: { width: number; height: number }) => void } })
    .happyDOM;
  happy?.setViewport?.({ width, height: 800 });
  assert(window.innerWidth === width, `viewport is ${width}px`);
  const cases = [
    ["owner sign-in modal", createElement(OwnerSignIn), "si-email", "si-password"],
    ["accountant sign-in modal", createElement(AccountantSignIn), "si-email", "si-password"],
    ["/auth", createElement(AuthPageFields), "auth-email", "auth-password"],
  ] as const;
  for (const [label, node, emailId, passwordId] of cases) {
    const unmount = await mount(node);
    await typePair(emailId, passwordId, `${label} @ ${width}px`);
    await unmount();
  }
}

await runWidth(1280);
await runWidth(390);
console.log("signin-focus: email and password keep focus");
