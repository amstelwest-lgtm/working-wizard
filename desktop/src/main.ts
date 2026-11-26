import { app, BrowserWindow, dialog, ipcMain, Menu, nativeImage, net, shell, Tray } from "electron";
import chokidar, { type FSWatcher } from "chokidar";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import {
  answerCancels,
  currentBooksPeriod,
  docTypeFromAnswer,
  findPeriod,
  formatPeriod,
  matchingClient,
  reviewFile,
  type DocType,
  type Flag,
} from "./classifier";
import { listPickerClients, type ListedClient } from "./client-list";
import { historyHas, loadSettings, rememberUpload, saveSettings, type Settings } from "./disk";
import { intakeHasSha, sha256Hex, uploadToIntake } from "./intake";
import { fileExtension, ignoredLocalFile, sizeError, watchedExtension } from "./paths";
import { allowedPasswordResetUrl, PASSWORD_RESET_URL } from "./external-url";
import { fetchWithDeadline, type FetchLike } from "./fetch-deadline";
import { SUPABASE_ANON_KEY, SUPABASE_URL } from "./public-config";
import {
  releaseForPasswordGrant,
  SESSION_RECOVER_MS,
  watchSessionRecovery,
  type InitAuth,
  type RecoveryWatch,
} from "./session-recover";
import { clearSessionFile, encryptionAvailable, secureSessionStorage } from "./session-store";
import { appendDesktopLog, startupLogLine } from "./desktop-log";
import { desktopAuthConfigOk, redactedSignInFailure, SIGN_IN_TIMEOUT_MS, signInFailureFromThrown, signInUserMessage, supabaseHost } from "./sign-in-error";
import { firstPageText } from "./snippet";

type Status = "queued" | "uploading" | "uploaded" | "needs answer" | "failed";

type Item = {
  id: string;
  filePath: string;
  name: string;
  status: Status;
  detail: string;
  flags: Flag[];
  docType: DocType | null;
  period: string | null;
  suggestedClientName: string | null;
  question: string | null;
  documentId: string | null;
};

type PublicState = {
  signedIn: boolean;
  email: string | null;
  folder: string | null;
  clientId: string | null;
  clients: ListedClient[];
  period: string;
  items: Item[];
  error: string | null;
};

let windowRef: BrowserWindow | null = null;
let tray: Tray | null = null;
let quitting = false;
let watcher: FSWatcher | null = null;
let supabase: SupabaseClient | null = null;
let settings: Settings = { folder: null, clientId: null, period: currentBooksPeriod() };
let clients: ListedClient[] = [];
let items: Item[] = [];
let banner: string | null = null;
let email: string | null = null;
let userId: string | null = null;
let signInAttempt = 0;
let recoveryAbort: AbortController | null = null;
let recovering = false;
let sessionWatch: RecoveryWatch | null = null;
const inflight = new Set<string>();

function reportSignInFailure(error: unknown): void {
  const line = redactedSignInFailure(error, supabaseHost(SUPABASE_URL));
  console.error(line);
  appendDesktopLog(app.getPath("logs"), line);
}

function logReady(): void {
  appendDesktopLog(
    app.getPath("logs"),
    startupLogLine(app.getVersion(), supabaseHost(SUPABASE_URL), app.getPath("userData")),
  );
}

/**
 * Electron 33's main process is Node 20 and has no global WebSocket.
 * supabase-js constructs a Realtime client during createClient and throws
 * before the window exists. Password sign-in does not use Realtime.
 */
class DesktopRealtimeTransport {
  constructor(_url?: string, _protocols?: unknown) {}
  close(): void {}
  send(_data?: unknown): void {}
  addEventListener(): void {}
  removeEventListener(): void {}
}

function logSignIn(stage: string, error?: unknown): void {
  const name = error instanceof Error ? error.name : "";
  const code =
    error && typeof error === "object" && "code" in error && typeof (error as { code?: unknown }).code === "string"
      ? (error as { code: string }).code
      : "";
  console.error(`[milon-desktop] sign-in stage=${stage}${name ? ` name=${name}` : ""}${code ? ` code=${code}` : ""}`);
}

function authState(): SupabaseClient["auth"] & InitAuth {
  return db().auth as SupabaseClient["auth"] & InitAuth;
}

function requestUrl(input: RequestInfo | URL): string {
  if (typeof input === "string") return input;
  if (input instanceof URL) return input.toString();
  return input.url;
}

function absoluteHttpsUrl(value: string): string {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw Object.assign(new TypeError("Invalid sign-in URL"), { code: "invalid_url" });
  }
  if (parsed.protocol !== "https:") {
    throw Object.assign(new TypeError(`Unsupported sign-in URL scheme ${parsed.protocol}`), { code: "invalid_url" });
  }
  return parsed.toString();
}

/** Chromium networking, so Windows proxy and certs apply. Node's fetch does not. */
const chromiumFetch: FetchLike = (input, init) => {
  let signal = init?.signal;
  if (recovering && recoveryAbort) {
    const recovery = recoveryAbort.signal;
    signal = signal ? AbortSignal.any([recovery, signal]) : recovery;
  }
  // Default Request credentials are "same-origin". With no Origin header, Electron's
  // net.fetch rewrites that to "include", which is the wrong mode for a bearer call.
  return net.fetch(absoluteHttpsUrl(requestUrl(input)), { ...init, signal, credentials: "omit" });
};

function armRecoveryAbort(): void {
  recoveryAbort = new AbortController();
  recovering = true;
}

function abandonRecovery(): void {
  const controller = recoveryAbort;
  recovering = false;
  recoveryAbort = null;
  controller?.abort();
}

function disarmRecoveryAbort(): void {
  recovering = false;
  recoveryAbort = null;
}

function dropStoredSession(): void {
  abandonRecovery();
  clearSessionFile();
}

function releasePasswordGrant(): void {
  if (!supabase) return;
  if (sessionWatch && !sessionWatch.done) {
    sessionWatch.done = true;
    sessionWatch.failed = true;
    sessionWatch.stop();
    abandonRecovery();
  }
  releaseForPasswordGrant(authState(), sessionWatch, clearSessionFile);
}

function startSessionRecovery(): void {
  armRecoveryAbort();
  const auth = authState();
  const pending = auth.initialize();
  sessionWatch = watchSessionRecovery(auth, pending, dropStoredSession);
  void auth.initializePromise?.then(
    () => {
      if (!sessionWatch?.failed) disarmRecoveryAbort();
    },
    () => {
      /* watchSessionRecovery clears session.bin */
    },
  );
}

function assetPath(name: string): string {
  return path.join(__dirname, "../assets", name);
}

function db(): SupabaseClient {
  if (!supabase) throw new Error("Sign in is not ready.");
  return supabase;
}

function selectedClient(): ListedClient | null {
  return clients.find((client) => client.id === settings.clientId) ?? null;
}

function snapshot(): PublicState {
  return {
    signedIn: Boolean(email),
    email,
    folder: settings.folder,
    clientId: settings.clientId,
    clients,
    period: settings.period,
    items,
    error: banner,
  };
}

function publish(): void {
  const state = snapshot();
  if (windowRef && !windowRef.isDestroyed()) windowRef.webContents.send("state", state);
  refreshTrayMenu();
}

function showWindow(): void {
  if (!windowRef || windowRef.isDestroyed()) {
    createWindow();
    return;
  }
  windowRef.show();
  windowRef.focus();
}

function windowIcon() {
  return nativeImage.createFromPath(assetPath("icon.ico"));
}

function trayIcon() {
  const image = nativeImage.createFromPath(assetPath("tray.png"));
  if (!image.isEmpty()) return image;
  return windowIcon().resize({ width: 32, height: 32 });
}

function refreshTrayMenu(): void {
  if (!tray) return;
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: "Open Milōn", click: () => showWindow() },
      { label: "Sign out", enabled: Boolean(email), click: () => void signOut() },
      { type: "separator" },
      {
        label: "Quit",
        click: () => {
          quitting = true;
          app.quit();
        },
      },
    ]),
  );
}

function createTray(): void {
  tray = new Tray(trayIcon());
  tray.setToolTip("Milōn");
  tray.on("click", () => showWindow());
  refreshTrayMenu();
}

function createWindow(): void {
  windowRef = new BrowserWindow({
    width: 1100,
    height: 720,
    minWidth: 760,
    minHeight: 560,
    title: "Milōn",
    icon: windowIcon(),
    show: false,
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  windowRef.removeMenu();
  void windowRef.loadFile(path.join(__dirname, "../src/renderer/index.html"));
  windowRef.once("ready-to-show", () => {
    windowRef?.show();
    publish();
  });
  windowRef.on("close", (event) => {
    if (!quitting) {
      event.preventDefault();
      windowRef?.hide();
    }
  });
  windowRef.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  windowRef.webContents.on("will-navigate", (event, url) => {
    if (!url.startsWith("file:")) event.preventDefault();
  });
}

function lineFor(item: Pick<Item, "docType" | "period" | "suggestedClientName">, tail: string): string {
  const label = item.docType ? item.docType.charAt(0).toUpperCase() + item.docType.slice(1) : null;
  const bits = [label, item.period ? formatPeriod(item.period) : null, item.suggestedClientName].filter(
    (bit): bit is string => Boolean(bit),
  );
  return bits.length > 0 ? `${bits.join(" · ")}. ${tail}` : tail;
}

async function refreshIdentity(): Promise<void> {
  const attempt = signInAttempt;
  const { data } = await db().auth.getSession();
  if (attempt !== signInAttempt) return;
  email = data.session?.user?.email ?? null;
  userId = data.session?.user?.id ?? null;
  if (!email) {
    userId = null;
    clients = [];
  }
}

async function refreshClients(): Promise<void> {
  const id = userId;
  if (!id) {
    clients = [];
    return;
  }
  const listed = await listPickerClients(db(), id);
  clients = listed.clients;
  banner = listed.error;
  if (settings.clientId && !clients.some((client) => client.id === settings.clientId)) {
    settings.clientId = null;
    saveSettings(settings);
  }
}

async function send(item: Item, bytes: Uint8Array, clientId: string): Promise<void> {
  item.status = "uploading";
  item.question = null;
  item.detail = lineFor(item, "Uploading.");
  publish();
  try {
    const result = await uploadToIntake(db(), { clientId, fileName: item.name, bytes });
    if (!result.ok) {
      item.status = "failed";
      item.detail = lineFor(item, result.message);
      return;
    }
    item.status = "uploaded";
    item.documentId = result.documentId;
    if (result.duplicate && !item.flags.includes("duplicate")) item.flags = [...item.flags, "duplicate"];
    item.detail = lineFor(
      item,
      result.duplicate ? "Duplicate — already in intake." : "In Milōn intake.",
    );
    rememberUpload({
      sha256: sha256Hex(bytes),
      clientId,
      documentId: result.documentId,
      at: new Date().toISOString(),
    });
  } catch {
    item.status = "failed";
    item.detail = lineFor(item, "The file could not be saved. Try again.");
  }
}

async function classifyAndMaybeUpload(item: Item): Promise<void> {
  if (inflight.has(item.id)) return;
  inflight.add(item.id);
  try {
    if (!email) {
      item.status = "queued";
      item.detail = "Sign in to upload.";
      return;
    }
    const client = selectedClient();
    if (!client) {
      item.status = "queued";
      item.detail = "Pick a client.";
      return;
    }
    let bytes: Buffer;
    try {
      const info = await stat(item.filePath);
      if (!info.isFile()) {
        item.status = "failed";
        item.detail = "The file could not be read.";
        return;
      }
      const problem = sizeError(info.size);
      if (problem) {
        item.status = "failed";
        item.detail = problem;
        return;
      }
      bytes = await readFile(item.filePath);
    } catch {
      item.status = "failed";
      item.detail = "The file could not be read.";
      return;
    }
    const sha = sha256Hex(bytes);
    const duplicate = historyHas(sha, client.id) || (await intakeHasSha(db(), client.id, sha));
    let text = "";
    try {
      text = await firstPageText(item.filePath);
    } catch {
      text = "";
    }
    const review = reviewFile({
      fileName: item.name,
      text,
      extension: fileExtension(item.name),
      booksPeriod: settings.period,
      selectedClient: client,
      clients,
      duplicate,
    });
    item.docType = review.docType;
    item.period = review.period;
    item.suggestedClientName = review.suggestedClientName;
    item.flags = review.flags;
    item.question = review.question;
    if (duplicate) {
      item.status = "uploaded";
      item.detail = lineFor(item, "Duplicate — already in intake.");
      item.question = null;
      return;
    }
    if (review.question) {
      item.status = "needs answer";
      item.detail = review.question;
      return;
    }
    await send(item, bytes, client.id);
  } finally {
    inflight.delete(item.id);
    publish();
  }
}

function enqueue(filePath: string): void {
  if (!settings.folder) return;
  const resolved = path.resolve(filePath);
  const root = path.resolve(settings.folder);
  if (resolved !== root && !resolved.startsWith(root + path.sep)) return;
  const name = path.basename(resolved);
  if (ignoredLocalFile(name) || !watchedExtension(name)) return;
  if (items.some((item) => item.filePath === resolved && item.status !== "failed")) return;
  const item: Item = {
    id: `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
    filePath: resolved,
    name,
    status: "queued",
    detail: "Queued.",
    flags: [],
    docType: null,
    period: null,
    suggestedClientName: null,
    question: null,
    documentId: null,
  };
  items = [item, ...items].slice(0, 100);
  publish();
  void classifyAndMaybeUpload(item);
}

function startWatcher(): void {
  void watcher?.close();
  watcher = null;
  if (!settings.folder) return;
  watcher = chokidar.watch(settings.folder, {
    ignoreInitial: true,
    awaitWriteFinish: { stabilityThreshold: 1500, pollInterval: 200 },
    depth: 0,
    ignorePermissionErrors: true,
  });
  watcher.on("add", (filePath) => enqueue(filePath));
  watcher.on("error", () => {
    banner = "The folder could not be watched.";
    publish();
  });
}

function pumpQueued(): void {
  for (const item of [...items]) {
    if (item.status === "queued") void classifyAndMaybeUpload(item);
  }
}

async function bootSession(): Promise<void> {
  const attempt = signInAttempt;
  await refreshIdentity();
  if (attempt !== signInAttempt) return;
  publish();
  if (!email) return;
  try {
    await refreshClients();
  } catch (error) {
    logSignIn("clients", error);
    if (attempt !== signInAttempt) return;
    banner = "Clients could not be loaded.";
  }
  if (attempt !== signInAttempt) return;
  startWatcher();
  publish();
  pumpQueued();
}

async function finishSignIn(attempt: number): Promise<void> {
  if (attempt !== signInAttempt) return;
  try {
    await refreshClients();
  } catch (error) {
    logSignIn("clients", error);
    if (attempt !== signInAttempt) return;
    banner = "Clients could not be loaded.";
  }
  if (attempt !== signInAttempt) return;
  startWatcher();
  publish();
  pumpQueued();
}

async function signOut(): Promise<void> {
  try {
    await db().auth.signOut();
  } catch {
    /* local clear still happens */
  }
  clearSessionFile();
  email = null;
  userId = null;
  clients = [];
  banner = null;
  signInAttempt += 1;
  publish();
}

function registerIpc(): void {
  ipcMain.handle("get-state", () => snapshot());
  ipcMain.handle("sign-in", async (_event, body: { email?: string; password?: string }) => {
    const attempt = ++signInAttempt;
    const address = String(body?.email ?? "").trim();
    const password = String(body?.password ?? "");
    if (body) body.password = "";
    if (!address || !password) return { ok: false, message: "Enter your email and password." };
    if (!supabase) {
      reportSignInFailure({ name: "Error", message: "Sign in is not ready.", code: "not_ready" });
      banner = signInUserMessage({ name: "Error", message: "Sign in is not ready.", code: "not_ready" });
      publish();
      return { ok: false, message: banner };
    }
    if (!desktopAuthConfigOk(SUPABASE_URL, SUPABASE_ANON_KEY)) {
      logSignIn("config");
      banner = signInUserMessage({ code: "config" });
      publish();
      return { ok: false, message: banner };
    }
    let canEncrypt = false;
    try {
      canEncrypt = encryptionAvailable();
    } catch (error) {
      logSignIn("encryption", error);
      canEncrypt = false;
    }
    if (!canEncrypt) {
      logSignIn("encryption");
      banner = "This PC can't encrypt the Milōn session. The password was not saved.";
      publish();
      return { ok: false, message: banner };
    }
    try {
      releasePasswordGrant();
      const { data, error } = await db().auth.signInWithPassword({ email: address, password });
      if (attempt !== signInAttempt) return { ok: false, message: "Sign-in was interrupted. Try again." };
      if (error || !data.session) {
        reportSignInFailure(error);
        try {
          await db().auth.signOut();
        } catch {
          /* the failed grant should not keep a session */
        }
        clearSessionFile();
        email = null;
        userId = null;
        banner = signInUserMessage(error);
        publish();
        return { ok: false, message: banner };
      }
      email = data.user?.email ?? data.session.user.email ?? address;
      userId = data.user?.id ?? data.session.user.id ?? null;
      banner = null;
      // The login screen waits on this IPC. Client lookups and the folder
      // watcher run after the upload screen is published.
      publish();
      setTimeout(() => {
        void finishSignIn(attempt);
      }, 0);
      return { ok: true, message: "" };
    } catch (error) {
      reportSignInFailure(error);
      clearSessionFile();
      email = null;
      userId = null;
      banner = signInUserMessage(signInFailureFromThrown(error));
      publish();
      return { ok: false, message: banner };
    }
  });
  ipcMain.handle("report-sign-in", (_event, body: unknown) => {
    const failure = signInFailureFromThrown(body) ?? { name: "Error", message: "Sign-in failed." };
    reportSignInFailure(failure);
    return { ok: false, message: signInUserMessage(failure) };
  });
  ipcMain.handle("open-password-reset", async () => {
    const url = allowedPasswordResetUrl(PASSWORD_RESET_URL);
    if (!url) {
      console.error("[milon-desktop] sign-in stage=password-reset reason=blocked-url");
      return { ok: false, message: "Password reset could not be opened." };
    }
    try {
      await shell.openExternal(url);
      return { ok: true, message: "" };
    } catch (error) {
      logSignIn("password-reset", error);
      return { ok: false, message: "Password reset could not be opened." };
    }
  });
  ipcMain.handle("sign-out", () => signOut());
  ipcMain.handle("pick-folder", async () => {
    const options = {
      title: "Choose a folder to watch",
      properties: ["openDirectory"] as "openDirectory"[],
    };
    const parent = windowRef && !windowRef.isDestroyed() ? windowRef : undefined;
    const result = parent
      ? await dialog.showOpenDialog(parent, options)
      : await dialog.showOpenDialog(options);
    if (result.canceled || !result.filePaths[0]) return snapshot();
    settings.folder = result.filePaths[0];
    saveSettings(settings);
    banner = null;
    startWatcher();
    publish();
    return snapshot();
  });
  ipcMain.handle("set-client", (_event, clientId: unknown) => {
    const id = typeof clientId === "string" ? clientId : "";
    settings.clientId = clients.some((client) => client.id === id) ? id : null;
    saveSettings(settings);
    publish();
    pumpQueued();
    return snapshot();
  });
  ipcMain.handle("set-period", (_event, period: unknown) => {
    const value = typeof period === "string" ? period : "";
    if (/^\d{4}-\d{2}$/.test(value)) {
      settings.period = value;
      saveSettings(settings);
      publish();
    }
    return snapshot();
  });
  ipcMain.handle("refresh-clients", async () => {
    if (email) await refreshClients();
    publish();
    return snapshot();
  });
  ipcMain.handle("answer", async (_event, body: { id?: string; text?: string }) => {
    const item = items.find((row) => row.id === body?.id);
    const text = String(body?.text ?? "").trim();
    if (!item || item.status !== "needs answer") return snapshot();
    if (!text) return snapshot();
    if (answerCancels(text)) {
      item.status = "failed";
      item.question = null;
      item.detail = lineFor(item, "Skipped.");
      publish();
      return snapshot();
    }
    const typed = docTypeFromAnswer(text);
    if (typed) item.docType = typed;
    const period = findPeriod(text);
    if (period) item.period = period;
    const named = matchingClient(text, clients);
    if (named) item.suggestedClientName = named.name;
    const client = named ?? selectedClient();
    if (!client) {
      item.detail = "Pick a client.";
      publish();
      return snapshot();
    }
    try {
      const info = await stat(item.filePath);
      const problem = sizeError(info.size);
      if (problem) {
        item.status = "failed";
        item.question = null;
        item.detail = problem;
        publish();
        return snapshot();
      }
      const bytes = await readFile(item.filePath);
      await send(item, bytes, client.id);
    } catch {
      item.status = "failed";
      item.question = null;
      item.detail = lineFor(item, "The file could not be read.");
    }
    publish();
    return snapshot();
  });
}

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on("second-instance", () => showWindow());
  app.on("window-all-closed", () => {
    /* The tray keeps Milōn running. */
  });
  app.whenReady().then(async () => {
    app.setAppUserModelId("finance.milon.desktop");
    settings = loadSettings();
    logReady();
    try {
      supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
        realtime: { transport: DesktopRealtimeTransport as unknown as typeof WebSocket },
        global: { fetch: fetchWithDeadline(SIGN_IN_TIMEOUT_MS, chromiumFetch) },
        auth: {
          storage: secureSessionStorage,
          persistSession: true,
          autoRefreshToken: true,
          detectSessionInUrl: false,
          skipAutoInitialize: true,
        },
      });
    } catch (error) {
      reportSignInFailure(error);
      banner = signInUserMessage(signInFailureFromThrown(error));
    }
    registerIpc();
    createWindow();
    createTray();
    if (supabase) {
      startSessionRecovery();
      // Session restore and the folder watcher are not on the sign-in click.
      setTimeout(() => {
        void bootSession().catch((error: unknown) => {
          logSignIn("startup-session", error);
          banner = "Sign in to Milōn.";
          publish();
        });
      }, 0);
    }
  });
}
