import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    id: "/",
    name: "ResaleMasterLab — Resale Research Tools",
    short_name: "ResaleMasterLab",
    description: "Search resale listings, check thrift-store profit from photos, and generate evidence-bounded listing templates with optional private browser AI.",
    start_url: "/",
    scope: "/",
    display: "standalone",
    orientation: "any",
    background_color: "#f7f9fc",
    theme_color: "#7157e8",
    categories: ["business", "shopping", "productivity", "utilities"],
    lang: "en-US",
    dir: "ltr",
    icons: [
      { src: "/icon-96.png", sizes: "96x96", type: "image/png", purpose: "any" },
      { src: "/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icon-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
    screenshots: [
      { src: "/screenshots/resalemasterlab-wide.png", sizes: "1280x720", type: "image/png", form_factor: "wide", label: "ResaleMasterLab research workspace" },
      { src: "/screenshots/resalemasterlab-mobile.png", sizes: "750x1334", type: "image/png", form_factor: "narrow", label: "ResaleMasterLab Thrift Check on mobile" },
    ],
    shortcuts: [
      { name: "Thrift Check", short_name: "Thrift Check", description: "Photograph a thrift-store item and estimate resale profit.", url: "/thrift-check", icons: [{ src: "/icon-192.png", sizes: "192x192", type: "image/png" }] },
      { name: "Listing Template", short_name: "Listing Template", description: "Generate an editable listing draft with local AI.", url: "/listing-template", icons: [{ src: "/icon-192.png", sizes: "192x192", type: "image/png" }] },
    ],
  };
}
