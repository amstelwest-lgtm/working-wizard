import { useEffect } from "react";
import { useServerFn } from "@tanstack/react-start";
import { getOwnerEntitlement, startOwnerCheckout } from "@/lib/stripe-checkout.functions";
import {
  ownerCheckoutHref,
  ownerSubscribeView,
  type OwnerSubscribeView,
} from "@/lib/owner-subscribe";

/**
 * Stripe checkout stays off the owner home chunk. The door paints first.
 * This bridge fills the subscribe state once its own chunk has loaded.
 */
export function OwnerBillingBridge({
  onView,
  onSubscribe,
}: {
  onView: (view: OwnerSubscribeView) => void;
  onSubscribe: (run: () => Promise<{ href: string | null; view: OwnerSubscribeView }>) => void;
}) {
  const loadEntitlement = useServerFn(getOwnerEntitlement);
  const beginCheckout = useServerFn(startOwnerCheckout);

  useEffect(() => {
    let cancelled = false;
    void loadEntitlement({ data: {} })
      .then((entitlement) => {
        if (!cancelled) onView(ownerSubscribeView({ entitlement, checkout: null }));
      })
      .catch(() => {
        if (!cancelled) onView({ kind: "subscribe" });
      });
    return () => {
      cancelled = true;
    };
  }, [loadEntitlement, onView]);

  useEffect(() => {
    onSubscribe(async () => {
      try {
        const result = await beginCheckout({ data: { interval: "month" } });
        return {
          href: ownerCheckoutHref(result),
          view: ownerSubscribeView({ entitlement: null, checkout: result }),
        };
      } catch {
        return { href: null, view: { kind: "unavailable" } };
      }
    });
  }, [beginCheckout, onSubscribe]);

  return null;
}
