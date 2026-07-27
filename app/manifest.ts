import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "ResaleMasterLab",
    short_name: "ResaleMasterLab",
    description: "Resale listing research, monitoring, and optional private browser AI.",
    start_url: "/",
    display: "standalone",
    background_color: "#f6f7fb",
    theme_color: "#5b45d6",
    icons: [
      { src: "/icon-192.png", sizes: "192x192", type: "image/png" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png" },
      { src: "/icon-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
