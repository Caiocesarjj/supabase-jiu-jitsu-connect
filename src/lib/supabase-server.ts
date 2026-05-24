import { createClient } from "@supabase/supabase-js";

function env(name: string): string | undefined {
  const fromProcess = process.env[name];
  if (fromProcess && fromProcess.length > 0) return fromProcess;
  if (name.startsWith("VITE_") && typeof import.meta !== "undefined") {
    const fromMeta = (import.meta.env as Record<string, string | undefined>)[name];
    if (fromMeta && fromMeta.length > 0) return fromMeta;
  }
  return undefined;
}

export function getSupabaseServerConfig() {
  const url =
    env("APP_SUPABASE_URL") ?? env("SUPABASE_URL") ?? env("VITE_SUPABASE_URL");
  const publishableKey =
    env("APP_SUPABASE_PUBLISHABLE_KEY") ??
    env("SUPABASE_ANON_KEY") ??
    env("VITE_SUPABASE_PUBLISHABLE_KEY");
  const serviceRoleKey =
    env("APP_SUPABASE_SERVICE_ROLE_KEY") ?? env("SUPABASE_SERVICE_ROLE_KEY");
  return { url, publishableKey, serviceRoleKey };
}

function assertServerConfig() {
  const config = getSupabaseServerConfig();
  if (!config.url || !config.publishableKey) {
    throw new Error(
      "Supabase do servidor não configurado. Defina VITE_SUPABASE_URL e VITE_SUPABASE_PUBLISHABLE_KEY no .env.",
    );
  }
  return config as {
    url: string;
    publishableKey: string;
    serviceRoleKey?: string;
  };
}

/** Prefer service role when set; otherwise publishable key (RLS applies). */
export function getAdminClient() {
  const { url, publishableKey, serviceRoleKey } = assertServerConfig();
  return createClient(url, serviceRoleKey ?? publishableKey, {
    auth: { persistSession: false },
  });
}

/** Client scoped to the caller JWT — use in server functions protected by RLS. */
export function getUserClient(accessToken: string) {
  const { url, publishableKey } = assertServerConfig();
  return createClient(url, publishableKey, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { Authorization: `Bearer ${accessToken}` } },
  });
}
