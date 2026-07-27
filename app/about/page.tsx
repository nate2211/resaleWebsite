import type { Metadata } from "next";
import { PublicShell } from "../components/public-shell";

export const metadata: Metadata = {
  title: "About ResaleMasterLab",
  description: "ResaleMasterLab is a browser-based workspace for finding, comparing, and monitoring apparel listings across resale marketplaces.",
  alternates: { canonical: "/about" },
};

export default function Page() {
  return (
    <PublicShell eyebrow="Resale research made easier to understand" title="About ResaleMasterLab" description="ResaleMasterLab is a browser-based workspace for finding, comparing, and monitoring apparel listings across resale marketplaces.">

<section>
  <h2>What the product does</h2>
  <p>ResaleMasterLab brings live listing discovery, sold-price comparisons, marketplace fee estimates, engagement signals, authenticity references, favorites, monitoring, and private local AI analysis into one workspace.</p>
</section>
<section>
  <h2>Built for evidence, not hype</h2>
  <p>Every listing keeps its original source link. Missing prices, dates, engagement metrics, and authenticity evidence remain unknown instead of being invented. Users should confirm all details on the source marketplace before purchasing or listing an item.</p>
</section>
<section>
  <h2>Private browser intelligence</h2>
  <p>The optional local AI model runs in the browser when supported. It can expand searches, explain evidence, and apply bounded ranking adjustments. Deterministic fee calculations and public sold-price evidence remain primary.</p>
</section>

    </PublicShell>
  );
}
