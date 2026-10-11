import {
  OWNER_MANAGE_LABEL,
  OWNER_SUBSCRIBE_LABEL,
  OWNER_UNAVAILABLE_LINE,
  ownerCheckoutReturnCopy,
  ownerCoveredLine,
  type OwnerSubscribeView,
} from "@/lib/owner-subscribe";

/** Presentational plan action. The door loads entitlement and starts Checkout. */
export function OwnerSubscribe({
  view,
  busy = false,
  notice = null,
  onSubscribe,
}: {
  view: OwnerSubscribeView;
  busy?: boolean;
  notice?: "success" | "cancel" | null;
  onSubscribe?: () => void;
}) {
  const button =
    view.kind === "subscribe"
      ? OWNER_SUBSCRIBE_LABEL
      : view.kind === "manage"
        ? OWNER_MANAGE_LABEL
        : null;

  return (
    <div className="owner-subscribe" data-owner-subscribe={view.kind}>
      {notice ? (
        <p className="owner-subscribe-status" role="status">
          {ownerCheckoutReturnCopy(notice)}
        </p>
      ) : null}
      {view.kind === "covered" ? (
        <p className="owner-subscribe-status">{ownerCoveredLine(view.firmName)}</p>
      ) : null}
      {view.kind === "unavailable" ? (
        <p className="owner-subscribe-status" role="status">
          {OWNER_UNAVAILABLE_LINE}
        </p>
      ) : null}
      {button ? (
        <button
          type="button"
          className="btn gold owner-ask"
          disabled={busy || !onSubscribe}
          onClick={onSubscribe}
        >
          {button}
        </button>
      ) : null}
    </div>
  );
}
