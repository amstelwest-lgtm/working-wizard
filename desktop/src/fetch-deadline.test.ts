import assert from "node:assert/strict";
import http from "node:http";
import test from "node:test";
import { fetchWithDeadline, type FetchLike } from "./fetch-deadline";

test("a request that never responds aborts", async () => {
  const sockets = new Set<import("node:net").Socket>();
  const server = http.createServer(() => {
    /* leave the socket open */
  });
  server.on("connection", (socket) => {
    sockets.add(socket);
    socket.on("close", () => sockets.delete(socket));
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => resolve()));
  const address = server.address();
  const port = address && typeof address === "object" ? address.port : 0;
  const started = Date.now();
  await assert.rejects(fetchWithDeadline(400)(`http://127.0.0.1:${port}/token?grant_type=password`), (error: unknown) => {
    return error instanceof Error && error.name === "AbortError";
  });
  assert.ok(Date.now() - started < 2000);
  for (const socket of sockets) socket.destroy();
  await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
});

test("the deadline wrapper calls the injected fetch", async () => {
  let seen = "";
  const injected: FetchLike = async (input) => {
    seen = String(input);
    return new Response("{}", { status: 200 });
  };
  const response = await fetchWithDeadline(1_000, injected)("https://example.test/auth/v1/token?grant_type=password");
  assert.equal(response.status, 200);
  assert.equal(seen, "https://example.test/auth/v1/token?grant_type=password");
});
