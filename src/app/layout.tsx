import type { Metadata } from "next";
import { Inter } from "next/font/google";
import { PROJECT } from "../config/project";
import "./globals.css";

const inter = Inter({
  variable: "--font-inter",
  subsets: ["latin"],
  display: "swap",
});

export const metadata: Metadata = {
  title: `${PROJECT.name} | ${PROJECT.tagline}`,
  description: PROJECT.tagline,
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="pt-BR" className="dark">
      <body className={`${inter.variable} antialiased bg-[#0a0a0a] text-white`}>
        {children}
      </body>
    </html>
  );
}
