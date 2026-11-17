/**
 * Poller local de telemetria em tempo real para ambiente de desenvolvimento.
 * Executa a cada 2 segundos disparando a rota /api/sync do WattFlow.
 */
const token = process.env.CRON_SECRET_TOKEN || "wattflow_secret_token_123";
const port = process.env.PORT || "3000";
const url = `http://localhost:${port}/api/sync?token=${token}`;

console.log(`[WattFlow Poller] Iniciando sync em tempo real (intervalo: 2s) em ${url}...`);

async function tick() {
  try {
    const res = await fetch(url, { method: "GET" });
    if (!res.ok) {
      console.warn(`[WattFlow Poller] HTTP ${res.status}`);
    }
  } catch (err) {
    // Servidor pode estar reiniciando
  }
}

setInterval(tick, 2000);
tick();
