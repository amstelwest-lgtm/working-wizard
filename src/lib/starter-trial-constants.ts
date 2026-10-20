/**
 * Trial copy with no imports.
 * Edge functions load this file by URL. Importing stripe-plans.ts from that
 * graph pulls app aliases the Deno bundle cannot resolve.
 */

export const FIRM_TRIAL_DAYS = 14;
export const FIRM_TRIAL_CLIENT_LIMIT = 5;
export const FIRM_TRIAL_SENTENCE = `${FIRM_TRIAL_DAYS}-day free trial · up to ${FIRM_TRIAL_CLIENT_LIMIT} clients`;
/** Asked at the pre-card wall, after the first result. Not at signup. */
export const FIRM_TRIAL_CARD_NOTE = "You add a card once you have seen your first result.";
export const FIRM_TRIAL_CARD_LINE = `${FIRM_TRIAL_SENTENCE} on Starter. ${FIRM_TRIAL_CARD_NOTE}`;

export const STARTER_TRIAL_ENDED_MESSAGE = "Your trial has ended, choose a plan";

export const STARTER_TRIAL_ENDED_CODE = "starter_trial_ended";
