"use client";

import { DomainSetupFlow, DomainRow } from "@/components/domain-setup-flow";

type Props = {
  token: string;
  tenantName: string;
  onComplete: () => void;
};

export function OnboardingWizard({ token, tenantName, onComplete }: Props) {
  function handleDone(_domain: DomainRow) {
    // domain is verified (or skipped) — let AuthGate know to hide wizard
    onComplete();
  }

  return (
    <div className="min-h-screen flex flex-col items-center justify-center bg-background px-6 py-12">
      <div className="w-full max-w-2xl">

        {/* Header */}
        <div className="mb-8 text-center">
          <div className="inline-flex items-center gap-2 rounded-full bg-accent-soft px-4 py-1 text-xs font-semibold text-accent-dark mb-4">
            One-time setup
          </div>
          <h1 className="font-display text-3xl text-foreground">
            Welcome to SwayamMail{tenantName ? `, ${tenantName}` : ""}
          </h1>
          <p className="mt-2 text-sm text-muted">
            Before you can send emails, connect your sending domain. It only takes a few minutes.
          </p>
        </div>

        {/* The shared 3-step flow — full size (compact=false) */}
        <div className="rounded-3xl border border-border bg-surface px-8 py-8 card-shadow fade-in">
          <DomainSetupFlow
            token={token}
            onComplete={handleDone}
          />
        </div>

      </div>
    </div>
  );
}
