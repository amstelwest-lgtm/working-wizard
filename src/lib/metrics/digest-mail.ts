/**
 * Plain-text founder digest via Resend.
 * Failures must not throw into product UI — caller decides.
 */

export async function sendFounderDigest(opts: {
  recipients: string[];
  subject: string;
  body: string;
}): Promise<{ ok: true; sent: number } | { ok: false; error: string }> {
  const apiKey = process.env.RESEND_API_KEY;
  const fromRaw = process.env.RESEND_FROM_EMAIL || "noreply@milon.co.za";
  const fromAddr = fromRaw.includes("<")
    ? fromRaw.replace(/^.*<([^>]+)>.*$/, "$1").trim()
    : fromRaw.trim();
  if (!apiKey) {
    return { ok: false, error: "RESEND_API_KEY not configured" };
  }
  const unique = [...new Set(opts.recipients.map((e) => e.trim().toLowerCase()).filter(Boolean))];
  if (!unique.length) {
    return { ok: false, error: "no digest recipients" };
  }

  let sent = 0;
  for (const to of unique) {
    const week = new Date().toISOString().slice(0, 10);
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
        "Idempotency-Key": `milon-digest:${week}:${to}`.slice(0, 256),
      },
      body: JSON.stringify({
        from: `Milōn <${fromAddr}>`,
        to: [to],
        subject: opts.subject,
        text: opts.body,
      }),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      return { ok: false, error: `Resend ${res.status}: ${body.slice(0, 200)}` };
    }
    sent += 1;
  }
  return { ok: true, sent };
}
