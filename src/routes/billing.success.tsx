import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { getCheckoutSessionStatus } from "@/lib/stripe-checkout.functions";

export const Route = createFileRoute("/billing/success")({
  validateSearch: (search: Record<string, unknown>): { session_id?: string } => {
    const session_id =
      typeof search.session_id === "string" && search.session_id.startsWith("cs_")
        ? search.session_id
        : undefined;
    return session_id ? { session_id } : {};
  },
  component: BillingSuccessPage,
  head: () => ({ meta: [{ title: "Payment received — Milōn" }] }),
});

function BillingSuccessPage() {
  const { session_id: sessionId } = Route.useSearch();
  const loadStatus = useServerFn(getCheckoutSessionStatus);
  const [label, setLabel] = useState("Checking Stripe…");

  useEffect(() => {
    if (!sessionId) {
      setLabel("Checkout finished. Open Stripe Dashboard if you need the receipt.");
      return;
    }
    let cancelled = false;
    void loadStatus({ data: { sessionId } })
      .then((result) => {
        if (cancelled) return;
        if (!result.ok) {
          setLabel("Checkout finished. Stripe status is not available on this deploy.");
          return;
        }
        if (result.paymentStatus === "paid" || result.status === "complete") {
          setLabel("Stripe confirmed the checkout. Public billing is still waitlist-only.");
          return;
        }
        setLabel(`Stripe session status: ${result.status ?? "unknown"}.`);
      })
      .catch(() => {
        if (!cancelled) {
          setLabel("Checkout finished. We could not confirm the session from here.");
        }
      });
    return () => {
      cancelled = true;
    };
  }, [sessionId, loadStatus]);

  return (
    <div className="grid min-h-screen place-items-center bg-[#0b1220] px-4 text-slate-200">
      <div className="w-full max-w-md rounded-2xl border border-white/10 bg-white/5 p-6">
        <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-amber-400">
          Billing
        </p>
        <h1 className="mt-2 text-xl font-semibold">Thanks — checkout completed</h1>
        <p className="mt-2 text-sm text-slate-400">{label}</p>
        <Link
          to="/ops"
          className="mt-5 inline-flex h-10 items-center rounded-full bg-amber-400 px-4 text-xs font-bold uppercase tracking-wider text-[#1b1300]"
        >
          Back to Lighthouse
        </Link>
      </div>
    </div>
  );
}
