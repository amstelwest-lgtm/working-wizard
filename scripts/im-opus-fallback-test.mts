/**
 * Opus 5.5 is tried first. A model-not-found or invalid-model error
 * retries once with the current Opus id. Other failures do not.
 * Run: pnpm test:im-opus-fallback
 */
import { CLAUDE_OPUS_55 } from "../src/lib/claude-request.ts";
import {
  IM_OPUS_55_ID,
  anthropicRejectedModel,
  imOpusAttemptModels,
  imOpusFallbackModel,
  readClaudeFailure,
} from "../src/lib/im-opus-model.ts";

function assert(cond: unknown, msg: string) {
  if (!cond) throw new Error(msg);
}

assert(IM_OPUS_55_ID === "claude-opus-5-5", "Opus 5.5 id matches the Claude API id");
assert(IM_OPUS_55_ID === CLAUDE_OPUS_55, "the interview uses the shared Opus 5.5 constant");

const same = imOpusAttemptModels(CLAUDE_OPUS_55);
assert(same.length === 1 && same[0] === IM_OPUS_55_ID, "the shared Opus constant is not retried as itself");

const override = imOpusAttemptModels("claude-opus-4-6");
assert(
  override[0] === IM_OPUS_55_ID && override[1] === "claude-opus-4-6",
  "a distinct current Opus id is the retry",
);
assert(imOpusAttemptModels("  ").join(",") === same.join(","), "a blank current id stays on the shared constant");
assert(imOpusAttemptModels(null).join(",") === same.join(","), "a missing current id stays on the shared constant");

const notFound = {
  status: 404,
  body: '{"type":"error","error":{"type":"not_found_error","message":"model: claude-opus-5-5"}}',
};
assert(
  anthropicRejectedModel(notFound.status, notFound.body),
  "404 not_found_error is a model rejection",
);
assert(
  imOpusFallbackModel({ attempted: IM_OPUS_55_ID, currentOpusId: CLAUDE_OPUS_55, ...notFound }) === null,
  "a 404 does not retry the same shared Opus id",
);
assert(
  imOpusFallbackModel({ attempted: "claude-opus-4-6", currentOpusId: "claude-opus-4-6", ...notFound }) === null,
  "the retry is not tried again",
);

const invalid = {
  status: 400,
  body: '{"type":"error","error":{"type":"invalid_request_error","message":"claude-opus-5-5 is not a valid model id"}}',
};
assert(
  anthropicRejectedModel(invalid.status, invalid.body),
  "400 invalid model is a model rejection",
);
assert(
  imOpusFallbackModel({
    attempted: IM_OPUS_55_ID,
    currentOpusId: "claude-opus-4-6",
    ...invalid,
  }) === "claude-opus-4-6",
  "a 400 invalid model selects the current Opus id",
);

const tooLong = {
  status: 400,
  body: '{"type":"error","error":{"type":"invalid_request_error","message":"prompt is too long"}}',
};
assert(
  !anthropicRejectedModel(tooLong.status, tooLong.body),
  "a 400 that is not about the model stays put",
);
assert(
  imOpusFallbackModel({ attempted: IM_OPUS_55_ID, currentOpusId: CLAUDE_OPUS_55, ...tooLong }) ===
    null,
  "prompt size does not switch models",
);

assert(!anthropicRejectedModel(429, "rate_limit_error"), "rate limit does not switch models");
assert(!anthropicRejectedModel(500, "api_error model"), "a server error does not switch models");
assert(!anthropicRejectedModel(401, "authentication_error"), "auth failure does not switch models");

const parsed = readClaudeFailure(new Error("Claude error (404): model: claude-opus-5-5"));
assert(
  parsed?.status === 404 && parsed.body.includes("model"),
  "the thrown Claude error keeps status and body",
);
assert(
  readClaudeFailure(new Error("The interview timed out. Retry.")) === null,
  "a timeout is not a model error",
);

console.log("im-opus-fallback-test: ok");
