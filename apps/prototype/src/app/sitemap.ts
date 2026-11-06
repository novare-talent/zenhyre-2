import type { MetadataRoute } from "next";
import { site } from "@/data/site";

// Only the public pages. Seats sit behind a login.
export default function sitemap(): MetadataRoute.Sitemap {
  return ["/", "/login"].map((p) => ({ url: `${site.url}${p}` }));
}
