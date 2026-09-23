import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "uPack Studio",
  description:
    "Draw, import and animate 240x240 sprites with layers and keyframes, export DPAK, send to device",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
