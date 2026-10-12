# Accountant nav system

Collapsible rail headings with sub-items. This replaces only the flat rail in `artifacts/accountant-ia-v2.md` section (c). Homes, the action plan, merged Reports content, sign-off, and the slice plan in that map still stand. No new pages. A heading is a place that already exists. A sub-item is a section of that place, or one report the accountant already sends.

Brand v1.1. White canvas, navy `#102A43`, cobalt `#0B5FFF`, borders `#DBEAFE`. Gold is the wordmark only. Status is an icon plus a word. Rail labels wrap. The bot runtime is untouched.

## How a heading works

Two controls, side by side, one row:

- The **label** is a link. It goes to that heading’s default sub-item and expands the heading.
- The **chevron** is a button. It only opens or closes the list. It does not navigate.

A heading with no sub-items is one link and has no chevron. Next moves and Settings are the only ones.

One heading is open at a time. Opening a second closes the first. Landing on a route opens the heading that owns it and closes the rest. If the accountant closes the heading for the page they are on, it stays closed until the route changes. The closed heading still shows the current-page mark, so the place is visible without the list.

Choosing a sub-item keeps its heading open. On a phone, choosing a sub-item also closes the drawer. Opening a heading does not close the drawer.

## Kickers

A kicker is a section label. It is not a link and it does not open or close. It stays visible whether the headings under it are open or shut. The headings under a kicker are the collapsible rows. One heading is open at a time, across the whole rail, not one per kicker.

## Practice rail

Firm-wide. Shown on Home, Clients, and Practice. Settings sits under a gap, same on every rail.

### Team

The firm’s agents.

#### Home

The three agents, practice-wide. Default: the team page.

| Sub-item | Purpose |
| --- | --- |
| Milōn Financial Manager | Ask the manager about the firm. |
| Milōn Analyst | Ask the analyst about the firm. |
| Milōn Advisor | Ask the advisor about the firm. |

### Book

The client book and the firm’s own work.

#### Clients

The book. Default: the full list. Opening a row still enters that client’s file. Nothing here auto-enters a file.

| Sub-item | Purpose |
| --- | --- |
| All clients | Every client, with health, cash, and what needs you. |
| Open queries | Clients with a question waiting, without stepping into one file. |
| Add client | Start a file. |

#### Practice

The firm’s own work. Default: the top of the overview.

| Sub-item | Purpose |
| --- | --- |
| Needs attention | The six clients that need you, in order. |
| Follow up | Chases you owe the book. |
| Insights | What the firm learned this week. |
| Marketplace | Offers you can put in front of a client. |
| Playbooks | Firm recipes. |

### Settings

No sub-items. Account, firm, billing, and sign out. Not under a kicker.

## Client rail

One client. The practice rail is gone while a file is open. “All clients” sits above the kickers and returns to the book. Settings is pinned at the bottom, under a gap, and is not under a kicker.

### Team

This client’s agents.

#### Home

This client’s team. Default: the three agent cards.

| Sub-item | Purpose |
| --- | --- |
| Milōn Financial Manager | Ask the manager about this client. |
| Milōn Analyst | Ask the analyst about this client. |
| Milōn Advisor | Ask the advisor about this client. |

### Numbers

The figures.

#### Health

Default: the score.

| Sub-item | Purpose |
| --- | --- |
| Score | The number, in words, and what moved it. |
| Where it hurts | The six pillars, worst first. |

#### Cash flow

Default: the forecast.

| Sub-item | Purpose |
| --- | --- |
| 13-week forecast | Week by week cash for this client. |
| Who to chase | Invoices to collect. |
| Who to pay | Bills to pay. |

#### Profit

Default: the waterfall.

| Sub-item | Purpose |
| --- | --- |
| Waterfall | Where the profit went. |
| Product lines | Which products make the money. |

#### Budget

Default: the year.

| Sub-item | Purpose |
| --- | --- |
| This year | Revenue, margin, and net against the plan. |
| Month by month | Each month, actual against plan. |

### Work

What you do with the figures.

#### Next moves

No sub-items. The ranked list. “Add to plan” stays a button on the page, not a rail item.

#### Action plan

Default: open work. The page’s status select still filters the list. These two sub-items are the only deep links.

| Sub-item | Purpose |
| --- | --- |
| Open work | Everything still to do, including overdue. |
| Overdue | Only what is late. |

#### Reports

Default: All reports. The top three are the signed pages for health, cash, and profit. Everything else lives under All reports.

| Sub-item | Purpose |
| --- | --- |
| Health scorecard | The signed health page. |
| 13-week cash forecast | The signed cash page. |
| Profitability waterfall | The signed profit page. |
| Drafts | Pack, recommendations, outcomes, and the note, still waiting to send. |
| Sent | What this client already received. |
| All reports | The full catalogue: intervention, cash cycle, budget variance, leverage, assets, labour, movement, benchmark. |

### File

The client’s file.

#### Books

Default: documents. The owner’s profile is not a nav item.

| Sub-item | Purpose |
| --- | --- |
| Documents | Files for this client. |
| Connections | Bank, ledger, and the other links. |

### Settings

Same as the practice rail. No sub-items.

## States

| State | What you see |
| --- | --- |
| Collapsed | Label, chevron pointing right. Sub-items are not in the tree. |
| Expanded | Chevron pointing down. Sub-items indented under the heading. |
| Hover | Navy text, pale fill `#F4F8FF`. No gold. |
| Active sub-item | Navy text, pale fill, cobalt bar on the left (`box-shadow: inset 3px 0 0 #0B5FFF`). `aria-current="page"`. |
| Current heading | Same cobalt bar, even when collapsed, so the place shows with the list shut. Weaker than the active sub-item: no pale fill while a child is the current page. |
| Focus | Cobalt outline, 2px, offset 2px. Visible on mouse and keyboard. |

The chevron hits 44px. Labels wrap. No truncation.

## Which heading opens

| You are on | Heading open | Sub-item current |
| --- | --- | --- |
| Practice Home | Home | none, until an Ask link is chosen |
| A practice agent ask | Home | that agent |
| Client list | Clients | All clients |
| Open queries | Clients | Open queries |
| Add client | Clients | Add client |
| Practice overview | Practice | the section in view, or Needs attention at the top |
| Client Home | Home | none, until an Ask link is chosen |
| Health | Health | Score, or Where it hurts when that section is in the address |
| Cash flow | Cash flow | the section in the address, else 13-week forecast |
| Profit | Profit | the section in the address, else Waterfall |
| Budget | Budget | the section in the address, else This year |
| Next moves | none | the Next moves link itself |
| Action plan | Action plan | Open work, or Overdue when the address says overdue |
| A top-3 report | Reports | that report |
| Drafts | Reports | Drafts |
| Sent | Reports | Sent |
| Any other report, or the catalogue | Reports | All reports |
| Books | Books | Documents or Connections |

## Mobile drawer

Below 861px the rail is not on the page. **Menu** in the top bar opens it.

- The drawer is the same list, kickers included, from the left, width `min(320px, 88vw)`, over a dimmed page.
- It opens on the heading for the current route, with that heading expanded.
- Scroll stays inside the drawer. The page behind does not scroll.
- Focus moves to the current item. Tab stays inside the drawer until it closes.
- Escape, the backdrop, and Menu again close it and return focus to Menu.
- Choosing a sub-item, or a heading with no sub-items, navigates and closes the drawer.
- The chevron does not close the drawer.

At 1280px and up there is no drawer. The rail is the left column, 232px, sticky.

## Keyboard and accessibility

The rail is a `<nav>` with a nested `<ul>`. It is not a menu. Sub-items are links. Each chevron is a `<button>`.

- `aria-expanded` and `aria-controls` on the chevron. The controlled list is the sub-item `<ul>`.
- `aria-current="page"` on the active link only.
- The current heading uses `aria-current="true"` when it is collapsed and you are inside it, so a closed section still announces as current.
- One tab stop for the rail (roving tabindex). Tab lands on the current item, or the first heading.
- Down and Up move through visible rows. Collapsed sub-items are skipped.
- Right opens a closed heading and moves to its first sub-item. On an open heading, Right moves to the first sub-item.
- Left on a sub-item moves to its heading. Left on an open heading closes it. Left on a closed heading does nothing.
- Enter follows the focused link. On a heading label, Enter goes to the default sub-item and opens the heading.
- Space on a chevron toggles it and does not navigate.
- Home and End move to the first and last visible row.
- Escape closes the drawer when it is open, and does nothing to the desktop rail.

## Deep links

Old addresses keep working. The rail opens the heading and marks the sub-item. The page underneath is unchanged.

| Address | Heading | Sub-item |
| --- | --- | --- |
| `/dashboard` | Home | — |
| `/dashboard?section=queries` | Clients | Open queries |
| `/clients` | Clients | All clients |
| `/practice` | Practice | Needs attention |
| `/practice#follow-up` | Practice | Follow up |
| `/practice#insights` | Practice | Insights |
| `/practice#marketplace` | Practice | Marketplace |
| `/practice#playbooks` | Practice | Playbooks |
| `?tab=home` or `?tab=bot` | Home | — |
| `?tab=health` | Health | Score |
| `?tab=health&section=pillars` | Health | Where it hurts |
| `?tab=cash` | Cash flow | 13-week forecast |
| `?tab=cash&section=collections` | Cash flow | Who to chase |
| `?tab=cash&section=payables` | Cash flow | Who to pay |
| `?tab=profit` | Profit | Waterfall |
| `?tab=profit&section=lines` | Profit | Product lines |
| `?tab=budget` | Budget | This year |
| `?tab=budget&section=months` | Budget | Month by month |
| `?tab=moves` | — | Next moves |
| `?tab=deliverables&section=plan` | Action plan | Open work |
| `?tab=deliverables&section=plan&status=overdue` | Action plan | Overdue |
| `?tab=reports&report=scorecard` | Reports | Health scorecard |
| `?tab=reports&report=forecast` | Reports | 13-week cash forecast |
| `?tab=reports&report=waterfall` | Reports | Profitability waterfall |
| `?tab=reports&section=pack`, `?section=drafter`, or `?tab=deliverables&section=pack` | Reports | Drafts |
| `?tab=reports&section=sent` | Reports | Sent |
| `?tab=reports` with any other report, or none | Reports | All reports |
| `?tab=books` or `?tab=portal` | Books | Documents |
| `?tab=books&section=connections` | Books | Connections |

Desk addresses (`?tab=desk`, and a deliverable id on the desk) still resolve as in the IA map: the desk tab is gone, and the id decides Drafts, Action plan, or Books.
