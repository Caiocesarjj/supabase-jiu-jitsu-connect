import { createFileRoute, Outlet, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";
import { AppSidebar } from "@/components/AppSidebar";
import { useAuth } from "@/hooks/useAuth";
import { LoadingSpinner } from "@/components/LoadingSpinner";
import { supabase } from "@/lib/supabase";

export const Route = createFileRoute("/_authenticated")({
  component: AuthenticatedLayout,
});

function AuthenticatedLayout() {
  const { user, loading, profile, organizationId } = useAuth();
  const navigate = useNavigate();
  const [trialEndsAt, setTrialEndsAt] = useState<string | null>(null);
  const [loadingOverride, setLoadingOverride] = useState(true);

  // Safety timeout: if loading drags on for >5s, force-resolve the spinner
  useEffect(() => {
    if (!loading) {
      setLoadingOverride(true);
      return;
    }
    const timeout = setTimeout(() => {
      console.warn("Auth loading timeout — forçando false");
      setLoadingOverride(false);
    }, 5000);
    return () => clearTimeout(timeout);
  }, [loading]);

  const isLoading = loading && loadingOverride;

  useEffect(() => {
    if (!isLoading && !user) {
      navigate({ to: "/login" });
    } else if (!isLoading && user && !profile) {
      navigate({ to: "/cadastro-academia" });
    }
  }, [isLoading, user, profile, navigate]);

  useEffect(() => {
    if (!organizationId) return;
    let cancelled = false;
    (async () => {
      try {
        const { data } = await supabase
          .from("organizations")
          .select("trial_ends_at")
          .eq("id", organizationId)
          .maybeSingle();
        if (cancelled || !data) return;
        setTrialEndsAt((data as { trial_ends_at: string | null }).trial_ends_at);
      } catch (err) {
        console.error("organizations fetch failed", err);
        if (!cancelled) setTrialEndsAt(null);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [organizationId]);

  if (isLoading || !user || !profile) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <LoadingSpinner label="Carregando..." />
      </div>
    );
  }

  let banner: React.ReactNode = null;
  if (trialEndsAt) {
    const end = new Date(trialEndsAt);
    const now = new Date();
    const diffDays = Math.ceil((end.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
    if (end > now) {
      banner = (
        <div className="bg-yellow-100 border-b border-yellow-300 text-yellow-900 text-sm px-4 py-2">
          Seu trial termina em {diffDays} {diffDays === 1 ? "dia" : "dias"}.{" "}
          <a href="mailto:suporte@jjmanager.com" className="underline font-medium">
            Falar com suporte
          </a>
        </div>
      );
    } else {
      banner = (
        <div className="bg-red-100 border-b border-red-300 text-red-900 text-sm px-4 py-2">
          Trial encerrado —{" "}
          <a href="mailto:suporte@jjmanager.com" className="underline font-medium">
            entre em contato
          </a>{" "}
          para continuar usando.
        </div>
      );
    }
  }

  return (
    <SidebarProvider>
      <div className="min-h-screen flex w-full bg-background">
        <AppSidebar />
        <div className="flex-1 flex flex-col">
          <header className="h-12 flex items-center border-b border-border bg-card px-3">
            <SidebarTrigger />
          </header>
          {banner}
          <main className="flex-1 p-4 md:p-6">
            <Outlet />
          </main>
        </div>
      </div>
    </SidebarProvider>
  );
}
