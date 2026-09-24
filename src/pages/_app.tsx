import type { AppProps } from "next/app";
import Head from "next/head";
import { AuthProvider } from "../context/AuthContext";
import "../styles/globals.css";

export default function App({ Component, pageProps }: AppProps) {
  return (
    <AuthProvider>
      <Head>
        <title>WattFlow - Orquestrador de Energia Inteligente</title>
        <meta
          name="description"
          content="Orquestrador de energia inteligente para estações EcoFlow e atuadores Tuya Smart Life"
        />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
      </Head>
      <Component {...pageProps} />
    </AuthProvider>
  );
}
