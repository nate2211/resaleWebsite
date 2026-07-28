import type { Metadata } from "next";
import { FeatureShell } from "../components/feature-shell";
import { ListingTemplateTool } from "../components/listing-template-tool";
import { SITE_URL } from "../lib/site";

export const metadata: Metadata = {
  title: "AI Listing Template Generator for Resale Clothing",
  description: "Load ResaleMasterLab's private browser AI, upload apparel photos, compare public resale prices, and generate an editable title, description, condition, brand, size, tags, and price template.",
  alternates: { canonical: "/listing-template" },
  openGraph: {
    type: "website",
    url: `${SITE_URL}/listing-template`,
    title: "Resale Listing Template Generator",
    description: "Turn item photos and marketplace evidence into an editable resale listing draft with a locally loaded AI model.",
    images: [{ url: `${SITE_URL}/listing-template-og.png`, width: 1200, height: 630, alt: "ResaleMasterLab Listing Template generator" }],
  },
  twitter: {
    card: "summary_large_image",
    title: "Resale Listing Template Generator",
    description: "Generate editable resale titles, descriptions, condition fields, tags, and evidence-bounded pricing from item photos.",
    images: [`${SITE_URL}/listing-template-og.png`],
  },
};

const structuredData = {
  "@context": "https://schema.org",
  "@graph": [
    {
      "@type": "WebApplication",
      "@id": `${SITE_URL}/listing-template#app`,
      name: "ResaleMasterLab Listing Template",
      url: `${SITE_URL}/listing-template`,
      applicationCategory: "BusinessApplication",
      operatingSystem: "Web browser",
      description: "A private browser AI tool that captions apparel photos and generates editable resale listing fields with public marketplace pricing evidence.",
      isPartOf: { "@id": `${SITE_URL}/#website` },
      featureList: [
        "Local image caption model",
        "Local text generation model",
        "Editable title and description",
        "Condition, brand, category, color, material, size, and tags",
        "Sold and active market price references",
      ],
    },
    {
      "@type": "HowTo",
      name: "How to create a resale clothing listing template",
      step: [
        { "@type": "HowToStep", position: 1, name: "Load the local models", text: "Download and cache the image-caption and writing models in the browser." },
        { "@type": "HowToStep", position: 2, name: "Upload item photos", text: "Add front, back, tag, detail, measurement, and flaw photos." },
        { "@type": "HowToStep", position: 3, name: "Generate the draft", text: "Use image captions, user notes, and public resale price evidence to produce editable listing fields." },
        { "@type": "HowToStep", position: 4, name: "Verify every field", text: "Correct any uncertain brand, material, condition, measurement, authenticity, or pricing claim before publishing." },
      ],
    },
    {
      "@type": "BreadcrumbList",
      itemListElement: [
        { "@type": "ListItem", position: 1, name: "ResaleMasterLab", item: SITE_URL },
        { "@type": "ListItem", position: 2, name: "Listing Template", item: `${SITE_URL}/listing-template` },
      ],
    },
  ],
};

export default function Page() {
  return (
    <FeatureShell
      current="listing-template"
      eyebrow="Private browser listing assistant"
      title="Turn item photos into an editable resale listing draft."
      description="Load the optional local AI models, upload clear apparel photos, add what you know, and generate a title, description, condition, brand, category, size, color, tags, list price, and floor price grounded by public resale evidence."
    >
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(structuredData) }} />
      <ListingTemplateTool />
      <section className="seo-copy-section" aria-labelledby="listing-template-safety">
        <h2 id="listing-template-safety">A draft—not an automatic truth claim</h2>
        <div className="seo-copy-grid">
          <article><h3>Private local models</h3><p>The image and writing models download to the browser and are cached locally. The page remains locked until both models are ready.</p></article>
          <article><h3>Evidence-bounded pricing</h3><p>Readable Grailed sold prices are preferred. Depop and Poshmark active asking prices provide a discounted fallback when sold evidence is sparse.</p></article>
          <article><h3>Human verification required</h3><p>Image models can misread logos, fabrics, sizes, colors, and condition. Verify every field against the physical item before publishing.</p></article>
        </div>
      </section>
    </FeatureShell>
  );
}
