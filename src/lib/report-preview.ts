/** A report link opens the PDF modal only when the caller asked for a preview. */
export function reportLinkOpensPreview(action: string | null | undefined): boolean {
  return action === "preview";
}

export function reportLinkRunsDownload(action: string | null | undefined): boolean {
  return action === "download";
}
