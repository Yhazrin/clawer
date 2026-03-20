import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Clawer",
  description: "Real-time AI Agent Conversation Demo",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="zh-CN">
      <body>{children}</body>
    </html>
  );
}
