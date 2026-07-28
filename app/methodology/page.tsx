import type { Metadata } from "next";
import { PublicShell } from "../components/public-shell";

export const metadata: Metadata = {
  title: "Research methodology",
  description: "A transparent overview of the evidence, calculations, and limits used in the workspace.",
  alternates: { canonical: "/methodology" },
};

export default function Page() {
  return (
    <PublicShell eyebrow="How ResaleMasterLab evaluates listings" title="Research methodology" description="A transparent overview of the evidence, calculations, and limits used in the workspace.">

<section>
  <h2>Listing discovery</h2>
  <p>The browser requests public marketplace and product pages, retains the original URL, and extracts readable listing fields such as title, price, condition, size, date, and seller information when available.</p>
</section>
<section>
  <h2>Comparable prices and fees</h2>
  <p>Expected resale values require loaded comparable-price evidence. Marketplace fees, outbound shipping, reserves, and landed acquisition cost are deducted to estimate net profit, return on investment, and margin.</p>
</section>
<section>
  <h2>Engagement and authenticity</h2>
  <p>Engagement analysis uses only public metrics that a marketplace exposes. Authenticity research compares listing details with public retailer and release references, but it does not certify an item as authentic.</p>
</section>
<section>
  <h2>Thrift Check image math</h2>
  <p>Optional computer vision calculates exposure, contrast, sharpness, edge density, dominant color, resolution, color histograms, and perceptual hashes. When sold-item images are readable, those feature vectors can weight otherwise valid sold prices. Visual similarity does not prove that two garments are the same model or authentic.</p>
</section>
<section>
  <h2>Listing Template pricing</h2>
  <p>The listing generator uses public sold evidence first and discounted active asking prices only when sold evidence is sparse. The local writing model receives that deterministic price anchor and produces an editable draft rather than an automatic marketplace post.</p>
</section>
<section>
  <h2>AI boundaries</h2>
  <p>The optional browser model can interpret evidence and adjust relevance or confidence within fixed limits. It cannot create missing sold prices, engagement counts, dates, or authenticity proof.</p>
</section>

    </PublicShell>
  );
}
