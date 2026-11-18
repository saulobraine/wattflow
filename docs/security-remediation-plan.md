# Plano Mestre de Remediação e Hardening de Segurança — WattFlow

- **Orquestrador:** Maestro
- **Origem:** Relatório [security-audit-report.md](./security-audit-report.md) (SEC-01 a SEC-14 + Infra PipelineForge)
- **Branch de Trabalho:** `fix/security-hardening` (derivada de `develop`)
- **Regra de Ouro:** Nenhuma etapa avança para commit sem **100% de aprovação** em testes unitários, integração/E2E, Code Review (`Sentinel`) e QA (`Certifier`). Nenhum deploy em produção sem autorização expressa de Baggute.

---

## Pré-Etapa — Setup de Branch (`GitOps`)
- [x] Atualizar `develop` com `origin/develop`.
- [x] Criar e fazer checkout da branch `fix/security-hardening`.

---

## Etapa 1 — Crítico: Segredos, SSRF & Hardening de Infraestrutura
**Itens:** `SEC-02`, `SEC-04`, `INF-01`, `INF-02`
**Responsáveis:** `ApexDev` (Backend/Daemon) + `PipelineForge` (Docker/CI/CD)
- [x] **SEC-02:** Remover todos os fallbacks hardcoded de `AUTH_SECRET` e `CRON_SECRET_TOKEN` (`sessionHelper.ts`, `mqtt-stream.ts`, `local-sync-daemon.js`, `docker-compose.yml`). Validar entropia mínima de 32 bytes na inicialização.
- [x] **SEC-04:** Validar `ecoflowEndpointRegion` contra allowlist oficial (`https://api.ecoflow.com`, `https://api-e.ecoflow.com`) na API (`/api/settings`, `/api/test-control`) e no daemon. Restringir broker MQTT a `mqtts`, porta `8883` e hosts `*.ecoflow.com`.
- [x] **INF-01 & INF-02:** Remover `cp .env.example .env` do `deploy.yml` (falhar se `.env` ausente), passar secrets via `env:` no SSH action, adicionar `permissions: contents: read` e remover `--accept-data-loss` do `docker-entrypoint.sh`.
- [x] **Portão de Testes (100%):**
  - `UnitTestEngine`: Testes unitários de falha sem env secrets e bloqueio de SSRF/domínios inválidos.
  - `E2EGuardian`: Validação de `docker compose config` e build/boot sem regressão.
  - `Sentinel`: Code Review do diff.
  - `Certifier`: Validação de aceite da Etapa 1.
- [x] **Commit (`GitOps`):** `fix(security): remover fallbacks de segredos e blindar SSRF e CI/CD`

---

## Etapa 2 — Crítico: Correção de Bypass 2FA/TOTP e Criptografia BYOK em Repouso
**Itens:** `SEC-01`, `SEC-03`
**Responsáveis:** `ApexDev` (Crypto/Backend/Prisma) + `PixelCraft` (UI Login 2FA & Settings)
- [x] **SEC-01:** Bloquear emissão de sessão definitiva no `POST /api/auth/login` quando `twoFactorEnabled === true`. Emitir token de desafio (`scope: "2fa_challenge"`, TTL 5m) e validar código TOTP em `/api/auth/login-2fa`. Persistir segredo pendente no `SETUP`, exigir `currentPassword` para alterar/ativar 2FA e rejeitar segredos `< 16 bytes` no `totpHelper.ts`.
- [x] **SEC-03:** Implementar criptografia `AES-256-GCM` (`ENCRYPTION_KEY`) para segredos no PostgreSQL (`ecoflowAccessSecret`, `tuyaAccessSecret`, `telegramBotToken`, `whatsappApiKey`, `twoFactorSecret`). Ocultar segredos em texto claro no `GET /api/settings` (retornar flags `has*` e máscara final) + `Cache-Control: no-store`.
- [x] **UI (`PixelCraft`):** Adaptar tela de login para etapa de código 2FA e adaptar `/settings` para lidar com chaves mascaradas.
- [x] **Portão de Testes (100%):**
  - `UnitTestEngine`: Testes unitários de `AES-256-GCM`, fluxo TOTP completo, bloqueio de bypass e mascaramento.
  - `E2EGuardian`: Fluxo E2E de login com 2FA ativo e verificação visual de segredos mascarados em `/settings`.
  - `Sentinel`: Code Review do diff.
  - `Certifier`: Homologação funcional.
- [x] **Commit (`GitOps`):** `fix(auth): corrigir bypass de 2FA e cifrar credenciais BYOK em repouso`

---

## Etapa 3 — Alto: TLS MQTT, Passkeys, Rate Limiting, Isolamento Multi-Tenant e Sessões
**Itens:** `SEC-05`, `SEC-06`, `SEC-07`, `SEC-08`, `SEC-09`
**Responsáveis:** `ApexDev` + `PixelCraft`
- [x] **SEC-05:** Habilitar `rejectUnauthorized: true` em `EcoFlowMqttStreamService.ts` e `local-sync-daemon.js`.
- [x] **SEC-06:** Remover fluxo simulado de Passkeys (ou implementar validação FIDO2 completa com `@simplewebauthn/server` e challenge persistido).
- [x] **SEC-07:** Implementar Rate Limiting (IP + conta) em `/api/auth/*`, `/api/test-control` (cooldown AC/ATS) e `/api/test-notification`. Trocar `scryptSync` por `crypto.scrypt` assíncrono, exigir senha 12-128 chars e flag `ALLOW_PUBLIC_REGISTRATION` (default `false`).
- [x] **SEC-08:** Refatorar `EcoFlowMqttStreamService` e `LiveTelemetryService` para escopo isolado por `userId` (`Map<string, ...>`).
- [x] **SEC-09:** Adicionar `tokenVersion` no modelo `User` validado a cada request e incrementado em logout, troca de senha, troca de e-mail e 2FA. Exigir `currentPassword` no `PATCH /api/auth/profile` ao alterar e-mail.
- [x] **Portão de Testes (100%):**
  - `UnitTestEngine`: Testes de rate limit, isolamento de estado multi-tenant, revogação via `tokenVersion` e política de senha.
  - `E2EGuardian`: Testes E2E de bloqueio por tentativas, invalidação de sessão pós-logout e troca de e-mail.
  - `Sentinel`: Code Review do diff.
  - `Certifier`: Homologação.
- [x] **Commit (`GitOps`):** `fix(security): habilitar TLS estrito, rate limit, isolamento multi-tenant e revogacao de sessao`

---

## Etapa 4 — Médio & Baixo: CSRF, Schemas Zod, Anti-Replay, Timeouts e Security Headers
**Itens:** `SEC-10`, `SEC-11`, `SEC-12`, `SEC-13`, `SEC-14`
**Responsáveis:** `ApexDev` + `PipelineForge`
- [ ] **SEC-10:** Restringir `/api/auth/logout` e `/api/sync` (sessão) para `POST`, cookie `SameSite=Strict`, validação de `Origin`/`Host`.
- [ ] **SEC-11:** `try/catch` em `decodeURIComponent`/`JSON.parse`, validação Zod com `maxLength` nos bodies das APIs, `escapeHtml()` em notificações Telegram.
- [ ] **SEC-12:** Aceitar `CRON_SECRET_TOKEN` apenas via header (`Authorization: Bearer` / `x-cron-token`), usar `crypto.timingSafeEqual` (hashes SHA-256) e persistir `lastTotpCounter` contra replay TOTP.
- [ ] **SEC-13:** `AbortSignal.timeout(8000)` em todos os `fetch()` externos; Security Headers em `next.config.js` (CSP, `X-Frame-Options: DENY`, `HSTS`, `X-Content-Type-Options: nosniff`).
- [ ] **SEC-14:** Dummy `scrypt` no login contra enumeração por timing, sanitização de mensagens 500, remoção de `console.log` bruto EcoFlow, `Dockerfile` com `npm ci` e permissões não-root.
- [ ] **Portão de Testes (100%):**
  - `UnitTestEngine`: Suíte completa unitária e integração (Zod, `escapeHtml`, `timingSafeEqual`, anti-replay, headers HTTP, rejeição GET).
  - `E2EGuardian`: Regressão E2E completa de toda a aplicação.
  - `Sentinel`: Auditoria final de código (`[APROVADO]`).
  - `Certifier`: Certificação final de release.
- [ ] **Commit (`GitOps`):** `fix(security): hardening HTTP, CSRF, Zod schemas, timingSafeEqual e resiliencia`
