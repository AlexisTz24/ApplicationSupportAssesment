import type { Metadata } from "next";
import { Inter } from "next/font/google";

import "./globals.css";
import { SiteHeader } from "@/components/site-header";

const inter = Inter({ subsets: ["latin"] });

export const metadata: Metadata = {
  title: "MercadoVerde · Panel de soporte",
  description:
    "Panel interno de soporte para el e-commerce MercadoVerde (prueba técnica).",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="es">
      <body className={inter.className}>
        <SiteHeader />
        <main className="container py-8">{children}</main>
        <footer className="mt-12 border-t">
          <div className="container flex h-16 items-center justify-between text-sm text-muted-foreground">
            <span>MercadoVerde · Panel interno de soporte</span>
            <a
              href="https://mercadoverde.example.com/centro-de-ayuda"
              target="_blank"
              rel="noopener noreferrer"
              className="underline underline-offset-4 hover:text-foreground"
            >
              Centro de ayuda
            </a>
          </div>
        </footer>
      </body>
    </html>
  );
}
