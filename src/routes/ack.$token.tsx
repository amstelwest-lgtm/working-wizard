import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { acknowledgeDelivery } from "@/lib/advisory-deliveries";

/**
 * Public acknowledgement page — /ack/:token
 * Client taps the link from a shared advisory / health summary to mark
 * the delivery ledger row as acknowledged (G17).
 */
export const Route = createFileRoute("/ack/$token")({
  component: AckPage,
  head: () => ({ meta: [{ title: "Confirm receipt — Milōn" }] }),
});

function AckPage() {
  const { token } = Route.useParams();
  const [status, setStatus] = useState<"working" | "ok" | "error">("working");
  const [message, setMessage] = useState("Confirming receipt…");

  useEffect(() => {
    let alive = true;
    (async () => {
      const res = await acknowledgeDelivery(token);
      if (!alive) return;
      if (res.ok) {
        setStatus("ok");
        setMessage("Thanks — your accountant has been notified that you received this.");
      } else {
        setStatus("error");
        setMessage(res.error ?? "This acknowledgement link is invalid or expired.");
      }
    })();
    return () => {
      alive = false;
    };
  }, [token]);

  return (
    <main className="flex min-h-screen items-center justify-center bg-[#0a0c0b] px-5 text-[#e8ede9]">
      <div className="w-full max-w-md rounded-2xl border border-white/10 bg-[#10130f] p-8 text-center">
        <p className="text-sm font-black tracking-[0.35em] text-[#d4a550]">MILŌN</p>
        <h1 className="mt-4 text-xl font-semibold tracking-tight">
          {status === "working" ? "Confirming…" : status === "ok" ? "Received" : "Couldn’t confirm"}
        </h1>
        <p
          className={`mt-3 text-sm leading-relaxed ${
            status === "error" ? "text-rose-300" : "text-[#8a938c]"
          }`}
        >
          {message}
        </p>
      </div>
    </main>
  );
}
