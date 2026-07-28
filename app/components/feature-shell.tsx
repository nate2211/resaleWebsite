import type { ReactNode } from "react";
import { SiteNavigation } from "./site-navigation";

export function FeatureShell({
  current,
  eyebrow,
  title,
  description,
  children,
}: {
  current: "thrift-check" | "listing-template";
  eyebrow: string;
  title: string;
  description: string;
  children: ReactNode;
}) {
  return (
    <main className="feature-shell">
      <SiteNavigation currentPath={current === "thrift-check" ? "/thrift-check" : "/listing-template"} />
      <section className="feature-hero">
        <p className="eyebrow">{eyebrow}</p>
        <h1>{title}</h1>
        <p>{description}</p>
      </section>
      <div className="feature-page">{children}</div>
      <footer className="feature-footer">
        <div><strong>ResaleMasterLab</strong><span>Evidence-led apparel sourcing and listing tools</span></div>
        <nav aria-label="Public pages">
          <a href="/about">About</a>
          <a href="/faq">FAQ</a>
          <a href="/privacy">Privacy</a>
          <a href="/terms">Terms</a>
        </nav>
      </footer>
    </main>
  );
}
