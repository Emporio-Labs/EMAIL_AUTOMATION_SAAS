export const SITE_URL = "https://swayammail.yugaas.in";
export const SITE_NAME = "SwayamMail";
export const SIGNUP_HREF = "/signin?mode=signup";

export const OVERAGE_NOTE = "Overage: ₹15 per 1,000 emails. All prices exclude 18% GST.";

export type Plan = {
  name: string;
  price: string;
  priceValue: number;
  emails: string;
  features: string[];
  cta: string;
  highlight?: boolean;
};

export const PLANS: Plan[] = [
  {
    name: "Free",
    price: "₹0",
    priceValue: 0,
    emails: "1,000 emails / month",
    features: ["1 sending domain", "Transactional send API", "Sandbox keys for testing"],
    cta: "Start free",
  },
  {
    name: "Starter",
    price: "₹499",
    priceValue: 499,
    emails: "25,000 emails / month",
    features: ["2 sending domains", "Marketing campaigns and lists", "About 2 paise per email"],
    cta: "Get Starter",
  },
  {
    name: "Growth",
    price: "₹1,499",
    priceValue: 1499,
    emails: "100,000 emails / month",
    features: ["5 sending domains", "Signed webhooks", "Open and click tracking"],
    cta: "Get Growth",
    highlight: true,
  },
  {
    name: "Scale",
    price: "₹5,999",
    priceValue: 5999,
    emails: "500,000 emails / month",
    features: ["Unlimited sending domains", "Up to 1,000 recipients per send", "Everything in Growth"],
    cta: "Get Scale",
  },
];

export type Faq = { q: string; a: string };

export function faqJsonLd(faqs: Faq[]) {
  return {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: faqs.map(({ q, a }) => ({
      "@type": "Question",
      name: q,
      acceptedAnswer: { "@type": "Answer", text: a },
    })),
  };
}
