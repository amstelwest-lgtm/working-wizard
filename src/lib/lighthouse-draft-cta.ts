/** Locked accountant_v1 v3 assets. */
export const ACCOUNTANT_TEASER_PRACTICE = "https://youtu.be/J4vJki7HcIs";
export const ACCOUNTANT_TEASER_OWNER = "https://youtu.be/k3aRM4toTvU";
export const ACCOUNTANT_ONE_PAGER_PATH = "/lighthouse/milon-one-pager-accountants.pdf";
export const LIGHTHOUSE_TEAM_VOICE = "The Milōn Team";

/** Absolute public one-pager URL from SITE_URL (no trailing slash). */
export function accountantOnePagerUrl(siteBase: string): string {
  const base = siteBase.replace(/\/$/, "");
  return `${base}${ACCOUNTANT_ONE_PAGER_PATH}`;
}

/** CTA brief for watch_60s / watch_walkthrough when one or both teasers are ready. */
export function watchVideoCtaBrief(urls: string[]): string {
  const ready = urls.map((u) => u.trim()).filter(Boolean);
  if (ready.length >= 2) {
    return `Include BOTH of these exact URLs in the body: ${ready.join(" and ")}. No trial link.`;
  }
  if (ready.length === 1) {
    return `Point to exactly this link and nothing else: ${ready[0]}`;
  }
  return "The video is not produced yet, so describe the insight in one sentence instead of linking to anything.";
}

/** CTA brief for reply_interest — accountant v3 Day 0/17; owner Day 0 stays a short no-URL ask. */
export function replyInterestCtaBrief(opts: { day: number; persona?: string }): string {
  if (opts.day === 17) {
    return "Ask one unusual, specific question that invites a short reply. Do not include any URL or PDF.";
  }
  if (opts.day === 0 && opts.persona === "accountant") {
    return "Soft-ask about their capacity ceiling (how full the book is; retainer vs ad hoc). Do not include any URL.";
  }
  return "Ask for a short reply. Do not include any URL.";
}

/** CTA brief for start_trial — accountant v3 Day 9/28 mention the one-pager when ready. */
export function startTrialCtaBrief(opts: {
  day: number;
  trialDays: number;
  trialLink: string | null;
  onePagerUrl?: string | null;
  teaserUrls?: string[];
}): string {
  const trial = opts.trialLink ?? "(link pending)";
  const onePager = String(opts.onePagerUrl ?? "").trim();
  const teasers = (opts.teaserUrls ?? []).map((u) => u.trim()).filter(Boolean);

  if (opts.day === 9) {
    const pager = onePager
      ? ` Include this exact one-pager URL in the body (not as a second CTA): ${onePager}.`
      : "";
    return `The ONLY call to action is the free-trial link using exactly this URL: ${trial}.${pager} No other CTAs or video links.`;
  }

  if (opts.day === 28) {
    const parts = [
      `Ask them to start the free ${opts.trialDays}-day trial using exactly this link: ${trial}`,
    ];
    if (teasers.length >= 2) {
      parts.push(`Include BOTH of these exact YouTube URLs: ${teasers.join(" and ")}`);
    } else if (teasers.length === 1) {
      parts.push(`Include this exact YouTube URL: ${teasers[0]}`);
    }
    if (onePager) {
      parts.push(`Include this exact one-pager URL: ${onePager}`);
    }
    return `${parts.join(". ")}.`;
  }

  return `Ask them to start the free ${opts.trialDays}-day trial using exactly this link: ${trial}`;
}

/** Resend attachment for Day 9/28 when the public one-pager URL is known. */
export function lighthouseOnePagerAttachments(
  onePagerUrl: string | null | undefined,
): Array<{ filename: string; path: string }> {
  const path = String(onePagerUrl ?? "").trim();
  if (!path) return [];
  return [{ filename: "milon-one-pager-accountants.pdf", path }];
}
