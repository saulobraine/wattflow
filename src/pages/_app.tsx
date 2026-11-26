import React, { useEffect } from "react";
import type { AppProps } from "next/app";
import Head from "next/head";
import { AuthProvider } from "../context/AuthContext";
import { Toaster } from "../components/ui/toast";
import "../styles/globals.css";

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
          content="width=device-width, initial-scale=1, maximum-scale=5, viewport-fit=cover, interactive-widget=resizes-content"
        />
      </Head>
      <Component {...pageProps} />
      <Toaster />
    </AuthProvider>
  );
}
