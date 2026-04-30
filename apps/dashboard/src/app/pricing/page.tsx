import React from "react";

export default function PricingPage() {
  return (
    <div className="min-h-screen bg-background text-foreground px-6 py-12">
      <div className="max-w-4xl mx-auto text-center">
        <h1 className="serif text-4xl mb-4">Pricing</h1>
        <p className="text-muted mb-8">Free for users who sign up during our open beta.</p>

        <div className="grid md:grid-cols-3 gap-6">
          <div className="p-6 border border-border rounded-xl">
            <div className="text-xs uppercase text-muted">Starter</div>
            <h3 className="text-2xl font-semibold my-2">Free</h3>
            <p className="text-sm text-muted">Up to 10,000 emails / month during beta.</p>
          </div>
          <div className="p-6 border border-border rounded-xl">
            <div className="text-xs uppercase text-muted">Growth</div>
            <h3 className="text-2xl font-semibold my-2">Pay as you go</h3>
            <p className="text-sm text-muted">Scale with predictable per-email pricing.</p>
          </div>
          <div className="p-6 border border-border rounded-xl">
            <div className="text-xs uppercase text-muted">Enterprise</div>
            <h3 className="text-2xl font-semibold my-2">Custom</h3>
            <p className="text-sm text-muted">SLA, dedicated IPs, and volume discounts.</p>
          </div>
        </div>
      </div>
    </div>
  );
}
