/**
 * Edge auth: a network failure is 503, a bad token is 401.
 * Run: pnpm test:edge-auth
 */
import { authenticateEdgeUser, AUTH_UNAVAILABLE_CODE } from "../supabase/functions/_shared/edge-auth.ts";

function assert(cond: unknown, msg: string) {
  if (!cond) throw new Error(msg);
}

function auth(getUser: () => Promise<{ data: { user: { id: string; email?: string } | null }; error: unknown }>) {
  return { getUser };
}

const network = {
  name: "AuthRetryableFetchError",
  status: 0,
  message: "Failed to fetch",
};

{
  let calls = 0;
  const result = await authenticateEdgeUser({
    token: "jwt",
    auth: auth(async () => {
      calls += 1;
      return { data: { user: null }, error: network };
    }),
  });
  assert(calls === 2, "a network error retries getUser once");
  assert(result.ok === false && result.status === 503, "a network error is 503");
  assert(
    result.ok === false && result.body.code === AUTH_UNAVAILABLE_CODE,
    "a network error is auth_unavailable",
  );
  assert(result.ok === false && result.body.error !== "Unauthorised", "a network error is not Unauthorised");
}

{
  let calls = 0;
  const result = await authenticateEdgeUser({
    token: "not-a-jwt",
    auth: auth(async () => {
      calls += 1;
      return {
        data: { user: null },
        error: { name: "AuthApiError", status: 401, message: "invalid JWT" },
      };
    }),
  });
  assert(calls === 1, "a bad token does not retry");
  assert(result.ok === false && result.status === 401, "a bad token is 401");
  assert(result.ok === false && result.body.error === "Unauthorised", "a bad token says Unauthorised");
  assert(result.ok === false && result.body.code === undefined, "a bad token is not auth_unavailable");
}

{
  let calls = 0;
  const result = await authenticateEdgeUser({
    token: "",
    auth: auth(async () => {
      calls += 1;
      return { data: { user: { id: "should-not-run" } }, error: null };
    }),
  });
  assert(calls === 0, "a missing token does not call getUser");
  assert(result.ok === false && result.status === 401, "a missing token is 401");
}

{
  let calls = 0;
  const result = await authenticateEdgeUser({
    token: "jwt",
    auth: auth(async () => {
      calls += 1;
      if (calls === 1) return { data: { user: null }, error: network };
      return { data: { user: { id: "user-1", email: "a@example.com" } }, error: null };
    }),
  });
  assert(result.ok === true && result.user.id === "user-1", "a retry that reaches Auth returns the user");
  assert(calls === 2, "the successful retry is the second getUser");
}

{
  let userCalls = 0;
  const result = await authenticateEdgeUser({
    token: "jwt",
    auth: {
      getUser: async () => {
        userCalls += 1;
        return { data: { user: null }, error: network };
      },
      getClaims: async () => ({
        data: { claims: { sub: "local-user", email: "local@example.com" } },
        error: null,
      }),
    },
  });
  assert(userCalls === 1, "a local getClaims result skips the getUser retry");
  assert(result.ok === true && result.user.id === "local-user", "getClaims supplies the user id");
}

console.log("edge-auth: ok");
