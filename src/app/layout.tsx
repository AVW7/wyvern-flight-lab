import "./globals.css";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Wyvern Flight Lab | 3D V1 & V2 Rig Inspection",
  description: "Interactive flight animation laboratory and 3D rig inspection suite for V1 and V2 Wyvern models.",
  other: {
    "theme-color": "#000000",
  },
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <head>
        <meta name="theme-color" content="#000000" />
      </head>
      <body>{children}</body>
    </html>
  );
}
