import { Html, Head, Main, NextScript } from "next/document";

export default function Document() {
  return (
    <Html lang="pt-BR">
      <Head>
        <link rel="icon" type="image/svg+xml" href="/favicon.svg" />
        <link rel="alternate icon" href="/favicon.ico" />
        <link rel="apple-touch-icon" sizes="180x180" href="/icons/apple-touch-icon.png" />
        <link rel="manifest" href="/manifest.webmanifest" />
        <meta name="theme-color" content="#020617" />
        <meta name="apple-mobile-web-app-capable" content="yes" />
        <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent" />
        <meta name="apple-mobile-web-app-title" content="WattFlow" />
        <meta name="application-name" content="WattFlow" />
        <meta name="mobile-web-app-capable" content="yes" />
      </Head>
      <body className="bg-slate-950 font-sans text-slate-100 selection:bg-emerald-500 selection:text-white">
        <Main />
        <NextScript />
      </body>
    </Html>
  );
}
