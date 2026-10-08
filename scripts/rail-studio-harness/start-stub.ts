/** Local stand-in so the harness does not load the TanStack Start server runtime. */
function builder() {
  const call = () => Promise.reject(new Error("harness-local"));
  return new Proxy(call, {
    get(_target, prop) {
      if (prop === "then") return undefined;
      return () => builder();
    },
  });
}

export function createServerFn() {
  return builder();
}

export function useServerFn() {
  return async () => {
    throw new Error("harness-local");
  };
}

export function createMiddleware() {
  return builder();
}

export function getRequest() {
  return new Request("http://127.0.0.1/");
}

export function createStartHandler() {
  return () => new Response("harness-local", { status: 404 });
}
