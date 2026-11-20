import fs from "fs";
import path from "path";
import { chromium } from "@playwright/test";

const outputDir = path.resolve("public/icons");
if (!fs.existsSync(outputDir)) {
  fs.mkdirSync(outputDir, { recursive: true });
}

// SVG com símbolo do WattFlow (Raio esmeralda/ciano)
function getSvg(size, isMaskable = false) {
  const padding = isMaskable ? Math.round(size * 0.15) : Math.round(size * 0.05);
  const innerSize = size - padding * 2;

  return `
    <svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
      <defs>
        <linearGradient id="bg" x1="0" y1="0" x2="${size}" y2="${size}" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stop-color="#0f172a" />
          <stop offset="100%" stop-color="#020617" />
        </linearGradient>
        <linearGradient id="zap" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stop-color="#34d399" />
          <stop offset="60%" stop-color="#10b981" />
          <stop offset="100%" stop-color="#06b6d4" />
        </linearGradient>
        <filter id="glow" x="-20%" y="-20%" width="140%" height="140%">
          <feDropShadow dx="0" dy="2" stdDeviation="${Math.max(2, size * 0.02)}" flood-color="#10b981" flood-opacity="0.5" />
        </filter>
      </defs>

      <!-- Fundo -->
      <rect width="${size}" height="${size}" fill="url(#bg)" />

      <!-- Borda sutil quando não for maskable -->
      ${!isMaskable ? `
        <rect x="${padding * 0.3}" y="${padding * 0.3}" width="${size - padding * 0.6}" height="${size - padding * 0.6}" rx="${size * 0.2}" fill="none" stroke="#10b981" stroke-width="${Math.max(1.5, size * 0.01)}" stroke-opacity="0.3" />
      ` : ""}

      <!-- Raio centralizado -->
      <g transform="translate(${padding}, ${padding}) scale(${innerSize / 32})">
        <path
          d="M17.5 4L7 16.5H15L14.5 28L25 15.5H17L17.5 4Z"
          fill="url(#zap)"
          stroke="#34d399"
          stroke-width="0.8"
          stroke-linejoin="round"
          filter="url(#glow)"
        />
      </g>
    </svg>
  `;
}

async function generate() {
  const browser = await chromium.launch();
  const page = await browser.newPage();

  const targets = [
    { file: "icon-192.png", size: 192, maskable: false },
    { file: "icon-192-maskable.png", size: 192, maskable: true },
    { file: "icon-512.png", size: 512, maskable: false },
    { file: "icon-512-maskable.png", size: 512, maskable: true },
    { file: "apple-touch-icon.png", size: 180, maskable: false },
  ];

  for (const t of targets) {
    const svg = getSvg(t.size, t.maskable);
    await page.setViewportSize({ width: t.size, height: t.size });
    await page.setContent(`<!DOCTYPE html><html><body style="margin:0;padding:0;overflow:hidden;background:#020617;">${svg}</body></html>`);
    const outPath = path.join(outputDir, t.file);
    await page.screenshot({ path: outPath, omitBackground: false });
    console.log(`Generated: ${outPath} (${t.size}x${t.size})`);

    // Também copia apple-touch-icon para a raiz do public para compatibilidade máxima com Safari
    if (t.file === "apple-touch-icon.png") {
      const rootAppleIcon = path.resolve("public/apple-touch-icon.png");
      fs.copyFileSync(outPath, rootAppleIcon);
      console.log(`Copied to: ${rootAppleIcon}`);
    }
  }

  await browser.close();
  console.log("All PWA icons generated successfully.");
}

generate().catch(console.error);
