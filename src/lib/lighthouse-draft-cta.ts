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

/** CTA brief for reply_interest — Day 0/7/18 use the same CTA with different link rules. */
export function replyInterestCtaBrief(opts: { day: number; trialLink: string | null }): string {
  if (opts.day === 7) {
    const link = opts.trialLink
      ? ` using exactly this link if you include one: ${opts.trialLink}`
      : "";
    return `Describe a real product outcome path. Soft-ask the firm signup / trial${link}. No fake cases or invented clients.`;
  }
  if (opts.day === 18) {
    return `Break up. Say you will stop writing. Invite them to reply "later" if they want one link. Do not include a URL.`;
  }
  return "Ask for a short reply. Do not include any URL.";
}
