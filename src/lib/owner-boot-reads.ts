/**
 * Cashflow and period financials for one known client.
 * Both selects start together. Neither waits on role resolution.
 */

export async function beginOwnerClientReads<C, F>(
  readCashflow: () => Promise<C>,
  readFinancials: () => Promise<F>,
): Promise<[C, F]> {
  return Promise.all([readCashflow(), readFinancials()]);
}
