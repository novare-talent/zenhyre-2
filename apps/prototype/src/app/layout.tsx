import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";
import { Motion } from "@/components/Motion";
import { RulesProvider } from "@/components/Rules";
import { Toasts } from "@/components/Toasts";
import { site } from "@/data/site";
import { rulesFromConfig } from "@/lib/config";
import { archivo, mono } from "./fonts";
import "./globals.css";

export const metadata: Metadata = {
  metadataBase: new URL(site.url),
  title: { default: `${site.name} | Hiring from the twenty-three IITs`, template: `%s | ${site.name}` },
  description: site.description,
  alternates: { canonical: "./" },
  openGraph: { type: "website", siteName: site.name, images: ["/og.png"] },
  twitter: { card: "summary_large_image" },
};
export const viewport: Viewport = { themeColor: "#eeefef" };

// Before first paint: motion styles only apply when JS is on and the visitor has not asked for less.
const flags = `document.documentElement.classList.add('js');if(!matchMedia('(prefers-reduced-motion: reduce)').matches)document.documentElement.classList.add('motion')`;

const jsonLd = {
  "@context": "https://schema.org",
  "@type": "WebSite",
  name: site.name,
  url: site.url,
  description: site.description,
  publisher: { "@type": "Organization", name: site.owner },
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" className={`${archivo.variable} ${mono.variable}`} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: flags }} />
      </head>
      <body>
        <a className="skip-link" href="#main">Skip to content</a>
        <RulesProvider rules={rulesFromConfig()}>
          <Toasts>{children}</Toasts>
        </RulesProvider>
        <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd).replace(/</g, "\\u003c") }} />
        <Motion />
      </body>
    </html>
  );
}
