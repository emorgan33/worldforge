import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { currentTheme } from "@/lib/theme-server";
import { requireRequestTime } from "@/lib/request-time";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

// The chrome theme is resolved per request from the account and a cookie, so
// every route blocks on the server instead of prerendering a themed shell.
export const instant = false;

export const metadata: Metadata = {
  title: "WorldForge · D&D & Pathfinder Campaigns",
  description: "Build your campaign world, creatures, spells and treasure for D&D 5e 2014 and Pathfinder 2e Remaster.",
};

export default async function RootLayout({ children }: LayoutProps<"/">) {
  // Establish the request-time boundary once, before the session lookup runs a
  // synchronous SQLite query (#39). Page segments then inherit a dynamic render.
  await requireRequestTime();
  const theme = await currentTheme();
  return (
    <html
      lang="en"
      data-theme={theme}
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
