import type { Metadata } from "next";
import { FeatureShell } from "../components/feature-shell";
import { ThriftCheckTool } from "../components/thrift-check-tool";
import { SITE_URL } from "../lib/site";

export const metadata: Metadata = {
  title: "Thrift Check — Photo-Based Resale Profit Estimator",
  description: "Photograph a thrift-store shirt, compare public sold and active resale evidence, estimate fees and profit, and optionally add local browser AI and computer-vision metrics.",
  alternates: { canonical: "/thrift-check" },
  openGraph: {
    type: "website",
    url: `${SITE_URL}/thrift-check`,
    title: "Thrift Check — Should you buy this thrift-store item?",
    description: "Upload item photos, enter an optional thrift price, compare resale evidence, and estimate profit before buying.",
    images: [{ url: `${SITE_URL}/thrift-check-og.png`, width: 1200, height: 630, alt: "ResaleMasterLab Thrift Check interface" }],
  },
  twitter: {
    card: "summary_large_image",
    title: "Thrift Check by ResaleMasterLab",
    description: "Photo-based thrift sourcing analysis with sold evidence, fees, profit, and optional local AI.",
    images: [`${SITE_URL}/thrift-check-og.png`],
  },
};

const structuredData = {
  "@context": "https://schema.org",
  "@graph": [
    {
      "@type": "WebApplication",
      "@id": `${SITE_URL}/thrift-check#app`,
      name: "ResaleMasterLab Thrift Check",
      url: `${SITE_URL}/thrift-check`,
      applicationCategory: "BusinessApplication",
      operatingSystem: "Web browser",
      description: "A browser tool for estimating apparel resale price, fees, ROI, and profit from thrift-store photos and public marketplace evidence.",
      isPartOf: { "@id": `${SITE_URL}/#website` },
      featureList: [
        "Phone camera and image upload",
        "Sold and active resale price comparisons",
        "Marketplace fee and profit estimation",
        "Optional local image captioning",
        "Optional mathematical image similarity",
      ],
    },
    {
      "@type": "HowTo",
      name: "How to check a thrift-store item for resale",
      description: "Photograph the item, describe it, run sold-price analysis, and review the profit estimate before buying.",
      step: [
        { "@type": "HowToStep", position: 1, name: "Photograph the item", text: "Take clear photos of the front, back, tags, graphics, and flaws." },
        { "@type": "HowToStep", position: 2, name: "Enter known details", text: "Add the brand, item type, size, condition, and optional thrift price." },
        { "@type": "HowToStep", position: 3, name: "Run Thrift Check", text: "Compare public sold and active listings, selling fees, and optional image metrics." },
        { "@type": "HowToStep", position: 4, name: "Inspect before buying", text: "Verify authenticity, damage, measurements, odors, repairs, and all marketplace assumptions." },
      ],
    },
    {
      "@type": "BreadcrumbList",
      itemListElement: [
        { "@type": "ListItem", position: 1, name: "ResaleMasterLab", item: SITE_URL },
        { "@type": "ListItem", position: 2, name: "Thrift Check", item: `${SITE_URL}/thrift-check` },
      ],
    },
  ],
};

export default function Page() {
  return (
    <FeatureShell
      current="thrift-check"
      eyebrow="In-store sourcing assistant"
      title="Photograph a thrift-store find before you buy it."
      description="Thrift Check combines the photos on your phone, public sold and active resale evidence, marketplace fees, and optional local computer vision to estimate resale range, profit, ROI, and whether the item deserves a closer look."
    >
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(structuredData) }} />
      <ThriftCheckTool />
      <section className="seo-copy-section" aria-labelledby="thrift-check-method">
        <h2 id="thrift-check-method">What Thrift Check measures</h2>
        <div className="seo-copy-grid">
          <article><h3>Marketplace evidence</h3><p>The tool searches readable Grailed sold listings plus active Depop and Poshmark cards. Sold evidence is preferred; active asking prices are discounted before they are used as a fallback.</p></article>
          <article><h3>True sourcing math</h3><p>Enter the thrift price to calculate marketplace fees, outbound shipping, a risk reserve, estimated net profit, and return on investment for Depop, Grailed, and Poshmark.</p></article>
          <article><h3>Optional image metrics</h3><p>Computer-vision math measures image exposure, contrast, edges, sharpness, dominant color, resolution, and perceptual similarity. These metrics describe photo evidence, not authenticity.</p></article>
        </div>
      </section>
    </FeatureShell>
  );
}
