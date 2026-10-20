/**
 * Settings, the trial block, and Start here all ask for the same plan line.
 * Share one server call per firm for a minute.
 */

const TTL_MS = 60_000;

const cached = new Map<string, { at: number; value: unknown }>();
const inflight = new Map<string, Promise<unknown>>();

export function readCachedFirmPlan<T>(
  firmId: string | null,
  load: (input: { data: { firmId: string | null } }) => Promise<T>,
): Promise<T> {
  const key = firmId ?? "";
  const hit = cached.get(key);
  if (hit && Date.now() - hit.at < TTL_MS) return Promise.resolve(hit.value as T);
  const pending = inflight.get(key);
  if (pending) return pending as Promise<T>;
  const next = load({ data: { firmId } }).then(
    (value) => {
      cached.set(key, { at: Date.now(), value });
      inflight.delete(key);
      return value;
    },
    (err: unknown) => {
      inflight.delete(key);
      throw err;
    },
  );
  inflight.set(key, next);
  return next;
}
