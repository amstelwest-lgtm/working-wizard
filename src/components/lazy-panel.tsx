import { Component, Fragment, lazy, type ComponentType, type ReactNode } from "react";

const PANEL_ERROR_CLS =
  "rounded-xl border border-rose-500/40 bg-rose-50 p-6 text-sm text-rose-900 dark:border-rose-500/30 dark:bg-rose-950/40 dark:text-rose-100";

function PanelError({
  label,
  detail,
  onRetry,
}: {
  label: string;
  detail: string;
  onRetry?: () => void;
}) {
  return (
    <div className={PANEL_ERROR_CLS}>
      {label} {detail}{" "}
      {onRetry && (
        <>
          <button type="button" className="underline" onClick={onRetry}>
            Try again
          </button>
          {" · "}
        </>
      )}
      <button type="button" className="underline" onClick={() => window.location.reload()}>
        Refresh the page
      </button>
    </div>
  );
}

/**
 * Lazy-load a tab panel. A missing/stale chunk (fresh Vercel deploy while the
 * tab was still open) used to throw through the root error page. Show a
 * refresh prompt instead so the rest of the board stays up.
 */
export function lazyPanel<P extends object>(
  loader: () => Promise<{ default: ComponentType<P> }>,
  label: string,
) {
  return lazy(async () => {
    try {
      return await loader();
    } catch (err) {
      console.error(`[${label}] chunk failed`, err);
      const Fallback: ComponentType<P> = function ChunkError() {
        return <PanelError label={label} detail="failed to load." />;
      };
      return { default: Fallback };
    }
  });
}

/** Catch render throws inside a tab so one panel cannot white-screen /app. */
export class TabErrorBoundary extends Component<
  { label: string; children: ReactNode },
  { error: Error | null; resetKey: number }
> {
  state: { error: Error | null; resetKey: number } = { error: null, resetKey: 0 };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  componentDidCatch(error: Error) {
    console.error(`[${this.props.label}] render failed`, error);
  }

  render() {
    if (this.state.error) {
      return (
        <PanelError
          label={this.props.label}
          detail="hit an error."
          onRetry={() => this.setState((s) => ({ error: null, resetKey: s.resetKey + 1 }))}
        />
      );
    }
    return <Fragment key={this.state.resetKey}>{this.props.children}</Fragment>;
  }
}
