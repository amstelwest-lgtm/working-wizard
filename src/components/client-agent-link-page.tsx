/**
 * Public Tax Specialist page. Consent first, then a vertical checklist.
 * Nothing is emailed. The portrait is the silent in-app agent card.
 */
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import "@/components/owner-door/owner-door.css";
import { usePrefersReducedMotion } from "@/hooks/use-prefers-reduced-motion";
import { SEND_FILE_MAX_BYTES, SEND_FILE_MIMES } from "@/lib/client-agent-send";
import {
  CLIENT_AGENT_CHAT_ENABLED,
  CLIENT_AGENT_FAQ_TITLE,
  CLIENT_AGENT_FILE_NOTE,
  CLIENT_AGENT_PASSWORD_REQUIRED,
  CLIENT_AGENT_PASSWORD_UNSAVED,
  checklistReady,
  itemNotAvailable,
  clientAgentChecklistIntro,
  clientAgentFaq,
  clientAgentFaqClose,
  clientAgentIntro,
  clientAgentItemHelp,
  clientAgentThanks,
  clientFileMime,
  sanitizeClientFileName,
  sizeAllowed,
  type ItemQuality,
} from "@/lib/client-agent-link";
import {
  askClientAgentLink,
  completeClientAgentSend,
  confirmClientAgentUpload,
  consentClientAgentLink,
  finishClientAgentItem,
  openClientAgentLink,
  prepareClientAgentUpload,
  removeClientAgentFile,
  saveClientAgentFilePassword,
  undoClientAgentItem,
  type OpenLinkResult,
  type PublicItem,
} from "@/lib/client-agent-link.functions";
import { uploadToClientAgentSignedUrl } from "@/lib/client-agent-upload-browser";
import { pickedPdfLooksEncrypted } from "@/lib/pdf-password";
import { avatarPoster, fmClipSources } from "@/lib/fm-avatar-state";

const PRIMARY =
  "inline-flex min-h-11 items-center justify-center rounded-full bg-[#0B5FFF] px-4 text-sm font-semibold text-white hover:bg-[#2563EB] disabled:opacity-60";
const SECONDARY =
  "inline-flex min-h-11 items-center justify-center rounded-full border border-[#DBEAFE] bg-white px-4 text-sm font-semibold text-[#102A43] disabled:opacity-60";
const QUIET =
  "inline-flex min-h-11 items-center text-sm font-semibold text-[#3D5270] underline decoration-[#DBEAFE] underline-offset-4 disabled:opacity-60";

export const CLIENT_AGENT_NEXT_HINT =
  "Upload a file or tap I don't have this for each document to continue.";

export const CLIENT_AGENT_LOAD_ERROR = "Couldn't load, try again";

function TaxSpecialistHero({ clip }: { clip: "curious" | "done" }) {
  const reduced = usePrefersReducedMotion();
  const poster = avatarPoster("tax_specialist");
  const sources = fmClipSources(clip, "tax_specialist");
  return (
    <span
      className="owner-presence is-tax_specialist is-character is-idle is-lg is-fm-clip"
      data-avatar="character"
      data-agent="tax_specialist"
      role="img"
      aria-label="Tax Specialist"
    >
      <span className="owner-fm-face">
        <picture className="owner-fm-poster">
          <source srcSet={poster.webp} type="image/webp" />
          <img src={poster.jpg} alt="" />
        </picture>
        {reduced ? null : (
          <video
            className="is-on"
            muted
            autoPlay
            playsInline
            loop
            preload="auto"
            poster={poster.webp}
          >
            <source src={sources.webm} type="video/webm" />
            <source src={sources.mp4} type="video/mp4" />
          </video>
        )}
      </span>
    </span>
  );
}

export function ClientAgentLinkScreen({
  view,
  busy,
  notice,
  noteFor,
  explanation,
  onAgree,
  onPickFile,
  onRemove,
  onOpenNote,
  onMarkMissing,
  onUndo,
  onExplanation,
  onExplanationFor,
  explanations = {},
  onSaveNote,
  loadFailed = false,
  onRetry,
  chatOpen = false,
  chatMessages = [],
  chatDraft = "",
  onToggleChat,
  onChatDraft,
  onAsk,
  passwordDrafts = {},
  onPasswordDraft,
  onPassword,
  onNext,
  thanks = false,
}: {
  view: OpenLinkResult | null;
  busy: boolean;
  notice: string | null;
  noteFor: string | null;
  explanation: string;
  onAgree: () => void;
  onPickFile: (item: PublicItem, files: File[], mode?: "replace") => void;
  onRemove?: (item: PublicItem) => void;
  onOpenNote: (itemKey: string) => void;
  onMarkMissing?: (item: PublicItem) => void;
  onUndo?: (item: PublicItem) => void;
  onExplanation: (value: string) => void;
  onExplanationFor?: (itemKey: string, value: string) => void;
  explanations?: Record<string, string>;
  onSaveNote: (item: PublicItem) => void;
  loadFailed?: boolean;
  onRetry?: () => void;
  chatOpen?: boolean;
  chatMessages?: Array<{ role: "you" | "she"; text: string }>;
  chatDraft?: string;
  onToggleChat?: () => void;
  onChatDraft?: (value: string) => void;
  onAsk?: () => void;
  passwordDrafts?: Record<string, string>;
  onPasswordDraft?: (itemKey: string, value: string) => void;
  onPassword?: (item: PublicItem) => void;
  onNext?: () => void;
  thanks?: boolean;
}) {
  const openView = view?.ok ? view : null;
  const ready = openView ? checklistReady(openView.items) : false;
  const showThanks = Boolean(openView && (thanks || openView.completed));
  const thankYou = openView
    ? clientAgentThanks({
        firstName: openView.firstName ?? null,
        practiceName: openView.practiceName,
      })
    : null;
  const help = openView ? clientAgentFaq(openView.items) : [];

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-3xl flex-col gap-4 bg-white px-4 py-6 text-[#102A43]">
      <span
        className="owner-door -ml-3 inline-flex h-[96px] w-[96px] shrink-0 self-start overflow-hidden min-[761px]:-ml-[21.5px] min-[761px]:h-[172px] min-[761px]:w-[172px]"
        data-client-portrait="tax_specialist"
      >
        <TaxSpecialistHero clip={showThanks ? "done" : "curious"} />
      </span>
      {openView ? (
        <p className="text-sm font-semibold" data-practice-name="true">
          {openView.practiceName}
        </p>
      ) : null}
      <h1 id="agent-link-title" className="text-2xl font-semibold">
        Tax Specialist
      </h1>
      {!view && !loadFailed ? <p className="text-sm text-[#3D5270]">Opening this link.</p> : null}
      {loadFailed ? (
        <div className="flex flex-col gap-3" data-link-retry="true">
          <p className="text-sm">{CLIENT_AGENT_LOAD_ERROR}</p>
          <button type="button" className={PRIMARY} disabled={busy} onClick={onRetry}>
            Try again
          </button>
        </div>
      ) : null}
      {view && !view.ok && !loadFailed && view.reason === "limited" ? (
        <div className="flex flex-col gap-3" data-link-throttled="true">
          <p className="text-sm">{view.body}</p>
          <button type="button" className={PRIMARY} disabled={busy} onClick={onRetry}>
            Try again
          </button>
        </div>
      ) : null}
      {view && !view.ok && !loadFailed && view.reason !== "limited" ? (
        <p className="text-sm">{view.body}</p>
      ) : null}
      {openView && !openView.consented ? (
        <div className="flex flex-col gap-3">
          <p className="text-sm leading-6 text-[#3D5270]" data-client-intro="true">
            {clientAgentIntro(openView.practiceName, openView.expiresAt)}
          </p>
          <p className="text-sm leading-6">{openView.notice}</p>
          <button type="button" className={PRIMARY} disabled={busy} onClick={onAgree}>
            I agree
          </button>
        </div>
      ) : null}
      {openView?.consented && showThanks && thankYou ? (
        <div className="flex flex-col gap-3" data-client-thanks="true">
          <p className="text-sm leading-6">{thankYou.text}</p>
        </div>
      ) : null}
      {openView?.consented && !showThanks ? (
        <div className="flex flex-col gap-3">
          <p className="text-sm leading-6 text-[#3D5270]" data-checklist-intro="true">
            {clientAgentChecklistIntro(openView.firstName, openView.practiceName)}
          </p>
          {CLIENT_AGENT_CHAT_ENABLED ? (
            <div className="flex flex-col gap-2" data-agent-chat="true">
              <button type="button" className={QUIET} disabled={busy} onClick={onToggleChat}>
                {chatOpen ? "Close" : "Ask the Tax Specialist"}
              </button>
              {chatOpen ? (
                <div
                  className="flex flex-col gap-2 rounded-2xl border border-[#DBEAFE] p-3"
                  data-agent-chat-panel="true"
                >
                  {chatMessages.length === 0 ? (
                    <p className="text-sm leading-6 text-[#3D5270]">
                      Ask what a document is, where to find it, or what counts.
                    </p>
                  ) : (
                    <div className="flex flex-col gap-2">
                      {chatMessages.map((message, index) => (
                        <p
                          key={`${message.role}-${index}`}
                          className="text-sm leading-6"
                          data-chat-role={message.role}
                        >
                          {message.text}
                        </p>
                      ))}
                    </div>
                  )}
                  <label className="text-sm text-[#3D5270]">
                    Your question
                    <textarea
                      className="mt-1 min-h-11 w-full rounded-xl border border-[#DBEAFE] p-2 text-sm text-[#102A43]"
                      value={chatDraft}
                      maxLength={400}
                      data-agent-chat-draft="true"
                      onChange={(event) => onChatDraft?.(event.target.value)}
                    />
                  </label>
                  <button
                    type="button"
                    className={PRIMARY}
                    disabled={busy || chatDraft.trim().length === 0}
                    onClick={onAsk}
                  >
                    Ask
                  </button>
                </div>
              ) : null}
            </div>
          ) : (
            <section className="flex flex-col gap-3 rounded-2xl border border-[#DBEAFE] p-3" data-doc-help="true">
              <h2 className="text-base font-semibold">{CLIENT_AGENT_FAQ_TITLE}</h2>
              {help.map((entry) => (
                <div key={entry.itemKey} className="flex flex-col gap-1" data-doc-help-item={entry.itemKey}>
                  <p className="text-sm font-semibold">{entry.label}</p>
                  <p className="text-sm leading-6 text-[#3D5270]">{entry.body}</p>
                </div>
              ))}
              <p className="text-sm leading-6" data-doc-help-close="true">
                {clientAgentFaqClose(openView.practiceName)}
              </p>
            </section>
          )}
          <ol className="flex flex-col border-t border-[#DBEAFE]" data-doc-list="true">
            {openView.items.map((item) => (
              <li
                key={item.itemKey}
                className="flex flex-col gap-2 border-b border-[#DBEAFE] py-3"
                data-send-item={item.itemKey}
              >
                <div className="grid grid-cols-1 gap-2 min-[761px]:grid-cols-[minmax(0,1.1fr)_minmax(0,1.2fr)_max-content_max-content_2.75rem] min-[761px]:items-center">
                  <p className="font-semibold" data-doc-name="true">
                    {item.label}
                  </p>
                  <p className="text-sm leading-6 text-[#3D5270]" data-doc-hint="true">
                    {clientAgentItemHelp(item)}
                  </p>
                  {item.hasFile ? (
                    <div className="flex flex-col gap-2" data-received={item.itemKey}>
                      {(item.fileNames ?? []).map((name) => (
                        <p key={name} className="text-sm" data-received-name="true">
                          {name}
                        </p>
                      ))}
                      <p className="text-sm font-semibold">Received ✓</p>
                      <button
                        type="button"
                        className={SECONDARY}
                        disabled={busy}
                        onClick={() => document.getElementById(`upload-${item.itemKey}`)?.click()}
                      >
                        Replace
                      </button>
                      <button
                        type="button"
                        className={SECONDARY}
                        disabled={busy}
                        onClick={() => onRemove?.(item)}
                      >
                        Remove
                      </button>
                    </div>
                  ) : itemNotAvailable(item) ? (
                    <div className="flex flex-col gap-2" data-not-available={item.itemKey}>
                      <p className="text-sm font-semibold">Marked as not available</p>
                      <button
                        type="button"
                        className={SECONDARY}
                        disabled={busy}
                        data-undo-missing={item.itemKey}
                        onClick={() => onUndo?.(item)}
                      >
                        Undo
                      </button>
                    </div>
                  ) : (
                    <div className="flex flex-col gap-2">
                      <button
                        type="button"
                        className={`${PRIMARY} w-full min-[761px]:w-auto`}
                        disabled={busy}
                        onClick={() => document.getElementById(`upload-${item.itemKey}`)?.click()}
                      >
                        Upload
                      </button>
                      <button
                        type="button"
                        className={`${QUIET} w-full justify-center whitespace-nowrap min-[761px]:w-auto min-[761px]:justify-start`}
                        disabled={busy}
                        onClick={() => {
                          if (onMarkMissing) {
                            onMarkMissing(item);
                            return;
                          }
                          onOpenNote(item.itemKey);
                        }}
                      >
                        I don't have this
                      </button>
                    </div>
                  )}
                </div>
                <input
                  id={`upload-${item.itemKey}`}
                  className="sr-only"
                  type="file"
                  multiple
                  accept={SEND_FILE_MIMES.join(",")}
                  disabled={busy}
                    onChange={(event) => {
                    const picked = Array.from(event.target.files ?? []);
                    event.target.value = "";
                    const files = picked.filter((file) => file.size <= SEND_FILE_MAX_BYTES);
                    if (files.length === 0) return;
                    onPickFile(item, files, item.hasFile ? "replace" : undefined);
                  }}
                />
                {item.hasFile ? (
                  <div className="flex flex-col gap-2" data-file-password={item.itemKey}>
                    {item.passwordSaved ? (
                      <p className="text-sm text-[#3D5270]" data-file-password-saved={item.itemKey}>
                        Password saved 🔒
                      </p>
                    ) : null}
                    <label className="text-sm text-[#3D5270]">
                      File password (if it has one)
                      <input
                        type="password"
                        className="mt-1 min-h-11 w-full rounded-xl border border-[#DBEAFE] bg-white px-2 text-sm text-[#102A43]"
                        value={passwordDrafts[item.itemKey] ?? ""}
                        maxLength={80}
                        autoComplete="off"
                        onChange={(event) => onPasswordDraft?.(item.itemKey, event.target.value)}
                        onBlur={() => {
                          if ((passwordDrafts[item.itemKey] ?? "").trim().length === 0) return;
                          onPassword?.(item);
                        }}
                      />
                    </label>
                    <button
                      type="button"
                      className={SECONDARY}
                      disabled={busy || (passwordDrafts[item.itemKey] ?? "").trim().length === 0}
                      onMouseDown={(event) => event.preventDefault()}
                      onClick={() => onPassword?.(item)}
                    >
                      Save password
                    </button>
                  </div>
                ) : null}
                {itemNotAvailable(item) || noteFor === item.itemKey ? (
                  <div className="flex flex-col gap-2" data-missing-note={item.itemKey}>
                    <label className="text-sm text-[#3D5270]">
                      Optional note
                      <textarea
                        className="mt-1 min-h-11 w-full rounded-xl border border-[#DBEAFE] p-2 text-sm text-[#102A43]"
                        value={explanations[item.itemKey] ?? (noteFor === item.itemKey ? explanation : item.explanation ?? "")}
                        maxLength={2000}
                        onChange={(event) => {
                          if (onExplanationFor) onExplanationFor(item.itemKey, event.target.value);
                          else onExplanation(event.target.value);
                        }}
                      />
                    </label>
                    <button
                      type="button"
                      className={QUIET}
                      disabled={busy}
                      onClick={() => onSaveNote(item)}
                    >
                      Save note
                    </button>
                  </div>
                ) : null}
              </li>
            ))}
          </ol>
          <p className="text-sm leading-6 text-[#3D5270]" data-file-note="true">
            {CLIENT_AGENT_FILE_NOTE}
          </p>
          <button
            type="button"
            className={PRIMARY}
            data-client-next="true"
            disabled={busy || !ready}
            onMouseDown={(event) => event.preventDefault()}
            onClick={onNext}
          >
            Finish
          </button>
          {!ready ? (
            <p className="text-sm leading-6 text-[#3D5270]" data-next-hint="true">
              {CLIENT_AGENT_NEXT_HINT}
            </p>
          ) : null}
        </div>
      ) : null}
      {notice ? <p className="text-sm text-[#3D5270]">{notice}</p> : null}
    </main>
  );
}

export function ClientAgentLinkPage({ token }: { token: string }) {
  const open = useServerFn(openClientAgentLink);
  const agree = useServerFn(consentClientAgentLink);
  const prepareUpload = useServerFn(prepareClientAgentUpload);
  const confirmUpload = useServerFn(confirmClientAgentUpload);
  const removeUpload = useServerFn(removeClientAgentFile);
  const finish = useServerFn(finishClientAgentItem);
  const undoMissing = useServerFn(undoClientAgentItem);
  const savePassword = useServerFn(saveClientAgentFilePassword);
  const ask = useServerFn(askClientAgentLink);
  const complete = useServerFn(completeClientAgentSend);
  const [view, setView] = useState<OpenLinkResult | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [explanations, setExplanations] = useState<Record<string, string>>({});
  const scrollY = useRef(0);
  const holdScroll = useRef(false);
  const rememberScroll = () => {
    if (typeof window === "undefined") return;
    scrollY.current = window.scrollY;
    holdScroll.current = scrollY.current > 0;
  };
  const [chatOpen, setChatOpen] = useState(false);
  const [chatMessages, setChatMessages] = useState<Array<{ role: "you" | "she"; text: string }>>(
    [],
  );
  const [chatDraft, setChatDraft] = useState("");
  const [passwordDrafts, setPasswordDrafts] = useState<Record<string, string>>({});
  /** Items whose uploaded PDF looks password-protected, this session. */
  const [lockedItems, setLockedItems] = useState<Record<string, boolean>>({});
  const [fileNames, setFileNames] = useState<Record<string, string[]>>({});
  const [thanks, setThanks] = useState(false);

  const shownView: OpenLinkResult | null = view?.ok
    ? {
        ...view,
        items: view.items.map((item) => ({
          ...item,
          fileNames:
            item.fileNames && item.fileNames.length > 0
              ? item.fileNames
              : (fileNames[item.itemKey] ?? []),
        })),
      }
    : view;

  const openRef = useRef(open);
  openRef.current = open;

  useEffect(() => {
    const onScroll = () => {
      if (holdScroll.current) return;
      scrollY.current = window.scrollY;
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  useLayoutEffect(() => {
    const y = scrollY.current;
    if (typeof window === "undefined" || y <= 0) return;
    window.scrollTo(0, y);
    const first = window.requestAnimationFrame(() => {
      window.scrollTo(0, y);
      window.requestAnimationFrame(() => {
        window.scrollTo(0, y);
        holdScroll.current = false;
      });
    });
    return () => window.cancelAnimationFrame(first);
  }, [view, notice, thanks, busy, loadFailed]);

  useEffect(() => {
    let alive = true;
    setBusy(true);
    void openRef.current({ data: { token } })
      .then((result) => {
        if (!alive) return;
        setLoadFailed(false);
        setView(result);
      })
      .catch(() => {
        if (!alive) return;
        setView(null);
        setLoadFailed(true);
      })
      .finally(() => {
        if (alive) setBusy(false);
      });
    return () => {
      alive = false;
    };
  }, [token, attempt]);

  const onAgree = async () => {
    rememberScroll();
    setBusy(true);
    setNotice(null);
    try {
      setView(await agree({ data: { token } }));
    } catch {
      setNotice("The agreement could not be saved.");
    } finally {
      setBusy(false);
    }
  };

  const upload = async (item: PublicItem, files: File[], mode?: "replace") => {
    const accepted = files.filter((file) => sizeAllowed(file.size));
    if (accepted.length === 0) {
      setNotice("Use a PDF, JPG, PNG, or HEIC up to 20 MB.");
      return;
    }
    rememberScroll();
    setBusy(true);
    setNotice(files.length === accepted.length ? null : "Use a PDF, JPG, PNG, or HEIC up to 20 MB.");
    try {
      if (mode === "replace" && item.hasFile) {
        const removed = await removeUpload({ data: { token, itemKey: item.itemKey } });
        if (!removed.ok) {
          setNotice(removed.body);
          setView(await open({ data: { token } }));
          return;
        }
      }
      let lockedPick = false;
      for (const file of accepted) {
        if (clientFileMime(file.type, file.name) !== "application/pdf") continue;
        try {
          if (await pickedPdfLooksEncrypted(file)) lockedPick = true;
        } catch {
          // Unreadable bytes never block the upload itself.
        }
      }
      const stored: string[] = [];
      for (const file of accepted) {
        const prepared = await prepareUpload({
          data: {
            token,
            itemKey: item.itemKey,
            size: file.size,
            mime: clientFileMime(file.type, file.name),
            name: file.name,
          },
        });
        if (!prepared.ok) {
          setNotice(prepared.body);
          setView(await open({ data: { token } }));
          return;
        }
        const placed = await uploadToClientAgentSignedUrl({
          path: prepared.path,
          token: prepared.token,
          file,
        });
        if (!placed) {
          setNotice("The document could not be saved.");
          return;
        }
        const confirmed = await confirmUpload({
          data: { token, itemKey: item.itemKey, path: prepared.path, grant: prepared.grant },
        });
        if (!confirmed.ok) {
          setNotice(confirmed.body);
          setView(await open({ data: { token } }));
          return;
        }
        const label = sanitizeClientFileName(file.name);
        if (label) stored.push(label);
      }
      setFileNames((current) => ({
        ...current,
        [item.itemKey]: mode === "replace" ? stored : [...(current[item.itemKey] ?? []), ...stored],
      }));
      setLockedItems((current) => ({
        ...current,
        [item.itemKey]:
          mode === "replace" ? lockedPick : (current[item.itemKey] ?? false) || lockedPick,
      }));
      // A password already typed in the box is saved with the upload, so a
      // client who filled the field first never loses it.
      if ((passwordDrafts[item.itemKey] ?? "").trim()) {
        await saveItemPassword(item);
      } else if (lockedPick && !item.passwordSaved) {
        setNotice(CLIENT_AGENT_PASSWORD_REQUIRED);
      }
      rememberScroll();
      setView(await open({ data: { token } }));
    } catch {
      setNotice("The document could not be saved.");
    } finally {
      setBusy(false);
    }
  };

  const onRemove = async (item: PublicItem) => {
    rememberScroll();
    setBusy(true);
    setNotice(null);
    try {
      const removed = await removeUpload({ data: { token, itemKey: item.itemKey } });
      if (!removed.ok) {
        setNotice(removed.body);
        return;
      }
      setFileNames((current) => ({ ...current, [item.itemKey]: [] }));
      setLockedItems((current) => ({ ...current, [item.itemKey]: false }));
      setPasswordDrafts((current) => ({ ...current, [item.itemKey]: "" }));
      rememberScroll();
      setView(await open({ data: { token } }));
    } catch {
      setNotice("That could not be saved.");
    } finally {
      setBusy(false);
    }
  };

  const saveItemPassword = async (item: PublicItem): Promise<boolean> => {
    const password = (passwordDrafts[item.itemKey] ?? "").trim();
    if (!password) return true;
    const saved = await savePassword({
      data: { token, itemKey: item.itemKey, password },
    });
    setPasswordDrafts((current) => ({ ...current, [item.itemKey]: "" }));
    if (!saved.ok) {
      setNotice(saved.body);
      return false;
    }
    return true;
  };

  const onPassword = async (item: PublicItem) => {
    const password = (passwordDrafts[item.itemKey] ?? "").trim();
    if (!password) return;
    rememberScroll();
    setBusy(true);
    setNotice(null);
    try {
      const saved = await saveItemPassword(item);
      if (!saved) return;
      rememberScroll();
      setView(await open({ data: { token } }));
    } catch {
      setPasswordDrafts((current) => ({ ...current, [item.itemKey]: "" }));
      setNotice(CLIENT_AGENT_PASSWORD_UNSAVED);
    } finally {
      setBusy(false);
    }
  };

  const onAsk = async () => {
    if (!CLIENT_AGENT_CHAT_ENABLED) return;
    const message = chatDraft.trim();
    if (!message) return;
    setBusy(true);
    setNotice(null);
    setChatMessages((current) => [...current, { role: "you", text: message }]);
    setChatDraft("");
    try {
      const result = await ask({ data: { token, message } });
      const reply = result.ok ? result.reply : result.body;
      setChatMessages((current) => [...current, { role: "she", text: reply }]);
    } catch {
      setChatMessages((current) => [
        ...current,
        { role: "she", text: "I'll check with Theo's practice" },
      ]);
    } finally {
      setBusy(false);
    }
  };

  const onMarkMissing = async (item: PublicItem) => {
    rememberScroll();
    setBusy(true);
    setNotice(null);
    const note = (explanations[item.itemKey] ?? "").trim();
    try {
      const saved = await finish({
        data: {
          token,
          itemKey: item.itemKey,
          quality: "incomplete" satisfies ItemQuality,
          ...(note ? { explanation: note } : { explanation: "" }),
        },
      });
      if (!saved.ok) {
        setNotice(saved.body);
        return;
      }
      setView(await open({ data: { token } }));
    } catch {
      setNotice("That could not be saved.");
    } finally {
      setBusy(false);
    }
  };

  const onUndoMissing = async (item: PublicItem) => {
    rememberScroll();
    setBusy(true);
    setNotice(null);
    try {
      const saved = await undoMissing({ data: { token, itemKey: item.itemKey } });
      if (!saved.ok) {
        setNotice(saved.body);
        return;
      }
      setExplanations((current) => ({ ...current, [item.itemKey]: "" }));
      setView(await open({ data: { token } }));
    } catch {
      setNotice("That could not be saved.");
    } finally {
      setBusy(false);
    }
  };

  const onSaveNote = async (item: PublicItem) => {
    rememberScroll();
    setBusy(true);
    setNotice(null);
    const note = (explanations[item.itemKey] ?? item.explanation ?? "").trim();
    try {
      const saved = await finish({
        data: {
          token,
          itemKey: item.itemKey,
          quality: "incomplete" satisfies ItemQuality,
          explanation: note,
        },
      });
      if (!saved.ok) {
        setNotice(saved.body);
        return;
      }
      setView(await open({ data: { token } }));
    } catch {
      setNotice("That could not be saved.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <ClientAgentLinkScreen
      view={shownView}
      busy={busy}
      notice={notice}
      noteFor={null}
      explanation=""
      explanations={explanations}
      onAgree={() => void onAgree()}
      onPickFile={(item, file, mode) => void upload(item, file, mode)}
      onRemove={(item) => void onRemove(item)}
      onOpenNote={() => undefined}
      onMarkMissing={(item) => void onMarkMissing(item)}
      onUndo={(item) => void onUndoMissing(item)}
      onExplanation={() => undefined}
      onExplanationFor={(itemKey, value) =>
        setExplanations((current) => ({ ...current, [itemKey]: value }))
      }
      onSaveNote={(item) => void onSaveNote(item)}
      loadFailed={loadFailed}
      chatOpen={chatOpen}
      chatMessages={chatMessages}
      chatDraft={chatDraft}
      onToggleChat={() => setChatOpen((openChat) => !openChat)}
      onChatDraft={setChatDraft}
      onAsk={() => void onAsk()}
      passwordDrafts={passwordDrafts}
      onPasswordDraft={(itemKey, value) =>
        setPasswordDrafts((current) => ({ ...current, [itemKey]: value }))
      }
      onPassword={(item) => void onPassword(item)}
      onNext={() => {
        void (async () => {
          if (!view?.ok || view.completed) {
            if (view?.ok && view.completed) setThanks(true);
            return;
          }
          if (!checklistReady(view.items)) return;
          // A locked PDF cannot be finished without its password: the
          // accountant could not open it and the pack would stall.
          const missingPassword = view.items.find(
            (item) =>
              lockedItems[item.itemKey] &&
              !item.passwordSaved &&
              !(passwordDrafts[item.itemKey] ?? "").trim(),
          );
          if (missingPassword) {
            setNotice(CLIENT_AGENT_PASSWORD_REQUIRED);
            return;
          }
          rememberScroll();
          setBusy(true);
          setNotice(null);
          try {
            for (const item of view.items) {
              const pending = (passwordDrafts[item.itemKey] ?? "").trim();
              if (!pending) continue;
              const savedPassword = await saveItemPassword(item);
              if (!savedPassword) return;
            }
            const saved = await complete({ data: { token } });
            if (!saved.ok) {
              setNotice(saved.body);
              return;
            }
            setThanks(true);
          } catch {
            setNotice("That could not be saved.");
          } finally {
            setBusy(false);
          }
        })();
      }}
      thanks={thanks}
      onRetry={() => {
        if (busy) return;
        setAttempt((current) => current + 1);
      }}
    />
  );
}
