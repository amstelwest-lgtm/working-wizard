import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { acknowledgeDelivery, previewDeliveryAck } from "@/lib/advisory-deliveries";

/**
 * Public acknowledgement page — /ack/:token
 * GET is read-only (preview). Confirming receipt is an explicit button POST.
 * Email scanners prefetching this URL must not mark the delivery acknowledged.
 */
export const Route = createFileRoute("/ack/$token")({
  component: AckPage,
  head: () => ({ meta: [{ title: "Confirm receipt — Milōn" }] }),
});

function AckPage() {
  const { token } = Route.useParams();
  const [status, setStatus] = useState<"ready" | "working" | "ok" | "error">("ready");
  const [message, setMessage] = useState(
    "Tap confirm only if you actually received this from your accountant.",
  );

  useEffect(() => {
    let alive = true;
    void (async () => {
      const p = await previewDeliveryAck(token);
      if (!alive) return;
      if (!p.found) {
        setStatus("error");
        setMessage("This acknowledgement link is invalid or expired.");
        return;
      }
      if (p.already) {
        setStatus("ok");
        setMessage("This was already confirmed. Your accountant has the receipt.");
      }
    })();
    return () => {
      alive = false;
    };
  }, [token]);

  const confirm = async () => {
    setStatus("working");
    setMessage("Confirming receipt…");
    const res = await acknowledgeDelivery(token);
    if (res.ok) {
      setStatus("ok");
      setMessage("Thanks — your accountant has been notified that you received this.");
    } else {
      setStatus("error");
      setMessage(res.error ?? "This acknowledgement link is invalid or expired.");
    }
  };

  return (
    <main className="flex min-h-screen items-center justify-center bg-[#0a0c0b] px-5 text-[#e8ede9]">
      <div className="w-full max-w-md rounded-2xl border border-white/10 bg-[#10130f] p-8 text-center">
        <p className="text-sm font-black tracking-[0.35em] text-[#d4a550]">MILŌN</p>
        <h1 className="mt-4 text-xl font-semibold tracking-tight">
          {status === "working"
            ? "Confirming…"
            : status === "ok"
              ? "Received"
              : status === "error"
                ? "Couldn’t confirm"
                : "Confirm receipt"}
        </h1>
        <p
          className={`mt-3 text-sm leading-relaxed ${
            status === "error" ? "text-rose-300" : "text-[#8a938c]"
          }`}
        >
          {message}
        </p>
        {status === "ready" && (
          <button
            type="button"
            onClick={() => void confirm()}
            className="mt-6 rounded-lg bg-[#d4a550] px-5 py-2.5 text-sm font-semibold text-[#0a0c0b]"
          >
            I received this
          </button>
        )}
      </div>
    </main>
  );
}
