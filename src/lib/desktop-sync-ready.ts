/**
 * Gate desktop sync until CoS applies the migration and ops sets the env flag.
 */
export function desktopSyncSqlReady(): boolean {
  return (process.env.DESKTOP_SYNC_SQL_READY ?? "").trim() === "1";
}

export function desktopSyncClientReady(): boolean {
  const env = import.meta.env.VITE_DESKTOP_SYNC_SQL_READY as string | undefined;
  return (env ?? "").trim() === "1";
}
