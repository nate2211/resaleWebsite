import type { ReactNode } from "react";
import { SiteNavigation } from "./site-navigation";

export function PublicShell({
  eyebrow,
  title,
  description,
  children,
}: {
  eyebrow: string;
  title: string;
  description: string;
  children: ReactNode;
}) {
  return (
    <main className="public-page-shell">
      <SiteNavigation />
      <article className="public-content">
        <p className="public-eyebrow">{eyebrow}</p>
        <h1>{title}</h1>
        <p className="public-lead">{description}</p>
        <div className="public-prose">{children}</div>
      </article>
      <footer className="public-footer">
        <strong>ResaleMasterLab</strong>
        <span>Evidence-led resale research. Estimates are not guarantees or authenticity determinations.</span>
      </footer>
    </main>
  );
}
