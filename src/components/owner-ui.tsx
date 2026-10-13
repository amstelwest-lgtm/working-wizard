/**
 * Shared owner-portal presentation primitives (premium pass).
 *
 * One header voice for every owner tab: a small uppercase eyebrow, a big
 * bold title, and a one-line plain-English lede. Styled by
 * `src/styles/owner-premium.css`; the accountant side can adopt the same
 * classes next.
 */
import type { ReactNode } from "react";

export function OwnerPageHead({
  eyebrow,
  title,
  lede,
  aside,
}: {
  eyebrow: string;
  title: string;
  lede?: ReactNode;
  aside?: ReactNode;
}) {
  return (
    <header className="owner-page-head">
      <div className="owner-page-head-main">
        <p className="owner-eyebrow">{eyebrow}</p>
        <h1 className="owner-title">{title}</h1>
        {lede ? <p className="owner-lede">{lede}</p> : null}
      </div>
      {aside ? <div className="owner-page-head-aside">{aside}</div> : null}
    </header>
  );
}
