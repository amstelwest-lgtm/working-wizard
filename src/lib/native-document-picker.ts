import { sourceDocumentMime, sourceDocumentSizeError } from "@/lib/source-documents-ui";

export type NativePickedPayload = {
  name: string;
  mime: string;
  base64: string;
};

export type NativeDocumentPicker = {
  takePhoto: () => Promise<NativePickedPayload | null>;
  pickDocument: () => Promise<NativePickedPayload | null>;
};

export type NativePickOutcome =
  | { status: "file"; file: File }
  | { status: "cancel" }
  | { status: "error"; message: string }
  | { status: "unavailable" };

type PickerHost = {
  __MILON_NATIVE_PICKER__?: NativeDocumentPicker;
};

export function readNativePicker(host: PickerHost | undefined | null): NativeDocumentPicker | null {
  const picker = host?.__MILON_NATIVE_PICKER__;
  if (
    !picker ||
    typeof picker.takePhoto !== "function" ||
    typeof picker.pickDocument !== "function"
  ) {
    return null;
  }
  return picker;
}

/** Bytes the shell already limited. Returns null when the type or size is not allowed. */
export function fileFromNativePick(picked: NativePickedPayload): File | null {
  const name = picked.name.split(/[/\\]/).pop()?.trim() || "upload";
  const mime = sourceDocumentMime({ name, type: picked.mime });
  if (!mime || !picked.base64) return null;
  let bytes: Uint8Array;
  try {
    const binary = atob(picked.base64.replace(/\s/g, ""));
    bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  } catch {
    return null;
  }
  if (sourceDocumentSizeError(bytes.byteLength)) return null;
  return new File([bytes], name, { type: mime });
}

function outcomeFromError(error: unknown): NativePickOutcome {
  const message = error instanceof Error ? error.message : "The file could not be opened.";
  if (/not implemented|not available|UNIMPLEMENTED/i.test(message))
    return { status: "unavailable" };
  if (/permission/i.test(message)) {
    return { status: "error", message: "Allow camera access to photograph a receipt." };
  }
  return { status: "error", message };
}

/**
 * Camera and document picker inside the store shell.
 * A normal browser has no picker, so the caller keeps the file input.
 */
export async function pickNativeDocument(
  channel: "upload" | "camera",
  host?: PickerHost | null,
): Promise<NativePickOutcome> {
  const picker = readNativePicker(host === undefined ? window : host);
  if (!picker) return { status: "unavailable" };
  try {
    const picked = channel === "camera" ? await picker.takePhoto() : await picker.pickDocument();
    if (!picked) return { status: "cancel" };
    const file = fileFromNativePick(picked);
    if (!file)
      return { status: "error", message: "Use a PDF or a photo (JPEG, PNG, WebP, or HEIC)." };
    return { status: "file", file };
  } catch (error) {
    return outcomeFromError(error);
  }
}
