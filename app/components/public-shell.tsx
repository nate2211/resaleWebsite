import type { ReactNode } from "react";

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
      <header className="public-header">
        <a className="public-brand" href="/" aria-label="ResaleMasterLab home">
          <span>R</span>
          <strong>ResaleMasterLab</strong>
        </a>
        <nav aria-label="Public pages">
          <a href="/about">About</a>
          <a href="/methodology">Methodology</a>
          <a href="/faq">FAQ</a>
          <a href="/contact">Contact</a>
          <a href="/accessibility">Accessibility</a>
          <a href="/privacy">Privacy</a>
          <a href="/terms">Terms</a>
          <a className="public-app-link" href="/">Open workspace</a>
        </nav>
      </header>
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
