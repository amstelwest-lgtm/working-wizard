/**
 * Publishable Stripe key for browser code (Stripe.js). Safe to import from
 * client components — this value is designed to be public.
 */

export function stripePublishableKey(): string {
  return (
    (import.meta.env.VITE_STRIPE_PUBLISHABLE_KEY as string | undefined)?.trim() ||
    ""
  );
}

export function stripePublishableConfigured(): boolean {
  return Boolean(stripePublishableKey());
}
