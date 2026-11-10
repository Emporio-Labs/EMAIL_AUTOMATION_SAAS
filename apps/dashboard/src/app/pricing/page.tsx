import type { Metadata } from "next";
import { FinalCta, MarketingFooter, MarketingNav, PricingGrid } from "@/components/marketing/site-chrome";

const title = "Pricing: email API plans in rupees";
const description =
  "SwayamMail pricing: free for 1,000 emails a month, then ₹499 for 25,000, ₹1,499 for 100,000 and ₹5,999 for 500,000 emails a month, plus GST. Email OTP, transactional and marketing email included.";

export const metadata: Metadata = {
  title,
  description,
  alternates: { canonical: "/pricing" },
  openGraph: { title, description, url: "/pricing" },
};

export default function PricingPage() {
  return (
    <>
      <MarketingNav />
      <main>
        <section className="mx-auto max-w-6xl px-5 py-16 text-center">
          <h1 className="font-display text-4xl sm:text-5xl">Simple monthly pricing in rupees.</h1>
          <p className="mx-auto mb-10 mt-4 max-w-xl text-muted">
            Flat plans, no credits that expire. One account covers email OTP, the transactional API and campaigns;
            marketing campaigns start on the Starter plan.
          </p>
          <PricingGrid />
        </section>
        <FinalCta
          title="Start on the free plan."
          body="1,000 emails a month at no cost. Upgrade when you need more."
        />
      </main>
      <MarketingFooter />
    </>
  );
}
