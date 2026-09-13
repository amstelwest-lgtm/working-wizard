import { createFileRoute, Link } from "@tanstack/react-router";

export const Route = createFileRoute("/billing/cancel")({
  component: BillingCancelPage,
  head: () => ({ meta: [{ title: "Checkout cancelled — Milōn" }] }),
});

function BillingCancelPage() {
  return (
    <div className="grid min-h-screen place-items-center bg-[#0b1220] px-4 text-slate-200">
      <div className="w-full max-w-md rounded-2xl border border-white/10 bg-white/5 p-6">
        <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-amber-400">
          Billing
        </p>
        <h1 className="mt-2 text-xl font-semibold">Checkout cancelled</h1>
        <p className="mt-2 text-sm text-slate-400">
          Nothing was charged. You can start a test checkout again from Lighthouse when you want.
        </p>
        <Link
          to="/ops"
          className="mt-5 inline-flex h-10 items-center rounded-full border border-amber-400/40 px-4 text-xs font-bold uppercase tracking-wider text-amber-400"
        >
          Back to Lighthouse
        </Link>
      </div>
    </div>
  );
}
