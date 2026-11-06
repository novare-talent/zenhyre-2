import type { NextConfig } from "next";

const config: NextConfig = {
  // Config defaults, money helpers and the gate's rules pass are read straight from the workspace source.
  transpilePackages: ["@zenhyre/gate", "@zenhyre/ops", "@zenhyre/shared"],
  devIndicators: false,
  poweredByHeader: false,
  async headers() {
    const base = [
      { key: "X-Content-Type-Options", value: "nosniff" },
      { key: "X-Frame-Options", value: "DENY" },
      { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
      { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
    ];
    return [
      { source: "/:path*", headers: base },
      // The sign-in token is in this URL: never send it anywhere as a referrer, never cache the page.
      { source: "/auth/:path*", headers: [{ key: "Referrer-Policy", value: "no-referrer" }, { key: "Cache-Control", value: "no-store" }] },
    ];
  },
};
export default config;
