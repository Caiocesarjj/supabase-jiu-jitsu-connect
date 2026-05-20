import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import type { Session, User } from "@supabase/supabase-js";
import { supabase } from "@/lib/supabase";
import type { Profile, UserRole } from "@/types/database";

interface AuthState {
  user: User | null;
  session: Session | null;
  profile: Profile | null;
  organizationId: string | null;
  userRole: UserRole | null;
  loading: boolean;
  signIn: (email: string, password: string) => Promise<void>;
  signOut: () => Promise<void>;
  refreshProfile: () => Promise<void>;
}

const AuthContext = createContext<AuthState | undefined>(undefined);

async function fetchProfile(userId: string): Promise<Profile | null> {
  try {
    const { data, error } = await supabase
      .from("profiles")
      .select("*")
      .eq("id", userId)
      .maybeSingle();
    if (error) {
      console.error("fetchProfile error", error);
      return null;
    }
    return (data as Profile | null) ?? null;
  } catch (err) {
    console.error("fetchProfile threw", err);
    return null;
  }
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let mounted = true;

    const initAuth = async () => {
      try {
        const {
          data: { session: existing },
        } = await supabase.auth.getSession();
        if (!mounted) return;
        setSession(existing);
        if (existing?.user) {
          const p = await fetchProfile(existing.user.id);
          if (mounted) setProfile(p);
        }
      } catch (err) {
        console.error("Auth init error:", err);
      } finally {
        if (mounted) setLoading(false);
      }
    };

    void initAuth();

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((event, newSession) => {
      if (!mounted) return;

      if (event === "SIGNED_OUT" || !newSession) {
        setSession(null);
        setProfile(null);
        setLoading(false);
        return;
      }

      setSession(newSession);

      if (newSession.user) {
        // Fire-and-forget: never await inside onAuthStateChange
        void fetchProfile(newSession.user.id).then((p) => {
          if (!mounted) return;
          setProfile(p);
          setLoading(false);
        });
      } else {
        setLoading(false);
      }
    });

    // Safety net: never leave the app stuck on the loading spinner
    const safetyTimer = setTimeout(() => {
      if (mounted) setLoading(false);
    }, 5000);

    return () => {
      mounted = false;
      clearTimeout(safetyTimer);
      subscription.unsubscribe();
    };
  }, []);

  const signIn = useCallback(async (email: string, password: string) => {
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) throw error;
  }, []);

  const signOut = useCallback(async () => {
    await supabase.auth.signOut();
    setProfile(null);
    setSession(null);
  }, []);

  const refreshProfile = useCallback(async () => {
    if (session?.user) {
      const p = await fetchProfile(session.user.id);
      setProfile(p);
    }
  }, [session?.user]);

  const value = useMemo<AuthState>(
    () => ({
      user: session?.user ?? null,
      session,
      profile,
      organizationId: profile?.organization_id ?? null,
      userRole: profile?.role ?? null,
      loading,
      signIn,
      signOut,
      refreshProfile,
    }),
    [session, profile, loading, signIn, signOut, refreshProfile],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
