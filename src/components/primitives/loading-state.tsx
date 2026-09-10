import { cn } from "@/lib/utils";

export type LoadingStateProps = {
  message?: string;
  fullscreen?: boolean;
  className?: string;
};

export function LoadingState({
  message = "Loading…",
  fullscreen = false,
  className,
}: LoadingStateProps) {
  return (
    <div
      className={cn(
        "milon-loading-state",
        fullscreen && "milon-loading-state--fullscreen",
        className,
      )}
      role="status"
      aria-live="polite"
    >
      <span className="milon-loading-state__spinner" aria-hidden />
      <span>{message}</span>
    </div>
  );
}
