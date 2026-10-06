/**
 * Edge import of the shared identifier redactor.
 * Implementation lives in src/lib so server functions and tests use one copy.
 */
export {
  ACCOUNT_TOKEN,
  CLIENT_TOKEN,
  EMAIL_TOKEN,
  PHONE_TOKEN,
  TAX_TOKEN,
  appendClientIdentity,
  applyRedaction,
  sealedCacheAnswer,
  cacheHitIsDisplaySafe,
  clientIdentityInstruction,
  clientNameCore,
  createRedactionSession,
  questionAsksForClientName,
  redactForModel,
  redactIdentifiers,
  redactStatementText,
  redactStructured,
  redactTextParts,
  rehydrateClientName,
  rehydrateForUi,
  rehydrateModelOutput,
  rehydrateWorkingContext,
} from "../../../src/lib/redact-identifiers.ts";

export type {
  IdentifierSubject,
  RedactionRestore,
  RedactionSession,
} from "../../../src/lib/redact-identifiers.ts";
