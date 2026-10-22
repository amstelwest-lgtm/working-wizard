/**
 * Public Tax Specialist page. Consent first, then a vertical checklist.
 * Finish asks the server to store the files and tell the practice.
 * The page never emails the client. The portrait is the silent in-app agent card.
 */
import { useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import "@/components/owner-door/owner-door.css";
import { usePrefersReducedMotion } from "@/hooks/use-prefers-reduced-motion";
import { SEND_FILE_MAX_BYTES, SEND_FILE_MIMES } from "@/lib/client-agent-send";
import {
  CLIENT_AGENT_FILE_NOTE,
  checklistReady,
  clientAgentIntro,
  clientAgentItemHelp,
  clientAgentThanks,
  itemSettled,
  sizeAllowed,
  type ItemQuality,
} from "@/lib/client-agent-link";
import {
  askClientAgentLink,
  completeClientAgentSend,
  consentClientAgentLink,
  finishClientAgentItem,
  openClientAgentLink,
  saveClientAgentFilePassword,
  uploadClientAgentFile,
  type OpenLinkResult,
  type PublicItem,
} from "@/lib/client-agent-link.functions";
import { avatarPoster, fmClipSources } from "@/lib/fm-avatar-state";

const PRIMARY =
  "inline-flex min-h-11 items-center justify-center rounded-full bg-[#0B5FFF] px-4 text-sm font-semibold text-white hover:bg-[#2563EB] disabled:opacity-60";
const QUIET =
  "inline-flex min-h-11 items-center text-sm font-semibold text-[#3D5270] underline decoration-[#DBEAFE] underline-offset-4 disabled:opacity-60";

export const CLIENT_AGENT_UPLOAD_INTRO =
  "Only upload what you have. If something doesn't apply to you, tap 'I don't have this' and move on.";

export const CLIENT_AGENT_LOAD_ERROR = "Couldn't load, try again";

function fileBase64(file: File): Promise<string> {
  return file.arrayBuffer().then((buffer) => {
    const bytes = new Uint8Array(buffer);
    let binary = "";
    const chunk = 0x8000;
    for (let i = 0; i < bytes.length; i += chunk) {
      binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
    }
    return btoa(binary);
  });
}

function TaxSpecialistHero() {
  const reduced = usePrefersReducedMotion();
  const poster = avatarPoster("tax_specialist");
  const sources = fmClipSources("curious", "tax_specialist");
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

function UploadedTick() {
  return (
    <span
      className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-[#0B5FFF] text-white"
      aria-label="Uploaded"
      data-upload-tick="true"
    >
      <svg viewBox="0 0 16 16" className="h-4 w-4" aria-hidden="true">
        <path
          d="M3.5 8.2 6.4 11 12.5 4.8"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
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
  onOpenNote,
  onExplanation,
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
  onPickFile: (item: PublicItem, files: File[]) => void;
  onOpenNote: (itemKey: string) => void;
  onExplanation: (value: string) => void;
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
  const thankYou = openView
    ? clientAgentThanks({
        firstName: openView.firstName ?? null,
        practiceName: openView.practiceName,
      })
    : null;

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-3xl flex-col gap-4 bg-white px-4 py-6 text-[#102A43]">
      <span
        className="owner-door -ml-3 inline-flex h-[96px] w-[96px] shrink-0 self-start overflow-hidden min-[761px]:-ml-[21.5px] min-[761px]:h-[172px] min-[761px]:w-[172px]"
        data-client-portrait="tax_specialist"
      >
        <TaxSpecialistHero />
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
      {view && !view.ok && !loadFailed ? <p className="text-sm">{view.body}</p> : null}
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
      {openView?.consented && thanks && thankYou ? (
        <div className="flex flex-col gap-3" data-client-thanks="true">
          <p className="text-lg font-semibold">{thankYou.greeting}</p>
          <p className="text-sm leading-6">{thankYou.body}</p>
          <p className="text-sm font-semibold">{thankYou.signoff}</p>
        </div>
      ) : null}
      {openView?.consented && !thanks ? (
        <div className="flex flex-col gap-3">
          <p className="text-sm leading-6 text-[#3D5270]">{CLIENT_AGENT_UPLOAD_INTRO}</p>
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
                    onClick={() => onOpenNote(item.itemKey)}
                  >
                    I don't have this
                  </button>
                  {itemSettled(item) ? <UploadedTick /> : <span className="h-11 w-11" />}
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
                    onPickFile(item, files);
                  }}
                />
                {item.hasFile ? (
                  item.passwordSaved ? (
                    <p className="text-sm text-[#3D5270]" data-file-password-saved={item.itemKey}>
                      Saved
                    </p>
                  ) : (
                    <label className="text-sm text-[#3D5270]" data-file-password={item.itemKey}>
                      File password (if it has one)
                      <input
                        type="password"
                        className="mt-1 min-h-11 w-full rounded-xl border border-[#DBEAFE] px-2 text-sm text-[#102A43]"
                        value={passwordDrafts[item.itemKey] ?? ""}
                        maxLength={80}
                        autoComplete="off"
                        onChange={(event) => onPasswordDraft?.(item.itemKey, event.target.value)}
                      />
                      <button
                        type="button"
                        className={`${QUIET} mt-1`}
                        disabled={busy || (passwordDrafts[item.itemKey] ?? "").trim().length === 0}
                        onClick={() => onPassword?.(item)}
                      >
                        Save password
                      </button>
                    </label>
                  )
                ) : null}
                {noteFor === item.itemKey ? (
                  <div className="flex flex-col gap-2" data-missing-note={item.itemKey}>
                    <label className="text-sm text-[#3D5270]">
                      Optional note
                      <textarea
                        className="mt-1 min-h-11 w-full rounded-xl border border-[#DBEAFE] p-2 text-sm text-[#102A43]"
                        value={explanation}
                        maxLength={2000}
                        onChange={(event) => onExplanation(event.target.value)}
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
            onClick={onNext}
          >
            Finish
          </button>
        </div>
      ) : null}
      {notice ? <p className="text-sm text-[#3D5270]">{notice}</p> : null}
    </main>
  );
}

export function ClientAgentLinkPage({ token }: { token: string }) {
  const open = useServerFn(openClientAgentLink);
  const agree = useServerFn(consentClientAgentLink);
  const uploadFile = useServerFn(uploadClientAgentFile);
  const finish = useServerFn(finishClientAgentItem);
  const savePassword = useServerFn(saveClientAgentFilePassword);
  const ask = useServerFn(askClientAgentLink);
  const complete = useServerFn(completeClientAgentSend);
  const [view, setView] = useState<OpenLinkResult | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [noteFor, setNoteFor] = useState<string | null>(null);
  const [explanation, setExplanation] = useState("");
  const [chatOpen, setChatOpen] = useState(false);
  const [chatMessages, setChatMessages] = useState<Array<{ role: "you" | "she"; text: string }>>(
    [],
  );
  const [chatDraft, setChatDraft] = useState("");
  const [passwordDrafts, setPasswordDrafts] = useState<Record<string, string>>({});
  const [thanks, setThanks] = useState(false);

  useEffect(() => {
    let alive = true;
    setBusy(true);
    void open({ data: { token } })
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
  }, [open, token, attempt]);

  const onAgree = async () => {
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

  const upload = async (item: PublicItem, files: File[]) => {
    const accepted = files.filter((file) => sizeAllowed(file.size));
    if (accepted.length === 0) {
      setNotice("Use a PDF, JPG, PNG, or HEIC up to 20 MB.");
      return;
    }
    setBusy(true);
    setNotice(files.length === accepted.length ? null : "Use a PDF, JPG, PNG, or HEIC up to 20 MB.");
    try {
      for (const file of accepted) {
        const base64 = await fileBase64(file);
        const saved = await uploadFile({
          data: { token, itemKey: item.itemKey, base64 },
        });
        if (!saved.ok) {
          setNotice(saved.body);
          setView(await open({ data: { token } }));
          return;
        }
      }
      setNoteFor(null);
      setExplanation("");
      setView(await open({ data: { token } }));
    } catch {
      setNotice("The document could not be saved.");
    } finally {
      setBusy(false);
    }
  };

  const onPassword = async (item: PublicItem) => {
    const password = (passwordDrafts[item.itemKey] ?? "").trim();
    if (!password) return;
    setBusy(true);
    setNotice(null);
    try {
      const saved = await savePassword({
        data: { token, itemKey: item.itemKey, password },
      });
      setPasswordDrafts((current) => ({ ...current, [item.itemKey]: "" }));
      if (!saved.ok) {
        setNotice(saved.body);
        return;
      }
      setView(await open({ data: { token } }));
    } catch {
      setPasswordDrafts((current) => ({ ...current, [item.itemKey]: "" }));
      setNotice("That could not be saved.");
    } finally {
      setBusy(false);
    }
  };

  const onAsk = async () => {
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

  const onNote = async (item: PublicItem) => {
    setBusy(true);
    setNotice(null);
    const note = explanation.trim() || "I don't have this.";
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
      setNoteFor(null);
      setExplanation("");
      setView(await open({ data: { token } }));
    } catch {
      setNotice("That could not be saved.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <ClientAgentLinkScreen
      view={view}
      busy={busy}
      notice={notice}
      noteFor={noteFor}
      explanation={explanation}
      onAgree={() => void onAgree()}
      onPickFile={(item, file) => void upload(item, file)}
      onOpenNote={(itemKey) => {
        setNoteFor(itemKey);
        setExplanation("");
      }}
      onExplanation={setExplanation}
      onSaveNote={(item) => void onNote(item)}
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
          if (!view?.ok || !checklistReady(view.items)) return;
          setBusy(true);
          setNotice(null);
          try {
            const result = await complete({ data: { token } });
            if (!result.ok) {
              setNotice(result.body);
              return;
            }
            setThanks(true);
          } catch {
            setNotice("That could not be finished. Please try again.");
          } finally {
            setBusy(false);
          }
        })();
      }}
      thanks={thanks || Boolean(view?.ok && view.completed)}
      onRetry={() => {
        if (busy) return;
        setAttempt((current) => current + 1);
      }}
    />
  );
}
