/** Controllable client read. A hang never resolves. Everything else is empty. */
let clientsHang = false;

export function setFirmBookClientsHang(hang: boolean): void {
  clientsHang = hang;
}

function answer(table: string): Promise<{ data: unknown[]; error: null }> {
  if (table === "clients" && clientsHang) return new Promise(() => {});
  return Promise.resolve({ data: [], error: null });
}

function chain(table: string) {
  const promise = answer(table);
  const builder: Record<string, unknown> = {};
  const self = new Proxy(builder, {
    get(_target, prop) {
      if (prop === "then") return promise.then.bind(promise);
      if (prop === "catch") return promise.catch.bind(promise);
      if (prop === "finally") return promise.finally.bind(promise);
      return () => self;
    },
  });
  return self;
}

export const supabase = {
  from(table: string) {
    return chain(table);
  },
  rpc() {
    return Promise.resolve({ data: false, error: null });
  },
  auth: {
    getSession: async () => ({ data: { session: null }, error: null }),
    onAuthStateChange() {
      return { data: { subscription: { unsubscribe() {} } } };
    },
  },
};
