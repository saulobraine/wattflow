import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";

describe("PWA Security, Headers & Service Worker Integrity", () => {
  const rootDir = path.resolve(__dirname, "../../../../");

  describe("next.config.js (CSP & SW Headers)", () => {
    it("configura cabeçalhos anti-cache estritos para /sw.js", async () => {
      // Carrega a configuração do next.config.js
      const nextConfig = require(path.join(rootDir, "next.config.js"));
      const headersList = await nextConfig.headers();

      const swHeaderEntry = headersList.find((entry: { source: string }) => entry.source === "/sw.js");
      expect(swHeaderEntry).toBeDefined();

      const cacheControl = swHeaderEntry.headers.find((h: { key: string }) => h.key === "Cache-Control");
      expect(cacheControl).toBeDefined();
      expect(cacheControl.value).toContain("no-cache");
      expect(cacheControl.value).toContain("no-store");
      expect(cacheControl.value).toContain("must-revalidate");

      const swAllowed = swHeaderEntry.headers.find((h: { key: string }) => h.key === "Service-Worker-Allowed");
      expect(swAllowed).toBeDefined();
      expect(swAllowed.value).toBe("/");
    });

    it("estende a CSP com manifest-src 'self' e worker-src 'self'", async () => {
      const nextConfig = require(path.join(rootDir, "next.config.js"));
      const headersList = await nextConfig.headers();

      const globalHeaderEntry = headersList.find((entry: { source: string }) => entry.source === "/:path*");
      expect(globalHeaderEntry).toBeDefined();

      const cspHeader = globalHeaderEntry.headers.find((h: { key: string }) => h.key === "Content-Security-Policy");
      expect(cspHeader).toBeDefined();

      const cspValue = cspHeader.value;
      expect(cspValue).toContain("manifest-src 'self'");
      expect(cspValue).toContain("worker-src 'self'");
      expect(cspValue).toContain("default-src 'self'");
      expect(cspValue).toContain("connect-src 'self' https://fonts.googleapis.com https://fonts.gstatic.com");
    });
  });

  describe("public/sw.js (Política de Cache e Bypass)", () => {
    const swPath = path.join(rootDir, "public/sw.js");
    let swContent = "";

    it("arquivo public/sw.js existe e possui o nome de cache versionado correto", () => {
      expect(fs.existsSync(swPath)).toBe(true);
      swContent = fs.readFileSync(swPath, "utf-8");
      expect(swContent).toMatch(/wattflow-static-v[1-9]/);
    });

    it("possui regra estrita de bypass Network-Only para qualquer rota /api/*", () => {
      if (!swContent) swContent = fs.readFileSync(swPath, "utf-8");
      expect(swContent).toMatch(/url\.pathname\.startsWith\(["']\/api\/["']\)/);
      expect(swContent).toContain("request.method !== 'GET'");
    });

    it("possui fallback offline para /offline.html nas requisições de navegação", () => {
      if (!swContent) swContent = fs.readFileSync(swPath, "utf-8");
      expect(swContent).toContain("request.mode === 'navigate'");
      expect(swContent).toContain("'/offline.html'");
    });

    it("executa self.skipWaiting() e clients.claim() para atualização imediata", () => {
      if (!swContent) swContent = fs.readFileSync(swPath, "utf-8");
      expect(swContent).toContain("skipWaiting");
      expect(swContent).toContain("clients.claim");
    });

    it("trata fontes externas do Google Fonts com resiliência sem gerar 504", () => {
      if (!swContent) swContent = fs.readFileSync(swPath, "utf-8");
      expect(swContent).toContain("fonts.googleapis.com");
      expect(swContent).toContain("fonts.gstatic.com");
    });
  });

  describe("public/offline.html (Página de Contingência)", () => {
    const offlinePath = path.join(rootDir, "public/offline.html");

    it("arquivo public/offline.html existe e possui elementos essenciais de contingência", () => {
      expect(fs.existsSync(offlinePath)).toBe(true);
      const content = fs.readFileSync(offlinePath, "utf-8");
      expect(content).toContain("Sem Conexão");
      expect(content).toContain("#020617");
      expect(content).toContain("window.location.reload()");
      expect(content).toContain("online");
    });
  });
});
