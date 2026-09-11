/**
 * Authoritative accountant outreach copy for Lighthouse.
 *
 * accountant_v1 (5-step drip) uses Theo’s approved Growth-pack v3 emails as
 * the default golden draft. Claude is rewrite-only on that sequence.
 *
 * accountant_oneshot_v1 is a one-shot / single-banger for firms that should
 * not enter the drip. Default loads this golden copy; Claude is rewrite-only.
 * The one-shot intentionally mentions a follow-up call — drip no-call rules
 * do not apply here.
 */

export const ACCOUNTANT_V1_SEQUENCE_KEY = "accountant_v1";

/** One-shot accountant sequence — separate from the 5-step drip. */
export const ACCOUNTANT_ONESHOT_SEQUENCE_KEY = "accountant_oneshot_v1";

export type LighthouseDraftMode = "default" | "rewrite";
export type LighthouseDraftEngine = "golden" | "claude";

export type GoldenEmail = {
  step: number;
  day: number;
  subject: string;
  body: string;
};

export type GoldenFillTokens = {
  name?: string | null;
  firm?: string | null;
  trialLink?: string | null;
};

/** Growth-pack v3 golden copy. Tokens: {{name}}, {{firm}}, {{trial_link}}. */
export const ACCOUNTANT_V1_GOLDEN: readonly GoldenEmail[] = [
  {
    step: 1,
    day: 0,
    subject: "A different way to scale your bookkeeping",
    body: `Hi {{name}},

I’ve been looking at how accounting firms are scaling their bookkeeping practices, and there’s a fairly frustrating ceiling: adding more clients usually means adding more people.

We’re building Milōn around the idea that it shouldn’t have to work that way.

It automates a lot of the back-and-forth and manual work between the client, the books and the accountant, so a firm can handle more work without simply growing the team alongside it.

I’m curious whether capacity is something you’re thinking about at {{firm}} at the moment.

The Milōn Team`,
  },
  {
    step: 2,
    day: 4,
    subject: "Your team shouldn't have to chase clients",
    body: `Hi {{name}},

How much of your team's time goes into chasing clients for things that should have been submitted correctly in the first place?

That was one of the problems we started building Milōn around.

The idea is pretty simple: make the accounting workflow work around the accountant, rather than having the accountant constantly work around the client.

Two 30-second clips that show both sides of the same workspace (not a pitch):

How it looks for the firm: https://youtu.be/J4vJki7HcIs
How it looks for the owner: https://youtu.be/k3aRM4toTvU

We’re building it specifically for accounting firms, and I’d be interested to hear whether client chasing is a meaningful headache for you guys.

The Milōn Team`,
  },
  {
    step: 3,
    day: 9,
    subject: "I think accounting software has become too complicated",
    body: `Hi {{name}},

Something I've noticed talking to accounting firms is that a lot of the software built for accountants has become incredibly powerful — but also incredibly complicated.

More settings, more workflows, more things to configure and more ways to fix problems after they happen.

We’re taking a different approach with Milōn: make the underlying workflow simpler instead of giving the accountant another dashboard full of controls.

It’s still early, but I think there’s a big opportunity to make accounting software feel much more like a system that simply gets the work done.

Would you be open to taking a look at what we’re building?

Start here (firm workspace → invite one client → first health score):
{{trial_link}}

The Milōn Team`,
  },
  {
    step: 4,
    day: 17,
    subject: "A slightly unusual question",
    body: `Hi {{name}},

A slightly unusual question:

If you could remove one recurring piece of work from your bookkeeping team tomorrow, what would it be?

I’m asking because we’re building Milōn specifically around removing the operational work that sits between a client and their accountant — and I’ve found that the answer varies quite a bit from firm to firm.

If you tell me yours, I’ll show you what we’re doing about it.

The Milōn Team`,
  },
  {
    step: 5,
    day: 28,
    subject: "Could {{firm}} handle 2x the clients?",
    body: `Hi {{name}},

If {{firm}} doubled its bookkeeping clients over the next couple of years, would you need roughly twice the bookkeeping team to service them?

That’s the problem we’re trying to solve with Milōn.

Rather than adding another layer of software for accountants to manage, we’re building the workflow so that more of the work happens automatically and the accountant spends more time on the parts that actually require an accountant.

I’d be interested to show you what that looks like in practice — particularly if growing capacity without growing headcount is relevant to {{firm}}.

Firm signup (invite one client → first branded score):
{{trial_link}}

Quick picture of both sides if useful:
Firm: https://youtu.be/J4vJki7HcIs
Owner: https://youtu.be/k3aRM4toTvU

The Milōn Team`,
  },
];

export const ACCOUNTANT_ONESHOT_ACCOUNTANT_PAGER_URL =
  "https://www.milonfinance.com/lighthouse/milon-one-pager-accountants.pdf";
export const ACCOUNTANT_ONESHOT_OWNER_PAGER_URL =
  "https://www.milonfinance.com/lighthouse/milon-one-pager-owners.pdf";

/** Theo’s one-shot / single-banger accountant email (not the 5-step drip). */
export const ACCOUNTANT_ONESHOT_GOLDEN: GoldenEmail = {
  step: 1,
  day: 0,
  subject: "A better way to grow advisory",
  body: `Hi {{name}},

We’re building Milōn around a problem we think many accounting firms face:

You already have your clients’ numbers. But turning those numbers into useful, recurring advice — across an entire client base — is difficult to do consistently without consuming a lot of professional time.

Clients increasingly want more than compliance. They want to know:

- How is my business actually doing?
- What needs my attention?
- What is going to happen to my cash?
- What should I do next?

And from the firm's side, there’s an equally important question:

Which of my clients actually need my attention right now — and how do I deliver useful advice to them without adding another junior for every client?

That’s where Milōn comes in.

You give it the financial information you already have, and it turns it into a shared workspace for your firm and your client — showing business health, what has changed, where the pressure is, forward-looking cash and prioritised next actions.

At the portfolio level, your team can see which clients need attention and why. At the client level, Milōn helps turn the underlying numbers into practical advisory — with Claude drafting the advice for your team to review, edit and sign off before anything reaches the client.

The opportunity we see for firms is bigger than simply saving time.

Milōn can make it much easier to turn existing compliance relationships into a valuable, recurring monthly advisory service — without having to build a large advisory team to deliver it.

It doesn't replace your accounting, compliance or professional judgement. It gives your team a system for delivering more of the advisory work you already know your clients need.

We’re now bringing a small number of accounting firms into the first commercial rollout, and we’re looking for firms that have a meaningful client base, want to grow their advisory offering, and are willing to give us candid feedback on what would make this genuinely useful in practice.

We’d like to explore whether your firm could be one of them.

We’ve included two short videos and one-pagers for both the accountant and business-owner sides of Milōn:

Accountant overview: https://youtu.be/J4vJki7HcIs

Business-owner overview: https://youtu.be/k3aRM4toTvU

Accountant one-pager: https://www.milonfinance.com/lighthouse/milon-one-pager-accountants.pdf

Business-owner one-pager: https://www.milonfinance.com/lighthouse/milon-one-pager-owners.pdf

We’ll give you a call shortly after you’ve had a chance to look through them.

No long demo or sales presentation — we’d simply like to show you what we’ve built, get your honest reaction, and see whether there’s a fit.

The Milōn Team`,
};

export const ACCOUNTANT_ONESHOT_TEMPLATE: {
  sequenceKey: typeof ACCOUNTANT_ONESHOT_SEQUENCE_KEY;
  kind: "oneshot";
  subject: string;
  body: string;
} = {
  sequenceKey: ACCOUNTANT_ONESHOT_SEQUENCE_KEY,
  kind: "oneshot",
  subject: ACCOUNTANT_ONESHOT_GOLDEN.subject,
  body: ACCOUNTANT_ONESHOT_GOLDEN.body,
};

export const ACCOUNTANT_ONESHOT_STEP = {
  step: 1,
  day: 0,
  angle: "advisory_banger",
  goal: "One-shot commercial-rollout ask. Keep the follow-up call, both teaser videos, and both one-pager URLs. Do not convert this into drip copy.",
  max_words: 750,
  cta: "call_followup",
  asset: "one_pager_accountant",
  asset_fallback: "one_pager_owner",
} as const;

export const ACCOUNTANT_ONESHOT_SEQUENCE = {
  key: ACCOUNTANT_ONESHOT_SEQUENCE_KEY,
  name: "Accountant / practice — one-shot",
  persona: "accountant" as const,
  steps: [ACCOUNTANT_ONESHOT_STEP],
  active: true,
};

export function accountantOneshotCopyReady(): boolean {
  return Boolean(
    ACCOUNTANT_ONESHOT_TEMPLATE.subject.trim() && ACCOUNTANT_ONESHOT_TEMPLATE.body.trim(),
  );
}

/** Resend attachments for the one-shot: both PDFs, in addition to the body links. */
export function lighthouseOneshotAttachments(): Array<{ filename: string; path: string }> {
  return [
    {
      filename: "milon-one-pager-accountants.pdf",
      path: ACCOUNTANT_ONESHOT_ACCOUNTANT_PAGER_URL,
    },
    {
      filename: "milon-one-pager-owners.pdf",
      path: ACCOUNTANT_ONESHOT_OWNER_PAGER_URL,
    },
  ];
}

/** Sequences whose default draft is golden fill, not a Claude generation. */
export function sequenceUsesGoldenDefault(sequenceKey: string): boolean {
  return sequenceKey === ACCOUNTANT_V1_SEQUENCE_KEY || sequenceKey === ACCOUNTANT_ONESHOT_SEQUENCE_KEY;
}

/**
 * Default accountant_v1 and accountant_oneshot_v1 load golden copy.
 * `rewrite` always uses Claude. owner_v1 stays Claude-first.
 */
export function resolveLighthouseDraftEngine(
  sequenceKey: string,
  mode: LighthouseDraftMode = "default",
): LighthouseDraftEngine {
  if (mode === "rewrite") return "claude";
  if (sequenceUsesGoldenDefault(sequenceKey)) return "golden";
  return "claude";
}

export function lighthouseDraftCallsClaude(
  sequenceKey: string,
  mode: LighthouseDraftMode = "default",
): boolean {
  return resolveLighthouseDraftEngine(sequenceKey, mode) === "claude";
}

/** First token of the lead name, or empty when none is recorded. */
export function firstNameFromLeadName(name: string | null | undefined): string {
  const trimmed = String(name ?? "").trim();
  if (!trimmed) return "";
  return trimmed.split(/\s+/)[0] ?? "";
}

export function fillGoldenTokens(template: string, tokens: GoldenFillTokens): string {
  const first = firstNameFromLeadName(tokens.name);
  const firm = String(tokens.firm ?? "").trim() || "your firm";
  const trial = String(tokens.trialLink ?? "").trim();
  let out = template
    .replaceAll("{{name}}", first)
    .replaceAll("{{firm}}", firm)
    .replaceAll("{{trial_link}}", trial);
  out = out.replace(/^Hi\s*,/m, "Hi,");
  return out;
}

export function accountantV1GoldenStep(stepNo: number): GoldenEmail {
  const step = ACCOUNTANT_V1_GOLDEN.find((s) => s.step === stepNo);
  if (!step) {
    throw new Error(`accountant_v1 has no golden copy for step ${stepNo}`);
  }
  return step;
}

export function fillAccountantV1Golden(
  stepNo: number,
  tokens: GoldenFillTokens,
): { subject: string; body: string } {
  const step = accountantV1GoldenStep(stepNo);
  return {
    subject: fillGoldenTokens(step.subject, tokens),
    body: fillGoldenTokens(step.body, tokens),
  };
}

/**
 * Fill golden copy for any accountant sequence that uses it.
 */
export function fillAccountantSequenceGolden(opts: {
  sequenceKey: string;
  stepNo: number;
  name?: string | null;
  firm?: string | null;
  trialLink?: string | null;
}): { subject: string; body: string } {
  const tokens: GoldenFillTokens = {
    name: opts.name,
    firm: opts.firm,
    trialLink: opts.trialLink,
  };

  if (opts.sequenceKey === ACCOUNTANT_V1_SEQUENCE_KEY) {
    return fillAccountantV1Golden(opts.stepNo, tokens);
  }

  if (opts.sequenceKey === ACCOUNTANT_ONESHOT_SEQUENCE_KEY) {
    if (opts.stepNo !== 1) {
      throw new Error(`accountant_oneshot_v1 has no golden copy for step ${opts.stepNo}`);
    }
    return {
      subject: fillGoldenTokens(ACCOUNTANT_ONESHOT_GOLDEN.subject, tokens),
      body: fillGoldenTokens(ACCOUNTANT_ONESHOT_GOLDEN.body, tokens),
    };
  }

  throw new Error(`${opts.sequenceKey} has no golden accountant template`);
}
