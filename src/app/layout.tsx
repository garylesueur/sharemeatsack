import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { Analytics } from "@vercel/analytics/next";
import { ColorSchemeSync } from "@/components/color-scheme-sync";
import { COLOR_MODE_BOOT_SCRIPT } from "@/lib/color-mode";
import { SITE_DESCRIPTION, SITE_TITLE } from "@/lib/mcp-docs";
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
    default: SITE_TITLE,
    template: `%s · ${SITE_TITLE}`,
  },
  description: `${PRODUCT_SENTENCE} ${SITE_DESCRIPTION}`,
  applicationName: PRODUCT_NAME,
  keywords: ["sharemeatsack.com", "MCP", "file transfer", "agent", "human in the loop"],
  authors: [{ name: PRODUCT_NAME, url: origin }],
  alternates: {
    canonical: "/",
    types: {
      "text/markdown": "/mcp.md",
      "text/plain": "/llms.txt",
    },
  },
  openGraph: {
    type: "website",
    locale: "en_GB",
    url: origin,
    siteName: PRODUCT_NAME,
    title: PRODUCT_NAME,
    description: `${PRODUCT_SENTENCE} ${SITE_DESCRIPTION}`,
  },
  twitter: {
    card: "summary_large_image",
    title: PRODUCT_NAME,
    description: `${PRODUCT_SENTENCE} ${SITE_DESCRIPTION}`,
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en-GB"
      className={`${geist.variable} ${geistMono.variable} h-full antialiased`}
      suppressHydrationWarning
    >
      <body className="flex min-h-full flex-col bg-background font-sans text-foreground">
        <script dangerouslySetInnerHTML={{ __html: COLOR_MODE_BOOT_SCRIPT }} />
        <ColorSchemeSync />
        {children}
        <Analytics />
      </body>
    </html>
  );
}
