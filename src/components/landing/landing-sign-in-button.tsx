/**
 * Header Sign in control shared by the homepage nav and public marketing pages.
 * The label and element stay the same; each page passes its own class and click.
 */
export function LandingSignInButton({
  className = "btn btn-ghost nav-signin",
  onClick,
}: {
  className?: string;
  onClick: () => void;
}) {
  return (
    <button type="button" className={className} onClick={onClick}>
      Sign in
    </button>
  );
}
