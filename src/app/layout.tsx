import type { Metadata } from "next";
import "./globals.css";
import "./login.css";

export const metadata: Metadata = {
  title: "NOUR | NCC Level 10 Exam Coach",
  description: "AI-powered exam simulator and study coach for the NCC Level 10 Promotion Exam.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      className="h-full antialiased"
    >
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
