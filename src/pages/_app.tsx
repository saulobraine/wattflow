import React, { useEffect } from "react";
import type { AppProps } from "next/app";
import Head from "next/head";
import { Geist, Geist_Mono } from "next/font/google";
import { AuthProvider } from "../context/AuthContext";
import "../styles/globals.css";

const geistSans = Geist({
  subsets: ["latin"],
  variable: "--font-geist-sans",
});

const geistMono = Geist_Mono({
  subsets: ["latin"],
  variable: "--font-geist-mono",
});

export default function App({ Component, pageProps }: AppProps) {
  useEffect(() => {
    if (typeof window !== "undefined" && "serviceWorker" in navigator) {
      window.addEventListener("load", () => {
        navigator.serviceWorker
          .register("/sw.js", { scope: "/" })
          .then((registration) => {
            // Verifica atualizações em background
            registration.update().catch(() => {});
          })
          .catch((err) => {
            console.error("[WattFlow PWA] Falha ao registrar Service Worker:", err);
          });
      });
    }
  }, []);

  return (
    <AuthProvider>
      <Head>
        <title>WattFlow - Orquestrador de Energia Inteligente</title>
        <meta
          name="description"
          content="Orquestrador de energia inteligente para estações EcoFlow com Chave de Transferência Automática (ATS)"
        />
        <meta
          name="viewport"
          content="width=device-width, initial-scale=1, maximum-scale=5, viewport-fit=cover"
        />
      </Head>
      <div className={`${geistSans.variable} ${geistMono.variable} font-sans min-h-screen bg-slate-950 text-slate-100`}>
        <Component {...pageProps} />
      </div>
    </AuthProvider>
  );
}
