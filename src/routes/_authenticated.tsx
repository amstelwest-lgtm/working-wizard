import { createFileRoute, Outlet, useNavigate, useRouterState } from "@tanstack/react-router";
import { useEffect } from "react";
import { useAuth } from "@/hooks/use-auth";
import { shouldStayOnAccountantPortal, setPortalIntent, clearForcePortal } from "@/lib/user-roles";

export const Route = createFileRoute("/_authenticated")({
  component: AuthGate,
});

function isPracticePath(pathname: string): boolean {
  return (
    pathname === "/dashboard" ||
    pathname.startsWith("/dashboard/") ||
    pathname.startsWith("/clients") ||
    pathname.startsWith("/reports")
  );
}

function AuthGate() {
  const { user, loading } = useAuth();
  const navigate = useNavigate();
  const pathname = useRouterState({ select: (s) => s.location.pathname });

  useEffect(() => {
    if (typeof window === "undefined") return;
    void import("@/lib/email-confirm").then(({ shouldForwardToConfirm, confirmUrlFromLocation }) => {
      if (
        shouldForwardToConfirm(window.location.pathname, window.location.search, window.location.hash)
      ) {
        window.location.replace(
          confirmUrlFromLocation(window.location.origin, window.location.search, window.location.hash),
        );
      }
    });
  }, []);

  useEffect(() => {
    if (!loading && !user) navigate({ to: "/auth", search: {} });
  }, [user, loading, navigate]);

  useEffect(() => {
    if (!user || loading || !isPracticePath(pathname)) return;
    let cancelled = false;
    void shouldStayOnAccountantPortal(user.id).then((stay) => {
      if (cancelled) return;
      if (stay) return;
      clearForcePortal();
      setPortalIntent("owner");
      navigate({ to: "/app" });
    });
    return () => {
      cancelled = true;
    };
  }, [user, loading, pathname, navigate]);

  if (loading) {
    return (
      <div className="min-h-screen grid place-items-center text-muted-foreground">
        Loading…
      </div>
    );
  }
  if (!user) return null;
  return <Outlet />;
}
