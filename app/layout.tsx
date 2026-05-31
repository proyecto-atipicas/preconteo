import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Resultados en Vivo · Presidenciales Colombia 2026",
  description:
    "Resultados electorales en tiempo real de las Elecciones Presidenciales de Colombia 2026 — Registraduría Nacional del Estado Civil.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="es">
      <body>{children}</body>
    </html>
  );
}
