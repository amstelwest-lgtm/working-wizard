/**
 * Accountant inbox + listing (P3) — firm side, on the dashboard.
 *
 * Inbox: owner requests to this firm, each with the owner's line and a link to
 * the client (the pack is what they judge). Accept attaches the client; decline
 * sends a short note. Listing: the firm's marketplace card — listed / accepting,
 * headline, tags. Both live in one section so a firm sees supply and demand in
 * one place.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { Check, ChevronDown, ChevronUp, Inbox, Loader2, Store, X } from "lucide-react";
import { toast } from "sonner";
import { useTrack } from "@/hooks/use-track";
import { requestStatusLabel, type AccountantRequest, type FirmListing } from "@/lib/marketplace";
import {
  getFirmListing,
  listFirmInbox,
  respondToAccountantRequest,
  upsertFirmListing,
} from "@/lib/marketplace.functions";

type Props = {
  firmId: string | null;
  onChanged?: () => void;
  className?: string;
  /** Practice home: one collapsed line unless a request is waiting. */
  quiet?: boolean;
};

const GOLD_BTN =
  "inline-flex items-center gap-1.5 rounded-lg bg-gradient-to-b from-[#f3d98a] via-[#d4a550] to-[#b7872a] px-3 py-1.5 text-[12px] font-bold text-[#1b1300] disabled:opacity-50";
const GHOST_BTN =
  "inline-flex items-center gap-1.5 rounded-lg border border-slate-300/70 px-2.5 py-1.5 text-[12px] font-semibold text-slate-600 disabled:opacity-50 dark:border-white/15 dark:text-slate-300";
const INPUT =
  "w-full rounded-md border border-slate-300/70 bg-white px-2 py-1.5 text-[12.5px] font-normal text-slate-900 dark:border-white/15 dark:bg-transparent dark:text-slate-100";

export function AccountantInbox({ firmId, onChanged, className, quiet }: Props) {
  const track = useTrack();
  const fetchInbox = useServerFn(listFirmInbox);
  const fetchListing = useServerFn(getFirmListing);
  const respond = useServerFn(respondToAccountantRequest);
  const save = useServerFn(upsertFirmListing);

  const [requests, setRequests] = useState<AccountantRequest[]>([]);
  const [listing, setListing] = useState<FirmListing | null>(null);
  const [migrated, setMigrated] = useState(true);
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [declining, setDeclining] = useState<string | null>(null);
  const [note, setNote] = useState("");
  const [showListing, setShowListing] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const [form, setForm] = useState({
    isListed: false,
    accepting: true,
    headline: "",
    bio: "",
    industries: "",
    regions: "",
    services: "",
    contactEmail: "",
  });
  const seq = useRef(0);
  const foldRef = useRef<HTMLDetailsElement>(null);

  const load = useCallback(async () => {
    if (!firmId) return;
    const mine = ++seq.current;
    try {
      const [inbox, l] = await Promise.all([
        fetchInbox({ data: { firmId } }),
        fetchListing({ data: { firmId } }),
      ]);
      if (mine !== seq.current) return;
      setMigrated(inbox.migrated && l.migrated);
      setRequests(inbox.requests);
      setListing(l.listing);
      if (l.listing) {
        setForm({
          isListed: l.listing.is_listed,
          accepting: l.listing.accepting,
          headline: l.listing.headline ?? "",
          bio: l.listing.bio ?? "",
          industries: l.listing.industries.join(", "),
          regions: l.listing.regions.join(", "),
          services: l.listing.services.join(", "),
          contactEmail: l.listing.contact_email ?? "",
        });
      }
    } catch {
      if (mine !== seq.current) return;
      setRequests([]);
    } finally {
      if (mine === seq.current) setLoaded(true);
    }
  }, [firmId, fetchInbox, fetchListing]);

  useEffect(() => {
    if (!firmId) return;
    void load();
  }, [firmId, load]);

  useEffect(() => {
    if (!quiet || !loaded || !foldRef.current) return;
    if (requests.some((r) => r.status === "open")) foldRef.current.open = true;
  }, [quiet, loaded, requests]);

  const decide = async (r: AccountantRequest, accept: boolean) => {
    if (busy) return;
    setBusy(r.id);
    try {
      const res = await respond({
        data: { requestId: r.id, accept, note: note.trim() || undefined },
      });
      track("accountant_request_answered", { firmId, requestId: r.id, status: res.status });
      toast.success(
        accept ? `${r.client_name ?? "Client"} is now attached to your firm` : "Request declined",
      );
      setDeclining(null);
      setNote("");
      await load();
      onChanged?.();
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : "Could not respond.");
    } finally {
      setBusy(null);
    }
  };

  const saveListing = async () => {
    if (!firmId || busy) return;
    setBusy("listing");
    try {
      const res = await save({ data: { firmId, ...form } });
      setListing(res.listing);
      track("firm_listing_saved", { firmId, listed: res.listing.is_listed });
      toast.success(
        res.listing.is_listed ? "Your firm is listed" : "Listing saved (not visible to owners)",
      );
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : "Could not save the listing.");
    } finally {
      setBusy(null);
    }
  };

  if (!firmId || !loaded || !migrated) return null;

  const open = requests.filter((r) => r.status === "open");
  const history = requests.filter((r) => r.status !== "open");
  const shell = [
    "rounded-2xl border border-[#b7872a]/25 bg-white/70 p-4 shadow-sm dark:border-[#d4a550]/20 dark:bg-white/[0.035]",
    className,
  ]
    .filter(Boolean)
    .join(" ");

  const summary =
    open.length > 0
      ? `${open.length} request${open.length === 1 ? "" : "s"}`
      : listing?.is_listed
        ? "No new requests"
        : "List your firm";

  const heading = (
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div>
        <span className="block text-[9.5px] font-bold uppercase tracking-[0.22em] text-[#9a7014] dark:text-[#e1b85e]">
          Marketplace
        </span>
        <h3 className="mt-0.5 flex items-center gap-1.5 text-[15px] font-bold leading-tight text-slate-900 dark:text-[#f4e7c2]">
          <Inbox className="h-4 w-4 text-[#b7872a]" aria-hidden />
          {open.length === 0
            ? listing?.is_listed
              ? "No new requests"
              : "Your firm is not listed yet"
            : `${open.length} business${open.length === 1 ? "" : "es"} asking for your review`}
        </h3>
        <p className="mt-1 max-w-[64ch] text-[12px] leading-relaxed text-slate-600 dark:text-slate-300/80">
          {listing?.is_listed
            ? "Owners running MILŌN alone can ask you to review their advisory pack. Accepting attaches them to your firm: packs come to you for sign-off and they appear in your portfolio."
            : "List your firm and owners who run MILŌN without an accountant can ask you to review their pack. You judge the work MILŌN has already done, not raw statements."}
        </p>
      </div>
      <button
        type="button"
        onClick={() => setShowListing((v) => !v)}
        className={GHOST_BTN}
        aria-expanded={showListing}
        data-listing-toggle
      >
        <Store className="h-3.5 w-3.5" aria-hidden />{" "}
        {listing?.is_listed ? "Edit listing" : "List your firm"}
      </button>
    </div>
  );

  const body = (
    <>
      {heading}

      {showListing ? (
        <form
          className="mt-3 grid gap-2 rounded-xl border border-dashed border-[#b7872a]/35 p-3 sm:grid-cols-2"
          onSubmit={(e) => {
            e.preventDefault();
            void saveListing();
          }}
          data-listing-form
        >
          <label className="flex items-center gap-2 text-[12px] font-semibold text-slate-700 dark:text-slate-200">
            <input
              type="checkbox"
              checked={form.isListed}
              onChange={(e) => setForm({ ...form, isListed: e.target.checked })}
            />
            Visible to owners
          </label>
          <label className="flex items-center gap-2 text-[12px] font-semibold text-slate-700 dark:text-slate-200">
            <input
              type="checkbox"
              checked={form.accepting}
              onChange={(e) => setForm({ ...form, accepting: e.target.checked })}
            />
            Taking new clients
          </label>
          <label className="text-[11px] font-semibold text-slate-600 dark:text-slate-300 sm:col-span-2">
            One-line headline
            <input
              value={form.headline}
              onChange={(e) => setForm({ ...form, headline: e.target.value })}
              maxLength={140}
              className={INPUT}
              placeholder="e.g. Cash-flow specialists for owner-run businesses"
            />
          </label>
          <label className="text-[11px] font-semibold text-slate-600 dark:text-slate-300 sm:col-span-2">
            About the firm
            <textarea
              value={form.bio}
              onChange={(e) => setForm({ ...form, bio: e.target.value })}
              maxLength={1500}
              rows={3}
              className={INPUT}
            />
          </label>
          <label className="text-[11px] font-semibold text-slate-600 dark:text-slate-300">
            Industries (comma-separated; matched to the owner's business type)
            <input
              value={form.industries}
              onChange={(e) => setForm({ ...form, industries: e.target.value })}
              className={INPUT}
              placeholder="retail, hospitality, trades"
            />
          </label>
          <label className="text-[11px] font-semibold text-slate-600 dark:text-slate-300">
            Regions (country / state codes: za, us, tx)
            <input
              value={form.regions}
              onChange={(e) => setForm({ ...form, regions: e.target.value })}
              className={INPUT}
              placeholder="za"
            />
          </label>
          <label className="text-[11px] font-semibold text-slate-600 dark:text-slate-300">
            Services
            <input
              value={form.services}
              onChange={(e) => setForm({ ...form, services: e.target.value })}
              className={INPUT}
              placeholder="advisory, tax, payroll"
            />
          </label>
          <label className="text-[11px] font-semibold text-slate-600 dark:text-slate-300">
            Contact email (optional)
            <input
              value={form.contactEmail}
              onChange={(e) => setForm({ ...form, contactEmail: e.target.value })}
              className={INPUT}
              type="email"
            />
          </label>
          <div className="sm:col-span-2">
            <button type="submit" disabled={busy !== null} className={GOLD_BTN}>
              {busy === "listing" ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
              ) : (
                <Check className="h-3.5 w-3.5" aria-hidden />
              )}
              Save listing
            </button>
          </div>
        </form>
      ) : null}

      {open.length > 0 ? (
        <ul className="mt-3 space-y-2" data-inbox>
          {open.map((r) => (
            <li
              key={r.id}
              data-request={r.id}
              className="rounded-xl border border-[#b7872a]/20 bg-white/60 p-3 dark:border-white/10 dark:bg-white/[0.03]"
            >
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="min-w-0 flex-1">
                  <p className="text-[14px] font-semibold text-slate-900 dark:text-[#f4e7c2]">
                    <Link
                      to="/clients/$clientId"
                      params={{ clientId: r.client_id }}
                      search={{ tab: "advisory" } as never}
                      className="underline-offset-2 hover:underline"
                    >
                      {r.client_name ?? "A business"}
                    </Link>
                    {r.match_score !== null ? (
                      <span className="ml-2 text-[11px] font-normal text-slate-500">
                        match {r.match_score}/6
                      </span>
                    ) : null}
                  </p>
                  {r.message ? (
                    <p className="mt-0.5 text-[12.5px] italic text-slate-700 dark:text-slate-200/85">
                      “{r.message}”
                    </p>
                  ) : null}
                  <p className="mt-1 text-[11px] text-slate-500 dark:text-slate-400">
                    {r.pack_id
                      ? "Their current advisory pack is attached — open the client to read it."
                      : "No pack yet; open the client to see the figures MILŌN has."}
                  </p>
                </div>
                {declining !== r.id ? (
                  <div className="flex items-center gap-1.5">
                    <button
                      type="button"
                      onClick={() => void decide(r, true)}
                      disabled={busy !== null}
                      className={GOLD_BTN}
                      data-accept
                    >
                      {busy === r.id ? (
                        <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
                      ) : (
                        <Check className="h-3.5 w-3.5" aria-hidden />
                      )}
                      Accept
                    </button>
                    <button
                      type="button"
                      onClick={() => setDeclining(r.id)}
                      disabled={busy !== null}
                      className={GHOST_BTN}
                      data-decline
                    >
                      <X className="h-3.5 w-3.5" aria-hidden /> Decline
                    </button>
                  </div>
                ) : null}
              </div>
              {declining === r.id ? (
                <form
                  className="mt-2 flex flex-wrap items-end gap-2"
                  onSubmit={(e) => {
                    e.preventDefault();
                    void decide(r, false);
                  }}
                >
                  <label className="flex min-w-[220px] flex-1 flex-col gap-1 text-[11px] font-semibold text-slate-600 dark:text-slate-300">
                    A short note for the owner (optional)
                    <input
                      value={note}
                      onChange={(e) => setNote(e.target.value)}
                      maxLength={1000}
                      className={INPUT}
                    />
                  </label>
                  <button type="submit" disabled={busy !== null} className={GHOST_BTN}>
                    Confirm decline
                  </button>
                  <button
                    type="button"
                    onClick={() => setDeclining(null)}
                    className="text-[12px] font-semibold text-slate-500"
                  >
                    Back
                  </button>
                </form>
              ) : null}
            </li>
          ))}
        </ul>
      ) : null}

      {history.length > 0 ? (
        <>
          <button
            type="button"
            onClick={() => setShowHistory((v) => !v)}
            className="mt-3 inline-flex items-center gap-1 text-[11.5px] font-semibold text-slate-500 dark:text-slate-400"
            aria-expanded={showHistory}
          >
            {showHistory ? (
              <ChevronUp className="h-3.5 w-3.5" aria-hidden />
            ) : (
              <ChevronDown className="h-3.5 w-3.5" aria-hidden />
            )}
            {showHistory ? "Hide" : "Show"} {history.length} past request
            {history.length === 1 ? "" : "s"}
          </button>
          {showHistory ? (
            <ul className="mt-2 space-y-1 text-[12px] text-slate-600 dark:text-slate-300">
              {history.map((r) => (
                <li key={r.id}>
                  <span className="font-semibold">{r.client_name ?? "Business"}</span> ·{" "}
                  {requestStatusLabel(r.status, "accountant")}
                  {r.responded_at ? (
                    <span className="text-slate-400">
                      {" "}
                      · {new Date(r.responded_at).toLocaleDateString()}
                    </span>
                  ) : null}
                </li>
              ))}
            </ul>
          ) : null}
        </>
      ) : null}
    </>
  );

  if (quiet) {
    return (
      <details
        ref={foldRef}
        className={["home-fold", className].filter(Boolean).join(" ")}
        id="accountant-inbox"
        data-open={open.length}
        data-listed={listing?.is_listed ? 1 : 0}
      >
        <summary>
          <span>Marketplace</span>
          <span className="home-fold-meta">{summary}</span>
        </summary>
        <div className="home-fold-body">{body}</div>
      </details>
    );
  }

  return (
    <section
      className={shell}
      id="accountant-inbox"
      data-open={open.length}
      data-listed={listing?.is_listed ? 1 : 0}
    >
      {body}
    </section>
  );
}
