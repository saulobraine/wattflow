# ESPECIFICAÇÃO TÉCNICA: LIVE-SYNC EM TEMPO REAL VIA SSE & INDICADOR DE STATUS NO HEADER
**Projeto:** WATTFLOW (G:\projetos\wattflow)  
**Autor:** Atlas - Arquiteto & Planejador  
**Destinatários:** Maestro (Orquestrador), Apex (Backend/SSE/Stream), Prism (Frontend/Hook/Header/Kiosk), Sentry (Tester QA), Sentinel (Code Reviewer)  
**Documento de Referência:** `UPGRADES_E_MELHORIAS_UI.md` (Item 4.3)

---

## 1. Visão Geral & Objetivos Estratégicos
O WattFlow opera com telemetria contínua via MQTT diretamente da nuvem da EcoFlow. Atualmente, os clientes web realizam consultas periódicas via HTTP polling para atualizar a interface.
O objetivo deste ciclo é implementar o **Live-Sync em Tempo Real orientado a eventos via Server-Sent Events (SSE)**, garantindo:
1. **Latência Milimétrica:** Atualização imediata dos cartões de telemetria (SOC, PV Watts, AC Output, modo ATS) milissegundos após o pacote MQTT ser recebido pelo backend.
2. **Zero Polling Desnecessário:** Eliminação do tráfego repetitivo de requisições HTTP REST nos clientes conectados, reduzindo carga no servidor e economizando dados móveis.
3. **Resiliência com Fallback Gracioso:** Hook reativo `useLiveTelemetry` que tenta SSE como primeira via e comuta automaticamente para polling com backoff exponencial caso o canal SSE seja interrompido por instabilidades de rede ou proxies restritivos.
4. **Visibilidade Operacional no Header:** Indicador luminoso em tempo real no Header do sistema (Verde pulsante para Live SSE/MQTT, Amarelo para Reconectando/Fallback Polling e Vermelho para Offline).
5. **Integração Holística:** Aplicação transparente no Dashboard (`/`), Estatísticas (`/statistics`) e Modo Kiosk (`/kiosk`).

---

## 2. Arquitetura Backend & Event Bridge (Apex - Backend)

### 2.1. Event Bridge no `EcoFlowMqttStreamService.ts`
O serviço singleton multi-tenant `EcoFlowMqttStreamService` deve prover um mecanismo pub/sub leve em memória para distribuir os dados recebidos aos clientes conectados de cada usuário.

**Interface de Subscrição:**
```typescript
type TelemetryListener = (snapshot: LiveTelemetrySnapshot) => void;

export class EcoFlowMqttStreamService {
  // Mapa de listeners ativos indexado por userId: Map<userId, Set<TelemetryListener>>
  private readonly telemetryListenersByUser = new Map<string, Set<TelemetryListener>>();

  public subscribeTelemetry(userId: string, listener: TelemetryListener): () => void {
    if (!this.telemetryListenersByUser.has(userId)) {
      this.telemetryListenersByUser.set(userId, new Set());
    }
    this.telemetryListenersByUser.get(userId)!.add(listener);

    // Retorna função limpa de cancelamento (unsubscribe)
    return () => {
      const userListeners = this.telemetryListenersByUser.get(userId);
      if (userListeners) {
        userListeners.delete(listener);
        if (userListeners.size === 0) {
          this.telemetryListenersByUser.delete(userId);
        }
      }
    };
  }

  // Acionado dentro de handleIncomingMessage / updateUserSnapshot:
  private broadcastTelemetry(userId: string, snapshot: LiveTelemetrySnapshot): void {
    const listeners = this.telemetryListenersByUser.get(userId);
    if (listeners && listeners.size > 0) {
      listeners.forEach((listener) => {
        try {
          listener(snapshot);
        } catch (listenerError) {
          console.warn(`[EcoFlow SSE] Erro ao notificar listener para user=${userId}:`, listenerError);
        }
      });
    }
  }
}
```

### 2.2. Endpoint SSE (`GET /api/telemetry/stream.ts`)
- **Autenticação:** Protegido por sessão via cookie `wattflow_session` (`extractUserFromRequest`). Retorna `401 Unauthorized` se não houver sessão ativa.
- **Headers HTTP Mandatórios para Streaming SSE:**
  ```http
  Content-Type: text/event-stream; charset=utf-8
  Cache-Control: no-cache, no-transform
  Connection: keep-alive
  X-Accel-Buffering: no
  ```
  *(Nota: `X-Accel-Buffering: no` é crítico para impedir que o Nginx em produção na VPS acumule os pacotes SSE em buffers).*
- **Ciclo de Vida da Conexão:**
  1. **Envio Imediato da Telemetria Atual:** Assim que o cliente conecta, busca `streamService.getLatestTelemetry(userId)` e despacha um evento imediato:
     `event: telemetry
data: ${JSON.stringify(latestTelemetry)}

`
  2. **Inscrição no Stream em Tempo Real:** Conecta o listener no `streamService.subscribeTelemetry(userId, ...)`.
  3. **Heartbeat / Keep-Alive a cada 15 segundos:**
     `setInterval` disparando `: keep-alive

` ou `event: ping
data: {"time": Date.now()}

` para evitar timeout por inatividade em proxies, firewalls e browsers mobile.
  4. **Prevenção Rigorosa de Vazamento de Memória (Memory Leaks):**
     Ao detectar fechamento da conexão (`req.on("close", ...)` ou `req.on("finish", ...)`):
     - Cancelar o `setInterval` do heartbeat.
     - Executar a função de `unsubscribe()` do `streamService`.
     - Finalizar a resposta (`res.end()`).

---

## 3. Hook Reativo & Frontend Architecture (Prism - Frontend)

### 3.1. Hook `src/hooks/useLiveTelemetry.ts`
Hook centralizador de estado de telemetria e conectividade.

**Definição TypeScript:**
```typescript
export type ConnectionStatus = "LIVE" | "POLLING" | "OFFLINE";

export interface UseLiveTelemetryResult {
  telemetry: LiveTelemetrySnapshot | null;
  connectionStatus: ConnectionStatus;
  lastUpdated: Date | null;
  isLive: boolean;
  reconnect: () => void;
}
```

**Comportamento & Algoritmo de Conectividade:**
1. **Tentativa Primária (SSE via `EventSource`):**
   - Cria instância de `EventSource('/api/telemetry/stream')`.
   - No `onopen`: define `connectionStatus = "LIVE"`.
   - No `onmessage` / listener de evento `"telemetry"`: atualiza `telemetry` e `lastUpdated = new Date()`.
   - No evento `"ping"`: atualiza heartbeat interno.
2. **Tratamento de Erros & Fallback Gracioso:**
   - No `onerror`:
     - Fecha o `EventSource`.
     - Muda o estado para `connectionStatus = "POLLING"`.
     - Inicia polling periódico via HTTP (`GET /api/dashboard-status` a cada 5 segundos) para manter o usuário sempre atualizado.
     - Agenda tentativa de reconexão SSE com backoff exponencial com jitter (2s, 4s, 8s, até teto de 15s).
3. **Detecção de Offline:**
   - Monitora `window.addEventListener("offline", ...)`: define imediatamente `connectionStatus = "OFFLINE"`.
   - Monitora `window.addEventListener("online", ...)`: dispara `reconnect()` imediato.
4. **Gerenciamento de Visibilidade (`visibilitychange`):**
   - Quando `document.visibilityState === "hidden"` em mobile: pode suspender a conexão para economizar bateria e reconectar instantaneamente ao retornar para `"visible"`.
5. **Limpeza:**
   - No cleanup do useEffect: fechar o `EventSource` e limpar quaisquer timers ativos.

### 3.2. Indicador Luminoso de Conexão no Header (`ConnectionStatusIndicator.tsx`)
Componente visual posicionado no cabeçalho global (`src/components/Layout.tsx`):
- **Estado "LIVE" (Verde Esmeralda):**
  - Ponto luminoso `w-2.5 h-2.5 rounded-full bg-emerald-500 shadow-[0_0_8px_#10b981]`.
  - Anel de pulso sutil em CSS: `animate-ping opacity-75`.
  - Micro-rótulo textual (visível em desktop `>= md`): `Tempo Real` ou `Live`.
  - Tooltip acessível: *"Conectado via MQTT/SSE em tempo real. Latência inferior a 100ms."*
- **Estado "POLLING" (Âmbar / Amarelo):**
  - Ponto luminoso `w-2.5 h-2.5 rounded-full bg-amber-500 shadow-[0_0_8px_#f59e0b]`.
  - Micro-rótulo textual: `Sincronizando...`.
  - Tooltip acessível: *"Modo de contingência ativo. Atualizando via polling a cada 5s."*
- **Estado "OFFLINE" (Vermelho Carmim):**
  - Ponto luminoso `w-2.5 h-2.5 rounded-full bg-rose-500 shadow-[0_0_8px_#f43f5e]`.
  - Micro-rótulo textual: `Desconectado`.
  - Tooltip acessível: *"Sem conexão com o servidor. Verifique sua rede."*
- **Acessibilidade:**
  - `role="status"` e `aria-live="polite"`.
  - `aria-label` dinâmico conforme o estado de conexão.

---

## 4. Integração nas Telas do Sistema

### 4.1. Dashboard Principal (`src/pages/index.tsx`)
- Substituir o polling rígido de 5s pelo consumo do `useLiveTelemetry`.
- Atualização sem transição brusca (zero layout shift) do nível de bateria SOC %, potência solar PV Watts, consumo AC Watts e estado da ATS.
- Feedback visual imediato quando a Chave ATS comutar (ex: rede -> bateria).

### 4.2. Estatísticas (`src/pages/statistics.tsx`)
- Conectar o topo da página (Potência Instantânea e Medidores Atuais) ao `useLiveTelemetry`.
- O histórico temporal continua consumindo o motor de agregação, enquanto a telemetria do topo opera 100% em tempo real.

### 4.3. Modo Kiosk / Wall Panel (`src/pages/kiosk.tsx`)
- Integrar `useLiveTelemetry` para animação contínua e suave do diagrama sinóptico de fluxo de potência.
- Indicador luminoso de status embutido ao lado do relógio digital para supervisão no painel elétrico.

---

## 5. Divisão de Tarefas do Squad

| Especialista | Módulo / Camada | Arquivos Alvo | Atribuições Detalhadas |
| :--- | :--- | :--- | :--- |
| **Apex** (Backend / SSE / Stream) | Camada de Stream SSE | `src/infrastructure/services/EcoFlowMqttStreamService.ts`<br>`src/pages/api/telemetry/stream.ts`<br>`src/infrastructure/security/*` | 1. Implementar `subscribeTelemetry` e `broadcastTelemetry` no `EcoFlowMqttStreamService`.<br>2. Desenvolver o endpoint SSE `/api/telemetry/stream.ts` com autenticação, headers de streaming e heartbeat de 15s.<br>3. Blindar contra vazamentos de memória no fechamento de conexão (`req.on("close")`).<br>4. Criar testes unitários no Vitest para o formato de mensagens SSE e o ciclo de vida de subscrições. |
| **Prism** (Frontend / Hook / Layout / Kiosk) | Frontend Reativo & UI | `src/hooks/useLiveTelemetry.ts`<br>`src/components/ConnectionStatusIndicator.tsx`<br>`src/components/Layout.tsx`<br>`src/pages/index.tsx`<br>`src/pages/statistics.tsx`<br>`src/pages/kiosk.tsx` | 1. Desenvolver o hook `useLiveTelemetry.ts` com suporte a `EventSource`, reconexão exponencial e fallback para polling.<br>2. Criar o componente `ConnectionStatusIndicator.tsx` com estados Verde/Amarelo/Vermelho e animações táteis.<br>3. Integrar o indicador no Header de `Layout.tsx` (responsivo para mobile e desktop).<br>4. Conectar o hook no Dashboard (`index.tsx`), Estatísticas (`statistics.tsx`) e Modo Kiosk (`kiosk.tsx`). |
| **Sentry** (Tester QA) | Suíte de Testes & QA | `tests/unit/useLiveTelemetry.test.ts`<br>`tests/unit/sseStream.test.ts`<br>`e2e/live-telemetry-sse.spec.ts` | 1. Testes unitários para o hook `useLiveTelemetry` (estados LIVE, POLLING, OFFLINE e reconexão).<br>2. Suíte Playwright E2E validando indicador luminoso no Header, fluxo de dados SSE e comutação para fallback. |
| **Sentinel** (Code Reviewer) | Quality Gate & Segurança | Todo o diff do PR | 1. Auditoria rigorosa de memory leaks em conexões de longa duração no Node.js.<br>2. Validação dos cabeçalhos HTTP para compatibilidade com Nginx (`X-Accel-Buffering: no`).<br>3. Conformidade WCAG 2.1 AA para estados de conexão e contraste cromático. |

---

## 6. Critérios de Aceite para Homologação (DoD - Definition of Done)

1. **Protocolo SSE & Stream:**
   - Conexão `/api/telemetry/stream` mantida com `Content-Type: text/event-stream` e `X-Accel-Buffering: no`.
   - Ao receber novo pacote MQTT da EcoFlow, o backend faz broadcast para os clientes conectados em menos de **100ms**.
   - Heartbeats de keep-alive enviados a cada 15s sem interrupções.
2. **Zero Memory Leaks:**
   - Comprovado por teste que fechar a aba ou abortar a requisição remove o listener do `EcoFlowMqttStreamService` e limpa o timer do heartbeat.
3. **Resiliência do Hook & Fallback:**
   - Em condições normais, o estado permanece `LIVE` (ponto verde pulsante).
   - Ao simular falha no SSE ou desconexão do stream, o hook transita imediatamente para `POLLING` (ponto amarelo) e mantém a interface funcional sem travar.
   - Ao retornar a rede, o hook reconecta ao SSE e restaura o estado `LIVE`.
4. **Indicador Visual no Header:**
   - Ponto luminoso presente no Header em todas as resoluções (360px até 4k) com tooltip explicativo e suporte a leitores de tela (`aria-live="polite"`).
5. **Integração nas Telas:**
   - Dashboard, Estatísticas e Kiosk refletem novas leituras de Watts e Bateria sem refresh e sem layout shift.
6. **Suíte de Testes 100% Aprovada:**
   - `npm test` verde em 100% das asserções.
   - `npm run lint` e `npm run build` executam sem advertências ou erros.
   - `npx playwright test e2e/live-telemetry-sse.spec.ts` aprovado.
