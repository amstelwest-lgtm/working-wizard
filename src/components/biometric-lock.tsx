import { useEffect, useState } from "react";
import { biometricLockAvailable, type BiometricLockApi } from "@/lib/biometric-lock";

const LOCK_EVENT = "milon-biometric-lock";

/**
 * Covers the workspace until this device confirms the person.
 * It does not sign out and it does not clear the session.
 */
export function BiometricLockGate() {
  const [api, setApi] = useState<BiometricLockApi | null>(null);
  const [locked, setLocked] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const next = biometricLockAvailable();
    if (!next) return;
    setApi(next);
    let gone = false;
    const arm = () => {
      void next.enabled().then((on) => {
        if (gone || !on) return;
        setLocked(true);
      });
    };
    arm();
    window.addEventListener(LOCK_EVENT, arm);
    return () => {
      gone = true;
      window.removeEventListener(LOCK_EVENT, arm);
    };
  }, []);

  if (!api || !locked) return null;

  const unlock = () => {
    setBusy(true);
    setMessage(null);
    void api
      .unlock()
      .then((result) => {
        if (result.ok) {
          setLocked(false);
          return;
        }
        setMessage(result.message ?? "That didn't unlock. Try again.");
      })
      .catch(() => setMessage("That didn't unlock. Try again."))
      .finally(() => setBusy(false));
  };

  return (
    <div
      className="fixed inset-0 z-[80] flex items-center justify-center bg-white px-6 text-[#102A43]"
      role="dialog"
      aria-modal
      aria-labelledby="milon-lock-title"
    >
      <div className="w-full max-w-sm text-center">
        <h1 id="milon-lock-title" className="text-xl font-semibold">
          Milōn is locked
        </h1>
        <p className="mt-2 text-sm leading-6 text-[#3D5270]">
          Unlock with Face ID, Touch ID, or fingerprint. This stays on the device.
        </p>
        {message ? (
          <p role="alert" className="mt-4 text-sm text-[#8E2430]">
            {message}
          </p>
        ) : null}
        <button
          type="button"
          className="mt-6 inline-flex min-h-11 w-full items-center justify-center rounded-lg bg-[#0B5FFF] px-4 text-sm font-semibold text-white disabled:opacity-60"
          onClick={unlock}
          disabled={busy}
        >
          {busy ? "Waiting…" : "Unlock"}
        </button>
      </div>
    </div>
  );
}

/** Settings row. Hidden in a browser, where the shell API is absent. */
export function BiometricLockSetting() {
  const [api, setApi] = useState<BiometricLockApi | null>(null);
  const [enabled, setEnabled] = useState(false);
  const [ready, setReady] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const next = biometricLockAvailable();
    if (!next) return;
    let gone = false;
    setApi(next);
    void next.available().then(async (available) => {
      if (gone || !available) return;
      const on = await next.enabled();
      if (gone) return;
      setEnabled(on);
      setReady(true);
    });
    return () => {
      gone = true;
    };
  }, []);

  if (!api || !ready) return null;

  const toggle = () => {
    setBusy(true);
    setMessage(null);
    void api
      .setEnabled(!enabled)
      .then(async (result) => {
        if (!result.ok) {
          setMessage(result.message ?? "The lock did not change.");
          return;
        }
        setEnabled(await api.enabled());
      })
      .catch(() => setMessage("The lock did not change."))
      .finally(() => setBusy(false));
  };

  return (
    <section className="mb-6 rounded-xl border border-[#DBEAFE] bg-white p-4 text-[#102A43]">
      <h2 className="text-base font-semibold">Lock this device</h2>
      <p className="mt-1 text-sm leading-6 text-[#3D5270]">
        Face ID, Touch ID, or fingerprint. It stays on this device and does not sign you out.
      </p>
      {message ? (
        <p role="alert" className="mt-3 text-sm text-[#8E2430]">
          {message}
        </p>
      ) : null}
      <button
        type="button"
        className="mt-4 inline-flex min-h-11 items-center justify-center rounded-lg border border-[#DBEAFE] bg-white px-4 text-sm font-semibold text-[#102A43] disabled:opacity-60"
        onClick={toggle}
        disabled={busy}
      >
        {busy ? "Waiting…" : enabled ? "Turn lock off" : "Turn lock on"}
      </button>
    </section>
  );
}
