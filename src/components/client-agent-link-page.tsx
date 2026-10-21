/**
 * Public Tax Specialist page. Consent first, then a vertical checklist.
 * Nothing is emailed. The portrait is the silent in-app agent card.
 */
import { useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { OwnerAvatar } from "@/components/owner-door/owner-avatar";
import "@/components/owner-door/owner-door.css";
import { SEND_FILE_MAX_BYTES, SEND_FILE_MIMES } from "@/lib/client-agent-send";
import {
  CLIENT_AGENT_FILE_NOTE,
  clientAgentIntro,
  clientAgentItemHelp,
  closedLink,
  sizeAllowed,
  type ItemQuality,
} from "@/lib/client-agent-link";
import {
  consentClientAgentLink,
  finishClientAgentItem,
  openClientAgentLink,
  uploadClientAgentFile,
  type OpenLinkResult,
  type PublicItem,
} from "@/lib/client-agent-link.functions";

const PRIMARY =
  "inline-flex min-h-11 items-center justify-center rounded-full bg-[#0B5FFF] px-4 text-sm font-semibold text-white hover:bg-[#2563EB] disabled:opacity-60";
const QUIET =
  "inline-flex min-h-11 items-center text-sm font-semibold text-[#3D5270] underline decoration-[#DBEAFE] underline-offset-4 disabled:opacity-60";

export const CLIENT_AGENT_UPLOAD_INTRO =
  "Only upload what you have. If something doesn't apply to you, tap 'I don't have this' and move on.";

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
}: {
  view: OpenLinkResult | null;
  busy: boolean;
  notice: string | null;
  noteFor: string | null;
  explanation: string;
  onAgree: () => void;
  onPickFile: (item: PublicItem, file: File) => void;
  onOpenNote: (itemKey: string) => void;
  onExplanation: (value: string) => void;
  onSaveNote: (item: PublicItem) => void;
}) {
  const openView = view?.ok ? view : null;

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-xl flex-col gap-4 bg-white px-4 py-6 text-[#102A43]">
      <span
        className="owner-door inline-flex h-[96px] w-[96px] shrink-0 self-start overflow-hidden min-[761px]:h-[172px] min-[761px]:w-[172px]"
        data-client-portrait="tax_specialist"
      >
        <OwnerAvatar
          agent="tax_specialist"
          variant="character"
          size="lg"
          motion="idle"
          label="Tax Specialist"
        />
      </span>
      {openView ? (
        <p className="text-sm font-semibold" data-practice-name="true">
          {openView.practiceName}
        </p>
      ) : null}
      <h1 id="agent-link-title" className="text-2xl font-semibold">
        Tax Specialist
      </h1>
      {!view ? <p className="text-sm text-[#3D5270]">Opening this link.</p> : null}
      {view && !view.ok ? <p className="text-sm">{view.body}</p> : null}
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
      {openView?.consented ? (
        <div className="flex flex-col gap-3">
          <p className="text-sm leading-6 text-[#3D5270]">{CLIENT_AGENT_UPLOAD_INTRO}</p>
          <ol className="flex flex-col gap-3">
            {openView.items.map((item) => (
              <li
                key={item.itemKey}
                className="flex flex-col gap-3 rounded-2xl border border-[#DBEAFE] bg-white p-4"
                data-send-item={item.itemKey}
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="font-semibold">{item.label}</p>
                    <p className="mt-1 text-sm leading-6 text-[#3D5270]">
                      {clientAgentItemHelp(item)}
                    </p>
                  </div>
                  {item.hasFile ? <UploadedTick /> : null}
                </div>
                <div className="flex flex-wrap items-center gap-3">
                  <button
                    type="button"
                    className={PRIMARY}
                    disabled={busy}
                    onClick={() => document.getElementById(`upload-${item.itemKey}`)?.click()}
                  >
                    Upload
                  </button>
                  <button
                    type="button"
                    className={QUIET}
                    disabled={busy}
                    onClick={() => onOpenNote(item.itemKey)}
                  >
                    I don't have this
                  </button>
                  <input
                    id={`upload-${item.itemKey}`}
                    className="sr-only"
                    type="file"
                    accept={SEND_FILE_MIMES.join(",")}
                    disabled={busy}
                    onChange={(event) => {
                      const file = event.target.files?.[0];
                      event.target.value = "";
                      if (!file) return;
                      if (file.size > SEND_FILE_MAX_BYTES) return;
                      onPickFile(item, file);
                    }}
                  />
                </div>
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
  const [view, setView] = useState<OpenLinkResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [noteFor, setNoteFor] = useState<string | null>(null);
  const [explanation, setExplanation] = useState("");

  useEffect(() => {
    let alive = true;
    setBusy(true);
    void open({ data: { token } })
      .then((result) => {
        if (alive) setView(result);
      })
      .catch(() => {
        if (alive) setView(closedLink("unavailable"));
      })
      .finally(() => {
        if (alive) setBusy(false);
      });
    return () => {
      alive = false;
    };
  }, [open, token]);

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

  const upload = async (item: PublicItem, file: File) => {
    if (!sizeAllowed(file.size)) {
      setNotice("Use a PDF, JPG, PNG, or HEIC up to 20 MB.");
      return;
    }
    setBusy(true);
    setNotice(null);
    try {
      const base64 = await fileBase64(file);
      const saved = await uploadFile({
        data: { token, itemKey: item.itemKey, base64 },
      });
      if (!saved.ok) {
        setNotice(saved.body);
        return;
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
    />
  );
}
