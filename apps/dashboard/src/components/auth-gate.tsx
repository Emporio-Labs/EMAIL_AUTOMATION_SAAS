"use client";

import { createContext, useContext, useEffect, useMemo, useState } from "react";
import { fetchMe, loginWithPassword } from "@/lib/api";

type AuthContextValue = {
  token: string | null;
  user: { id: string; email?: string | null } | null;
  tenant: { id: string; name: string; slug: string | null; role: string } | null;
  signOut: () => void;
};

const AuthContext = createContext<AuthContextValue | null>(null);

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error("useAuth must be used within AuthGate");
  }
  return context;
}

const STORAGE_KEY = "swayammail_token";

export function AuthGate({ children }: { children: React.ReactNode }) {
  const [token, setToken] = useState<string | null>(null);
  const [user, setUser] = useState<AuthContextValue["user"]>(null);
  const [tenant, setTenant] = useState<AuthContextValue["tenant"]>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const stored = window.localStorage.getItem(STORAGE_KEY);
    if (!stored) {
      setLoading(false);
      return;
    }

    setLoading(true);
    fetchMe(stored)
      .then((response) => {
        setToken(stored);
        setUser(response.user);
        setTenant(response.tenant);
        setError(null);
      })
      .catch(() => {
        window.localStorage.removeItem(STORAGE_KEY);
        setToken(null);
      })
      .finally(() => setLoading(false));
  }, []);

  const signOut = () => {
    window.localStorage.removeItem(STORAGE_KEY);
    setToken(null);
    setUser(null);
    setTenant(null);
  };

  const contextValue = useMemo(
    () => ({ token, user, tenant, signOut }),
    [token, user, tenant],
  );

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center text-sm text-muted">
        Loading your workspace...
      </div>
    );
  }

  if (!token) {
    return (
      <LoginCard
        setToken={setToken}
        setUser={setUser}
        setTenant={setTenant}
        setError={setError}
        error={error}
      />
    );
  }

  return <AuthContext.Provider value={contextValue}>{children}</AuthContext.Provider>;
}

function LoginCard({
  setToken,
  setUser,
  setTenant,
  setError,
  error,
}: {
  setToken: (token: string) => void;
  setUser: (user: AuthContextValue["user"]) => void;
  setTenant: (tenant: AuthContextValue["tenant"]) => void;
  setError: (value: string | null) => void;
  error: string | null;
}) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setSubmitting(true);
    setError(null);

    try {
      const result = await loginWithPassword(email, password);
      window.localStorage.setItem(STORAGE_KEY, result.access_token);
      setToken(result.access_token);
      const profile = await fetchMe(result.access_token);
      setUser(profile.user);
      setTenant(profile.tenant);
    } catch (err: any) {
      setError(err?.message ?? "Failed to sign in");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center px-6">
      <div className="w-full max-w-md rounded-3xl border border-border bg-surface px-8 py-10 card-shadow">
        <div className="inline-flex items-center gap-2 rounded-full bg-accent-soft px-4 py-1 text-xs font-semibold text-accent-dark">
          Built for the Next Billion Indian Businesses
        </div>
        <h1 className="font-display mt-4 text-3xl text-foreground">Sign in to SwayamMail</h1>
        <p className="mt-2 text-sm text-muted">Use your platform credentials to access the dashboard.</p>

        <form className="mt-6 flex flex-col gap-4" onSubmit={handleSubmit}>
          <label className="flex flex-col gap-2 text-sm text-muted">
            Email
            <input
              className="h-11 rounded-xl border border-border bg-surface-muted px-4 text-sm text-foreground outline-none focus:border-accent"
              type="email"
              autoComplete="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              placeholder="you@company.com"
              required
            />
          </label>
          <label className="flex flex-col gap-2 text-sm text-muted">
            Password
            <input
              className="h-11 rounded-xl border border-border bg-surface-muted px-4 text-sm text-foreground outline-none focus:border-accent"
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              placeholder="••••••••"
              required
            />
          </label>

          {error ? <p className="text-sm text-red-600">{error}</p> : null}

          <button
            type="submit"
            className="mt-2 h-11 rounded-full bg-foreground text-sm font-semibold text-background transition hover:bg-[#2a2a2a]"
            disabled={submitting}
          >
            {submitting ? "Signing in..." : "Sign in"}
          </button>
        </form>
      </div>
    </div>
  );
}
