import "./connect-books-card.css";
import { CONNECT_BOOKS_BODY, CONNECT_BOOKS_TITLE } from "@/lib/connect-books-copy";

type Props = {
  onXero: () => void;
  onQuickBooks: () => void;
  onSage: () => void;
  /** US clients do not get the Sage flow the portal already hides. */
  showSage?: boolean;
  busy?: "xero" | "qbo" | null;
};

/**
 * Primary action on the accountant client Home when no ledger is connected.
 * The buttons call the same Xero and QuickBooks starts the portal uses.
 * Sage opens the existing Sage dialog.
 */
export function ConnectBooksHomeCard({
  onXero,
  onQuickBooks,
  onSage,
  showSage = true,
  busy = null,
}: Props) {
  return (
    <section
      className="connect-books-card"
      data-connect-books="home"
      aria-labelledby="connect-books-title"
    >
      <h2 id="connect-books-title" className="connect-books-card__title">
        {CONNECT_BOOKS_TITLE}
      </h2>
      <p className="connect-books-card__body">{CONNECT_BOOKS_BODY}</p>
      <div className="connect-books-card__actions">
        <button
          type="button"
          className="connect-books-card__primary"
          data-connect-books="xero"
          aria-label="Connect Xero"
          disabled={busy != null}
          onClick={onXero}
        >
          {busy === "xero" ? "Opening Xero…" : "Xero"}
        </button>
        <button
          type="button"
          className="connect-books-card__primary"
          data-connect-books="quickbooks"
          aria-label="Connect QuickBooks"
          disabled={busy != null}
          onClick={onQuickBooks}
        >
          {busy === "qbo" ? "Opening QuickBooks…" : "QuickBooks"}
        </button>
      </div>
      {showSage ? (
        <button
          type="button"
          className="connect-books-card__sage"
          data-connect-books="sage"
          onClick={onSage}
        >
          Connect Sage
        </button>
      ) : null}
    </section>
  );
}
