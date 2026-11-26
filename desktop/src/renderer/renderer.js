/* global milon */
const app = document.getElementById("app");
const drafts = new Map();
const RENDERER_TIMEOUT_MS = 25000;
let signingIn = false;
let loginEmail = "";
let loginError = "";
let lastState = null;

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text != null) node.textContent = text;
  return node;
}

function svgEl(name, attrs) {
  const node = document.createElementNS("http://www.w3.org/2000/svg", name);
  for (const [key, value] of Object.entries(attrs)) node.setAttribute(key, value);
  return node;
}

function eyeIcon(visible) {
  const svg = svgEl("svg", {
    viewBox: "0 0 24 24",
    width: "20",
    height: "20",
    fill: "none",
    stroke: "currentColor",
    "stroke-width": "1.8",
    "stroke-linecap": "round",
    "stroke-linejoin": "round",
    "aria-hidden": "true",
  });
  svg.appendChild(svgEl("path", {
    d: "M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z",
  }));
  svg.appendChild(svgEl("circle", { cx: "12", cy: "12", r: "3" }));
  if (visible) svg.appendChild(svgEl("path", { d: "M4 20L20 4" }));
  return svg;
}

function statusClass(status) {
  if (status === "needs answer") return "needs";
  return status;
}

function wordmark() {
  const logo = document.createElement("img");
  logo.className = "wordmark";
  logo.src = "./wordmark.png";
  logo.alt = "MILŌN";
  return logo;
}

function signInOrTimeout(email, password) {
  return new Promise((resolve) => {
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      console.error("[milon-desktop] sign-in name=TimeoutError code=renderer_timeout");
      resolve({ ok: false, message: "Can't reach Milōn. Check your connection and try again. (timeout)" });
    }, RENDERER_TIMEOUT_MS);
    milon.signIn(email, password).then(
      (result) => {
        if (settled) {
          if (result && result.ok) milon.getState().then((state) => render(state));
          return;
        }
        settled = true;
        clearTimeout(timer);
        resolve(result);
      },
      () => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        console.error("[milon-desktop] sign-in name=Error code=renderer_rejected");
        resolve({ ok: false, message: "Can't reach Milōn. Check your connection and try again. (network)" });
      },
    );
  });
}

function renderLogin(state) {
  const screen = el("div", "signin");
  screen.appendChild(el("div", "signin-scrim"));
  const card = el("section", "card");
  card.append(
    wordmark(),
    el("h1", null, "Sign in"),
    el("p", "lede", "Use your Milōn email and password. New files in the watched folder go to source-document intake."),
  );

  const form = el("form");
  const fields = el("fieldset");
  fields.disabled = signingIn;

  const emailLabel = el("label");
  const emailInput = Object.assign(document.createElement("input"), {
    type: "email",
    name: "email",
    autocomplete: "username",
    required: true,
    value: loginEmail,
  });
  emailInput.addEventListener("input", () => {
    loginEmail = emailInput.value;
  });
  emailLabel.append("Email", emailInput);

  const passwordLabel = el("label");
  passwordLabel.append("Password");
  const passwordField = el("div", "password-field");
  const passwordInput = Object.assign(document.createElement("input"), {
    type: "password",
    name: "password",
    autocomplete: "current-password",
    required: true,
  });
  const toggle = el("button", "eye");
  toggle.type = "button";
  toggle.setAttribute("aria-label", "Show password");
  toggle.setAttribute("aria-pressed", "false");
  toggle.appendChild(eyeIcon(false));
  toggle.addEventListener("click", () => {
    const showing = passwordInput.type === "password";
    passwordInput.type = showing ? "text" : "password";
    toggle.setAttribute("aria-pressed", showing ? "true" : "false");
    toggle.setAttribute("aria-label", showing ? "Hide password" : "Show password");
    toggle.replaceChildren(eyeIcon(showing));
  });
  passwordField.append(passwordInput, toggle);
  passwordLabel.append(passwordField);

  const forgot = el("button", "link", "Forgot password?");
  forgot.type = "button";
  forgot.addEventListener("click", async () => {
    const result = await milon.openPasswordReset();
    if (!result.ok) {
      loginError = result.message || "Password reset could not be opened.";
      console.error(`[milon-desktop] sign-in stage=password-reset message=${loginError}`);
      render(lastState || state);
    }
  });

  fields.append(emailLabel, passwordLabel, forgot);

  const button = el("button", "primary");
  button.type = "submit";
  button.disabled = signingIn;
  button.setAttribute("aria-busy", signingIn ? "true" : "false");
  if (signingIn) {
    const row = el("span", "signin-row");
    row.append(el("span", "spinner"), document.createTextNode("Signing in…"));
    button.appendChild(row);
  } else {
    button.textContent = "Sign in";
  }

  form.append(fields, button);
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (signingIn) return;
    const password = passwordInput.value;
    loginEmail = emailInput.value.trim();
    loginError = "";
    signingIn = true;
    render(state);
    const result = await signInOrTimeout(loginEmail, password);
    signingIn = false;
    if (result.ok) {
      loginError = "";
      const next = await milon.getState();
      render(next);
      return;
    }
    loginError = result.message || "Could not sign in.";
    render(lastState || state);
  });

  const message = loginError || state.error || "";
  card.append(form, el("p", "err", message), el("p", "who", "The password is not stored. This PC keeps an encrypted session until you sign out."));
  screen.appendChild(card);
  app.appendChild(screen);
}

function render(state) {
  lastState = state;
  const focused = document.activeElement;
  const keepId = focused && focused.dataset ? focused.dataset.answer : "";
  const keepValue = keepId ? focused.value : "";
  app.replaceChildren();

  if (!state.signedIn) {
    renderLogin(state);
    return;
  }

  signingIn = false;
  loginError = "";
  const workspace = el("div", "workspace");
  workspace.append(
    wordmark(),
    el("h1", null, "Uploads"),
    el("p", "lede", "New files in the watched folder go to source-document intake. Nothing is posted to a ledger."),
    el("p", "err", state.error || ""),
  );

  const who = el("p", "who", state.email || "");
  const signOut = el("button", "quiet", "Sign out");
  signOut.type = "button";
  signOut.addEventListener("click", () => milon.signOut());
  const top = el("div", "row");
  top.append(who, signOut);
  who.classList.add("grow");
  workspace.appendChild(top);

  const folderLabel = el("label", null, "Watched folder");
  const folderRow = el("div", "row");
  const folderText = Object.assign(document.createElement("input"), {
    type: "text",
    readOnly: true,
    value: state.folder || "No folder yet",
  });
  const choose = el("button", null, "Choose");
  choose.type = "button";
  choose.addEventListener("click", () => milon.pickFolder());
  folderRow.append(folderText, choose);
  folderLabel.append(folderRow);
  workspace.appendChild(folderLabel);

  const clientLabel = el("label");
  clientLabel.append("Client");
  const clientRow = el("div", "row");
  const select = document.createElement("select");
  const empty = el("option", null, state.clients.length ? "Choose a client" : "No clients yet");
  empty.value = "";
  select.appendChild(empty);
  for (const client of state.clients) {
    const option = el("option", null, client.name);
    option.value = client.id;
    if (client.id === state.clientId) option.selected = true;
    select.appendChild(option);
  }
  select.addEventListener("change", () => milon.setClient(select.value));
  const refresh = el("button", "quiet", "Refresh");
  refresh.type = "button";
  refresh.addEventListener("click", () => milon.refreshClients());
  clientRow.append(select, refresh);
  clientLabel.append(clientRow);
  workspace.appendChild(clientLabel);

  const periodLabel = el("label");
  periodLabel.append("Books period");
  const period = Object.assign(document.createElement("input"), { type: "month", value: state.period || "" });
  period.addEventListener("change", () => milon.setPeriod(period.value));
  periodLabel.append(period);
  workspace.appendChild(periodLabel);

  workspace.appendChild(el("p", "who", "Status. The assistant's read stays on this PC."));

  const list = document.createElement("ul");
  if (state.items.length === 0) {
    list.appendChild(el("li", null, "Drop a PDF, photo, CSV, or Excel file in the folder."));
  }
  for (const item of state.items) {
    const card = document.createElement("li");
    card.append(
      el("div", "name", item.name),
      el("div", `status ${statusClass(item.status)}`, item.status),
      el("div", "detail", item.detail || ""),
    );
    if (item.flags && item.flags.length) card.append(el("div", "flags", item.flags.join(" · ")));
    if (item.status === "needs answer" && item.question) {
      const ask = el("form", "ask");
      const input = Object.assign(document.createElement("input"), {
        type: "text",
        value: drafts.get(item.id) || "",
        placeholder: "Yes, or a short answer",
      });
      input.dataset.answer = item.id;
      input.addEventListener("input", () => drafts.set(item.id, input.value));
      const send = el("button", null, "Send");
      send.type = "submit";
      ask.append(input, send);
      ask.addEventListener("submit", async (event) => {
        event.preventDefault();
        const text = input.value.trim();
        if (!text) return;
        drafts.delete(item.id);
        await milon.answer(item.id, text);
      });
      card.append(ask);
      if (keepId === item.id) input.value = keepValue;
    }
    list.appendChild(card);
  }
  workspace.appendChild(list);
  app.appendChild(workspace);
  if (keepId && window.CSS) {
    const again = app.querySelector(`input[data-answer="${CSS.escape(keepId)}"]`);
    if (again) again.focus();
  }
}

milon.onState(render);
milon.getState().then(render);
