import type { Metadata } from "next";
import { PublicShell } from "./components/public-shell";

export const metadata: Metadata = {
  title: "Page not found",
  robots: { index: false, follow: true },
};

export default function NotFound() {
  return (
    <PublicShell
      eyebrow="404"
      title="This page could not be found"
      description="The address may have changed, or the page may no longer exist."
    >
      <section>
        <h2>Continue researching</h2>
        <p>Return to the ResaleMasterLab workspace to search listings, compare evidence, and monitor saved items.</p>
        <p><a href="/">Open the workspace</a></p>
      </section>
    </PublicShell>
  );
}
