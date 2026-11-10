/**
 * Sign in with Google through Supabase Auth, without a client library.
 * Flow: redirect to Supabase -> Google -> back here with tokens in the URL hash. The session lives in
 * localStorage and is refreshed shortly before it expires.
 */
export interface Session {
  access_token: string;
  refresh_token: string;
  expires_at: number; // epoch seconds
  email?: string;
}
export interface AuthConfig {
  auth: "dev" | "supabase";
  supabaseUrl: string;
  supabaseAnonKey: string;
}

const KEY = "rs.session";
let cfg: AuthConfig = { auth: "dev", supabaseUrl: "", supabaseAnonKey: "" };
let session: Session | null = null;
let refreshing: Promise<Session | null> | null = null;

const emailOf = (jwt: string): string | undefined => {
  try {
    return JSON.parse(atob(jwt.split(".")[1].replace(/-/g, "+").replace(/_/g, "/"))).email;
  } catch {
    return undefined;
  }
};

const store = (s: Session | null) => {
  session = s;
  try {
    if (s) localStorage.setItem(KEY, JSON.stringify(s));
    else localStorage.removeItem(KEY);
  } catch {}
};

/** Call once at startup. Picks up a session from the redirect hash or from storage. */
export function initAuth(c: AuthConfig): Session | null {
  cfg = c;
  if (c.auth !== "supabase") return null;
  const h = new URLSearchParams(location.hash.replace(/^#/, ""));
  if (h.get("access_token") && h.get("refresh_token")) {
    const at = h.get("access_token")!;
    store({ access_token: at, refresh_token: h.get("refresh_token")!, expires_at: Math.floor(Date.now() / 1000) + Number(h.get("expires_in") || 3600), email: emailOf(at) });
    history.replaceState(null, "", location.pathname + location.search);
  } else {
    try {
      session = JSON.parse(localStorage.getItem(KEY) || "null");
    } catch {
      session = null;
    }
  }
  return session;
}

export const authError = (): string | null => {
  const h = new URLSearchParams(location.hash.replace(/^#/, ""));
  return h.get("error_description");
};

export function signInWithGoogle(): void {
  location.href = `${cfg.supabaseUrl}/auth/v1/authorize?provider=google&redirect_to=${encodeURIComponent(location.origin)}`;
}

export function signOut(): void {
  const s = session;
  store(null);
  if (s) fetch(`${cfg.supabaseUrl}/auth/v1/logout`, { method: "POST", headers: { apikey: cfg.supabaseAnonKey, Authorization: `Bearer ${s.access_token}` } }).catch(() => {});
  location.reload();
}

async function refresh(): Promise<Session | null> {
  if (!session) return null;
  try {
    const r = await fetch(`${cfg.supabaseUrl}/auth/v1/token?grant_type=refresh_token`, {
      method: "POST",
      headers: { apikey: cfg.supabaseAnonKey, "Content-Type": "application/json" },
      body: JSON.stringify({ refresh_token: session.refresh_token }),
    });
    if (!r.ok) throw new Error("refresh failed");
    const d = await r.json();
    store({ access_token: d.access_token, refresh_token: d.refresh_token, expires_at: Math.floor(Date.now() / 1000) + (d.expires_in || 3600), email: emailOf(d.access_token) });
  } catch {
    store(null);
  }
  return session;
}

/** A valid access token, or null when signed out (dev mode needs none). */
export async function token(): Promise<string | null> {
  if (cfg.auth !== "supabase" || !session) return null;
  if (session.expires_at - Date.now() / 1000 < 60) {
    refreshing = refreshing || refresh().finally(() => (refreshing = null));
    await refreshing;
  }
  return session?.access_token || null;
}

export const currentSession = () => session;
