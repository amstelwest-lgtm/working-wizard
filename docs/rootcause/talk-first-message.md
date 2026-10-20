# First message on /talk never leaves the browser

AQA failed this twice from a non-ZA view: once on #693, then again on #701 (merged as `60daccee`, live on `e90d2221` with prospect-talk v4). On `/talk/financial-manager`, typing and clicking Send immediately after load produced no You bubble and no reply after 12 seconds. The Analyst answered on a later load. Same page, same action, different timing.

## Cause

`/talk/$agent` is server-rendered. The HTML already contains `<form class="talk-composer">` and `<button class="talk-send" type="submit">`. The form has no `action` and the textarea has no `name`. `onSubmit` calls `preventDefault` only after React hydrates.

A click in that gap is a native GET submit. The browser reloads `/talk/financial-manager`. The typed text is not in the query string, so it is gone. React's `onSend` never runs. Nothing is written into the thread, and nothing is posted to `prospect-talk`. That matches "no You bubble and no reply". The session row is created by that POST. There is no session to attach the message to, because the POST never happened.

There is a second way to lose the same text. The textarea is a controlled input whose React state starts as `""`. If the visitor types into the server HTML and React hydrates before the click, hydration writes that empty state back into the DOM. Send then returns early on an empty draft. Again no bubble and no POST.

The Analyst passing on another load is the same race won by hydration. The script had attached, `preventDefault` ran, and the message was posted.

## Files

- `src/routes/talk.$agent.tsx` — the document head. The only inline script forced light theme. It did not watch the composer.
- `src/components/prospect-talk.tsx` — `ProspectTalkScreen` renders the live form. `ProspectTalkLive` owns `sessionReady`, the You bubble, and the POST. `sessionReady` starts false and flips in `useEffect` after paint.
- `src/lib/prospect-talk-session.ts` — `queueTalkMessage` / `openTalkSession`. They run only after that effect.
- `src/lib/prospect-talk-client.ts` — `postProspectTalk`. This is the call that creates the session on the first turn.
- `scripts/prospect-talk-test.mts` — the #701 test mounted an already-hydrated tree and delayed `readStoredToken`.

## Why #701 missed it

#701 queued a send that happened after React was mounted and before `sessionStorage` had been read. The queue lives in a ref. The flush lives in `useEffect`. Neither exists until hydration. A native submit before hydration never enters the queue, and the reload throws away the DOM, so the You bubble cannot survive.

The test that was meant to lock this started from `createRoot` on a component that was already React. It delayed the token read, typed through the React `onChange`, and called `requestSubmit`. That is the gap after hydration, which #701 does cover. It does not load the document, block the module scripts, type into the server HTML, and click Send before hydration and before any session exists. A green run of that test can sit next to a red AQA run. #693 left the same hole: the free-reply count moved, and the composer was still a native form until the bundle arrived.

## Fix

An inline boot script, in the document head, listens before the bundle. A Send click, a form submit, or Enter (not Shift+Enter) on the composer is cancelled while `data-talk-live` is absent. The text is stored, the textarea is cleared, and a You bubble is painted immediately in a host outside the React tree, so hydration cannot drop it. The button is `type="button"`, so a click cannot navigate even if the script is late.

When React hydrates, a layout effect reads that stored text into the thread, removes the temporary host, marks the form live, and leaves the text on the existing session queue. The passive effect then reads `sessionStorage` and posts. The POST is what creates the session. The bubble does not wait for either step. If hydration retries the tree, the in-flight reply is applied to the tree that stays.

Shift+Enter is a newline. After the form is live, Enter sends through React the same way.

## How to verify

`scripts/prospect-talk-browser-test.mts` is a real browser run, and it is on the blocking `test:ci` list.

It opens `/talk/financial-manager` with the module scripts held, so React has not hydrated and no session exists. It types and clicks Send. The You bubble is visible at once, the URL does not change, and there is no POST. It then releases the scripts. The same text is posted once, the bubble is still there, and the mocked reply renders. A second turn presses Enter to send and Shift+Enter to insert a newline. The prospect-talk POST is mocked. Nothing in this test creates a lead or sends mail.
