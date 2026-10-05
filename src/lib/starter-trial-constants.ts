/**
 * Trial-end copy with no imports.
 * Edge functions load this file by URL. Importing firm-starter-trial.ts from
 * that graph pulls stripe-plans without a .ts extension, and the Deno bundle
 * cannot resolve it.
 */

export const STARTER_TRIAL_ENDED_MESSAGE = "Your trial has ended, choose a plan";

export const STARTER_TRIAL_ENDED_CODE = "starter_trial_ended";
