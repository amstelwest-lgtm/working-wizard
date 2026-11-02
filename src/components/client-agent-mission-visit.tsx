/**
 * Public mission page. One agent, consent, a clear upload, chat, and I'm done.
 * The face is the existing silent clip. No lip-sync.
 * Finish shows thank-you for this visit. Reopening the same link shows upload again.
 */
import { usePrefersReducedMotion } from "@/hooks/use-prefers-reduced-motion";
import { SEND_FILE_MIMES } from "@/lib/client-agent-send";
import { sendAgentFace } from "@/lib/client-agent-missions";
import { avatarPoster, fmClipSources } from "@/lib/fm-avatar-state";
import type { PublicMission } from "@/lib/client-agent-link.functions";

const PRIMARY =
  "inline-flex min-h-11 items-center justify-center rounded-full bg-[#0B5FFF] px-4 text-sm font-semibold text-white hover:bg-[#2563EB] disabled:opacity-60";
const SECONDARY =
  "inline-flex min-h-11 items-center justify-center rounded-full border border-[#DBEAFE] bg-white px-4 text-sm font-semibold text-[#102A43] disabled:opacity-60";
const QUIET =
  "inline-flex min-h-11 items-center text-sm font-semibold text-[#3D5270] underline decoration-[#DBEAFE] underline-offset-4 disabled:opacity-60";

function MissionFace({
  agent,
  label,
  clip,
}: {
  agent: string;
  label: string;
  clip: "curious" | "done";
}) {
  const reduced = usePrefersReducedMotion();
  const face = sendAgentFace(agent);
  const poster = avatarPoster(face);
  const sources = fmClipSources(clip, face);
  return (
    <span
      className={`owner-presence is-${face} is-character is-idle is-lg is-fm-clip`}
      data-avatar="character"
      data-agent={face}
      role="img"
      aria-label={label}
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

export function ClientAgentMissionVisit({
  practiceName,
  mission,
  consented,
  notice,
  completed,
  busy,
  noticeText,
  messages,
  draft,
  uploadLabel,
  onAgree,
  onDraft,
  onAsk,
  onUploadLabel,
  onUpload,
  onDone,
  returnVisit = false,
  passwordPrompt = false,
  password = "",
  onPassword,
  onSavePassword,
}: {
  practiceName: string;
  mission: PublicMission;
  consented: boolean;
  notice: string;
  completed: boolean;
  busy: boolean;
  noticeText: string | null;
  messages: Array<{ role: "you" | "she"; text: string }>;
  draft: string;
  uploadLabel: string;
  onAgree: () => void;
  onDraft: (value: string) => void;
  onAsk: () => void;
  onUploadLabel: (value: string) => void;
  onUpload: (files: File[]) => void;
  onDone: () => void;
  /** The link was already finished. The client can still send more files. */
  returnVisit?: boolean;
  passwordPrompt?: boolean;
  password?: string;
  onPassword?: (value: string) => void;
  onSavePassword?: () => void;
}) {
  const showThanks = completed;
  return (
    <main
      className="mx-auto flex min-h-screen w-full max-w-3xl flex-col gap-4 bg-white px-4 py-6 text-[#102A43]"
      data-client-mission={mission.key}
    >
      <span className="owner-door -ml-3 inline-flex h-[96px] w-[96px] shrink-0 self-start overflow-hidden min-[761px]:-ml-[21.5px] min-[761px]:h-[172px] min-[761px]:w-[172px]">
        <MissionFace
          agent={mission.agent}
          label={mission.agentShortName}
          clip={showThanks ? "done" : "curious"}
        />
      </span>
      <p className="text-sm font-semibold" data-practice-name="true">
        {practiceName}
      </p>
      <h1 className="text-2xl font-semibold">{mission.agentShortName}</h1>
      {noticeText ? <p className="text-sm text-[#3D5270]">{noticeText}</p> : null}
      {!consented ? (
        <div className="flex flex-col gap-3">
          <p className="text-sm leading-6 text-[#3D5270]" data-client-intro="true">
            {mission.intro}
          </p>
          <p className="text-sm leading-6">{notice}</p>
          <button type="button" className={PRIMARY} disabled={busy} onClick={onAgree}>
            I agree
          </button>
        </div>
      ) : null}
      {consented && showThanks ? (
        <div className="flex flex-col gap-3" data-client-thanks="true">
          <p className="text-sm leading-6">{mission.thanks}</p>
        </div>
      ) : null}
      {consented && !showThanks ? (
        <div className="flex flex-col gap-4">
          <p className="text-sm leading-6 text-[#3D5270]" data-client-intro="true">
            {mission.intro}
          </p>
          {returnVisit ? (
            <p className="text-sm leading-6" data-return-visit="true">
              This link is still open. You can send more documents.
            </p>
          ) : null}
          <div className="flex flex-col gap-2" data-mission-upload="true">
            <button
              type="button"
              className={PRIMARY}
              data-upload-documents=""
              disabled={busy}
              onClick={() => document.getElementById("mission-file")?.click()}
            >
              Upload documents
            </button>
            <label className="text-sm text-[#3D5270]" htmlFor="mission-upload-label">
              What is this?
            </label>
            <input
              id="mission-upload-label"
              className="min-h-11 rounded-xl border border-[#DBEAFE] px-3 text-sm"
              maxLength={200}
              value={uploadLabel}
              disabled={busy}
              onChange={(event) => onUploadLabel(event.target.value)}
            />
            <p className="text-sm leading-6 text-[#3D5270]">
              A name is optional. The file name is used if you leave this blank.
            </p>
            <input
              id="mission-file"
              className="sr-only"
              type="file"
              accept={SEND_FILE_MIMES.join(",")}
              disabled={busy}
              onChange={(event) => {
                const files = Array.from(event.target.files ?? []);
                event.target.value = "";
                if (files.length > 0) onUpload(files);
              }}
            />
            {passwordPrompt ? (
              <div className="flex flex-col gap-2">
                <p className="text-sm leading-6">
                  That PDF has a password. Type it so your accountant can open it.
                </p>
                <label className="text-sm text-[#3D5270]" htmlFor="mission-file-password">
                  Password
                </label>
                <input
                  id="mission-file-password"
                  className="min-h-11 rounded-xl border border-[#DBEAFE] px-3 text-sm"
                  type="password"
                  value={password}
                  disabled={busy}
                  onChange={(event) => onPassword?.(event.target.value)}
                />
                <button
                  type="button"
                  className={PRIMARY}
                  disabled={busy || !password.trim()}
                  onClick={onSavePassword}
                >
                  Save password
                </button>
              </div>
            ) : null}
          </div>
          {mission.uploads.length > 0 ? (
            <ul className="flex flex-col gap-2">
              {mission.uploads.map((file) => (
                <li key={`${file.label}-${file.mime}`} className="text-sm text-[#3D5270]">
                  {file.label}
                </li>
              ))}
            </ul>
          ) : null}
          <div
            className="flex flex-col gap-2 rounded-2xl border border-[#DBEAFE] p-3"
            data-agent-chat="true"
          >
            {messages.length === 0 ? (
              <p className="text-sm leading-6 text-[#3D5270]">
                Reply in a full sentence when you are ready.
              </p>
            ) : (
              messages.map((message, index) => (
                <p
                  key={`${message.role}-${index}`}
                  className="text-sm leading-6"
                  data-chat-role={message.role}
                >
                  {message.text}
                </p>
              ))
            )}
            <label className="text-sm text-[#3D5270]" htmlFor="mission-reply">
              Your reply
            </label>
            <textarea
              id="mission-reply"
              className="min-h-24 rounded-xl border border-[#DBEAFE] px-3 py-2 text-sm"
              maxLength={2000}
              value={draft}
              disabled={busy}
              onChange={(event) => onDraft(event.target.value)}
            />
            <button
              type="button"
              className={SECONDARY}
              disabled={busy || !draft.trim()}
              onClick={onAsk}
            >
              Reply
            </button>
          </div>
          <button type="button" className={`${QUIET} self-start`} disabled={busy} onClick={onDone}>
            I'm done
          </button>
        </div>
      ) : null}
    </main>
  );
}
