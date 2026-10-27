import "./connect-books-card.css";
import {
  CONNECT_BOOKS_BODY,
  CONNECT_BOOKS_TITLE,
  CONNECT_BOOKS_TITLE_WITH_SAGE,
  SAGE_NOT_SYNCED_HINT,
} from "@/lib/connect-books-copy";

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
 * Sage is the same size and opens the existing Sage dialog.
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
        {showSage ? CONNECT_BOOKS_TITLE_WITH_SAGE : CONNECT_BOOKS_TITLE}
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
        {showSage ? (
          <button
            type="button"
            className="connect-books-card__primary"
            data-connect-books="sage"
            aria-label="Connect Sage"
            disabled={busy != null}
            onClick={onSage}
          >
            Sage
          </button>
        ) : null}
      </div>
      {showSage ? (
        <p className="connect-books-card__note" data-connect-books-note="sage">
          {SAGE_NOT_SYNCED_HINT}
        </p>
      ) : null}
    </section>
  );
}
