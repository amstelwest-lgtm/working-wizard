/**
 * GoTrue's password grant waits on `initializePromise` while session restore
 * refreshes a stored token. Cap that restore so sign-in can continue.
 */
export const SESSION_RECOVER_MS = 3_000;

export type InitAuth = {
  initializePromise?: Promise<unknown> | null;
};

export type RecoveryWatch = {
  done: boolean;
  failed: boolean;
  stop: () => void;
};

export function watchSessionRecovery(
  auth: InitAuth,
  pending: Promise<unknown>,
  clear: () => void,
  ms = SESSION_RECOVER_MS,
): RecoveryWatch {
  let timer: ReturnType<typeof setTimeout>;
  const watch: RecoveryWatch = {
    done: false,
    failed: false,
    stop: () => clearTimeout(timer),
  };
  const giveUp = () => {
    if (watch.done) return;
    watch.done = true;
    watch.failed = true;
    watch.stop();
    try {
      clear();
    } catch {
      /* the password grant still runs */
    }
    auth.initializePromise = Promise.resolve();
  };
  timer = setTimeout(giveUp, ms);
  pending.then(
    () => {
      if (watch.done) return;
      watch.done = true;
      watch.stop();
    },
    () => {
      giveUp();
    },
  );
  return watch;
}

/** Drop a stuck or failed restore without awaiting initializePromise. */
export function releaseForPasswordGrant(auth: InitAuth, watch: RecoveryWatch | null, clear: () => void): void {
  if (!watch || (watch.done && !watch.failed)) return;
  watch.stop();
  if (!watch.done) {
    watch.done = true;
    watch.failed = true;
  }
  try {
    clear();
  } catch {
    /* the password grant still runs */
  }
  auth.initializePromise = Promise.resolve();
}
