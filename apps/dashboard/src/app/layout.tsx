import type { Metadata } from "next";
import { Manrope, Playfair_Display } from "next/font/google";
import { SITE_NAME, SITE_URL } from "@/lib/site";
import "./globals.css";

const manrope = Manrope({
  variable: "--font-manrope",
  subsets: ["latin"],
});

const playfair = Playfair_Display({
  variable: "--font-playfair",
  subsets: ["latin"],
});

const defaultDescription =
  "SwayamMail is an email API for Indian businesses: send OTP codes by email, transactional email and marketing campaigns from one account, on flat monthly plans priced in rupees.";

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: {
    default: "SwayamMail: Email OTP API, transactional and marketing email for India",
    template: "%s | SwayamMail",
  },
  description: defaultDescription,
  applicationName: SITE_NAME,
  keywords: [
    "email OTP API",
    "send OTP via email",
    "OTP email service India",
    "transactional email API India",
    "email marketing India",
    "email verification code API",
  ],
  openGraph: {
    type: "website",
    siteName: SITE_NAME,
    locale: "en_IN",
    url: SITE_URL,
    title: "SwayamMail: Email OTP API, transactional and marketing email for India",
    description: defaultDescription,
  },
  twitter: {
    card: "summary_large_image",
    title: "SwayamMail: Email OTP API, transactional and marketing email for India",
    description: defaultDescription,
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en-IN"
      className={`${manrope.variable} ${playfair.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col bg-background text-foreground">
        {children}
      </body>
    </html>
  );
}
