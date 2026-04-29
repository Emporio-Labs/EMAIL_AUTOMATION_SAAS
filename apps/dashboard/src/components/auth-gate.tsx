"use client";

import { createContext, useContext, useEffect, useMemo, useState, useCallback } from "react";
import { apiFetch, fetchMe, loginWithPassword, signUpWithPassword } from "@/lib/api";
import { OnboardingWizard } from "@/components/onboarding-wizard";

type AuthContextValue = {
  token: string | null;
  user: { id: string; email?: string | null } | null;
  tenant: { id: string; name: string; slug: string | null; role: string } | null;
  pendingVerification: boolean;
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

// ─── AuthGate ─────────────────────────────────────────────────────────────────

export function AuthGate({ children }: { children: React.ReactNode }) {
  const [token, setToken] = useState<string | null>(null);
  const [user, setUser] = useState<AuthContextValue["user"]>(null);
  const [tenant, setTenant] = useState<AuthContextValue["tenant"]>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Onboarding: true = show wizard, false = go to dashboard
  const [needsOnboarding, setNeedsOnboarding] = useState(false);
  // true when user has domains but none are verified yet
  const [pendingVerification, setPendingVerification] = useState(false);

  const checkOnboarding = useCallback(async (tok: string) => {
    try {
      const res = await apiFetch<{ domains: { verified: boolean }[] }>("/v1/domains", tok);
      const domains = res.domains ?? [];
      const hasAny     = domains.length > 0;
      const hasVerified = domains.some((d) => d.verified);
      // Must register at least one domain before entering dashboard
      setNeedsOnboarding(!hasAny);
      // Pending banner: has domains but none verified
      setPendingVerification(hasAny && !hasVerified);
    } catch {
      // API unavailable — show onboarding as safe default.
      setNeedsOnboarding(true);
      setPendingVerification(false);
    }
  }, []);

  useEffect(() => {
    const stored = window.localStorage.getItem(STORAGE_KEY);
    if (!stored) {
      setLoading(false);
      return;
    }

    setLoading(true);
    fetchMe(stored)
      .then(async (response) => {
        setToken(stored);
        setUser(response.user);
        setTenant(response.tenant);
        setError(null);
        await checkOnboarding(stored);
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
    setNeedsOnboarding(false);
    setPendingVerification(false);
  };

  const contextValue = useMemo(
    () => ({ token, user, tenant, pendingVerification, signOut }),
    [token, user, tenant, pendingVerification],
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
      <AuthCards
        setToken={setToken}
        setUser={setUser}
        setTenant={setTenant}
        setError={setError}
        error={error}
        onLoginSuccess={checkOnboarding}
        onSignupSuccess={() => setNeedsOnboarding(true)}
      />
    );
  }

  // Show onboarding wizard if no verified domain yet
  if (needsOnboarding) {
    return (
      <OnboardingWizard
        token={token}
        tenantName={tenant?.name ?? ""}
        onComplete={() => setNeedsOnboarding(false)}
      />
    );
  }

  return (
    <AuthContext.Provider value={contextValue}>
      {/* Persistent banner when domain is registered but DKIM not yet verified */}
      {pendingVerification && (
        <div className="sticky top-0 z-40 flex items-center justify-between gap-3 bg-amber-50 border-b border-amber-200 px-6 py-2.5 text-sm text-amber-800">
          <span>
            ⚠️ <strong>Domain verification pending.</strong> Publish your DNS records and click{" "}
            <strong>Check DNS</strong> on the Domains page to unlock sending.
          </span>
          <a
            href="/domains"
            className="shrink-0 rounded-full bg-amber-800 px-3 py-1 text-xs font-semibold text-white transition hover:bg-amber-900"
          >
            Go to Domains →
          </a>
        </div>
      )}
      {children}
    </AuthContext.Provider>
  );
}

// ─── Shared types ─────────────────────────────────────────────────────────────

type CardProps = {
  setToken: (token: string) => void;
  setUser: (user: AuthContextValue["user"]) => void;
  setTenant: (tenant: AuthContextValue["tenant"]) => void;
  setError: (value: string | null) => void;
  error: string | null;
  onLoginSuccess: (token: string) => Promise<void>; // existing user — checks API
  onSignupSuccess: () => void;                       // new user  — always show wizard
};

// ─── Shell: toggles between Login and Signup ──────────────────────────────────

function AuthCards(props: CardProps) {
  const [mode, setMode] = useState<"login" | "signup">("login");

  return (
    <div className="min-h-screen flex items-center justify-center px-6 py-12">
      {mode === "login" ? (
        <LoginCard {...props} onSwitchToSignup={() => { props.setError(null); setMode("signup"); }} />
      ) : (
        <SignupCard {...props} onSwitchToLogin={() => { props.setError(null); setMode("login"); }} />
      )}
    </div>
  );
}

// ─── Login Card ───────────────────────────────────────────────────────────────

function LoginCard({
  setToken,
  setUser,
  setTenant,
  setError,
  error,
  onLoginSuccess,
  onSwitchToSignup,
}: CardProps & { onSwitchToSignup: () => void }) {
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
      await onLoginSuccess(result.access_token);
    } catch (err: any) {
      setError(err?.message ?? "Failed to sign in");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="w-full max-w-md rounded-3xl border border-border bg-surface px-8 py-10 card-shadow fade-in">
      <div className="inline-flex items-center gap-2 rounded-full bg-accent-soft px-4 py-1 text-xs font-semibold text-accent-dark">
        Built for the Next Billion Indian Businesses
      </div>
      <h1 className="font-display mt-4 text-3xl text-foreground">
        Sign in to SwayamMail
      </h1>
      <p className="mt-2 text-sm text-muted">
        Use your platform credentials to access the dashboard.
      </p>

      <form className="mt-6 flex flex-col gap-4" onSubmit={handleSubmit}>
        <label className="flex flex-col gap-2 text-sm text-muted">
          Email
          <input
            className="h-11 rounded-xl border border-border bg-surface-muted px-4 text-sm text-foreground outline-none focus:border-accent"
            type="email"
            autoComplete="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
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
            onChange={(e) => setPassword(e.target.value)}
            placeholder="••••••••"
            required
          />
        </label>

        {error ? <p className="text-sm text-red-600">{error}</p> : null}

        <button
          type="submit"
          className="mt-2 h-11 rounded-full bg-foreground text-sm font-semibold text-background transition hover:bg-[#2a2a2a] disabled:opacity-60"
          disabled={submitting}
        >
          {submitting ? "Signing in..." : "Sign in"}
        </button>
      </form>

      <p className="mt-6 text-center text-xs text-muted">
        Don&apos;t have an account?{" "}
        <button
          type="button"
          className="font-semibold text-accent-dark underline-offset-2 hover:underline"
          onClick={onSwitchToSignup}
        >
          Create one free
        </button>
      </p>
    </div>
  );
}

// ─── Signup Card ──────────────────────────────────────────────────────────────

function SignupCard({
  setToken,
  setUser,
  setTenant,
  setError,
  error,
  onSignupSuccess,
  onSwitchToLogin,
}: CardProps & { onSwitchToLogin: () => void }) {
  const [form, setForm] = useState({
    tenantName: "",
    email: "",
    password: "",
    confirmPassword: "",
  });
  const [submitting, setSubmitting] = useState(false);
  const [confirmation, setConfirmation] = useState<string | null>(null);

  function patch(key: keyof typeof form) {
    return (e: React.ChangeEvent<HTMLInputElement>) =>
      setForm((prev) => ({ ...prev, [key]: e.target.value }));
  }

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);

    if (form.password !== form.confirmPassword) {
      setError("Passwords do not match.");
      return;
    }

    setSubmitting(true);

    try {
      const result = await signUpWithPassword(
        form.email,
        form.password,
        form.tenantName,
      );

      if ("requiresConfirmation" in result && result.requiresConfirmation) {
        setConfirmation(result.message);
        return;
      }

      const session = result as { access_token: string };
      window.localStorage.setItem(STORAGE_KEY, session.access_token);
      setToken(session.access_token);
      const profile = await fetchMe(session.access_token);
      setUser(profile.user);
      setTenant(profile.tenant);
      // New signup → always show onboarding (they can't have a domain yet)
      onSignupSuccess();
    } catch (err: any) {
      setError(err?.message ?? "Failed to create account");
    } finally {
      setSubmitting(false);
    }
  }

  // ── Email-confirmation pending state ──────────────────────────────────────
  if (confirmation) {
    return (
      <div className="w-full max-w-md rounded-3xl border border-border bg-surface px-8 py-10 card-shadow fade-in text-center">
        <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-accent-soft text-2xl">
          ✉️
        </div>
        <h1 className="font-display mt-5 text-2xl text-foreground">
          Check your inbox
        </h1>
        <p className="mt-3 text-sm text-muted leading-relaxed">{confirmation}</p>
        <button
          type="button"
          className="mt-8 h-11 w-full rounded-full bg-foreground text-sm font-semibold text-background transition hover:bg-[#2a2a2a]"
          onClick={onSwitchToLogin}
        >
          Back to sign in
        </button>
      </div>
    );
  }

  // ── Main signup form ──────────────────────────────────────────────────────
  return (
    <div className="w-full max-w-md rounded-3xl border border-border bg-surface px-8 py-10 card-shadow fade-in">
      <div className="inline-flex items-center gap-2 rounded-full bg-accent-soft px-4 py-1 text-xs font-semibold text-accent-dark">
        Built for the Next Billion Indian Businesses
      </div>
      <h1 className="font-display mt-4 text-3xl text-foreground">
        Create your account
      </h1>
      <p className="mt-2 text-sm text-muted">
        Set up your SwayamMail workspace in seconds.
      </p>

      <form className="mt-6 flex flex-col gap-4" onSubmit={handleSubmit}>
        <label className="flex flex-col gap-2 text-sm text-muted">
          Workspace name
          <input
            className="h-11 rounded-xl border border-border bg-surface-muted px-4 text-sm text-foreground outline-none focus:border-accent"
            type="text"
            autoComplete="organization"
            value={form.tenantName}
            onChange={patch("tenantName")}
            placeholder="Acme Corp"
            required
            minLength={2}
          />
        </label>

        <label className="flex flex-col gap-2 text-sm text-muted">
          Email
          <input
            className="h-11 rounded-xl border border-border bg-surface-muted px-4 text-sm text-foreground outline-none focus:border-accent"
            type="email"
            autoComplete="email"
            value={form.email}
            onChange={patch("email")}
            placeholder="you@company.com"
            required
          />
        </label>

        <label className="flex flex-col gap-2 text-sm text-muted">
          Password
          <input
            className="h-11 rounded-xl border border-border bg-surface-muted px-4 text-sm text-foreground outline-none focus:border-accent"
            type="password"
            autoComplete="new-password"
            value={form.password}
            onChange={patch("password")}
            placeholder="Min. 8 characters"
            required
            minLength={8}
          />
        </label>

        <label className="flex flex-col gap-2 text-sm text-muted">
          Confirm password
          <input
            className="h-11 rounded-xl border border-border bg-surface-muted px-4 text-sm text-foreground outline-none focus:border-accent"
            type="password"
            autoComplete="new-password"
            value={form.confirmPassword}
            onChange={patch("confirmPassword")}
            placeholder="••••••••"
            required
          />
        </label>

        {error ? <p className="text-sm text-red-600">{error}</p> : null}

        <button
          type="submit"
          className="mt-2 h-11 rounded-full bg-foreground text-sm font-semibold text-background transition hover:bg-[#2a2a2a] disabled:opacity-60"
          disabled={submitting}
        >
          {submitting ? "Creating account..." : "Create account"}
        </button>
      </form>

      <p className="mt-6 text-center text-xs text-muted">
        Already have an account?{" "}
        <button
          type="button"
          className="font-semibold text-accent-dark underline-offset-2 hover:underline"
          onClick={onSwitchToLogin}
        >
          Sign in
        </button>
      </p>
    </div>
  );
}
