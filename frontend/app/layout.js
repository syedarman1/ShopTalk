import "./globals.css";
import { JetBrains_Mono, Inter } from "next/font/google";

const inter = Inter({ subsets: ["latin"], variable: "--font-sans" });
const mono = JetBrains_Mono({ subsets: ["latin"], variable: "--font-mono" });

export const metadata = {
  title: "ShopTalk — Text your Shopify store in plain English",
  description:
    "Ask your Shopify store questions by text and get instant answers — a live MCP-powered dashboard. (Demo uses sample data.)",
};

export default function RootLayout({ children }) {
  return (
    <html lang="en" className="dark">
      <body className={`${inter.variable} ${mono.variable} font-sans`}>
        {children}
      </body>
    </html>
  );
}
