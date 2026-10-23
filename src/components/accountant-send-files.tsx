/**
 * Files a client uploaded on a send. A saved password stays masked until
 * the accountant asks for it. The plaintext is a prop from the page, held
 * in memory there, and is not written to storage or analytics.
 */
import { SEND_ITEM_KEYS, SEND_ITEM_LABELS, type SendItemKey } from "@/lib/client-agent-send";

const QUIET =
  "inline-flex min-h-11 items-center justify-center rounded-full border border-[#0B5FFF] bg-white px-4 text-sm font-semibold text-[#102A43] hover:bg-[#F4F8FF] disabled:opacity-60";

export type AccountantSendFile = {
  id: string;
  itemKey: string;
  displayName: string | null;
  hasPassword: boolean;
  /** The shared copy in the client's documents — set as soon as the upload is stored. */
  documentPath: string | null;
};

export type ShownFilePassword = {
  fileId: string;
  password: string;
  visible: boolean;
};

function documentLabel(itemKey: string): string {
  if ((SEND_ITEM_KEYS as readonly string[]).includes(itemKey)) {
    return SEND_ITEM_LABELS[itemKey as SendItemKey];
  }
  return "Document";
}

export function AccountantSendFileList({
  files,
  revealed,
  busyFileId,
  onShow,
  onToggleVisible,
  onCopy,
  onOpen,
}: {
  files: readonly AccountantSendFile[];
  revealed: ShownFilePassword | null;
  busyFileId: string | null;
  onShow: (fileId: string) => void;
  onToggleVisible: () => void;
  onCopy: () => void;
  onOpen?: (documentPath: string) => void;
}) {
  if (files.length === 0) return null;
  return (
    <div className="flex flex-col gap-3" data-accountant-file-list="">
      <h3 className="text-sm font-semibold">Files</h3>
      {files.map((file) => {
        const label = documentLabel(file.itemKey);
        const title = file.displayName || label;
        const shown = revealed?.fileId === file.id ? revealed : null;
        return (
          <div
            key={file.id}
            className="flex flex-col gap-2 rounded-xl border border-[#DBEAFE] p-3"
            data-send-file={file.id}
          >
            <p className="text-sm font-semibold">{title}</p>
            {file.displayName && file.displayName !== label ? (
              <p className="text-sm text-[#3D5270]">{label}</p>
            ) : null}
            {file.documentPath && onOpen ? (
              <button
                type="button"
                className={QUIET}
                data-open-file={file.id}
                onClick={() => onOpen(file.documentPath as string)}
              >
                Open in Documents
              </button>
            ) : null}
            {file.hasPassword && !shown ? (
              <button
                type="button"
                className={QUIET}
                data-show-password=""
                disabled={busyFileId === file.id}
                onClick={() => onShow(file.id)}
              >
                Show password
              </button>
            ) : null}
            {shown ? (
              <div
                className="flex flex-col gap-2"
                data-file-password={shown.visible ? "revealed" : "masked"}
              >
                <input
                  readOnly
                  translate="no"
                  spellCheck={false}
                  autoComplete="off"
                  aria-label="File password"
                  type={shown.visible ? "text" : "password"}
                  value={shown.password}
                  className="notranslate w-full rounded-xl border border-[#DBEAFE] bg-white px-3 py-2 text-sm text-[#102A43]"
                  onFocus={(event) => event.currentTarget.select()}
                />
                <button
                  type="button"
                  className={QUIET}
                  data-reveal-password=""
                  aria-pressed={shown.visible}
                  onClick={onToggleVisible}
                >
                  {shown.visible ? "Hide" : "Reveal"}
                </button>
                <button type="button" className={QUIET} data-copy-password="" onClick={onCopy}>
                  Copy
                </button>
              </div>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}
