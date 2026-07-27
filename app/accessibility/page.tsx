import type { Metadata } from "next";
import { PublicShell } from "../components/public-shell";

export const metadata: Metadata = {
  title: "Accessibility statement",
  description: "ResaleMasterLab accessibility goals, supported interactions, and how to report an accessibility issue.",
  alternates: { canonical: "/accessibility" },
};

export default function Page() {
  return (
    <PublicShell eyebrow="A clearer workspace for more people" title="Accessibility statement" description="ResaleMasterLab aims to make listing research understandable and operable with keyboards, screen readers, zoom, and different screen sizes.">
      <section>
        <h2>Current accessibility support</h2>
        <p>The interface uses semantic headings, labeled controls, visible focus states, keyboard-operable buttons and collapsible sections, text alternatives for product images, responsive layouts, and status text that does not rely on color alone.</p>
      </section>
      <section>
        <h2>Known limitations</h2>
        <p>Third-party listing images, titles, embedded marketplace wording, and external pages are controlled by their original publishers. Local AI model downloads can also be resource intensive on older devices.</p>
      </section>
      <section>
        <h2>Report a problem</h2>
        <p>Use the <a href="/contact">contact page</a> and include the page, browser, assistive technology, and the action you were trying to complete.</p>
      </section>
      <section>
        <h2>Review date</h2>
        <p><strong>Last reviewed:</strong> July 26, 2026.</p>
      </section>
    </PublicShell>
  );
}
