/* global milon */
const app = document.getElementById("app");
const drafts = new Map();

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text != null) node.textContent = text;
  return node;
}

function statusClass(status) {
  if (status === "needs answer") return "needs";
  return status;
}

function render(state) {
  const focused = document.activeElement;
  const keepId = focused && focused.dataset ? focused.dataset.answer : "";
  const keepValue = keepId ? focused.value : "";
  app.replaceChildren();

  const error = el("p", "err", state.error || "");
  app.appendChild(error);

  if (!state.signedIn) {
    const form = el("form");
    const email = el("label");
    email.append("Email", Object.assign(document.createElement("input"), { type: "email", name: "email", autocomplete: "username", required: true }));
    const password = el("label");
    const passwordInput = Object.assign(document.createElement("input"), {
      type: "password",
      name: "password",
      autocomplete: "current-password",
      required: true,
    });
    password.append("Password", passwordInput);
    const button = el("button", null, "Sign in");
    button.type = "submit";
    form.append(email, password, button);
    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      button.disabled = true;
      const result = await milon.signIn(form.email.value.trim(), passwordInput.value);
      passwordInput.value = "";
      button.disabled = false;
      if (!result.ok) error.textContent = result.message || "Could not sign in.";
    });
    const note = el("p", "who", "The password is not stored. This PC keeps an encrypted session until you sign out.");
    app.append(form, note);
    return;
  }

  const who = el("p", "who", state.email || "");
  const signOut = el("button", "quiet", "Sign out");
  signOut.type = "button";
  signOut.addEventListener("click", () => milon.signOut());
  const top = el("div", "row");
  top.append(who, signOut);
  who.classList.add("grow");
  app.appendChild(top);

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
  app.appendChild(folderLabel);

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
  app.appendChild(clientLabel);

  const periodLabel = el("label");
  periodLabel.append("Books period");
  const period = Object.assign(document.createElement("input"), { type: "month", value: state.period || "" });
  period.addEventListener("change", () => milon.setPeriod(period.value));
  periodLabel.append(period);
  app.appendChild(periodLabel);

  const heading = el("p", "who", "Status. The assistant's read stays on this PC.");
  app.appendChild(heading);

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
  app.appendChild(list);
  if (keepId && window.CSS) {
    const again = app.querySelector(`input[data-answer="${CSS.escape(keepId)}"]`);
    if (again) again.focus();
  }
}

milon.onState(render);
milon.getState().then(render);
