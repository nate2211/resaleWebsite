import type { Metadata } from "next";
import { PublicShell } from "../components/public-shell";

const supportEmail = process.env.NEXT_PUBLIC_SUPPORT_EMAIL || "support@resalemasterlab.com";

export const metadata: Metadata = {
  title: "Contact",
  description: "Contact ResaleMasterLab about product feedback, accessibility, privacy, marketplace coverage, or technical support.",
  alternates: { canonical: "/contact" },
};

export default function Page() {
  return (
    <PublicShell eyebrow="Product support and feedback" title="Contact ResaleMasterLab" description="Get in touch about product feedback, accessibility, privacy, marketplace coverage, or technical issues.">
      <section>
        <h2>Email support</h2>
        <p><a href={`mailto:${supportEmail}`}>{supportEmail}</a></p>
        <p>Include the affected page, marketplace, listing URL, browser, and a short description of what happened. Do not email marketplace passwords, payment details, private authentication documents, or other sensitive account information.</p>
      </section>
      <section>
        <h2>Listing and transaction disputes</h2>
        <p>ResaleMasterLab is an independent research workspace and does not process marketplace transactions. Contact the original marketplace for order, shipping, payment, return, or account disputes.</p>
      </section>
      <section>
        <h2>Before production launch</h2>
        <p>The site operator should configure <code>NEXT_PUBLIC_SUPPORT_EMAIL</code> and verify that the mailbox is active before publishing this page.</p>
      </section>
    </PublicShell>
  );
}
