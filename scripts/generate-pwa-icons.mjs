import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { chromium } from "@playwright/test";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, "..");

const publicDir = path.resolve(projectRoot, "public");
const outputDir = path.resolve(publicDir, "icons");

if (!fs.existsSync(outputDir)) {
  fs.mkdirSync(outputDir, { recursive: true });
}

// SVG com o símbolo oficial do WattFlow (Squircle dark com raio Lucide Zap vazado)
function getSvg(size, isMaskable = false) {
  const padding = isMaskable ? Math.round(size * 0.12) : 0;
  const squircleSize = size - padding * 2;
  const rx = Math.round(squircleSize * 0.24);
  const strokeWidth = Math.max(1.5, squircleSize * 0.038);
  const glowDev = Math.max(1, squircleSize * 0.025);

  // Escala interna do ícone Zap (viewBox base 24x24)
  const zapTargetSize = squircleSize * 0.72;
  const zapScale = zapTargetSize / 24;
  const zapOffset = padding + (squircleSize - zapTargetSize) / 2;

  return `
    <svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
      <defs>
        <linearGradient id="bg-${size}" x1="0" y1="0" x2="${size}" y2="${size}" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stop-color="#0b1329" />
          <stop offset="100%" stop-color="#020617" />
        </linearGradient>
        <filter id="glow-${size}" x="-20%" y="-20%" width="140%" height="140%">
          <feDropShadow dx="0" dy="${Math.max(1, squircleSize * 0.015)}" stdDeviation="${glowDev}" flood-color="#10b981" flood-opacity="0.55" />
        </filter>
      </defs>

      <!-- Fundo dark sólido para máscara/viewport -->
      <rect width="${size}" height="${size}" fill="#020617" />

      <!-- Squircle Container Oficial -->
      <g transform="translate(${padding}, ${padding})">
        <rect
          x="${strokeWidth / 2}"
          y="${strokeWidth / 2}"
          width="${squircleSize - strokeWidth}"
          height="${squircleSize - strokeWidth}"
          rx="${rx}"
          fill="url(#bg-${size})"
          stroke="#10b981"
          stroke-width="${strokeWidth}"
          stroke-opacity="0.45"
        />
        <rect
          x="${strokeWidth / 2}"
          y="${strokeWidth / 2}"
          width="${squircleSize - strokeWidth}"
          height="${squircleSize - strokeWidth}"
          rx="${rx}"
          fill="#10b981"
          fill-opacity="0.08"
        />
      </g>

      <!-- Ícone Lucide Zap Oficial Centralizado -->
      <g transform="translate(${zapOffset}, ${zapOffset}) scale(${zapScale})">
        <path
          d="M15.914 4a1.5 1.5 0 00-2.474-1.561l-9 9A1.5 1.5 0 005.5 14h4.002a.5.5 0 01.471.666L8.086 20a1.5 1.5 0 002.475 1.56l9-9A1.5 1.5 0 0018.5 10h-3.997a.5.5 0 01-.472-.667z"
          fill="none"
          stroke="#34d399"
          stroke-width="2.2"
          stroke-linecap="round"
          stroke-linejoin="round"
          filter="url(#glow-${size})"
        />
      </g>
    </svg>
  `;
}

// Montador binário de arquivo .ico multiresolução contendo PNGs embutidos
function createIco(images) {
  const count = images.length;
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0); // reservado
  header.writeUInt16LE(1, 2); // formato 1 = ICO
  header.writeUInt16LE(count, 4); // quantidade de imagens

  let offset = 6 + count * 16;
  const dirs = [];
  const buffers = [];

  for (const img of images) {
    const dir = Buffer.alloc(16);
    dir.writeUInt8(img.width >= 256 ? 0 : img.width, 0);
    dir.writeUInt8(img.height >= 256 ? 0 : img.height, 1);
    dir.writeUInt8(0, 2); // sem paleta de cores
    dir.writeUInt8(0, 3); // reservado
    dir.writeUInt16LE(1, 4); // planos de cor
    dir.writeUInt16LE(32, 6); // 32 bits por pixel
    dir.writeUInt32LE(img.buffer.length, 8); // tamanho dos dados
    dir.writeUInt32LE(offset, 12); // offset no arquivo
    dirs.push(dir);
    buffers.push(img.buffer);
    offset += img.buffer.length;
  }

  return Buffer.concat([header, ...dirs, ...buffers]);
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

    // Também copia apple-touch-icon para a raiz do public para compatibilidade com iOS Safari
    if (t.file === "apple-touch-icon.png") {
      const rootAppleIcon = path.resolve(publicDir, "apple-touch-icon.png");
      fs.copyFileSync(outPath, rootAppleIcon);
      console.log(`Copied to: ${rootAppleIcon}`);
    }
  }

  // Gera favicon.ico com os tamanhos padrão 16x16, 32x32 e 48x48
  const icoSizes = [16, 32, 48];
  const icoImages = [];

  for (const s of icoSizes) {
    const svg = getSvg(s, false);
    await page.setViewportSize({ width: s, height: s });
    await page.setContent(`<!DOCTYPE html><html><body style="margin:0;padding:0;overflow:hidden;background:transparent;">${svg}</body></html>`);
    const buffer = await page.screenshot({ omitBackground: true });
    icoImages.push({ width: s, height: s, buffer });
  }

  const icoBuffer = createIco(icoImages);
  const faviconIcoPath = path.resolve(publicDir, "favicon.ico");
  fs.writeFileSync(faviconIcoPath, icoBuffer);
  console.log(`Generated: ${faviconIcoPath} (multi-res 16, 32, 48)`);

  await browser.close();
  console.log("All PWA and Favicon assets generated successfully.");
}

generate().catch(console.error);
