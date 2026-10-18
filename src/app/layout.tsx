import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { Analytics } from "@vercel/analytics/next";
import { ColorSchemeSync } from "@/components/color-scheme-sync";
import { COLOR_MODE_BOOT_SCRIPT } from "@/lib/color-mode";
import { SITE_DESCRIPTION, SITE_TITLE, siteJsonLd } from "@/lib/mcp-docs";
import { PRODUCT_NAME, PRODUCT_SENTENCE } from "@/lib/product";
import { publicOrigin } from "@/lib/public-origin";
import "./globals.css";

const geist = Geist({
  subsets: ["latin"],
  variable: "--font-geist-sans",
});

const geistMono = Geist_Mono({
  subsets: ["latin"],
  variable: "--font-geist-mono",
});

const origin = publicOrigin();

export const metadata: Metadata = {
  metadataBase: new URL(origin),
  title: {
    default: `${SITE_TITLE} · I, Meatsack`,
    template: `%s · ${SITE_TITLE} · I, Meatsack`,
  },
  description: `${PRODUCT_SENTENCE} ${SITE_DESCRIPTION}`,
  applicationName: PRODUCT_NAME,
  keywords: [
    "I, Meatsack",
    "share.imeatsack.com",
    "MCP",
    "file transfer",
    "agent",
    "human in the loop",
  ],
  authors: [{ name: "Gary Le Sueur", url: "https://gaz.dev" }],
  alternates: {
    canonical: "/",
    types: {
      "text/markdown": "/index.md",
      "text/plain": "/llms.txt",
    },
  },
  openGraph: {
    type: "website",
    locale: "en_GB",
    url: origin,
    siteName: "I, Meatsack",
    title: `${PRODUCT_NAME} · I, Meatsack`,
    description: `${PRODUCT_SENTENCE} ${SITE_DESCRIPTION}`,
  },
  twitter: {
    card: "summary_large_image",
    title: `${PRODUCT_NAME} · I, Meatsack`,
    description: `${PRODUCT_SENTENCE} ${SITE_DESCRIPTION}`,
  },
  robots: {
    index: true,
    follow: true,
    googleBot: { index: true, follow: true, "max-image-preview": "large", "max-snippet": -1 },
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const jsonLd = siteJsonLd(origin);
  return (
    <html
      lang="en-GB"
      className={`${geist.variable} ${geistMono.variable} h-full antialiased`}
      suppressHydrationWarning
    >
      <body className="flex min-h-full flex-col bg-background font-sans text-foreground">
        <script dangerouslySetInnerHTML={{ __html: COLOR_MODE_BOOT_SCRIPT }} />
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
        />
        <ColorSchemeSync />
        {children}
        <Analytics />
      </body>
    </html>
  );
}
