/**
 * Gate desktop sync until CoS applies the migration and ops sets the env flag.
 */
export function desktopSyncSqlReady(): boolean {
  const value = (process.env.DESKTOP_SYNC_SQL_READY ?? "").trim().toLowerCase();
  return value === "1" || value === "true" || value === "yes";
}

export function desktopSyncClientReady(): boolean {
  const env = import.meta.env.VITE_DESKTOP_SYNC_SQL_READY as string | undefined;
  const value = (env ?? "").trim().toLowerCase();
  return value === "1" || value === "true" || value === "yes";
}