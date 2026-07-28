"use client";

import { useEffect, useRef, useState } from "react";

const SITE_LINKS = [
  { href: "/", label: "Research" },
  { href: "/thrift-check", label: "Thrift Check" },
  { href: "/listing-template", label: "Listing Template" },
  { href: "/methodology", label: "Methodology" },
  { href: "/about", label: "About" },
  { href: "/faq", label: "FAQ" },
  { href: "/contact", label: "Contact" },
  { href: "/accessibility", label: "Accessibility" },
  { href: "/privacy", label: "Privacy" },
  { href: "/terms", label: "Terms" },
] as const;

export function SiteNavigation({ currentPath = "" }: { currentPath?: string }) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLElement>(null);

  useEffect(() => {
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    const closeOutside = (event: PointerEvent) => {
      if (rootRef.current && !rootRef.current.contains(event.target as Node)) setOpen(false);
    };
    window.addEventListener("keydown", closeOnEscape);
    window.addEventListener("pointerdown", closeOutside);
    return () => {
      window.removeEventListener("keydown", closeOnEscape);
      window.removeEventListener("pointerdown", closeOutside);
    };
  }, []);

  return (
    <header className="site-navigation" ref={rootRef}>
      <a className="site-navigation-brand" href="/" aria-label="ResaleMasterLab home" onClick={() => setOpen(false)}>
        <span aria-hidden="true">R</span>
        <strong>ResaleMasterLab</strong>
      </a>
      <button
        className="site-navigation-toggle"
        type="button"
        aria-label={open ? "Close navigation menu" : "Open navigation menu"}
        aria-expanded={open}
        aria-controls="site-navigation-links"
        onClick={() => setOpen((value) => !value)}
      >
        <span aria-hidden="true" />
        <span aria-hidden="true" />
        <span aria-hidden="true" />
      </button>
      <nav
        id="site-navigation-links"
        className={`site-navigation-links ${open ? "open" : ""}`}
        aria-label="ResaleMasterLab pages"
      >
        {SITE_LINKS.map((item) => (
          <a
            key={item.href}
            className={currentPath === item.href ? "active" : ""}
            href={item.href}
            aria-current={currentPath === item.href ? "page" : undefined}
            onClick={() => setOpen(false)}
          >
            {item.label}
          </a>
        ))}
      </nav>
    </header>
  );
}
