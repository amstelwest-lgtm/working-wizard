/** Records client error reports. Does not send them to Sentry. */
export const clientErrorReports: string[] = [];

export function reportClientError(error: unknown, ctx?: { source?: string }): void {
  const message = error instanceof Error ? error.message : String(error);
  clientErrorReports.push(`${ctx?.source ?? ""}:${message}`);
}

export function resetClientErrorReports(): void {
  clientErrorReports.length = 0;
}

export function setMonitoringUser(): void {}

export function monitoringEnabled(): boolean {
  return false;
}

export function initMonitoring(): Promise<null> {
  return Promise.resolve(null);
}
