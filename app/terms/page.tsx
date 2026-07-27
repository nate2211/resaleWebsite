import type { Metadata } from "next";
import { PublicShell } from "../components/public-shell";

export const metadata: Metadata = {
  title: "Terms and conditions",
  description: "These terms govern access to the ResaleMasterLab research workspace and public information pages.",
  alternates: { canonical: "/terms" },
};

export default function Page() {
  return (
    <PublicShell eyebrow="Terms for using ResaleMasterLab" title="Terms and conditions" description="These terms govern access to the ResaleMasterLab research workspace and public information pages.">

<section>
  <h2>Research tool only</h2>
  <p>ResaleMasterLab provides informational estimates and research assistance. It is not a marketplace, broker, authentication service, financial adviser, legal adviser, or guarantee of profit.</p>
</section>
<section>
  <h2>User responsibility</h2>
  <p>Users are responsible for verifying listing condition, authenticity, ownership, fees, shipping, duties, taxes, marketplace rules, and seller or buyer identity before completing a transaction.</p>
</section>
<section>
  <h2>Third-party services</h2>
  <p>Marketplace and retailer names, listings, trademarks, and links belong to their respective owners. ResaleMasterLab is not affiliated with or endorsed by those third parties unless explicitly stated.</p>
</section>
<section>
  <h2>Acceptable use</h2>
  <p>Users may not use the service to bypass access controls, overwhelm third-party sites, misrepresent evidence, infringe intellectual property, or conduct unlawful transactions.</p>
</section>
<section>
  <h2>No warranties and limitation</h2>
  <p>The service is provided on an as-available basis. Data can be incomplete, delayed, or inaccurate. To the extent permitted by law, the operator is not liable for losses arising from transactions or decisions made using the service.</p>
</section>
<section>
  <h2>Changes</h2>
  <p>Features and these terms may change. Continued use after an update constitutes acceptance of the updated terms.</p>
  <p><strong>Effective date:</strong> July 26, 2026.</p>
</section>

    </PublicShell>
  );
}
