import type { Metadata } from "next";
import { PublicShell } from "../components/public-shell";

export const metadata: Metadata = {
  title: "Privacy policy",
  description: "This policy explains what ResaleMasterLab stores and how browser-based features use data.",
  alternates: { canonical: "/privacy" },
};

export default function Page() {
  return (
    <PublicShell eyebrow="Privacy-first browser research" title="Privacy policy" description="This policy explains what ResaleMasterLab stores and how browser-based features use data.">

<section>
  <h2>Browser storage</h2>
  <p>The workspace stores preferences, saved listings, favorites, watch records, recent searches, and optional AI instructions in browser storage so the experience can continue across visits on the same device.</p>
</section>
<section>
  <h2>Public web requests</h2>
  <p>When a user searches or inspects a listing, the service may request public marketplace or retailer pages needed to return the requested evidence. The application does not sign in to third-party accounts or attempt to bypass access controls.</p>
</section>
<section>
  <h2>Local AI</h2>
  <p>When loaded, the local model performs inference in the browser. Model files may be downloaded and cached by the browser. Research prompts and listing evidence are processed locally by that model unless a feature explicitly states otherwise.</p>
</section>
<section>
  <h2>Control and deletion</h2>
  <p>Users can reset the workspace from Analysis Settings to remove ResaleMasterLab browser data. Browser storage can also be removed using the browser's site-data controls.</p>
</section>
<section>
  <h2>Policy changes</h2>
  <p>This policy may change as the service evolves. Material updates should be reflected on this page with a revised effective date.</p>
  <p><strong>Effective date:</strong> July 26, 2026.</p>
</section>

    </PublicShell>
  );
}
