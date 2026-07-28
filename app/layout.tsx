import type { Metadata, Viewport } from "next";
import "./globals.css";

import { SITE_URL } from "./lib/site";

const configuredSiteUrl = process.env.NEXT_PUBLIC_SITE_URL?.trim();
const siteUrl = configuredSiteUrl || SITE_URL;

export const metadata: Metadata = {
  metadataBase: new URL(siteUrl),
  title: {
    default: "ResaleMasterLab — Resale Listing Research and Monitoring",
    template: "%s | ResaleMasterLab",
  },
  description:
    "Search live resale listings, compare sold prices and fees, research engagement and authenticity evidence, and monitor favorites with optional private browser AI.",
  applicationName: "ResaleMasterLab",
  keywords: [
    "resale research", "streetwear resale", "clothing resale", "Depop research",
    "Grailed research", "Poshmark research", "sold listing analysis", "resale calculator", "thrift store profit calculator", "AI listing template", "resale listing generator",
  ],
  authors: [{ name: "ResaleMasterLab" }],
  creator: "ResaleMasterLab",
  publisher: "ResaleMasterLab",
  alternates: { canonical: "/" },
  robots: {
    index: true,
    follow: true,
    googleBot: {
      index: true,
      follow: true,
      "max-image-preview": "large",
      "max-snippet": -1,
      "max-video-preview": -1,
    },
  },
  openGraph: {
    type: "website",
    locale: "en_US",
    url: siteUrl,
    siteName: "ResaleMasterLab",
    title: "ResaleMasterLab — Evidence-led resale research",
    description: "Find, compare, analyze, and monitor apparel resale listings in one commercial research workspace.",
    images: [{ url: `${siteUrl}/og-card.png`, width: 1200, height: 630, alt: "ResaleMasterLab resale research workspace" }],
  },
  twitter: {
    card: "summary_large_image",
    title: "ResaleMasterLab — Evidence-led resale research",
    description: "Search and monitor resale listings with sold-price, fee, engagement, authenticity, and optional local AI analysis.",
    images: [`${siteUrl}/og-card.png`],
  },
  category: "technology",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#5b45d6",
  colorScheme: "light",
};

const structuredData = {
  "@context": "https://schema.org",
  "@graph": [
    {
      "@type": "Organization",
      "@id": `${siteUrl}/#organization`,
      name: "ResaleMasterLab",
      url: siteUrl,
      logo: { "@type": "ImageObject", url: `${siteUrl}/icon-512.png`, width: 512, height: 512 },
    },
    {
      "@type": "WebSite",
      "@id": `${siteUrl}/#website`,
      url: siteUrl,
      name: "ResaleMasterLab",
      description: "Evidence-led resale listing research and monitoring.",
      publisher: { "@id": `${siteUrl}/#organization` },
      potentialAction: {
        "@type": "SearchAction",
        target: `${siteUrl}/?q={search_term_string}`,
        "query-input": "required name=search_term_string",
      },
    },
    {
      "@type": "SoftwareApplication",
      name: "ResaleMasterLab",
      applicationCategory: "BusinessApplication",
      operatingSystem: "Web browser",
      url: siteUrl,
      description: "A web application for resale listing discovery, comparison, monitoring, and evidence-led analysis.",
      publisher: { "@id": `${siteUrl}/#organization` },
      featureList: [
        "Marketplace listing research",
        "Sold-price and fee analysis",
        "Thrift Check photo sourcing tool",
        "Private browser AI listing template generator",
      ],
    },
  ],
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <head>
        {/* Keep runtime assets origin-relative so localhost, LAN previews, and production all use the active host. */}
        <link rel="manifest" href="/manifest.webmanifest" />
        <link rel="icon" href="/favicon.ico" sizes="any" />
        <link rel="icon" href="/favicon.svg" type="image/svg+xml" />
        <link rel="icon" href="/icon-192.png" sizes="192x192" type="image/png" />
        <link rel="apple-touch-icon" href="/apple-touch-icon.png" sizes="180x180" />
        <meta name="google-site-verification" content={process.env.NEXT_PUBLIC_GOOGLE_SITE_VERIFICATION || ""} />
      </head>
      <body className="antialiased">
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(structuredData) }}
        />
        {children}
      </body>
    </html>
  );
}
