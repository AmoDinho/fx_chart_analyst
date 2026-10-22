import { UserManager, type User } from "oidc-client-ts";
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { isDemoMode, publicConfig } from "./config";

export type SessionUser = {
  email?: string;
  name?: string;
  groups: string[];
  accessToken: string;
};

type AuthContextValue = {
  ready: boolean;
  user: SessionUser | null;
  isAdmin: boolean;
  busy: boolean;
  error: string | null;
  signIn: (returnTo?: string) => Promise<void>;
  signOut: () => Promise<void>;
  getAccessToken: () => Promise<string | null>;
};

const AuthContext = createContext<AuthContextValue | null>(null);
const DEMO_KEY = "fx-demo-session";
const RETURN_KEY = "fx-return";

function decodeJwt(token: string | undefined): Record<string, unknown> | null {
  const part = token?.split(".")[1];
  if (!part) return null;
  try {
    const padded = part.replace(/-/g, "+").replace(/_/g, "/");
    const json = atob(padded.padEnd(padded.length + ((4 - (padded.length % 4)) % 4), "="));
    const parsed: unknown = JSON.parse(json);
    return parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

function groupsFrom(bag: Record<string, unknown> | null | undefined): string[] | null {
  const raw = bag?.["cognito:groups"];
  if (Array.isArray(raw)) return raw.map(String);
  if (typeof raw === "string" && raw) return raw.split(/[ ,]+/).filter(Boolean);
  return null;
}

function sessionFromOidc(user: User): SessionUser {
  const groups =
    groupsFrom(user.profile as Record<string, unknown>) ??
    groupsFrom(decodeJwt(user.access_token)) ??
    groupsFrom(decodeJwt(user.id_token)) ??
    [];
  return {
    email: typeof user.profile.email === "string" ? user.profile.email : undefined,
    name: typeof user.profile.name === "string" ? user.profile.name : undefined,
    groups,
    accessToken: user.access_token,
  };
}

let manager: UserManager | null = null;

export function getUserManager(): UserManager {
  if (manager) return manager;
  const origin = window.location.origin;
  const config = publicConfig();
  manager = new UserManager({
    authority: `https://cognito-idp.${config.region}.amazonaws.com/${config.userPoolId}`,
    client_id: config.userPoolClientId,
    redirect_uri: `${origin}/auth/callback`,
    response_type: "code",
    scope: "openid email profile",
    automaticSilentRenew: false,
    loadUserInfo: false,
  });
  return manager;
}

let callbackInflight: Promise<string> | null = null;

export function completeSignIn(): Promise<string> {
  callbackInflight ??= getUserManager()
    .signinRedirectCallback()
    .then(() => {
      const dest = sessionStorage.getItem(RETURN_KEY) || "/";
      sessionStorage.removeItem(RETURN_KEY);
      return dest.startsWith("/") && !dest.startsWith("//") ? dest : "/";
    })
    .catch((error: unknown) => {
      callbackInflight = null;
      throw error;
    });
  return callbackInflight;
}

function readDemo(): SessionUser | null {
  try {
    const raw = sessionStorage.getItem(DEMO_KEY);
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return null;
    const row = parsed as Partial<SessionUser>;
    if (typeof row.accessToken !== "string" || !Array.isArray(row.groups)) return null;
    return { email: row.email, name: row.name, groups: row.groups.map(String), accessToken: row.accessToken };
  } catch {
    return null;
  }
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const demo = isDemoMode();
  const [ready, setReady] = useState(demo);
  const [user, setUser] = useState<SessionUser | null>(() => (demo ? readDemo() : null));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (demo) return;
    let cancelled = false;
    getUserManager()
      .getUser()
      .then((loaded) => {
        if (!cancelled) setUser(loaded && !loaded.expired ? sessionFromOidc(loaded) : null);
      })
      .catch(() => {
        if (!cancelled) setUser(null);
      })
      .finally(() => {
        if (!cancelled) setReady(true);
      });
    return () => {
      cancelled = true;
    };
  }, [demo]);

  const signIn = useCallback(
    async (returnTo = "/") => {
      setError(null);
      if (demo) {
        const next: SessionUser = {
          email: "you@fx-chart-analyst",
          name: "You",
          groups: ["admins"],
          accessToken: "demo",
        };
        sessionStorage.setItem(DEMO_KEY, JSON.stringify(next));
        setUser(next);
        return;
      }
      setBusy(true);
      try {
        const dest = returnTo.startsWith("/") && !returnTo.startsWith("//") ? returnTo : "/";
        sessionStorage.setItem(RETURN_KEY, dest);
        await getUserManager().signinRedirect();
      } catch (err) {
        setError(err instanceof Error ? err.message : "Could not start sign-in");
        setBusy(false);
      }
    },
    [demo],
  );

  const signOut = useCallback(async () => {
    if (demo) {
      sessionStorage.removeItem(DEMO_KEY);
      setUser(null);
      return;
    }
    await getUserManager().removeUser();
    setUser(null);
  }, [demo]);

  const getAccessToken = useCallback(async () => {
    if (demo) return readDemo()?.accessToken ?? user?.accessToken ?? null;
    const loaded = await getUserManager().getUser();
    if (!loaded || loaded.expired) return null;
    return loaded.access_token;
  }, [demo, user]);

  const value = useMemo<AuthContextValue>(
    () => ({
      ready,
      user,
      isAdmin: user?.groups.includes("admins") ?? false,
      busy,
      error,
      signIn,
      signOut,
      getAccessToken,
    }),
    [ready, user, busy, error, signIn, signOut, getAccessToken],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const value = useContext(AuthContext);
  if (!value) throw new Error("Auth provider missing");
  return value;
}
