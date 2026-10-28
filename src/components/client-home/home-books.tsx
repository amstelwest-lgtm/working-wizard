import type { ReactNode } from "react";

/** Books connection on accountant client Home. No ledger shows the connect card. */
export function HomeBooks({
  ledger,
  syncLine,
  connect,
  onManage,
}: {
  ledger: string | null;
  syncLine: string | null;
  connect: ReactNode;
  onManage: () => void;
}) {
  if (!ledger) return <>{connect}</>;
  return (
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
  );
}
