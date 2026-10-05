/**
 * E17 send windows.
 *
 * US: Tue–Thu 08:00–10:00 in the recipient's local zone
 * (ET, CT, MT, or PT from the contact or firm state/timezone; ET if the
 * contact is US and the state is missing).
 * SA: Tue–Thu 08:00–10:00 Africa/Johannesburg.
 * 10:00 is outside the window. Send now is refused outside it.
 */

export const E17_START_HOUR = 8;
export const E17_END_HOUR = 10;

export const US_TIME_ZONES = {
  ET: "America/New_York",
  CT: "America/Chicago",
  MT: "America/Denver",
  PT: "America/Los_Angeles",
} as const;

export const SA_TIME_ZONE = "Africa/Johannesburg";

export type UsWindowZone = keyof typeof US_TIME_ZONES;
export type WindowZone = UsWindowZone | "SAST";
export type LighthouseGeo = "US" | "SA" | "OTHER";

export type RecipientPlace = {
  country?: string | null;
  state?: string | null;
  /** Lead rows store the US state on `region` when `state` is absent. */
  region?: string | null;
  timezone?: string | null;
  city?: string | null;
  email?: string | null;
};

export type ResolvedRecipientZone = {
  geo: LighthouseGeo;
  zone: WindowZone | null;
  timeZone: string | null;
};

export type SendWindowStatus = {
  open: boolean;
  geo: LighthouseGeo;
  zone: WindowZone | null;
  timeZone: string | null;
  nextOpensAt: string | null;
  countdownMs: number | null;
  countdownLabel: string;
  nextLabel: string;
  reason: string | null;
};

const ET_STATES = new Set([
  "CT", "DE", "DC", "FL", "GA", "IN", "KY", "ME", "MD", "MA", "MI", "NH", "NJ", "NY",
  "NC", "OH", "PA", "RI", "SC", "TN", "VT", "VA", "WV",
]);
const CT_STATES = new Set([
  "AL", "AR", "IL", "IA", "KS", "LA", "MN", "MS", "MO", "NE", "ND", "OK", "SD", "TX", "WI",
]);
const MT_STATES = new Set(["AZ", "CO", "ID", "MT", "NM", "UT", "WY"]);
const PT_STATES = new Set(["CA", "NV", "OR", "WA"]);

const STATE_NAMES: Record<string, string> = {
  alabama: "AL",
  alaska: "AK",
  arizona: "AZ",
  arkansas: "AR",
  california: "CA",
  colorado: "CO",
  connecticut: "CT",
  delaware: "DE",
  "district of columbia": "DC",
  florida: "FL",
  georgia: "GA",
  hawaii: "HI",
  idaho: "ID",
  illinois: "IL",
  indiana: "IN",
  iowa: "IA",
  kansas: "KS",
  kentucky: "KY",
  louisiana: "LA",
  maine: "ME",
  maryland: "MD",
  massachusetts: "MA",
  michigan: "MI",
  minnesota: "MN",
  mississippi: "MS",
  missouri: "MO",
  montana: "MT",
  nebraska: "NE",
  nevada: "NV",
  "new hampshire": "NH",
  "new jersey": "NJ",
  "new mexico": "NM",
  "new york": "NY",
  "north carolina": "NC",
  "north dakota": "ND",
  ohio: "OH",
  oklahoma: "OK",
  oregon: "OR",
  pennsylvania: "PA",
  "rhode island": "RI",
  "south carolina": "SC",
  "south dakota": "SD",
  tennessee: "TN",
  texas: "TX",
  utah: "UT",
  vermont: "VT",
  virginia: "VA",
  washington: "WA",
  "west virginia": "WV",
  wisconsin: "WI",
  wyoming: "WY",
};

const SA_CITY =
  /\b(johannesburg|cape town|durban|pretoria|sandton|stellenbosch|bloemfontein|gqeberha|port elizabeth|soweto|centurion|midrand|pietermaritzburg|polokwane|nelspruit|mbombela|rustenburg|east london|south africa)\b/i;

const TZ_ZONE: Record<string, { geo: LighthouseGeo; zone: WindowZone; timeZone: string }> = {
  "america/new_york": { geo: "US", zone: "ET", timeZone: US_TIME_ZONES.ET },
  "america/detroit": { geo: "US", zone: "ET", timeZone: US_TIME_ZONES.ET },
  "america/indiana/indianapolis": { geo: "US", zone: "ET", timeZone: US_TIME_ZONES.ET },
  "us/eastern": { geo: "US", zone: "ET", timeZone: US_TIME_ZONES.ET },
  "america/chicago": { geo: "US", zone: "CT", timeZone: US_TIME_ZONES.CT },
  "us/central": { geo: "US", zone: "CT", timeZone: US_TIME_ZONES.CT },
  "america/denver": { geo: "US", zone: "MT", timeZone: US_TIME_ZONES.MT },
  "america/boise": { geo: "US", zone: "MT", timeZone: US_TIME_ZONES.MT },
  "america/phoenix": { geo: "US", zone: "MT", timeZone: US_TIME_ZONES.MT },
  "us/mountain": { geo: "US", zone: "MT", timeZone: US_TIME_ZONES.MT },
  "america/los_angeles": { geo: "US", zone: "PT", timeZone: US_TIME_ZONES.PT },
  "us/pacific": { geo: "US", zone: "PT", timeZone: US_TIME_ZONES.PT },
  "africa/johannesburg": { geo: "SA", zone: "SAST", timeZone: SA_TIME_ZONE },
};

export type ZonedParts = {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
  weekday: string;
};

export function zonedParts(now: Date, timeZone: string): ZonedParts {
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone,
    weekday: "short",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  });
  const bag: Record<string, string> = {};
  for (const part of fmt.formatToParts(now)) {
    if (part.type !== "literal") bag[part.type] = part.value;
  }
  let hour = Number(bag.hour);
  if (hour === 24) hour = 0;
  return {
    year: Number(bag.year),
    month: Number(bag.month),
    day: Number(bag.day),
    hour,
    minute: Number(bag.minute),
    second: Number(bag.second),
    weekday: bag.weekday ?? "",
  };
}

export function zonedYmd(now: Date, timeZone: string): string {
  const p = zonedParts(now, timeZone);
  return `${p.year}-${String(p.month).padStart(2, "0")}-${String(p.day).padStart(2, "0")}`;
}

function addCalendarDays(year: number, month: number, day: number, add: number) {
  const dt = new Date(Date.UTC(year, month - 1, day + add));
  return { year: dt.getUTCFullYear(), month: dt.getUTCMonth() + 1, day: dt.getUTCDate() };
}

/** Wall-clock time in `timeZone` as a UTC instant. */
export function zonedWallTimeToUtc(
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number,
  timeZone: string,
): Date {
  let utc = Date.UTC(year, month - 1, day, hour, minute, 0);
  for (let i = 0; i < 4; i++) {
    const p = zonedParts(new Date(utc), timeZone);
    const asWall = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
    const want = Date.UTC(year, month - 1, day, hour, minute, 0);
    const diff = asWall - want;
    if (diff === 0) break;
    utc -= diff;
  }
  return new Date(utc);
}

export function isWeekdayInWindow(weekday: string): boolean {
  return weekday === "Tue" || weekday === "Wed" || weekday === "Thu";
}

export function isSendWindowOpen(now: Date, timeZone: string): boolean {
  const p = zonedParts(now, timeZone);
  if (!isWeekdayInWindow(p.weekday)) return false;
  return p.hour >= E17_START_HOUR && p.hour < E17_END_HOUR;
}

export function nextWindowStart(now: Date, timeZone: string): Date {
  const p = zonedParts(now, timeZone);
  for (let add = 0; add <= 7; add++) {
    const date = addCalendarDays(p.year, p.month, p.day, add);
    const start = zonedWallTimeToUtc(date.year, date.month, date.day, E17_START_HOUR, 0, timeZone);
    const sp = zonedParts(start, timeZone);
    if (!isWeekdayInWindow(sp.weekday)) continue;
    if (start.getTime() >= now.getTime()) return start;
  }
  const fallback = addCalendarDays(p.year, p.month, p.day, 7);
  return zonedWallTimeToUtc(fallback.year, fallback.month, fallback.day, E17_START_HOUR, 0, timeZone);
}

export function formatWindowCountdown(ms: number): string {
  if (ms <= 0) return "open";
  const totalMin = Math.max(1, Math.ceil(ms / 60000));
  const days = Math.floor(totalMin / (60 * 24));
  const hours = Math.floor((totalMin % (60 * 24)) / 60);
  const mins = totalMin % 60;
  if (days > 0) return `${days}d ${hours}h`;
  if (hours > 0) return `${hours}h ${mins}m`;
  return `${mins}m`;
}

function formatNextLabel(start: Date, timeZone: string, zone: WindowZone): string {
  const p = zonedParts(start, timeZone);
  const hh = String(p.hour).padStart(2, "0");
  const mm = String(p.minute).padStart(2, "0");
  return `${p.weekday} ${hh}:${mm} ${zone}`;
}

function zoneForState(abbrev: string): UsWindowZone | null {
  if (ET_STATES.has(abbrev)) return "ET";
  if (CT_STATES.has(abbrev)) return "CT";
  if (MT_STATES.has(abbrev)) return "MT";
  if (PT_STATES.has(abbrev)) return "PT";
  return null;
}

function stateAbbrevFromText(raw: string | null | undefined): string | null {
  const text = String(raw ?? "").trim();
  if (!text) return null;
  const upper = text.toUpperCase();
  if (/^[A-Z]{2}$/.test(upper) && (zoneForState(upper) || upper === "AK" || upper === "HI")) {
    return upper;
  }
  const named = STATE_NAMES[text.toLowerCase()];
  if (named) return named;
  const tail = text.match(/(?:,|\s)([A-Za-z]{2})$/);
  if (tail) {
    const abbr = tail[1].toUpperCase();
    if (zoneForState(abbr) || abbr === "AK" || abbr === "HI") return abbr;
  }
  for (const [name, abbr] of Object.entries(STATE_NAMES)) {
    if (text.toLowerCase().includes(name)) return abbr;
  }
  return null;
}

function countryOf(raw: string | null | undefined): LighthouseGeo | null {
  const v = String(raw ?? "").trim().toLowerCase();
  if (!v) return null;
  if (["us", "usa", "u.s.", "u.s.a.", "united states", "united states of america"].includes(v)) {
    return "US";
  }
  if (["sa", "za", "zaf", "south africa", "rsa"].includes(v)) return "SA";
  return "OTHER";
}

function looksSouthAfrican(place: RecipientPlace): boolean {
  const email = String(place.email ?? "").trim().toLowerCase();
  if (email.endsWith(".co.za") || email.endsWith(".za")) return true;
  const blob = `${place.city ?? ""} ${place.state ?? ""} ${place.region ?? ""}`;
  return SA_CITY.test(blob);
}

export function resolveRecipientZone(place: RecipientPlace): ResolvedRecipientZone {
  const tzKey = String(place.timezone ?? "").trim().toLowerCase();
  if (tzKey && TZ_ZONE[tzKey]) {
    const hit = TZ_ZONE[tzKey];
    return { geo: hit.geo, zone: hit.zone, timeZone: hit.timeZone };
  }

  const country = countryOf(place.country);
  const abbrev =
    stateAbbrevFromText(place.state) ??
    stateAbbrevFromText(place.region) ??
    stateAbbrevFromText(place.city);

  if (country === "SA" || (!country && looksSouthAfrican(place))) {
    return { geo: "SA", zone: "SAST", timeZone: SA_TIME_ZONE };
  }

  if (country === "US" || (!country && abbrev && zoneForState(abbrev))) {
    const zone = (abbrev && zoneForState(abbrev)) || "ET";
    return { geo: "US", zone, timeZone: US_TIME_ZONES[zone] };
  }

  if (country === "OTHER") return { geo: "OTHER", zone: null, timeZone: null };
  return { geo: "OTHER", zone: null, timeZone: null };
}

export function sendWindowStatus(place: RecipientPlace, now = new Date()): SendWindowStatus {
  const resolved = resolveRecipientZone(place);
  if (!resolved.timeZone || !resolved.zone) {
    return {
      open: false,
      geo: resolved.geo,
      zone: null,
      timeZone: null,
      nextOpensAt: null,
      countdownMs: null,
      countdownLabel: "—",
      nextLabel: "Set US or South Africa",
      reason: "Send blocked — set a US state or South Africa so the send window can be enforced.",
    };
  }
  if (isSendWindowOpen(now, resolved.timeZone)) {
    return {
      open: true,
      geo: resolved.geo,
      zone: resolved.zone,
      timeZone: resolved.timeZone,
      nextOpensAt: null,
      countdownMs: 0,
      countdownLabel: "open",
      nextLabel: `Open now · ${resolved.zone}`,
      reason: null,
    };
  }
  const start = nextWindowStart(now, resolved.timeZone);
  const countdownMs = Math.max(0, start.getTime() - now.getTime());
  const nextLabel = formatNextLabel(start, resolved.timeZone, resolved.zone);
  const countdownLabel = formatWindowCountdown(countdownMs);
  return {
    open: false,
    geo: resolved.geo,
    zone: resolved.zone,
    timeZone: resolved.timeZone,
    nextOpensAt: start.toISOString(),
    countdownMs,
    countdownLabel,
    nextLabel,
    reason: `Send blocked — outside the ${resolved.zone} window (Tue–Thu 08:00–10:00). Next window ${nextLabel} (${countdownLabel}).`,
  };
}

/** Null when Send now is allowed. A string when it must be refused. */
export function sendBlockedReason(place: RecipientPlace, now = new Date()): string | null {
  return sendWindowStatus(place, now).reason;
}
