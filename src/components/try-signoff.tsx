/**
 * Demo sign-off. Local only: the click paints a signature and a stamp.
 * It does not call a server function and does not write a review row.
 */
import { useState } from "react";

function Arrow() {
  return (
    <svg className="try-signoff-arrow" viewBox="0 0 128 48" aria-hidden="true">
      <path
        d="M4 30c14-16 22 14 36 6 12-7 16 10 30 4 8-3 14-8 24-10"
        fill="none"
        stroke="#0B5FFF"
        strokeWidth="2.2"
        strokeLinecap="round"
      />
      <path
        d="M92 18c8 2 16 8 26 12-10 1-16 7-24 14"
        fill="none"
        stroke="#0B5FFF"
        strokeWidth="2.2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function Signature() {
  return (
    <svg className="try-signature" viewBox="0 0 220 72" aria-hidden="true">
      <path
        className="try-signature-stroke"
        pathLength="1"
        d="M16 46c10-28 18-28 20 2 2 22 12 24 18 2 8-26 18-28 22-4 3 14 10 18 18 2 12-24 20-6 30 8 6 10 12 8 20-2 6-8 14-4 22 6"
        fill="none"
        stroke="#b8891a"
        strokeWidth="2.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function TrySignoffMark({ signed, onSign }: { signed: boolean; onSign?: () => void }) {
  return (
    <div
      className={signed ? "try-signoff is-signed" : "try-signoff"}
      data-try-signoff={signed ? "signed" : "open"}
    >
      <Arrow />
      <button
        type="button"
        className="try-signoff-btn"
        aria-pressed={signed}
        disabled={signed}
        onClick={() => onSign?.()}
      >
        Sign off
      </button>
      {signed ? (
        <div className="try-signoff-proof">
          <Signature />
          <p className="try-approved-stamp">Approved by you</p>
        </div>
      ) : null}
    </div>
  );
}

export function TrySignoff() {
  const [signed, setSigned] = useState(false);
  return <TrySignoffMark signed={signed} onSign={() => setSigned(true)} />;
}
