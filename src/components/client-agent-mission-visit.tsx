/**
 * Public mission page. One agent, consent, a clear upload, chat, and I'm done.
 * The face is the existing silent clip. No lip-sync.
 * Finish shows thank-you for this visit. Reopening the same link shows upload again.
 */
import { FileText, Loader2, X } from "lucide-react";
import { usePrefersReducedMotion } from "@/hooks/use-prefers-reduced-motion";
import { CLIENT_UPLOAD_ACCEPT } from "@/lib/client-agent-link";
import { sendAgentFace } from "@/lib/client-agent-missions";
import { formatBytes } from "@/lib/client-documents";
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
  onRemoveUpload,
  onDone,
  uploading = false,
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
  onRemoveUpload?: (file: { id?: string; label: string }) => void;
  onDone: () => void;
  /** True only while a file is being saved. */
  uploading?: boolean;
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
      {noticeText && (!consented || showThanks) ? (
        <p
          role="alert"
          data-upload-notice=""
          className="rounded-xl border border-[#DBEAFE] bg-[#F4F8FF] px-3 py-2 text-sm text-[#102A43]"
        >
          {noticeText}
        </p>
      ) : null}
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
          <div
            className="flex flex-col gap-2"
            data-mission-upload="true"
            onDragOver={(event) => event.preventDefault()}
            onDrop={(event) => {
              event.preventDefault();
              if (busy) return;
              const files = Array.from(event.dataTransfer.files);
              if (files.length > 0) onUpload(files);
            }}
          >
            <button
              type="button"
              className={PRIMARY}
              data-upload-documents=""
              aria-busy={uploading}
              disabled={busy || uploading}
              onClick={() => document.getElementById("mission-file")?.click()}
            >
              {uploading ? (
                <>
                  <Loader2
                    className="mr-2 h-4 w-4 animate-spin"
                    aria-hidden
                    data-upload-spinner=""
                  />
                  Uploading…
                </>
              ) : (
                "Upload documents"
              )}
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
            {noticeText ? (
              <p
                role="alert"
                data-upload-notice=""
                data-upload-error=""
                className="rounded-xl border border-[#DBEAFE] bg-[#F4F8FF] px-3 py-2 text-sm text-[#102A43]"
              >
                {noticeText}
              </p>
            ) : null}
            <input
              id="mission-file"
              className="sr-only"
              type="file"
              accept={CLIENT_UPLOAD_ACCEPT}
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
            <ul className="flex flex-col gap-2" data-upload-chips="">
              {mission.uploads.map((file, index) => {
                const size = formatBytes(file.sizeBytes ?? undefined);
                return (
                  <li
                    key={file.id ?? `${file.label}-${index}`}
                    className="flex items-center gap-3 rounded-2xl border border-[#DBEAFE] bg-[#F4F8FF] px-3 py-2"
                    data-upload-chip=""
                  >
                    <FileText className="h-5 w-5 shrink-0 text-[#0B5FFF]" aria-hidden />
                    <span className="min-w-0 flex-1">
                      <span
                        className="block truncate text-sm font-semibold"
                        data-upload-chip-name=""
                      >
                        {file.label}
                      </span>
                      {size ? (
                        <span className="block text-sm text-[#3D5270]" data-upload-chip-size="">
                          {size}
                        </span>
                      ) : null}
                    </span>
                    <button
                      type="button"
                      className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-[#3D5270] hover:bg-white disabled:opacity-60"
                      aria-label={`Remove ${file.label}`}
                      data-upload-chip-remove=""
                      disabled={busy || uploading}
                      onClick={() => onRemoveUpload?.(file)}
                    >
                      <X className="h-4 w-4" aria-hidden />
                    </button>
                  </li>
                );
              })}
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
