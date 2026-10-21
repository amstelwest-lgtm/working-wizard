/**
 * Test stand-in for @/lib/stripe.server.
 * The Add client allowance and the firm entitlement read call getStripe().
 * This lets those paths use a class-instance Stripe mock.
 */

type StripeLike = {
  customers: object;
  subscriptions: object;
};

let current: StripeLike | undefined;

export function stripeConfigured(): boolean {
  return true;
}

export function stripePublishableConfigured(): boolean {
  return false;
}

export function getStripe(): StripeLike {
  if (!current) throw new Error("test stripe is not installed");
  return current;
}

export function setTestStripe(next: StripeLike): void {
  current = next;
}
