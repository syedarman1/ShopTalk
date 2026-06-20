import "./globals.css";
import { JetBrains_Mono, Inter } from "next/font/google";

const inter = Inter({ subsets: ["latin"], variable: "--font-sans" });
const mono = JetBrains_Mono({ subsets: ["latin"], variable: "--font-mono" });

export const metadata = {
  title: "MockBase — Real-time Text-to-Database Playground",
  description:
    "Manage a local SQLite database via MCP tools and watch every mutation stream into the dashboard in real time.",
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
