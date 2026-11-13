import type { ReactNode } from "react";

/** Books connection on accountant client Home. No ledger shows the connect card. */
export function HomeBooks({
  ledger,
  pending = false,
  syncLine,
  connect,
  setupPartner,
  onManage,
}: {
  ledger: string | null;
  /** Status is still out. Do not show the connect card or a ledger name. */
  pending?: boolean;
  syncLine: string | null;
  connect: ReactNode;
  /** Shown with Books whether or not a ledger is connected (e.g. Implementation Manager). */
  setupPartner?: ReactNode;
  onManage: () => void;
}) {
  if (pending) {
    return <>{setupPartner}</>;
  }
  if (!ledger) {
    return (
      <>
        {connect}
        {setupPartner}
      </>
    );
  }
  return (
    <>
      <div className="home-books" data-home-books="connected">
        <div className="home-books__text">
          <span className="home-books__label">Connected</span>
          <span className="home-books__title">{ledger}</span>
          {syncLine ? <span className="home-books__detail">{syncLine}</span> : null}
        </div>
        <button type="button" className="home-attn__cta" onClick={onManage}>
          Manage connection
        </button>
      </div>
      {setupPartner}
    </>
  );
}
