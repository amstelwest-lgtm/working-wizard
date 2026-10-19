/**
 * Schedule a call on the public sample. The offered instants stay on the
 * SAST window. Buttons show the visitor's own zone, named after mount so
 * the server render matches the first client render. Booking goes through
 * a server function the page passes in.
 */
import { useEffect, useMemo, useState } from "react";
import {
  callSlots,
  detectedVisitorZone,
  formatSlotButton,
  formatSlotDay,
  marketFallbackZone,
  slotClockLead,
  visitorTimeZone,
  type CallSlot,
} from "@/lib/trial-call-slots";

export type TryCallResult =
  | { ok: true; status: "saved" | "booked"; meetUrl?: string | null }
  | { ok: false; error?: string; silent?: boolean };

export type TryCallInput = {
  name: string;
  email: string;
  consent: boolean;
  honeypot: string;
  start: string;
  timeZone: string;
};

function groupByDay(slots: CallSlot[], timeZone: string): { day: string; slots: CallSlot[] }[] {
  const groups: { day: string; slots: CallSlot[] }[] = [];
  for (const slot of slots) {
    const day = formatSlotDay(slot.start, timeZone);
    const last = groups[groups.length - 1];
    if (!last || last.day !== day) groups.push({ day, slots: [slot] });
    else last.slots.push(slot);
  }
  return groups;
}

function pageMarket(): "US" | "ZA" | null {
  if (typeof window === "undefined") return null;
  const raw = new URLSearchParams(window.location.search).get("market")?.trim().toUpperCase();
  return raw === "US" || raw === "ZA" ? raw : null;
}

function fallbackMarket(market: "US" | "ZA" | null | undefined): "US" | "ZA" {
  if (market === "ZA" || market === "US") return market;
  return pageMarket() ?? "US";
}

export function TrySchedule({
  now,
  timeZone,
  market,
  onBook,
}: {
  now?: Date;
  timeZone?: string;
  /** Fallback zone when the browser zone cannot be read. */
  market?: "US" | "ZA" | null;
  onBook?: (input: TryCallInput) => Promise<TryCallResult>;
}) {
  // The server does not know the laptop zone. A passed `timeZone` is the
  // visitor's zone (tests). Otherwise the first paint stays neutral and the
  // effect reads Intl after mount, so hydration cannot disagree.
  const passed = visitorTimeZone(timeZone);
  const [frozenNow, setFrozenNow] = useState<Date | null>(passed ? (now ?? null) : null);
  const [zone, setZone] = useState(passed ?? "");
  const [local, setLocal] = useState(passed != null);
  const [shownMarket, setShownMarket] = useState<"US" | "ZA">(market === "ZA" ? "ZA" : "US");
  useEffect(() => {
    const detected = visitorTimeZone(timeZone) ?? detectedVisitorZone();
    const nextMarket = fallbackMarket(market);
    setFrozenNow((current) => current ?? now ?? new Date());
    setShownMarket(nextMarket);
    if (detected) {
      setZone(detected);
      setLocal(true);
      return;
    }
    setZone(marketFallbackZone(nextMarket));
    setLocal(false);
  }, [now, timeZone, market]);
  const groups = useMemo(
    () => (frozenNow ? groupByDay(callSlots(frozenNow), zone || "UTC") : []),
    [frozenNow, zone],
  );
  const [more, setMore] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [consent, setConsent] = useState(false);
  const [honeypot, setHoneypot] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<"saved" | "booked" | null>(null);
  const [meetUrl, setMeetUrl] = useState<string | null>(null);
  const shown = more ? groups : groups.slice(0, 2);

  return (
    <section className="try-card try-schedule" aria-label="Schedule a call" data-try-schedule>
      <h2 className="try-kicker">Schedule a call</h2>
      <p className="try-schedule-lead">
        {slotClockLead({ local, zone, when: frozenNow, market: shownMarket })}
      </p>
      {!frozenNow ? <p className="try-status">Loading times.</p> : null}
      {done ? (
        <p className="try-schedule-done" role="status">
          {done === "booked"
            ? "Booked. The Meet link is on the calendar invite."
            : "Saved. We'll confirm this time."}
          {meetUrl ? (
            <>
              {" "}
              <a href={meetUrl}>Open the Meet link</a>
            </>
          ) : null}
        </p>
      ) : (
        <form
          className="try-form"
          onSubmit={(event) => {
            event.preventDefault();
            if (!selected || !onBook) {
              setError(
                onBook ? "Pick a time from the list." : "The sample isn't available right now.",
              );
              return;
            }
            setBusy(true);
            setError(null);
            void onBook({ name, email, consent, honeypot, start: selected, timeZone: zone })
              .then((result) => {
                if (!result.ok) {
                  if (result.silent) return;
                  setError(result.error ?? "We couldn't save that time. Try again.");
                  return;
                }
                setDone(result.status);
                setMeetUrl(result.meetUrl ?? null);
              })
              .catch(() => setError("We couldn't save that time. Try again."))
              .finally(() => setBusy(false));
          }}
        >
          {shown.map((group) => (
            <fieldset key={group.day} className="try-slot-day">
              <legend>{group.day}</legend>
              <div className="try-slots">
                {group.slots.map((slot) => {
                  const iso = slot.start.toISOString();
                  return (
                    <button
                      key={iso}
                      type="button"
                      className={selected === iso ? "try-slot is-selected" : "try-slot"}
                      aria-pressed={selected === iso}
                      onClick={() => setSelected(iso)}
                    >
                      {formatSlotButton(slot.start, zone)}
                    </button>
                  );
                })}
              </div>
            </fieldset>
          ))}
          {groups.length > 2 && !more ? (
            <button type="button" className="try-slot-more" onClick={() => setMore(true)}>
              More days
            </button>
          ) : null}
          <label className="try-field" htmlFor="try-call-name">
            Name
            <input
              id="try-call-name"
              name="call_name"
              type="text"
              value={name}
              onChange={(event) => setName(event.target.value)}
              autoComplete="section-try-call name"
              required
            />
          </label>
          <label className="try-field" htmlFor="try-call-email">
            Email
            <input
              id="try-call-email"
              name="call_email"
              type="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              autoComplete="section-try-call email"
              required
            />
          </label>
          <label className="try-consent">
            <input
              type="checkbox"
              checked={consent}
              onChange={(event) => setConsent(event.target.checked)}
            />
            <span>I agree Milōn may email me about this call.</span>
          </label>
          <div className="try-hp" aria-hidden="true">
            <label>
              Leave this blank
              <input
                type="text"
                name="milon_leave_blank"
                tabIndex={-1}
                autoComplete="off"
                value={honeypot}
                onChange={(event) => setHoneypot(event.target.value)}
              />
            </label>
          </div>
          <button type="submit" className="try-step" disabled={busy}>
            Book this time
          </button>
          {error ? <p className="try-error">{error}</p> : null}
        </form>
      )}
    </section>
  );
}
