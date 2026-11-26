import React from "react";
import { describe, it, expect, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { ConnectionStatusIndicator } from "../ConnectionStatusIndicator";

// Mock do hook useLiveTelemetry para isolamento total do componente
vi.mock("../../hooks/useLiveTelemetry", () => ({
  useLiveTelemetry: vi.fn(() => ({
    telemetry: null,
    connectionStatus: "LIVE",
    lastUpdated: new Date("2026-11-26T20:00:00Z"),
    isLive: true,
    reconnect: vi.fn(),
  })),
}));

describe("ConnectionStatusIndicator (Componente Visual de Conexão)", () => {
  it("renderiza corretamente o estado LIVE com badge verde esmeralda e label 'Ao Vivo'", () => {
    const html = renderToStaticMarkup(
      React.createElement(ConnectionStatusIndicator, { status: "LIVE" })
    );

    expect(html).toContain('role="status"');
    expect(html).toContain('aria-live="polite"');
    expect(html).toContain("Status da Conexão: Ao Vivo");
    expect(html).toContain("Ao Vivo");
    expect(html).toContain("bg-emerald-500");
    expect(html).toContain("text-emerald-400");
  });

  it("renderiza o estado POLLING com visual amigável 'Ao Vivo (Polling)' em verde e sem alarme", () => {
    const html = renderToStaticMarkup(
      React.createElement(ConnectionStatusIndicator, { status: "POLLING" })
    );

    expect(html).toContain("Ao Vivo (Polling)");
    // Não deve conter a cor de alarme amber-500 no dot
    expect(html).toContain("bg-emerald-500");
    expect(html).toContain("text-emerald-400");
    expect(html).not.toContain("bg-amber-500 shadow-[0_0_8px_#f59e0b]");
    expect(html).toContain("Modo de sincronização contínua via polling");
  });

  it("renderiza o estado CONNECTING com badge azul/sky e label 'Conectando'", () => {
    const html = renderToStaticMarkup(
      React.createElement(ConnectionStatusIndicator, { status: "CONNECTING" })
    );

    expect(html).toContain("Conectando");
    expect(html).toContain("bg-sky-500");
    expect(html).toContain("text-sky-400");
    expect(html).toContain("Estabelecendo conexão com o servidor");
  });

  it("renderiza o estado RECONNECTING com badge âmbar/laranja reservado para falhas de comunicação", () => {
    const html = renderToStaticMarkup(
      React.createElement(ConnectionStatusIndicator, { status: "RECONNECTING" })
    );

    expect(html).toContain("Reconectando");
    expect(html).toContain("bg-amber-500");
    expect(html).toContain("text-amber-400");
    expect(html).toContain("Falha temporária de comunicação");
  });

  it("renderiza o estado OFFLINE com badge vermelho carmim e label 'Offline'", () => {
    const html = renderToStaticMarkup(
      React.createElement(ConnectionStatusIndicator, { status: "OFFLINE" })
    );

    expect(html).toContain("Offline");
    expect(html).toContain("bg-rose-500");
    expect(html).toContain("text-rose-400");
    expect(html).toContain("Sem conexão com o servidor");
  });

  it("oculta o label textual no modo compacto, mantendo o indicador luminoso", () => {
    const html = renderToStaticMarkup(
      React.createElement(ConnectionStatusIndicator, { status: "LIVE", compact: true })
    );

    expect(html).toContain("bg-emerald-500");
    // No modo compacto o span de texto não deve ser renderizado
    expect(html).not.toContain("text-[11px] font-mono font-semibold");
  });

  it("exibe label em mobile quando showLabelOnMobile=true", () => {
    const html = renderToStaticMarkup(
      React.createElement(ConnectionStatusIndicator, {
        status: "LIVE",
        showLabelOnMobile: true,
      })
    );

    expect(html).toContain("inline");
    expect(html).not.toContain("hidden sm:inline");
  });
});
