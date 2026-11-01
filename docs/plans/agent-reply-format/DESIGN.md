# Agent reply format

Financial Manager, Analyst, Advisor, and Tax Specialist replies share one card. Owner chat and the accountant Ask thread (the same widget the owner app mounts) both render it. The model still writes the existing three-part reply. The client turns that text, plus the tool and figure payload already on the response, into the card. There is no second grounding pass and no extra model round.

## Card

1. **Answer first.** One headline, then 1–3 key figures, then 2–4 short points. Fewer is allowed. Nothing is invented to fill the row.
2. **Decision strip.** Confirm / Reject when a pending figure proposal is waiting on this person. Approve / Dismiss when a draft is waiting on this person. No strip on an ordinary answer, and no strip when this person cannot decide (`canDecide: false`).
3. **How I got this.** A short line from the tools already listed on the reply. The stored run trace stays off the card. It loads only if the person opens the line, from the trace that came back with this reply. A reply with no tools and no run has no how-line.
4. **Figure chips.** Only numbers already attached to the reply: the proposal patch, `created.overview` facts, or a `figures` list the caller already holds. Prose figures stay in the key-figure row. They are not parsed again into chips.

## Schema

`AgentReply` in `src/lib/agent-reply.ts`:

| Field | Rule |
| --- | --- |
| `agent` | `financial_manager`, `analyst`, `advisor`, `tax_specialist`, or null |
| `headline` | First sentence of the reply |
| `kpis` | Up to 3 `- Label: value` lines |
| `bullets` | Up to 4 Next actions. Extra figure lines fill in only when there are fewer than two actions |
| `decision` | `confirm_reject` or `approve_dismiss`, or null |
| `how` | `{ summary, detailId }`. `detailId` is null when there is nothing to open |
| `figures` | Chips from the payload above, at most 6 |

`howDetailLines` reads a run that is already in memory. It is not stored on the card. Opening the how-line calls `onLoadDetail(detailId)`. That lookup does not call the model.

## Where it renders

- **Owner door chat** renders `AgentReplyShell` for every agent reply. The strip sits on the card. Listen speaks the card.
- **Ask widget** (accountant practice thread, accountant client page, owner app) renders the same shell for an assistant turn. A pending figure change keeps Confirm / Reject on the card above the clipped thread, so the 220px scroller cannot hide it. The labels are Confirm and Reject.
- **Owner draft cards** use the same Approve / Dismiss strip. The first click on Approve still opens the existing edit step.

The accountant agent thread sets `data-agent-reply="shell"` on the widget mount. The panel copies that onto `data-agent-reply-host`.

## Prompt

`chatReplyFormatRules` still asks for the headline, the figure lines, and Next actions. One added line tells the model not to write a second account of how it got there. All four in-app chats already include those rules (ask-ai personas, including the Tax Specialist, and milon-bot).

## Out of scope

A new grounding pass, a second model call to build a trail, lip-sync, and Send-an-agent missions. Background finding rows stay on their own cards; only the decision chrome is shared.
