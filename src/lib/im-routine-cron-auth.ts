/**
 * Vercel cron bearer check for IM routine scheduler. Fail closed when unset.
 */
import { timingSafeEqual } from "node:crypto";

function cronSecret(): string {
  return (process.env.CRON_SECRET || "").trim();
}

export function cronSecretConfigured(): boolean {
  return cronSecret().length > 0;
}

export function hasValidCronBearer(request: Request): boolean {
  const expected = cronSecret();
  if (!expected) return false;
  const auth = request.headers.get("authorization") || "";
  if (!auth.toLowerCase().startsWith("bearer ")) return false;
  const bearer = auth.slice(7).trim();
  const a = Buffer.from(bearer);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

export function imRoutineCronKillSwitchOn(): boolean {
  return (process.env.IM_ROUTINE_CRON_ENABLED || "").trim() === "true";
}

export function imRoutineCronMaxFirms(): number {
  const raw = Number((process.env.IM_ROUTINE_CRON_MAX_FIRMS || "5").trim());
  return Number.isFinite(raw) && raw >= 1 ? Math.floor(raw) : 5;
}

export function imRoutineCronMaxInvokes(): number {
  const raw = Number((process.env.IM_ROUTINE_CRON_MAX_INVOKES || "20").trim());
  return Number.isFinite(raw) && raw >= 1 ? Math.floor(raw) : 20;
}

export function imRoutineCronFirmDailyCap(): number {
  const raw = Number((process.env.IM_ROUTINE_CRON_FIRM_DAILY_CAP || "10").trim());
  return Number.isFinite(raw) && raw >= 0 ? Math.floor(raw) : 10;
}