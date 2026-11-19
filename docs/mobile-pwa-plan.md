# Plano Mestre Oficial (4 Etapas): Arquitetura MQTT-First, Login Persistente, PWA & Mobile UX — WattFlow

- **Orquestrador:** `Maestro`
- **Arquitetura de Produto & UX:** `PulseDesign`
- **Branch de Trabalho:** `feat/mobile-pwa-persistent-auth` (derivada de `develop`)
- **Status Geral:** Plano oficial em **4 Etapas** aprovado por Baggute — **Etapa 1** com infraestrutura e implementação concluídas aguardando Quality Gate e commit; **Etapas 2, 3 e 4** planejadas para execução sequencial.
- **Regra de Ouro:** Nenhuma etapa avança para commit sem **100% de aprovação** nos testes unitários e de integração (`npm test`), suíte E2E (`npm run test:e2e`), lint (`npm run lint`), build de produção (`npm run build`), Code Review (`Sentinel`) e Homologação de QA (`Certifier`). É proibido executar comandos destrutivos ou disparos locais capazes de interferir na estação EcoFlow real de produção.

## Matriz de Responsabilidades do Squad

| Especialista | Papel | Escopo nesta Entrega |
| :--- | :--- | :--- |
| **Maestro** | Orquestrador Geral | Coordenação das 4 etapas, pausa da rotina local do Maestri e handoff entre especialistas |
| **PulseDesign** | Product Designer (UX/UI) & Growth | Diagnóstico completo, especificação mobile-first (`360px–430px`), Bottom Nav 5 abas, safe-areas, ergonomia touch e microcopy |
| **ApexDev** | Dev Sênior (TypeScript / Backend) | `DISABLE_LOCAL_CRON`, sessão 30d (`SameSite=Lax`, `Expires`, sliding refresh), `AuthContext` offline-resilient, **Arquitetura MQTT-First (Etapa 2)**, `sw.js` e `useVisibilityPolling` |
| **PipelineForge** | DevOps Engineer | `docker-compose.yml` (Watchdog 5 min `WATCHDOG_INTERVAL_SECONDS=300`), `.env.example`, `scripts/local-sync-daemon.js`, banco local e headers/CSP em `next.config.js` |
| **PixelCraft** | Dev Frontend (React / Next.js) | `manifest.webmanifest`, ícones PNG, `offline.html`, `PwaInstallPrompt`, Bottom Nav 5 abas, cards `md:hidden`, gráfico touch, checkbox "Manter conectado por 30 dias" e inputs `>= 16px` |
| **UnitTestEngine** | Testes Unitários & Integração | Cobertura Vitest das Etapas 1, 2 (MQTT-First), 3 (PWA/CSP/SW) e 4 (UX/Polling/RememberMe) |
| **E2EGuardian** | Testes E2E & Regressão | Cobertura Playwright desktop + mobile (`360x800`, `390x844`, `430x932`), incluindo suíte dedicada `e2e/mobile-pwa.spec.ts` |
| **Sentinel** | Code Reviewer | Auditoria estática, revisão CSRF/Auth/MQTT-First/CSP/Service Worker e Object Calisthenics antes de cada commit |
| **Certifier** | Analista de QA | Validação ponta a ponta dos Critérios de Aceite (DoD) e certificação formal de cada etapa |
| **GitOps** | GitHub Manager | Gestão de commits convencionais na branch `feat/mobile-pwa-persistent-auth` após aprovação dos portões |

---

## 1. Diagnóstico Completo e Arquitetura da Solução

### 1.1 Cron, Stream MQTT e Automação Local (Risco de Interferência no Hardware Real)

#### Risco Crítico Identificado
O banco PostgreSQL de desenvolvimento local pode conter o espelho das configurações de produção, incluindo o serial físico real **`R621ZBB6XG6K0937`** na tabela `UserConfiguration` com `isAutomationActive = true` e credenciais EcoFlow/ATS ativas. Qualquer ciclo local de sincronização ou stream MQTT conectado ao mesmo serial pode avaliar limiares (`turnOnThreshold` / `turnOffThreshold`) e disparar comandos físicos concorrentes (`ENABLE_ECOFLOW_AC` / `DISABLE_ECOFLOW_AC`) contra a estação real, competindo com a instância da VPS de produção e comutando indevidamente a Chave de Transferência Automática (ATS).

#### Mapeamento dos Vetores Locais de Disparo
1. **`scripts/local-sync-daemon.js`:** Daemon local que estabelece stream MQTT oficial (`mqtts://*.ecoflow.com:8883`) e agenda chamadas periódicas ao servidor Next.js autenticado por `CRON_SECRET_TOKEN`.
2. **`docker-compose.yml` (serviço `cron-scheduler`):** Container `wattflow_cron` (`alpine:3.20`) em loop contínuo acionando a rota protegida por `CRON_SECRET_TOKEN`.
3. **`src/infrastructure/services/LiveTelemetryService.ts` (`syncIfStale`):** Invocado automaticamente por `GET /api/dashboard-status` (`src/pages/api/dashboard-status.ts`) e `GET /api/statistics` (`src/pages/api/statistics.ts`), iniciando `EcoFlowMqttStreamService.startForUser(...)` e sincronização HTTP de fallback.
4. **`src/pages/api/sync.ts`:** Endpoint de sincronização em lote via Cron (`executeSyncAll()`) e individual via sessão (`POST /api/sync` → `executeSyncForUser()`).
5. **`src/pages/api/mqtt-stream.ts`:** Endpoint protegido por `CRON_SECRET_TOKEN` que inicializa e mantém ativo o singleton `EcoFlowMqttStreamService.startWithActiveConfiguration(prisma)`.
6. **Rotina Local do Maestri (`maestri routine`):** Rotina agendada no workspace local do Maestri capaz de acionar verificações ou ciclos periódicos no ambiente de desenvolvimento.

#### Solução Arquitetural (Tripla Barreira de Isolamento Local)
1. **Variável de Controle `DISABLE_LOCAL_CRON=true`:**
   - Configurada no `.env` local e documentada em `.env.example` / `docker-compose.yml` (mantida `false` em produção).
   - **`scripts/local-sync-daemon.js` e `docker-compose.yml` (`cron-scheduler`):** Ao detectar `DISABLE_LOCAL_CRON=true`, entram em modo passivo seguro sem abrir stream MQTT nem disparar chamadas para `/api/sync` ou `/api/mqtt-stream`.
   - **`src/pages/api/sync.ts` (fluxo Cron), `src/pages/api/mqtt-stream.ts` e `LiveTelemetryService.syncIfStale`:** Retornam *no-op* seguro quando `DISABLE_LOCAL_CRON=true`, lendo exclusivamente os dados já persistidos no PostgreSQL local sem enviar comandos nem abrir conexões à nuvem EcoFlow.
2. **Desativação no Banco PostgreSQL Local:**
   - Definir `isAutomationActive = false` na tabela `UserConfiguration` local para qualquer registro contendo o serial real `R621ZBB6XG6K0937`.
3. **Pausa da Rotina Local do Maestri:**
   - Pausar/desabilitar a rotina periódica local no Maestri via Orquestrador (`Maestro`) durante todo o ciclo de desenvolvimento e validação.

---

### 1.2 As 3 Causas Raiz da Perda de Login no Mobile e PWA

| # | Causa Raiz Atual | Arquivo / Símbolo Afetado | Impacto em Dispositivos Móveis & PWA | Solução Especificada |
| :--- | :--- | :--- | :--- | :--- |
| **(a)** | Cookie `wattflow_session` emitido com `SameSite=Strict` | `src/infrastructure/auth/sessionHelper.ts` (`setSessionCookie`, `clearSessionCookie`) | No iOS Safari / WebKit (incluindo PWA `standalone` na Tela de Início) e em aberturas por links externos (notificações Telegram/WhatsApp ou restauração de processo pelo SO), o navegador pode classificar o lançamento inicial como cross-site top-level e omitir o cookie `SameSite=Strict`, levando `/api/auth/me` a responder `isAuthenticated: false`. | Migrar para **`SameSite=Lax`** mantendo `HttpOnly`, `Path=/` e `Secure` em produção. A proteção contra CSRF permanece intacta via `enforceCsrfProtection` (`Origin`/`Referer` vs `Host` e `Sec-Fetch-Site`) em todos os endpoints mutáveis (`POST`/`PUT`/`PATCH`/`DELETE`), sem mutações de estado via `GET`. |
| **(b)** | TTL fixo de 7 dias sem atributo `Expires` explícito nem *sliding refresh* | `src/domain/services/AuthenticationTokenService.ts` (`createSessionToken`), `sessionHelper.ts` (`setSessionCookie`), `src/pages/api/auth/me.ts` | Sessão expira de forma absoluta após 7 dias mesmo com uso contínuo; além disso, cookies sem `Expires` explícito têm persistência menos previsível em WebKit/PWA iOS após suspensão pelo sistema operacional. | Ampliar TTL padrão de sessão para **30 dias** (`2592000s`) emitindo conjuntamente `Max-Age=2592000` e `Expires=<UTCString>` (suportando também cookie efêmero na Etapa 4 caso o checkbox *"Manter conectado por 30 dias"* seja desmarcado). Implementar **Sliding Refresh** em `GET /api/auth/me`: após validar assinatura HMAC e `tokenVersion` no banco, renovar o token e reemitir o cookie quando elegível. |
| **(c)** | `AuthContext.tsx` redirecionando para `/login` em qualquer erro de rede/offline/`5xx` | `src/context/AuthContext.tsx` (`fetchSession`, `useEffect`) | Em oscilação Wi-Fi ↔ 4G/5G, garagem/quadro elétrico sem sinal, modo offline ou falha transitória `5xx`, o `catch` ou erro HTTP executa `setUser(null)` e `router.push('/login')`, derrubando uma sessão válida. | Manter cache **estritamente não-sensível** em `localStorage` (`wattflow_user_cache`: `{ id, email, fullName, cachedAt }`) para hidratação imediata. Redirecionar para `/login` **somente** em `401` ou `{ isAuthenticated: false }` confirmado. Em erros de rede (`catch`/offline) ou `5xx`, preservar `user` e cache local, sinalizar estado offline/degradado e revalidar automaticamente via `window` (`online`) e `document` (`visibilitychange`). Limpar o cache explicitamente em `logout()`. |

---

### 1.3 Arquitetura MQTT-First Orientada a Eventos (Eliminação do Polling HTTP de 2s)

#### Problema da Arquitetura Anterior (Polling REST Contínuo)
O modelo anterior disparava ciclos HTTP de `2s` (`docker-compose.yml` `cron-scheduler`, `scripts/local-sync-daemon.js` e `LiveTelemetryService.syncIfStale(..., 2000)`) consultando repetidamente o endpoint REST `/quota/all` da EcoFlow e persistindo entradas em `SyncExecutionLog` a cada 2 segundos (~43.200 registros/dia por estação), gerando sobrecarga de banco, latência HTTP no carregamento do painel e risco de throttling na API oficial da EcoFlow.

#### Desenho Oficial MQTT-First (Orientado a Eventos)
1. **Automação ATS em Tempo Real dentro de `EcoFlowMqttStreamService`:**
   - Ao receber qualquer pacote de telemetria no evento `message` (`handleIncomingMessage`), o `EcoFlowMqttStreamService` avalia imediatamente os gatilhos da ATS (`turnOnThreshold` / `turnOffThreshold`) em tempo real sem esperar por ciclos de cron.
   - **Cooldown anti-flap de `15s` (`15_000ms`):** Impede oscilações repetidas de ligar/desligar a saída AC durante variações rápidas de bateria/leitura.
   - **Cache de regras por `10s` (`10_000ms`):** Evita consultas repetitivas ao PostgreSQL a cada frame MQTT recebido; quando o usuário altera limiares ou liga/desliga a automação em `POST /api/automations`, a rota chama **`invalidateUserConfigCache(userId)`** para efeito imediato. Ao alterar credenciais, serial ou região em `POST /api/settings`, executa-se **reinício controlado do stream** (`stopStream(userId)` + `startForUser(...)`).
2. **Única Chamada HTTP EcoFlow `PUT` na Transição + Hidratação Pós-Boot:**
   - Durante operação normal com MQTT conectado, **zero** chamadas HTTP REST de polling são feitas à EcoFlow.
   - Uma chamada HTTP `PUT` (`EcoFlowHttpClient`) ocorre **exclusivamente** no instante em que há transição efetiva de estado `ON`/`OFF` da saída AC/ATS.
   - Em `startStreamFromRecord`, ocorre **uma única hidratação inicial pós-boot** para popular imediatamente `latestTelemetry` (incluindo `isAcOutputEnabled`, `batteryPercentage`, `solarInputWatts` e `outputWatts`) antes do próximo frame MQTT chegar.
3. **Redução de 30x na Escrita de `SyncExecutionLog` + Janela RAM de 5 Minutos:**
   - **`persistTelemetryThrottled`:** Intervalo ampliado de `2.000ms` para **`60.000ms` (1 minuto)** para gravação periódica de telemetria — reduzindo de ~43.200 para ~1.440 inserções/dia (**30x menos escrita em disco/PostgreSQL**).
   - **Gravação imediata em transições ATS:** Qualquer mudança real de estado (`ENABLE_ECOFLOW_AC` / `DISABLE_ECOFLOW_AC`) ignora o throttle de 60s, grava `SyncExecutionLog` imediatamente e dispara os alertas (Telegram/WhatsApp).
   - **`getLatestTelemetry(userId)`:** Janela de validade em memória RAM ampliada de `15.000ms` para **`300.000ms` (5 minutos)** para absorver intervalos silenciosos do broker sem perder a leitura instantânea.
4. **`LiveTelemetryService` MQTT-First:**
   - Quando `EcoFlowMqttStreamService.getInstance().isStreamConnected(userId)` for `true`, `syncIfStale` retorna **imediatamente** com **`0` chamadas HTTP REST `/quota/all`**.
   - Aciona **fallback HTTP com janela mínima de `90s` (`90_000ms`)** apenas se o stream MQTT cair ou não estiver conectado (respeitando `DISABLE_LOCAL_CRON=true`).
5. **Leitura Sub-Segundo Direto da RAM nas APIs do Painel:**
   - `GET /api/dashboard-status` e `GET /api/statistics` leem instantaneamente (sub-segundo) os valores ao vivo diretamente da RAM via `EcoFlowMqttStreamService.getInstance().getLatestTelemetry(userId)`, combinando com os dados históricos de `SyncExecutionLog` apenas para séries temporais e fallback quando o stream ainda não tem snapshot.
6. **Cron Reduzido para Watchdog MQTT de 5 Minutos (`WATCHDOG_INTERVAL_SECONDS=300`):**
   - Remoção definitiva do loop agressivo de `2s` contra `/api/sync` tanto no `docker-compose.yml` (`cron-scheduler`) quanto em `scripts/local-sync-daemon.js`.
   - O agendador passa a atuar exclusivamente como **Watchdog MQTT** (`WATCHDOG_INTERVAL_SECONDS=300`): aciona `GET /api/mqtt-stream` uma vez no **boot** e depois a cada **5 minutos (300s)** apenas para assegurar que os streams MQTT permaneçam conectados 24/7.

---

### 1.4 Lacunas de PWA e Fraturas de UX Mobile (`360px–430px`)

#### Lacunas PWA (Etapa 3)
- Ausência de `public/manifest.webmanifest` (`display: "standalone"`, `start_url: "/"`, `theme_color: "#020617"`, `background_color: "#020617"`).
- Ausência de ícones PNG dedicados (`192x192` e `512x512` `any` e `maskable` em `public/icons/` + `public/apple-touch-icon.png` `180x180`; atualmente `_document.tsx` referencia `/favicon.svg`).
- Ausência de `public/sw.js` com **bypass estrito `Network-Only` para `/api/*`** e fallback de navegação para `public/offline.html` autocontido.
- Ausência de diretivas CSP `manifest-src 'self'` e `worker-src 'self'` e headers de não-cache para `/sw.js` em `next.config.js`.
- Ausência de `viewport-fit=cover` (`_app.tsx`), meta tags standalone iOS/Android (`_document.tsx`) e componente contextual `src/components/PwaInstallPrompt.tsx`.

#### Fraturas de UX Mobile `360px–430px` (Etapa 4)
1. **Header Congestionado sem Bottom Navigation (`src/components/Layout.tsx`):** Header espreme logo + 4 rotas + Perfil + Sair em `360px`, ocultando rótulos e reduzindo alvos abaixo de `44x44px` → Introduzir **`Bottom Nav` fixa de 5 abas** (`Painel`, `Estatísticas`, `Automações`, `Credenciais`, `Perfil`) com `env(safe-area-inset-bottom)` e header compacto com `env(safe-area-inset-top)`.
2. **Tabelas de 5 e 7 Colunas com Scroll Horizontal (`src/pages/index.tsx` e `src/pages/statistics.tsx`):** Tabelas extensas exigem rolagem lateral desconfortável em `360px–430px` → Renderizar **Cards Mobile (`md:hidden`)** empilhados e legíveis mantendo `<table>` completa em `hidden md:block`.
3. **Gráfico SVG 30 Minutos Dependente de `mouseover` e Tooltip Estourado (`src/pages/statistics.tsx`):** Interação restrita a `onMouseEnter` e tooltip com `whitespace-nowrap` vazando da tela em `360px` → Suporte a **touch/click/teclado** (`onClick`/`onPointerDown`) nos pontos e painel de inspeção responsivo sem overflow lateral.
4. **Polling de UI Ativo em Aba Oculta (`src/pages/index.tsx` e `src/pages/statistics.tsx`):** Intervalo de `2s` rodando em background mesmo com tela bloqueada ou aba minimizada → Hook `useVisibilityPolling` pausando automaticamente em `document.hidden` ou offline e retomando ao voltar para `visible`/`online`.
5. **Inputs `< 16px` Causando Zoom Automático no iOS & Checkbox de Sessão (`login.tsx`, `register.tsx`, `settings.tsx`, `profile.tsx`, `automations.tsx`):** Inputs com `text-sm`/`text-xs` acionam auto-zoom no iOS Safari → Padronizar `text-base sm:text-sm` (`>= 16px` no mobile) + alvos `min-h-[44px]`, além de adicionar checkbox **"Manter conectado por 30 dias"** na tela de login (`src/pages/login.tsx`).

---

## 2. Checklist Estruturado de Execução em 4 Etapas

### Pré-Etapa — Governança de Branch & Isolamento de Ambiente (`GitOps`, `Maestro`, `PipelineForge`)
- [x] (`GitOps`) Checkout limpo da branch `feat/mobile-pwa-persistent-auth` a partir de `develop`.
- [x] (`Maestro`) Pausa da rotina agendada local do Maestri durante o ciclo de desenvolvimento e testes.
- [x] (`PipelineForge` / `ApexDev`) Desativação de `isAutomationActive = false` no PostgreSQL local para o serial real `R621ZBB6XG6K0937` e ativação de `DISABLE_LOCAL_CRON=true`.

---

### Etapa 1 — Cron Local Desativado (`DISABLE_LOCAL_CRON`) + Login Persistente 30 Dias
> **Estado Atual:** Infraestrutura e implementação concluídas na branch — aguardando exclusivamente conclusão do Quality Gate (`UnitTestEngine`, `E2EGuardian`, `Sentinel`, `Certifier`) e commit (`GitOps`).

**Responsáveis:** `ApexDev` (Backend/Auth/Context) + `PipelineForge` (Infra/Daemon/DB) + `PulseDesign` (Estados de UI offline)

- [x] (`PipelineForge` / `ApexDev`) Implementar trava `DISABLE_LOCAL_CRON=true` em `.env.example`, `docker-compose.yml` (`cron-scheduler`), `scripts/local-sync-daemon.js`, `src/pages/api/sync.ts`, `src/pages/api/mqtt-stream.ts` e `src/infrastructure/services/LiveTelemetryService.ts`.
- [x] (`ApexDev`) Migrar cookie `wattflow_session` em `src/infrastructure/auth/sessionHelper.ts` para **`SameSite=Lax`**, mantendo `HttpOnly`, `Path=/`, `Secure` (prod) e `enforceCsrfProtection` em todas as rotas mutáveis.
- [x] (`ApexDev`) Ampliar TTL de sessão de 7 para **30 dias** (`2592000s`) em `src/domain/services/AuthenticationTokenService.ts` e `sessionHelper.ts` com emissão explícita de `Max-Age` + `Expires` (`UTCString`), e implementar *sliding refresh* em `GET /api/auth/me` respeitando `tokenVersion` (além de alinhamento nos endpoints `/api/auth/login`, `/api/auth/login-2fa`, `/api/auth/register`, `/api/auth/2fa`, `/api/auth/change-password` e `/api/auth/profile`).
- [x] (`ApexDev`) Refatorar `src/context/AuthContext.tsx` com cache não-sensível em `localStorage`, preservação da sessão em erros de rede/offline/`5xx`, redirect para `/login` apenas em `401` / `isAuthenticated: false` confirmado, limpeza no `logout` e revalidação automática nos eventos `online` e `visibilitychange`.
- [ ] **Portão de Testes, Auditoria & Commit — Etapa 1 (100% Obrigatório):**
  - [ ] (`UnitTestEngine`) Aprovar **100%** dos testes unitários cobrindo `DISABLE_LOCAL_CRON=true`, cookie `SameSite=Lax` + `Max-Age` + `Expires` (30d), *sliding refresh* em `/api/auth/me`, respeito a `tokenVersion` e resiliência offline em `AuthContext`.
  - [ ] (`E2EGuardian`) Aprovar **100%** dos testes E2E de persistência de sessão pós-login, sobrevivência em modo offline (`setOffline(true)`) sem redirect indevido para `/login` e revogação real no logout.
  - [ ] (`Sentinel`) Code Review completo do diff da Etapa 1 (CSRF, `tokenVersion`, zero dados sensíveis em `localStorage`, Object Calisthenics) com parecer **`[APROVADO]`**.
  - [ ] (`Certifier`) Homologação funcional da Etapa 1 com parecer **`[CERTIFICADO]`**.
  - [ ] (`GitOps`) Executar commit da Etapa 1 somente após os 4 sinais verdes acima: `feat(auth): implementar sessao persistente de 30 dias, resiliencia offline e trava DISABLE_LOCAL_CRON`

**Critérios de Aceite (DoD — Etapa 1):**
1. **100%** da suíte unitária (`npm test`) e E2E (`npm run test:e2e`) verde, `npm run lint` e `npm run build` sem erros.
2. Comprovado que `DISABLE_LOCAL_CRON=true` bloqueia qualquer disparo automático local contra o serial `R621ZBB6XG6K0937`.
3. Aprovações formais de `Sentinel` (`[APROVADO]`) e `Certifier` (`[CERTIFICADO]`) registradas antes do commit.

---

### Etapa 2 — Arquitetura MQTT-First Orientada a Eventos (Eliminação do Polling HTTP de 2s)
**Responsáveis:** `ApexDev` (EcoFlowMqttStreamService, LiveTelemetryService, APIs) + `PipelineForge` (Watchdog 5 min em Docker/Daemon)

- [ ] (`ApexDev`) Implementar motor de **automação ATS em tempo real** dentro de `src/infrastructure/services/EcoFlowMqttStreamService.ts` ao receber pacotes MQTT (`handleIncomingMessage`), com **cooldown anti-flap de `15s` (`15_000ms`)** por usuário e **cache das regras de automação por `10s` (`10_000ms`)**.
- [ ] (`ApexDev`) Expor e integrar **`invalidateUserConfigCache(userId)`** em `src/pages/api/automations.ts` (aplicação instantânea ao salvar limiares ou status da automação) e **reinício controlado do stream** (`stopStream(userId)` + `startForUser(...)`) em `src/pages/api/settings.ts` ao alterar credenciais/serial/região EcoFlow.
- [ ] (`ApexDev`) Garantir **única chamada HTTP EcoFlow `PUT`** estritamente quando houver transição real de estado `ON`/`OFF` da saída AC/ATS, adicionando **hidratação inicial pós-boot** em `startStreamFromRecord` para popular `latestTelemetry` e o estado inicial de `isAcOutputEnabled`.
- [ ] (`ApexDev`) Aplicar **redução de 30x** na escrita periódica de `SyncExecutionLog`: ampliar `persistTelemetryThrottled` para **`60_000ms` (1 minuto)** em leituras regulares, manter **gravação imediata sem throttle em qualquer transição ATS** (com disparo de notificações Telegram/WhatsApp) e ampliar a janela de `getLatestTelemetry(userId)` para **`300_000ms` (5 minutos)**.
- [ ] (`ApexDev`) Refatorar `src/infrastructure/services/LiveTelemetryService.ts` para arquitetura **MQTT-First**: retorno imediato quando `isStreamConnected(userId)` for `true` (**`0` chamadas HTTP REST `/quota/all`**), utilizando **fallback HTTP de `90s` (`90_000ms`)** somente se o stream MQTT cair.
- [ ] (`ApexDev`) Atualizar `src/pages/api/dashboard-status.ts` e `src/pages/api/statistics.ts` para **leitura sub-segundo direto da RAM** via `EcoFlowMqttStreamService.getInstance().getLatestTelemetry(userId)`, mantendo o banco apenas para histórico de gráficos/logs e fallback pós-boot.
- [ ] (`PipelineForge` / `ApexDev`) Reduzir o agendador em `docker-compose.yml` (`cron-scheduler`) e `scripts/local-sync-daemon.js` para **Watchdog MQTT de 5 minutos (`WATCHDOG_INTERVAL_SECONDS=300`)**, chamando `/api/mqtt-stream` uma vez no **boot** e a cada **5 minutos** (eliminando o loop de `2s` sobre `/api/sync`, preservando `DISABLE_LOCAL_CRON=true` no ambiente local).
- [ ] **Portão de Testes, Auditoria & Commit — Etapa 2 (100% Obrigatório):**
  - [ ] (`UnitTestEngine`) Aprovar **100%** dos testes unitários cobrindo: avaliação ATS em pacote MQTT, cooldown anti-flap de `15s`, cache de `10s` + `invalidateUserConfigCache`, hidratação inicial em `startStreamFromRecord`, `PUT` exclusivo em transição real, throttle de `60_000ms` vs gravação imediata de transição, janela `getLatestTelemetry` de `300_000ms`, `LiveTelemetryService` MQTT-First (`0` chamadas REST conectado / fallback `90s` desconectado) e leitura RAM em `/api/dashboard-status` e `/api/statistics`.
  - [ ] (`E2EGuardian`) Aprovar **100%** dos testes E2E validando carregamento sub-segundo do painel/estatísticas, `docker compose config` com `WATCHDOG_INTERVAL_SECONDS=300` e zero regressão nos fluxos de `/automations` e `/settings`.
  - [ ] (`Sentinel`) Code Review completo da Etapa 2 (segurança multi-tenant, prevenção de race conditions/flap na ATS, conformidade Object Calisthenics) com parecer **`[APROVADO]`**.
  - [ ] (`Certifier`) Homologação funcional da Etapa 2 com parecer **`[CERTIFICADO]`**.
  - [ ] (`GitOps`) Commit da Etapa 2 após aprovação unânime dos portões: `feat(telemetry): migrar para arquitetura MQTT-First orientada a eventos com watchdog de 5m`

**Critérios de Aceite (DoD — Etapa 2):**
1. **100%** dos testes unitários (`npm test`) e E2E (`npm run test:e2e`) aprovados, `npm run lint` e `npm run build` limpos.
2. Zero chamadas HTTP REST `/quota/all` durante operação normal com stream MQTT conectado; redução de 30x nas escritas periódicas em `SyncExecutionLog`; Watchdog configurado em `300s`.
3. Aprovações formais de `Sentinel` (`[APROVADO]`) e `Certifier` (`[CERTIFICADO]`) registradas antes do commit.

---

### Etapa 3 — App PWA Completo
**Responsáveis:** `PixelCraft` (Manifest, Ícones PNG, `offline.html`, `PwaInstallPrompt`, `_app.tsx`, `_document.tsx`) + `ApexDev` & `PipelineForge` (`sw.js`, CSP e headers `next.config.js`) + `PulseDesign` (Direção visual de ícones e microcopy PWA)

- [ ] (`PixelCraft` / `PulseDesign`) Criar `public/manifest.webmanifest` completo em `pt-BR` (`display: "standalone"`, `start_url: "/"`, `scope: "/"`, `theme_color: "#020617"`, `background_color: "#020617"`).
- [ ] (`PixelCraft` / `PulseDesign`) Gerar ícones PNG dedicados: `public/icons/icon-192x192.png` (`any`), `public/icons/icon-512x512.png` (`any`), `public/icons/icon-maskable-192x192.png` (`maskable` com safe-zone 80%), `public/icons/icon-maskable-512x512.png` (`maskable`) e `public/apple-touch-icon.png` (`180x180`).
- [ ] (`ApexDev` / `PixelCraft`) Implementar `public/sw.js` com cache estático versionado (`wattflow-static-v1`), **bypass estrito `Network-Only` para todas as rotas `/api/*` e métodos não-GET**, e fallback de navegação para `public/offline.html`.
- [ ] (`PixelCraft` / `PulseDesign`) Criar `public/offline.html` autocontido (CSS inline, zero dependências externas, tema `slate-950`/`emerald-400`, botão "Tentar Novamente" e listener `online`).
- [ ] (`PipelineForge` / `ApexDev`) Atualizar `next.config.js` adicionando diretivas CSP `manifest-src 'self'` e `worker-src 'self'` e headers de não-cache para `/sw.js` (`Cache-Control: no-cache, no-store, must-revalidate`, `Service-Worker-Allowed: /`).
- [ ] (`PixelCraft` / `PulseDesign`) Atualizar `src/pages/_app.tsx` (`viewport-fit=cover` + registro seguro de `/sw.js`), `src/pages/_document.tsx` (links de manifest, `apple-touch-icon.png` `180x180`, meta tags standalone iOS/Android) e criar `src/components/PwaInstallPrompt.tsx` (Chromium `beforeinstallprompt` + guia iOS Safari + cooldown em `localStorage`).
- [ ] **Portão de Testes, Auditoria & Commit — Etapa 3 (100% Obrigatório):**
  - [ ] (`UnitTestEngine`) Aprovar **100%** dos testes unitários validando CSP (`manifest-src`, `worker-src`), schema/caminhos de `public/manifest.webmanifest`, existência dos ícones PNG, regra de bypass `Network-Only` em `/api/*` do `sw.js` e lógica do `PwaInstallPrompt`.
  - [ ] (`E2EGuardian`) Aprovar **100%** dos testes E2E verificando carregamento de `/manifest.webmanifest` sem erro CSP, registro ativo de `/sw.js`, **zero** entradas `/api/*` na Cache Storage após uso autenticado, fallback para `/offline.html` quando offline e comportamento do `PwaInstallPrompt`.
  - [ ] (`Sentinel`) Auditoria de segurança do `sw.js` (zero cache de dados autenticados/sensíveis) e `next.config.js` com parecer **`[APROVADO]`**.
  - [ ] (`Certifier`) Homologação de instalabilidade PWA e checklist de segurança com parecer **`[CERTIFICADO]`**.
  - [ ] (`GitOps`) Commit da Etapa 3 após aprovação unânime dos portões: `feat(pwa): adicionar manifest, icones maskable, service worker seguro, offline fallback e prompt de instalacao`

**Critérios de Aceite (DoD — Etapa 3):**
1. **100%** dos testes unitários (`npm test`) e E2E (`npm run test:e2e`) aprovados, `npm run lint` e `npm run build` limpos.
2. Zero violações CSP no console; zero rotas `/api/*` cacheadas pelo Service Worker.
3. Aprovações formais de `Sentinel` (`[APROVADO]`) e `Certifier` (`[CERTIFICADO]`) registradas antes do commit.

---

### Etapa 4 — Reavaliação & Overhaul Mobile UX (`360px–430px`)
**Responsáveis:** `PulseDesign` (Arquitetura Mobile, Bottom Nav 5 abas, Ergonomia `>= 44px`, Microcopy) + `PixelCraft` (Componentes Responsivos, Cards, Gráfico Touch, Inputs `>= 16px`, Checkbox 30 dias) + `ApexDev` (`useVisibilityPolling` e parâmetro `rememberMe`) + `E2EGuardian` (`e2e/mobile-pwa.spec.ts`)

- [ ] (`PulseDesign` / `PixelCraft`) Reavaliar o fluxo completo em smartphones (`360px–430px`) e implementar **`Bottom Nav` fixa de 5 abas** no mobile (`Painel`, `Estatísticas`, `Automações`, `Credenciais`, `Perfil`) em `src/components/Layout.tsx`, com safe-areas (`env(safe-area-inset-top)` / `env(safe-area-inset-bottom)`), alvos `>= 44x44px` e header mobile desobstruído, preservando o layout desktop (`>= md`).
- [ ] (`PixelCraft` / `PulseDesign`) Substituir o scroll horizontal das tabelas de 5 colunas (`src/pages/index.tsx`) e 7 colunas (`src/pages/statistics.tsx`) por **Cards Mobile (`md:hidden`)**, mantendo a `<table>` completa em `hidden md:block`.
- [ ] (`PixelCraft` / `PulseDesign`) Refatorar o gráfico SVG de 30 minutos (`src/pages/statistics.tsx`) adicionando interação por **touch/click/teclado** (`onClick`/`onPointerDown`/`onKeyDown`) nos pontos de 5 em 5 minutos e painel de inspeção responsivo **sem tooltip `whitespace-nowrap` estourando a tela**.
- [ ] (`ApexDev` / `PixelCraft`) Criar e adotar `src/hooks/useVisibilityPolling.ts` em `src/pages/index.tsx` e `src/pages/statistics.tsx` para **pausar automaticamente o polling em background** (`document.visibilityState === "hidden"` ou offline) e retomar imediatamente ao retornar ao foco (`visible`/`online`).
- [ ] (`PixelCraft` / `PulseDesign`) Padronizar **inputs `>= 16px`** (`text-base sm:text-sm`) e controles `min-h-[44px]` em `login.tsx`, `register.tsx`, `settings.tsx` (incluindo modal de confirmação), `profile.tsx` e `automations.tsx` para eliminar zoom automático no iOS Safari.
- [ ] (`PixelCraft` / `ApexDev` / `PulseDesign`) Adicionar checkbox **"Manter conectado por 30 dias"** em `src/pages/login.tsx` (marcado por padrão) integrado a `/api/auth/login` e `/api/auth/login-2fa` (emitindo cookie persistente de 30 dias com `Max-Age` + `Expires` quando marcado, ou cookie de sessão quando desmarcado).
- [ ] (`E2EGuardian`) Criar a suíte dedicada **`e2e/mobile-pwa.spec.ts`** validando integralmente viewports `360x800`, `390x844` e `430x932` (Bottom Nav de 5 abas, zero overflow horizontal `scrollWidth <= innerWidth` em todas as rotas, Cards Mobile `md:hidden`, toque no gráfico 30min sem estouro de tooltip, pause de polling em background, inputs `>= 16px`, checkbox "Manter conectado por 30 dias", PWA manifest/SW e sobrevivência offline).
- [ ] **Portão de Testes, Auditoria & Commit — Etapa 4 (100% Obrigatório):**
  - [ ] (`UnitTestEngine`) Aprovar **100%** dos testes unitários cobrindo `useVisibilityPolling`, `BottomNav` (5 abas), flag `rememberMe` ("Manter conectado por 30 dias") nas APIs de login/sessão e componentes responsivos.
  - [ ] (`E2EGuardian`) Aprovar **100%** de `e2e/mobile-pwa.spec.ts` e de toda a suíte E2E desktop + mobile (`npm run test:e2e`).
  - [ ] (`Sentinel`) Auditoria final de código, acessibilidade ARIA, segurança e diff consolidado das 4 etapas com parecer **`[APROVADO]`**.
  - [ ] (`Certifier`) Certificação final de release das 4 Etapas com parecer **`[CERTIFICADO]`**.
  - [ ] (`GitOps`) Commit da Etapa 4 após aprovação unânime dos portões: `feat(mobile): implementar overhaul UX mobile, bottom nav 5 abas, manter conectado e suite e2e mobile-pwa`

**Critérios de Aceite (DoD — Etapa 4 & Fechamento da Branch):**
1. **100%** dos testes unitários (`npm test`) e E2E (`npm run test:e2e`, incluindo `e2e/mobile-pwa.spec.ts`) aprovados, `npm run lint` e `npm run build` limpos.
2. Zero overflow horizontal em `360px–430px` em todas as rotas, zero zoom automático em inputs no iOS, polling pausado em aba oculta comprovado e zero regressão desktop.
3. Aprovações formais de `Sentinel` (`[APROVADO]`) e `Certifier` (`[CERTIFICADO]`) registradas antes do commit final.
