/**
 * A chase the accountant can copy. Built only from names and action titles
 * already on the book. Nothing here sends mail.
 */

export type ChaseDraftAction = {
  title: string;
  overdue?: boolean;
};

export type ChaseDraftInput = {
  clientName: string;
  firmName?: string | null;
  actions: readonly ChaseDraftAction[];
};

export type ChaseDraft = {
  subject: string;
  body: string;
};

function titled(actions: readonly ChaseDraftAction[]): ChaseDraftAction[] {
  return actions
    .map((action) => ({ title: action.title.trim(), overdue: action.overdue === true }))
    .filter((action) => action.title.length > 0);
}

export function chaseDraftMessage(input: ChaseDraftInput): ChaseDraft {
  const client = input.clientName.trim() || "this client";
  const firm = input.firmName?.trim() || "";
  const actions = titled(input.actions);
  const overdue = actions.filter((action) => action.overdue);
  const shown = overdue.length > 0 ? overdue : actions;
  const subject =
    overdue.length > 0 ? `Chase: overdue work for ${client}` : `Chase: open work for ${client}`;
  const lines = [
    "Hello,",
    "",
    shown.length > 0
      ? `Please update us on this work for ${client}:`
      : `Please update us on the open work for ${client}.`,
    ...shown.map((action) => `- ${action.title}`),
    "",
    "Thank you,",
  ];
  if (firm) lines.push(firm);
  return { subject, body: lines.join("\n") };
}
