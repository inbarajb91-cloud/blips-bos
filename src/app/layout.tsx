import type { Metadata } from "next";
import { syne, dmMono, cormorant } from "@/lib/fonts";
import "./globals.css";

export const metadata: Metadata = {
  title: "BLIPS BOS",
  description: "BLIPS Brand Operating System — Engine Room",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${syne.variable} ${dmMono.variable} ${cormorant.variable} dark h-full antialiased`}
    >
      <body className="min-h-full bg-ink text-off-white font-mono flex flex-col">
        {children}
      </body>
    </html>
  );
}
