/** Local preview stand-in. The owner door does not wait on Vercel background work. */
export function waitUntil(task: Promise<unknown> | undefined): void {
  void task;
}
