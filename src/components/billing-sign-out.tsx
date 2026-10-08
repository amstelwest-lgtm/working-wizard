import { useAuth } from "@/hooks/use-auth";

/**
 * Exit from a billing wall. Clears the local session and leaves Checkout.
 */
export function BillingSignOutButton({ onBeforeSignOut }: { onBeforeSignOut?: () => void }) {
  const { signOut } = useAuth();
  return (
    <button
      type="button"
      onClick={() => {
        onBeforeSignOut?.();
        void signOut().then(() => {
          window.location.assign("/");
        });
      }}
      className="inline-flex h-10 items-center rounded-full border border-white/15 px-4 text-xs font-bold uppercase tracking-wider text-slate-300"
    >
      Sign out
    </button>
  );
}
