import type { Metadata, Viewport } from "next";
import "./globals.css";

const siteUrl = process.env.NEXT_PUBLIC_SITE_URL || "https://resalemasterlab.com";

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
    "Grailed research", "Poshmark research", "sold listing analysis", "resale calculator",
  ],
  authors: [{ name: "ResaleMasterLab" }],
  creator: "ResaleMasterLab",
  publisher: "ResaleMasterLab",
  alternates: { canonical: "/" },
  manifest: "/manifest.webmanifest",
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
    url: "/",
    siteName: "ResaleMasterLab",
    title: "ResaleMasterLab — Evidence-led resale research",
    description: "Find, compare, analyze, and monitor apparel resale listings in one commercial research workspace.",
    images: [{ url: "/og-card.png", width: 1200, height: 630, alt: "ResaleMasterLab resale research workspace" }],
  },
  twitter: {
    card: "summary_large_image",
    title: "ResaleMasterLab — Evidence-led resale research",
    description: "Search and monitor resale listings with sold-price, fee, engagement, authenticity, and optional local AI analysis.",
    images: ["/og-card.png"],
  },
  icons: {
    icon: [
      { url: "/favicon.svg", type: "image/svg+xml" },
      { url: "/icon-192.png", sizes: "192x192", type: "image/png" },
    ],
    shortcut: "/favicon.svg",
    apple: [{ url: "/apple-touch-icon.png", sizes: "180x180", type: "image/png" }],
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
      logo: `${siteUrl}/icon-512.png`,
    },
    {
      "@type": "WebSite",
      "@id": `${siteUrl}/#website`,
      url: siteUrl,
      name: "ResaleMasterLab",
      description: "Evidence-led resale listing research and monitoring.",
      publisher: { "@id": `${siteUrl}/#organization` },
    },
    {
      "@type": "SoftwareApplication",
      name: "ResaleMasterLab",
      applicationCategory: "BusinessApplication",
      operatingSystem: "Web browser",
      url: siteUrl,
      description: "A web application for resale listing discovery, comparison, monitoring, and evidence-led analysis.",
      publisher: { "@id": `${siteUrl}/#organization` },
    },
  ],
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
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
