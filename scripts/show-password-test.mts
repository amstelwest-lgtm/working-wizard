/**
 * Show password stays unchecked, is labeled, and does not take focus while typing.
 *
 * Covers owner and accountant sign-in, sign-up, reset, and Settings change-password.
 * Run: pnpm test:show-password
 */
import { readFileSync } from "node:fs";
import { Window } from "happy-dom";

const PASSWORD = "Pass mex x";

process.env.SUPABASE_URL ??= "https://example.supabase.co";
process.env.SUPABASE_PUBLISHABLE_KEY ??= "test-anon-key";
process.env.VITE_SUPABASE_URL ??= process.env.SUPABASE_URL;
process.env.VITE_SUPABASE_PUBLISHABLE_KEY ??= process.env.SUPABASE_PUBLISHABLE_KEY;

function assert(cond: boolean, msg: string) {
  if (!cond) throw new Error(msg);
}

const window = new Window({
  url: "http://127.0.0.1:5000/auth",
  width: 1280,
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
  "HTMLLabelElement",
  "HTMLFormElement",
  "Element",
  "Node",
  "Document",
  "KeyboardEvent",
  "MouseEvent",
  "InputEvent",
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

const { createElement, useState } = await import("react");
const { act } = await import("react");
const { createRoot } = await import("react-dom/client");
const { ChangePasswordCard } = await import("../src/components/change-password-card");
const { LandingSignInModal } = await import("../src/components/landing/sign-in-modal");
const { LandingRegisterForm } = await import("../src/components/landing/register-form");
const { OwnerInviteSigninOverlay } = await import("../src/components/owner-invite-signin-overlay");
const { OwnerInviteSignupPanel } = await import("../src/components/owner-invite-signup-panel");
const { StaffInviteLanding } = await import("../src/components/staff-invite-landing");
const { ResetPasswordFields } = await import("../src/routes/reset-password");

type FormEventLike = { preventDefault: () => void };

async function tick() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
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

function showBox(inputId: string) {
  const input = document.getElementById(inputId);
  const box = document.getElementById(`${inputId}-show`);
  const label = document.querySelector(`label[for="${inputId}-show"]`);
  assert(input instanceof HTMLInputElement, `${inputId} is a password input`);
  assert(box instanceof HTMLInputElement, `${inputId} has a show-password checkbox`);
  assert(label instanceof HTMLLabelElement, `${inputId} show password has a label`);
  assert(label.htmlFor === box.id, `${inputId} label htmlFor points at the checkbox`);
  assert(label.textContent === "Show password", `${inputId} label text`);
  assert(box.type === "checkbox", `${inputId} control is a checkbox`);
  assert(!box.checked, `${inputId} show password starts unchecked`);
  assert(!box.disabled && box.tabIndex >= 0, `${inputId} checkbox is keyboard accessible`);
  assert(
    (input.compareDocumentPosition(box) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0,
    `${inputId} checkbox sits under the field`,
  );
  assert(input.type === "password", `${inputId} starts masked`);
  return { input, box, label };
}

async function typeMasked(input: HTMLInputElement) {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
  assert(!!setter, "input value setter exists");
  let value = "";
  for (const ch of PASSWORD) {
    value += ch;
    input.focus();
    await act(async () => {
      setter!.call(input, value);
      input.dispatchEvent(new InputEvent("input", { bubbles: true, data: ch, inputType: "insertText" }));
      input.dispatchEvent(new KeyboardEvent("keydown", { key: ch, bubbles: true, cancelable: true }));
    });
    await tick();
    assert(document.activeElement === input, `#${input.id} lost focus on ${JSON.stringify(ch)}`);
    assert(input.type === "password", `#${input.id} unmasked while typing ${JSON.stringify(ch)}`);
    assert(input.value === value, `#${input.id} value after ${JSON.stringify(ch)}`);
    const box = document.getElementById(`${input.id}-show`);
    assert(document.activeElement !== box, `#${input.id} show password took focus on ${JSON.stringify(ch)}`);
  }
}

async function toggle(input: HTMLInputElement, box: HTMLInputElement, label: HTMLLabelElement) {
  const value = input.value;
  const space = new KeyboardEvent("keydown", { key: " ", bubbles: true, cancelable: true });
  box.focus();
  box.dispatchEvent(space);
  assert(!space.defaultPrevented, `#${input.id} Space on the checkbox is not swallowed`);
  assert(document.activeElement === box, `#${input.id} checkbox keeps focus for the keyboard`);
  await act(async () => {
    label.click();
  });
  assert(box.checked, `#${input.id} label checks show password`);
  assert(input.type === "text", `#${input.id} shows the password`);
  assert(input.value === value, `#${input.id} keeps its value when revealed`);
  await act(async () => {
    box.click();
  });
  assert(!box.checked, `#${input.id} checkbox clears`);
  assert(input.type === "password", `#${input.id} masks the password again`);
  assert(input.value === value, `#${input.id} keeps its value when hidden`);
}

async function exercise(inputId: string) {
  const { input, box, label } = showBox(inputId);
  await typeMasked(input);
  await toggle(input, box, label);
}

function SignIn() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  return createElement(LandingSignInModal, {
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
    onClose: () => setEmail(""),
    onSiEmailChange: setEmail,
    onSiPasswordChange: setPassword,
    onSubmit: (event: FormEventLike) => event.preventDefault(),
    onGoogleError: () => {},
    onForgotPassword: () => {},
    onFpEmailChange: () => {},
    onForgotSubmit: (event: FormEventLike) => event.preventDefault(),
    onBackToSignIn: () => {},
    onResend: () => {},
    onCreateAccount: () => {},
  });
}

function Register({ role }: { role: string }) {
  const [password, setPassword] = useState("");
  return createElement(LandingRegisterForm, {
    inviteClientId: null,
    inviteBusiness: null,
    inviteNeedsCode: false,
    inviteIsLegacyUuid: false,
    user: null,
    regClientCode: "",
    setRegClientCode: () => {},
    regBusy: false,
    regError: "",
    showRegisterError: () => {},
    regName: "",
    setRegName: () => {},
    regEmail: "",
    setRegEmail: () => {},
    regPassword: password,
    setRegPassword: setPassword,
    regRole: role,
    setRegRole: () => {},
    regPlan: "Business owner",
    setRegPlan: () => {},
    regFirmName: "",
    setRegFirmName: () => {},
    regBusiness: "",
    setRegBusiness: () => {},
    draftMarket: { country: "ZA", regionCode: null },
    setDraftMarket: () => {},
    firmInterval: "month",
    copyMarket: { copyPack: "us" as const },
    ownerNote: "",
    handleRegister: (event: FormEventLike) => event.preventDefault(),
    goToFirmSignup: () => {},
    goToOwnerSpark: () => {},
  });
}

function Reset() {
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  return createElement(ResetPasswordFields, {
    password,
    confirm,
    onPasswordChange: setPassword,
    onConfirmChange: setConfirm,
  });
}

function OwnerSignIn() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  return createElement(OwnerInviteSigninOverlay, {
    open: true,
    onClose: () => {},
    inviteToken: "invite",
    regClientCode: "",
    siEmail: email,
    onSiEmailChange: setEmail,
    siPassword: password,
    onSiPasswordChange: setPassword,
    siBusy: false,
    siError: "",
    onSubmit: (event: FormEventLike) => event.preventDefault(),
    onGoogleError: () => {},
    copyMarket: { copyPack: "us" as const },
  });
}

function OwnerSignUp() {
  const [password, setPassword] = useState("");
  return createElement(OwnerInviteSignupPanel, {
    inviteToken: "invite",
    businessName: "Northwind",
    inviteNeedsCode: false,
    inviteIsLegacyUuid: false,
    regClientCode: "",
    onRegClientCodeChange: () => {},
    regName: "",
    onRegNameChange: () => {},
    regEmail: "sam@milon.test",
    onRegEmailChange: () => {},
    regPassword: password,
    onRegPasswordChange: setPassword,
    regBusy: false,
    copyMarket: { copyPack: "us" as const },
    onSubmit: (event: FormEventLike) => event.preventDefault(),
    onSignInClick: () => {},
    onGoogleError: () => {},
  });
}

function Staff({ phase }: { phase: "signin" | "create" }) {
  const [password, setPassword] = useState("");
  return createElement(StaffInviteLanding, {
    token: "invite",
    firmName: "Northwind",
    memberName: "Sam",
    memberEmail: "sam@milon.test",
    classification: null,
    phase,
    name: "Sam",
    onNameChange: () => {},
    password,
    onPasswordChange: setPassword,
    busy: false,
    error: null,
    notice: null,
    onCreate: (event: FormEventLike) => event.preventDefault(),
    onSignIn: (event: FormEventLike) => event.preventDefault(),
    onSignOut: () => {},
    onGoogleError: () => {},
  });
}

const sources: Array<[string, string]> = [
  ["src/routes/auth.tsx", 'PasswordWithShow id="auth-password"'],
  ["src/routes/join.$token.tsx", 'PasswordWithShow id="accInvitePassword"'],
  ["src/routes/_authenticated/settings.index.tsx", "ChangePasswordCard"],
];
for (const [file, needle] of sources) {
  assert(readFileSync(file, "utf8").includes(needle), `${file} includes ${needle}`);
}

const cases = [
  ["owner and accountant sign-in modal", createElement(SignIn), ["si-password"]],
  ["owner sign-up", createElement(Register, { role: "Business owner" }), ["regPasswordField"]],
  ["accountant sign-up", createElement(Register, { role: "Accountant / Advisory firm" }), ["regPasswordField"]],
  ["reset password", createElement(Reset), ["reset-password", "reset-confirm"]],
  ["settings change password", createElement(ChangePasswordCard), ["settings-new-password", "settings-confirm-password"]],
  ["owner invite sign-in", createElement(OwnerSignIn), ["ownerInviteSiPassword"]],
  ["owner invite sign-up", createElement(OwnerSignUp), ["ownerInvitePassword"]],
  ["accountant staff sign-in", createElement(Staff, { phase: "signin" }), ["staff-invite-password"]],
  ["accountant staff sign-up", createElement(Staff, { phase: "create" }), ["staff-invite-password"]],
] as const;

for (const [label, node, ids] of cases) {
  const unmount = await mount(node);
  for (const id of ids) await exercise(id);
  await unmount();
  console.log(`show-password: ${label}`);
}

console.log("show-password: checkbox toggles type and leaves typing focus alone");
