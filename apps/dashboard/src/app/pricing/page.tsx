import React from "react";

export default function PricingPage() {
  return (
    <div className="min-h-screen bg-background text-foreground px-6 py-12">
      <div className="max-w-6xl mx-auto text-center">
        <h1 className="serif text-4xl mb-4">Pricing</h1>
        <p className="text-muted mb-8">
          INR-denominated pricing with Razorpay integration — zero forex fee friction. Overage: ₹0.80 per 1,000 emails.
        </p>

        <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-6 text-left">
          <div className="p-6 border border-border rounded-xl flex flex-col justify-between">
            <div>
              <div className="text-xs uppercase text-muted font-bold tracking-wider mb-1">Free</div>
              <h3 className="text-3xl font-semibold my-2">₹0</h3>
              <p className="text-sm text-muted">1,000 emails / month</p>
            </div>
            <div className="mt-6">
              <a href="/signin?mode=signup" className="inline-block w-full text-center bg-foreground text-background px-4 py-2.5 rounded-lg text-sm font-semibold hover:opacity-90 transition-opacity">
                Get Free
              </a>
            </div>
          </div>
          <div className="p-6 border border-border rounded-xl flex flex-col justify-between">
            <div>
              <div className="text-xs uppercase text-muted font-bold tracking-wider mb-1">Starter</div>
              <h3 className="text-3xl font-semibold my-2">
                ₹299<span className="text-sm font-normal text-muted">/mo</span>
              </h3>
              <p className="text-sm text-muted">25,000 emails / month</p>
            </div>
            <div className="mt-6">
              <a href="/signin?mode=signup" className="inline-block w-full text-center bg-foreground text-background px-4 py-2.5 rounded-lg text-sm font-semibold hover:opacity-90 transition-opacity">
                Get Started
              </a>
            </div>
          </div>
          <div className="p-6 border border-border rounded-xl flex flex-col justify-between">
            <div>
              <div className="text-xs uppercase text-muted font-bold tracking-wider mb-1">Growth</div>
              <h3 className="text-3xl font-semibold my-2">
                ₹799<span className="text-sm font-normal text-muted">/mo</span>
              </h3>
              <p className="text-sm text-muted">100,000 emails / month</p>
            </div>
            <div className="mt-6">
              <a href="/signin?mode=signup" className="inline-block w-full text-center bg-foreground text-background px-4 py-2.5 rounded-lg text-sm font-semibold hover:opacity-90 transition-opacity">
                Get Growth
              </a>
            </div>
          </div>
          <div className="p-6 border border-border rounded-xl flex flex-col justify-between">
            <div>
              <div className="text-xs uppercase text-muted font-bold tracking-wider mb-1">Scale</div>
              <h3 className="text-3xl font-semibold my-2">
                ₹1,999<span className="text-sm font-normal text-muted">/mo</span>
              </h3>
              <p className="text-sm text-muted">500,000 emails / month</p>
            </div>
            <div className="mt-6">
              <a href="/signin?mode=signup" className="inline-block w-full text-center bg-foreground text-background px-4 py-2.5 rounded-lg text-sm font-semibold hover:opacity-90 transition-opacity">
                Get Scale
              </a>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
