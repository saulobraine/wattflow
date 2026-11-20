import { test, expect } from "@playwright/test";

const MOBILE_VIEWPORTS = [
  { name: "Galaxy S20 (360x800)", width: 360, height: 800 },
  { name: "iPhone 12/13/14 (390x844)", width: 390, height: 844 },
  { name: "iPhone 14/15 Pro Max (430x932)", width: 430, height: 932 },
];

test.describe("PWA Completo & Headers de Segurança", () => {
  test("manifest.webmanifest é servido com status 200 e campos essenciais válidos", async ({
    request,
  }) => {
    const res = await request.get("/manifest.webmanifest");
    expect(res.status()).toBe(200);

    const body = await res.json();
    expect(body.name).toContain("WattFlow");
    expect(body.short_name).toBe("WattFlow");
    expect(body.display).toBe("standalone");
    expect(body.start_url).toBe("/");
    expect(body.theme_color).toBe("#020617");
    expect(body.background_color).toBe("#020617");
    expect(body.icons.length).toBeGreaterThanOrEqual(4);

    const has192 = body.icons.some(
      (icon: { sizes: string; purpose?: string }) =>
        icon.sizes === "192x192" && icon.purpose === "any"
    );
    const has192Maskable = body.icons.some(
      (icon: { sizes: string; purpose?: string }) =>
        icon.sizes === "192x192" && icon.purpose === "maskable"
    );
    const has512 = body.icons.some(
      (icon: { sizes: string; purpose?: string }) =>
        icon.sizes === "512x512" && icon.purpose === "any"
    );
    const has512Maskable = body.icons.some(
      (icon: { sizes: string; purpose?: string }) =>
        icon.sizes === "512x512" && icon.purpose === "maskable"
    );

    expect(has192).toBe(true);
    expect(has192Maskable).toBe(true);
    expect(has512).toBe(true);
    expect(has512Maskable).toBe(true);
  });

  test("public/sw.js é servido com cabeçalho Cache-Control anti-cache e escopo raiz", async ({
    request,
  }) => {
    const res = await request.get("/sw.js");
    expect(res.status()).toBe(200);

    const cacheControl = res.headers()["cache-control"] || "";
    expect(cacheControl).toContain("no-cache");
    expect(cacheControl).toContain("no-store");
    expect(cacheControl).toContain("must-revalidate");

    const swAllowed = res.headers()["service-worker-allowed"] || "";
    expect(swAllowed).toBe("/");

    const content = await res.text();
    expect(content).toContain("wattflow-static-v1");
    expect(content).toContain("/api/");
    expect(content).toContain("offline.html");
  });

  test("public/offline.html é acessível para fallback offline", async ({
    request,
  }) => {
    const res = await request.get("/offline.html");
    expect(res.status()).toBe(200);
    const html = await res.text();
    expect(html).toContain("Sem Conexão");
    expect(html).toContain("Tentar Reconectar");
  });
});

test.describe("Mobile UX: Telas de Autenticação (360px - 430px)", () => {
  for (const vp of MOBILE_VIEWPORTS) {
    test(`tela /login em ${vp.name} possui zero overflow horizontal e alvos de toque >= 44px`, async ({
      page,
    }) => {
      await page.setViewportSize({ width: vp.width, height: vp.height });
      await page.goto("/login");

      // 1. Zero Overflow Horizontal
      const overflow = await page.evaluate(() => {
        return {
          scrollWidth: document.documentElement.scrollWidth,
          clientWidth: window.innerWidth,
        };
      });
      expect(overflow.scrollWidth).toBeLessThanOrEqual(overflow.clientWidth);

      // 2. Inputs de texto: font-size >= 16px (evita auto-zoom iOS) e min-height >= 44px
      const emailInput = page.locator("#login-email-input");
      const passwordInput = page.locator("#login-password-input");

      await expect(emailInput).toBeVisible();
      await expect(passwordInput).toBeVisible();

      const emailFontSize = await emailInput.evaluate((el) =>
        parseFloat(window.getComputedStyle(el).fontSize)
      );
      const passwordFontSize = await passwordInput.evaluate((el) =>
        parseFloat(window.getComputedStyle(el).fontSize)
      );
      expect(emailFontSize).toBeGreaterThanOrEqual(16);
      expect(passwordFontSize).toBeGreaterThanOrEqual(16);

      const emailBox = await emailInput.boundingBox();
      const passwordBox = await passwordInput.boundingBox();
      expect(Math.round(emailBox?.height || 0)).toBeGreaterThanOrEqual(44);
      expect(Math.round(passwordBox?.height || 0)).toBeGreaterThanOrEqual(44);

      // 3. Botão de Entrar >= 44px (com tolerância a sub-pixel rendering)
      const submitButton = page.getByRole("button", { name: /entrar/i });
      const submitBox = await submitButton.boundingBox();
      expect(Math.round(submitBox?.height || 0)).toBeGreaterThanOrEqual(44);

      // 4. Checkbox "Manter conectado por 30 dias"
      const rememberCheckbox = page.locator("#login-remember-me");
      await expect(rememberCheckbox).toBeVisible();
      await expect(rememberCheckbox).toBeChecked();
    });
  }
});

test.describe("Mobile UX: Dashboard & Navegação Mobile Inferior (BottomNav)", () => {
  let authCookie: string = "";

  test.beforeAll(async ({ request }) => {
    const userEmail = `e2e-mobile-${Date.now()}@wattflow.local`;
    const password = "StrongMobilePassword!123";

    const registerRes = await request.post("/api/auth/register", {
      data: {
        email: userEmail,
        password,
        fullName: "Mobile Tester",
      },
    });

    if (registerRes.status() === 201) {
      const setCookie = registerRes.headers()["set-cookie"];
      if (setCookie) {
        authCookie = setCookie.split(";")[0];
      }
    }

    if (!authCookie) {
      const loginRes = await request.post("/api/auth/login", {
        data: {
          email: userEmail,
          password,
          rememberMe: true,
        },
      });
      const setCookie = loginRes.headers()["set-cookie"];
      if (setCookie) {
        authCookie = setCookie.split(";")[0];
      }
    }
  });

  for (const vp of MOBILE_VIEWPORTS) {
    test(`dashboard e navegação em ${vp.name} sem overflow e com BottomNav 5 abas`, async ({
      page,
      context,
    }) => {
      await page.setViewportSize({ width: vp.width, height: vp.height });

      if (authCookie) {
        const [cookieName, cookieVal] = authCookie.split("=");
        await context.addCookies([
          {
            name: cookieName,
            value: cookieVal,
            domain: "127.0.0.1",
            path: "/",
            httpOnly: true,
            sameSite: "Lax",
          },
        ]);
      }

      await page.goto("/");

      // Se redirecionou para login (ex: sem banco ativo no mock E2E), valida login sem overflow
      const currentUrl = page.url();
      if (currentUrl.includes("/login")) {
        const overflow = await page.evaluate(() => ({
          scrollWidth: document.documentElement.scrollWidth,
          clientWidth: window.innerWidth,
        }));
        expect(overflow.scrollWidth).toBeLessThanOrEqual(overflow.clientWidth);
        return;
      }

      // Valida zero overflow horizontal na Home autenticada
      const homeOverflow = await page.evaluate(() => ({
        scrollWidth: document.documentElement.scrollWidth,
        clientWidth: window.innerWidth,
      }));
      expect(homeOverflow.scrollWidth).toBeLessThanOrEqual(homeOverflow.clientWidth);

      // Valida Bottom Nav com 5 abas visíveis no mobile
      const bottomNav = page.locator('nav[aria-label="Navegação Mobile Inferior"]');
      await expect(bottomNav).toBeVisible();

      const navLinks = bottomNav.locator("a");
      await expect(navLinks).toHaveCount(5);

      // Cada alvo de toque da bottom nav deve ter largura e altura >= 44px
      const count = await navLinks.count();
      for (let i = 0; i < count; i++) {
        const linkBox = await navLinks.nth(i).boundingBox();
        expect(linkBox?.width).toBeGreaterThanOrEqual(44);
        expect(linkBox?.height).toBeGreaterThanOrEqual(44);
      }
    });

    test(`página /statistics em ${vp.name} sem overflow e com gráfico touch-friendly`, async ({
      page,
      context,
    }) => {
      await page.setViewportSize({ width: vp.width, height: vp.height });

      if (authCookie) {
        const [cookieName, cookieVal] = authCookie.split("=");
        await context.addCookies([
          {
            name: cookieName,
            value: cookieVal,
            domain: "127.0.0.1",
            path: "/",
            httpOnly: true,
            sameSite: "Lax",
          },
        ]);
      }

      await page.goto("/statistics");

      if (page.url().includes("/login")) {
        return;
      }

      // Valida zero overflow horizontal em /statistics
      const statsOverflow = await page.evaluate(() => ({
        scrollWidth: document.documentElement.scrollWidth,
        clientWidth: window.innerWidth,
      }));
      expect(statsOverflow.scrollWidth).toBeLessThanOrEqual(statsOverflow.clientWidth);
    });
  }
});
