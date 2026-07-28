import type { ReactNode } from "react";

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
      <header className="feature-topbar">
        <a className="brand" href="/" aria-label="ResaleMasterLab home">
          <span className="brand-mark">R</span>
          <span>ResaleMasterLab</span>
        </a>
        <nav className="feature-nav" aria-label="ResaleMasterLab tools">
          <a href="/">Research</a>
          <a className={current === "thrift-check" ? "active" : ""} href="/thrift-check">Thrift Check</a>
          <a className={current === "listing-template" ? "active" : ""} href="/listing-template">Listing Template</a>
          <a href="/methodology">Methodology</a>
        </nav>
      </header>
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
