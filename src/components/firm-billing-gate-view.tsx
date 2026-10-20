import type { ReactNode } from "react";
import { Link } from "@tanstack/react-router";

/**
 * What the accountant shell shows after an entitlement read.
 * `content` keeps the page. `error` is only for a firm with no known result.
 * `wall` is the unpaid resume. `skeleton` is the in-flight hold from #655.
 */
export function FirmBillingGateView({
  surface,
  notice = false,
  onRetry,
  children,
}: {
  surface: "content" | "error" | "wall" | "skeleton";
  notice?: boolean;
  onRetry?: () => void;
  children?: ReactNode;
}) {
  if (surface === "error") {
    return (
      <div className="bg-background px-6 py-8 text-foreground" data-billing-gate="pending" role="alert">
        <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-amber-400">Billing</p>
        <h1 className="mt-2 text-xl font-semibold">Couldn't check billing</h1>
        <p className="mt-2 max-w-md text-sm text-muted-foreground">
          This client file stays closed until the plan check finishes. Home, the client list, settings,
          and billing stay open.
        </p>
        <div className="mt-5 flex flex-wrap gap-2">
          <button
            type="button"
            onClick={onRetry}
            className="inline-flex h-10 items-center rounded-full bg-foreground px-4 text-xs font-bold uppercase tracking-wider text-background"
          >
            Retry
          </button>
          <Link to="/dashboard" className="inline-flex h-10 items-center px-4 text-sm underline">
            Back
          </Link>
        </div>
      </div>
    );
  }

  if (surface === "wall") {
    return (
      <div className="bg-background px-6 py-8 text-foreground" data-billing-gate="wall">
        <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-[#0B5FFF]">Billing</p>
        <h1 className="mt-2 text-xl font-semibold text-[#102A43]">This firm needs a plan</h1>
        <p className="mt-2 max-w-md text-sm text-[#102A43]">
          The last plan check says this firm is unpaid. Billing stays required.
        </p>
        <Link
          to="/billing/required"
          className="mt-5 inline-flex h-10 items-center rounded-full bg-[#0B5FFF] px-4 text-xs font-bold uppercase tracking-wider text-white"
        >
          Continue to billing
        </Link>
      </div>
    );
  }

  if (surface === "skeleton") {
    return <div data-billing-gate="skeleton">{children}</div>;
  }

  return (
    <div data-billing-gate="content">
      {notice ? (
        <p
          data-billing-gate="notice"
          className="fixed bottom-4 right-4 z-50 max-w-xs rounded-lg border border-[#DBEAFE] bg-white px-3 py-2 text-xs text-[#102A43] shadow"
        >
          Still checking this firm's plan. You can keep working.
        </p>
      ) : null}
      {children}
    </div>
  );
}
