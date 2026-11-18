# Relatório de Auditoria de Segurança — WattFlow

- **Auditor:** Sentinel (Code Reviewer & Security Auditor)
- **Parecer Técnico:** `[ALTERAÇÕES SOLICITADAS]`
- **Escopo Auditado:**
  1. Autenticação, sessões, tokens HMAC/JWT, Passkeys (WebAuthn) e 2FA/TOTP (`src/infrastructure/auth/**`, `src/domain/**`, `src/pages/api/auth/**`)
  2. Proteção de endpoints e APIs (`src/pages/api/**`)
  3. Prevenção de SSRF e chamadas externas (`src/infrastructure/http/**`, `src/infrastructure/services/**`, `src/infrastructure/notifications/**`, `scripts/**`)
  4. Injeção, sanitização de inputs e validação de schemas (`prisma/schema.prisma`, `src/domain/values/**`, `src/pages/api/**`)
  5. Vazamento de segredos, logs sensíveis, tokens expostos no client-side e infraestrutura (`src/pages/**`, `.env*`, `Dockerfile`, `docker-compose.yml`, `docker-entrypoint.sh`)

---

## Sumário Executivo (SEC-01 a SEC-14)

| ID | Severidade | Módulo / Arquivo | Descrição Resumida |
| :--- | :--- | :--- | :--- |
| **SEC-01** | **Crítico** | Auth / 2FA — `src/pages/api/auth/login.ts` (`L49-L85`), `src/pages/api/auth/2fa.ts` (`L66-L126`), `src/infrastructure/auth/totpHelper.ts` (`L27-L58`) | Bypass total de 2FA no login (emite sessão sem cobrar TOTP), sobrescrita de 2FA ativo sem senha e aceite de `secret` arbitrário do cliente. |
| **SEC-02** | **Crítico** | Sessão / Cron — `src/infrastructure/auth/sessionHelper.ts` (`L8-L11`), `src/pages/api/mqtt-stream.ts` (`L9-L13`), `docker-compose.yml` (`L52-L53`) | Segredos estáticos hardcoded de fallback para `AUTH_SECRET` e `CRON_SECRET_TOKEN`, permitindo forjar sessões HMAC e acionar rotas internas. |
| **SEC-03** | **Crítico** | Credenciais BYOK — `src/pages/api/settings.ts` (`L55-L73`), `src/pages/settings.tsx` (`L146-L152`), `prisma/schema.prisma` (`L46-L60`) | Retorno em texto claro de todas as chaves secretas (EcoFlow, Telegram, WhatsApp) no `GET /api/settings` e armazenamento sem criptografia no PostgreSQL. |
| **SEC-04** | **Crítico** | SSRF / Integrações — `src/pages/api/settings.ts` (`L118-L130`), `scripts/local-sync-daemon.js` (`L30-L80`), `src/infrastructure/services/EcoFlowMqttStreamService.ts` (`L113-L134`) | Stored SSRF e exfiltração de credenciais via `ecoflowEndpointRegion` não validado no banco/daemon e URL de broker MQTT construída sem allowlist. |
| **SEC-05** | **Alto** | Transporte MQTT — `src/infrastructure/services/EcoFlowMqttStreamService.ts` (`L126-L134`), `scripts/local-sync-daemon.js` (`L72-L80`) | Verificação de certificado TLS desabilitada (`rejectUnauthorized: false`), expondo credenciais MQTT e telemetria a ataques MitM. |
| **SEC-06** | **Alto** | Auth / WebAuthn — `src/pages/api/auth/passkey.ts` (`L78-L144`), `src/pages/profile.tsx` (`L277-L348`) | Fluxo de Passkeys incompleto/simulado: `challenge` não é persistido e o registro não valida assinatura, `attestationObject`, `origin` ou `rpId`. |
| **SEC-07** | **Alto** | APIs / Auth — `src/pages/api/auth/login.ts` (`L18-L85`), `src/pages/api/auth/register.ts` (`L17-L98`), `src/pages/api/test-control.ts` (`L25-L121`), `src/domain/values/RawPassword.ts` (`L15-L19`) | Ausência de rate limiting em login, TOTP, registro público e controle AC/ATS, somada a senha mínima de 6 caracteres e `scryptSync` bloqueante sem teto. |
| **SEC-08** | **Alto** | Isolamento Multi-Tenant — `src/infrastructure/services/EcoFlowMqttStreamService.ts` (`L40-L88`), `src/infrastructure/services/LiveTelemetryService.ts` (`L6-L60`) | Singleton global MQTT (`findFirst`) e variáveis globais de módulo (`inFlightSync`/`lastSyncTimeMs`) compartilhando estado e telemetria entre usuários distintos. |
| **SEC-09** | **Alto** | Ciclo de Sessão — `src/domain/services/AuthenticationTokenService.ts` (`L29-L77`), `src/pages/api/auth/logout.ts` (`L4-L10`), `src/pages/api/auth/profile.ts` (`L97-L166`) | Tokens stateless válidos por 7 dias sem revogação server-side em logout/troca de senha, e alteração de e-mail em `PATCH /api/auth/profile` sem exigir senha. |
| **SEC-10** | **Médio** | Proteção CSRF — `src/infrastructure/auth/sessionHelper.ts` (`L43-L52`), `src/pages/api/sync.ts` (`L17-L62`), `src/pages/api/auth/logout.ts` (`L4-L10`) | Falta de verificação anti-CSRF/`Origin`, cookie `SameSite=Lax` e aceite de `GET` em rotas com efeito colateral (`/api/sync` e `/api/auth/logout`). |
| **SEC-11** | **Médio** | Parsing / Schemas — `src/infrastructure/auth/sessionHelper.ts` (`L66`), `src/domain/services/AuthenticationTokenService.ts` (`L67-L76`), `src/infrastructure/notifications/NotificationDispatcher.ts` (`L119-L123`) | `decodeURIComponent`/`JSON.parse` sem `try/catch` (causando HTTP 500), ausência de validação de schema/tamanho máximo nos bodies e HTML não escapado no Telegram. |
| **SEC-12** | **Médio** | Criptografia / Tokens — `src/pages/api/sync.ts` (`L31-L35`), `src/infrastructure/auth/totpHelper.ts` (`L83-L98`), `docker-compose.yml` (`L89`) | Comparação não-constante (`===`) em segredos de Cron e TOTP, ausência de proteção contra replay TOTP na janela de 90s e envio de `CRON_SECRET_TOKEN` via query string. |
| **SEC-13** | **Médio** | Resiliência / HTTP — `src/infrastructure/http/EcoFlowHttpClient.ts` (`L130-L456`), `src/infrastructure/notifications/NotificationDispatcher.ts` (`L116-L153`), `next.config.js` (`L1-L10`) | Requisições externas `fetch()` sem timeout (`AbortSignal`) e ausência de Security Headers HTTP (`CSP`, `X-Frame-Options`, `HSTS`, `X-Content-Type-Options`). |
| **SEC-14** | **Baixo** | Erros / Logs / Deploy — `src/pages/api/auth/register.ts` (`L50-L56`), `src/pages/api/sync.ts` (`L70-L75`), `src/infrastructure/http/EcoFlowHttpClient.ts` (`L467`), `docker-entrypoint.sh` (`L14-L19`) | Enumeração de contas (409/timing), exposição de `error.message` bruto em 500, log integral de resposta da API e `prisma db push --accept-data-loss` no boot. |

---

## Detalhamento Técnico por Severidade

## 1. Severidade: CRÍTICO

### [SEC-01] Bypass Total de 2FA/TOTP no Login e Sobrescrita de Segredo 2FA Sem Validação
- **Arquivos e Linhas:**
  - `src/pages/api/auth/login.ts` (`L49-L85`, emissão direta do cookie em `L72-L75`)
  - `src/pages/api/auth/2fa.ts` (`SETUP` em `L66-L90`, `VERIFY_AND_ENABLE` em `L92-L126`)
  - `src/infrastructure/auth/totpHelper.ts` (`L27-L58`)
- **Análise Técnica:**
  1. Em `src/pages/api/auth/login.ts`, após validar `passwordHash` (`matchesRawPassword`), o handler cria imediatamente o token definitivo de sessão e define o cookie `wattflow_session` sem consultar `user.twoFactorEnabled` ou exigir código TOTP. O status "2FA Ativo" exibido em `src/pages/profile.tsx` (`L424`, `L638`) não impõe barreira alguma na autenticação.
  2. Em `src/pages/api/auth/2fa.ts` (`L92-L116`), a etapa `SETUP` não salva o segredo pendente no servidor; `VERIFY_AND_ENABLE` aceita o parâmetro `secret` enviado pelo cliente no corpo da requisição, não solicita confirmação de senha atual e não verifica se `user.twoFactorEnabled` já está habilitado (permitindo sobrescrever um 2FA ativo).
  3. Em `src/infrastructure/auth/totpHelper.ts` (`L42-L57`), `decodeBase32` ignora caracteres fora do alfabeto Base32; entradas sem caracteres Base32 válidos produzem `Buffer.alloc(0)` (chave HMAC vazia).
- **Impacto:** Comprometimento integral de contas com 2FA ativo apenas com credenciais primárias; substituição silenciosa do segredo TOTP em sessões comprometidas.
- **Recomendação de Correção:**
  - Verificar `user.twoFactorEnabled` em `/api/auth/login`: se ativo, emitir apenas token temporário de pré-autenticação (`scope: "2fa_challenge"`, TTL de 5 minutos) e exigir verificação em endpoint dedicado (`/api/auth/login-2fa`) antes de emitir `wattflow_session`.
  - Persistir o segredo TOTP temporário criptografado no banco durante `SETUP`, bloquear `VERIFY_AND_ENABLE` caso `twoFactorEnabled` já seja `true`, exigir `currentPassword` para ativar/alterar 2FA e rejeitar segredos decodificados com menos de 16 bytes.

---

### [SEC-02] Segredos Hardcoded de Fallback (`AUTH_SECRET` e `CRON_SECRET_TOKEN`)
- **Arquivos e Linhas:**
  - `src/infrastructure/auth/sessionHelper.ts` (`L8-L11`)
  - `src/pages/api/mqtt-stream.ts` (`L9-L13`)
  - `scripts/local-sync-daemon.js` (`L11-L14`)
  - `docker-compose.yml` (`L52-L53`, `L80`)
  - `.env` (`L12-L13`)
- **Análise Técnica:**
  - `getAuthenticationTokenService()` define `process.env.AUTH_SECRET || "wattflow_secure_authentication_secret_key_32chars"`, e `docker-compose.yml` (`L52`) define `${AUTH_SECRET:-wattflow_secure_production_auth_secret_key_random_64_bits_abc123}` (idêntico ao `.env` local). Como o token de sessão (`AuthenticationTokenService.ts`) é um payload JSON assinado por HMAC-SHA256, qualquer agente que conheça o segredo default pode gerar tokens válidos para qualquer `userId`.
  - `src/pages/api/mqtt-stream.ts` (`L9`), `scripts/local-sync-daemon.js` (`L11`) e `docker-compose.yml` (`L53`, `L80`) usam fallback `"wattflow_secret_token_123"`.
- **Impacto:** Falsificação offline de sessões arbitrárias (Account Takeover total) e invocação não autorizada do stream/telemetria caso variáveis de ambiente não sejam explicitamente customizadas em produção.
- **Recomendação de Correção:**
  - Remover todos os valores de fallback no código-fonte e no `docker-compose.yml` (utilizar `${AUTH_SECRET:?AUTH_SECRET obrigatorio}` e `${CRON_SECRET_TOKEN:?CRON_SECRET_TOKEN obrigatorio}`).
  - Validar na inicialização que `AUTH_SECRET` possui ao menos 32 bytes de entropia criptográfica, abortando o boot caso ausente ou fraco.

---

### [SEC-03] Exposição de Chaves Secretas BYOK em Texto Claro na API/Client e Ausência de Criptografia em Repouso
- **Arquivos e Linhas:**
  - `src/pages/api/settings.ts` (`L55-L73`)
  - `src/pages/settings.tsx` (`L146-L152`, `L395-L417`, `L491-L512`, `L605-L626`)
  - `prisma/schema.prisma` (`L18`, `L46-L60`)
- **Análise Técnica:**
  - Em `GET /api/settings` (`src/pages/api/settings.ts`, `L61-L69`), a API retorna os segredos reais sem qualquer mascaramento tanto nos atributos diretos (`ecoflowAccessSecret`, `telegramBotToken`, `whatsappApiKey`) quanto nos atributos `*Masked`. A resposta tampouco inclui `Cache-Control: no-store`.
  - No banco PostgreSQL (`prisma/schema.prisma`), `ecoflowAccessSecret`, `tuyaAccessSecret`, `telegramBotToken`, `whatsappApiKey` e `twoFactorSecret` são armazenados em texto puro.
- **Impacto:** Exfiltração imediata de credenciais capazes de controlar fisicamente a saída AC do inversor EcoFlow e comutar a chave ATS residencial, além de tokens de bots do Telegram e API do WhatsApp, em caso de XSS, acesso momentâneo ao navegador ou leitura/backup do banco de dados.
- **Recomendação de Correção:**
  - Remover os campos de segredo em texto claro do payload de `GET /api/settings`, retornando apenas flags booleanas (`hasEcoFlowSecret: true`) ou sufixo mascarado irreversível (`••••••••1a2b`), além de `Cache-Control: no-store`.
  - Criptografar todos os segredos em repouso no banco com AES-256-GCM autenticado utilizando chave de criptografia dedicada (`ENCRYPTION_KEY`).

---

### [SEC-04] Stored SSRF e Exfiltração de Credenciais em Chamadas Externas (`ecoflowEndpointRegion` e MQTT)
- **Arquivos e Linhas:**
  - `src/pages/api/settings.ts` (`L78`, `L118`, `L130`)
  - `scripts/local-sync-daemon.js` (`L30-L33`, `L62-L80`)
  - `src/infrastructure/services/EcoFlowMqttStreamService.ts` (`L113-L134`)
  - `src/infrastructure/http/EcoFlowHttpClient.ts` (`L169-L175`)
- **Análise Técnica:**
  - Embora `EcoFlowHttpClient.ts` possua allowlist `ALLOWED_HOSTS`, o endpoint `POST /api/settings` persiste qualquer valor arbitrário enviado em `ecoflowEndpointRegion` sem validação.
  - `scripts/local-sync-daemon.js` (`L30-L33`) consome `config.ecoflowEndpointRegion` diretamente do Prisma e executa `fetch(`${baseUrl}/iot-open/sign/certification`, { headers: { accessKey, nonce, timestamp, sign } })` sem sanitização de URL.
  - Em seguida, tanto `local-sync-daemon.js` (`L64-L80`) quanto `EcoFlowMqttStreamService.ts` (`L113-L134`) montam `brokerUrl = ${protocol}://${host}:${port}` diretamente dos campos retornados pela resposta HTTP sem restringir protocolo (`mqtts`) nem domínio (`*.ecoflow.com`).
- **Impacto:** Execução de Server-Side Request Forgery (SSRF) persistente contra serviços em loopback (`127.0.0.1`), rede interna Docker ou endpoints de metadata de nuvem, além de exfiltração de `accessKey`/assinatura HMAC e redirecionamento do cliente MQTT para brokers arbitrários.
- **Recomendação de Correção:**
  - Validar `ecoflowEndpointRegion` contra allowlist estrita (`https://api.ecoflow.com` e `https://api-e.ecoflow.com`) na gravação (`/api/settings`), no teste (`/api/test-control`) e na leitura pelo daemon.
  - Validar estritamente a resposta de certificação MQTT aceitando somente `protocol === "mqtts"`, porta `8883` e hostnames pertencentes a allowlist oficial da EcoFlow.

---

## 2. Severidade: ALTO

### [SEC-05] Verificação de Certificado TLS Desabilitada (`rejectUnauthorized: false`) no Cliente MQTT
- **Arquivos e Linhas:**
  - `src/infrastructure/services/EcoFlowMqttStreamService.ts` (`L126-L134`, linha `L133`)
  - `scripts/local-sync-daemon.js` (`L72-L80`, linha `L79`)
- **Análise Técnica:** As conexões `mqtt.connect` desabilitam explicitamente a validação de certificados TLS (`rejectUnauthorized: false` — CWE-295).
- **Impacto:** Permite interceptação Man-in-the-Middle (MitM) de `certificateAccount`/`certificatePassword` e injeção de mensagens MQTT falsificadas de telemetria (`bmsMaster.soc`) no banco de dados.
- **Recomendação de Correção:** Definir `rejectUnauthorized: true` em todas as conexões TLS/MQTTS.

---

### [SEC-06] Registro de Passkeys (WebAuthn) Sem Validação Criptográfica de Attestation ou Desafio
- **Arquivos e Linhas:**
  - `src/pages/api/auth/passkey.ts` (`L78-L144`)
  - `src/pages/profile.tsx` (`L277-L348`)
- **Análise Técnica:**
  - `action === "CHALLENGE"` (`L78-L93`) gera 32 bytes aleatórios sem armazená-los em sessão/banco.
  - `action === "REGISTER"` (`L95-L144`) persiste `credentialId` e `publicKey` enviados pelo cliente sem verificar `clientDataJSON`, desafio criptográfico, `origin`, `rpIdHash` ou estrutura COSE da chave pública. Tampouco há fluxo de login WebAuthn implementado.
- **Impacto:** Registro forjado de credenciais arbitrárias sem autenticador real e falsa garantia de segurança biométrica na conta.
- **Recomendação de Correção:** Implementar verificação completa FIDO2/WebAuthn no backend via `@simplewebauthn/server` com armazenamento efêmero de `challenge` vinculado ao `userId`, ou remover os endpoints/UI de Passkeys até a conclusão da implementação.

---

### [SEC-07] Ausência de Rate Limiting, Política de Senha Fraca e Registro Público Irrestrito
- **Arquivos e Linhas:**
  - `src/pages/api/auth/login.ts` (`L18-L85`)
  - `src/pages/api/auth/register.ts` (`L17-L98`)
  - `src/pages/api/auth/2fa.ts` (`L92-L173`)
  - `src/pages/api/auth/change-password.ts` (`L12-L120`)
  - `src/pages/api/test-control.ts` (`L25-L121`)
  - `src/pages/api/test-notification.ts` (`L24-L138`)
  - `src/domain/values/RawPassword.ts` (`L15-L19`)
  - `src/domain/values/HashedPassword.ts` (`L31`)
- **Análise Técnica:** Não existe rate limiting por IP ou conta em nenhum endpoint. `RawPassword` exige apenas 6 caracteres mínimos e não define tamanho máximo (permitindo DoS de CPU no event loop via `scryptSync` síncrono com entradas longas). `/api/auth/register` está aberto sem trava de convite/admin, e `/api/test-control` permite comutação física repetida da saída AC/ATS sem intervalo mínimo de segurança.
- **Impacto:** Viabilidade de força bruta contra senhas curtas e códigos TOTP de 6 dígitos, negação de serviço no processo Node.js, abuso de envio de mensagens externas e ciclagem excessiva da chave ATS física.
- **Recomendação de Correção:** Adicionar rate limiting por IP/usuário com bloqueio exponencial em login/2FA, limitar senhas entre 12 e 128 caracteres, substituir `scryptSync` por `crypto.scrypt` assíncrono, adicionar controle `ALLOW_PUBLIC_REGISTRATION=false` por padrão e impor cooldown mínimo entre comandos `ECOFLOW_ON`/`ECOFLOW_OFF`.

---

### [SEC-08] Vazamento de Estado Entre Usuários (Singleton MQTT e Race Condition em `LiveTelemetryService`)
- **Arquivos e Linhas:**
  - `src/infrastructure/services/EcoFlowMqttStreamService.ts` (`L40-L88`, `L156-L168`)
  - `src/infrastructure/services/LiveTelemetryService.ts` (`L6-L7`, `L27-L60`)
  - `src/infrastructure/repositories/ConfigurationRepository.ts` (`L39-L53`)
  - `src/pages/api/mqtt-stream.ts` (`L21-L35`)
- **Análise Técnica:**
  - `EcoFlowMqttStreamService` é um Singleton global que consulta `userConfiguration.findFirst(...)` (`L62`), conectando-se apenas ao primeiro usuário encontrado no banco e compartilhando `latestTelemetry` globalmente.
  - `LiveTelemetryService.ts` (`L6-L7`) declara `lastSyncTimeMs` e `inFlightSync` no escopo global do módulo: requisições concorrentes de usuários distintos em `/api/dashboard-status` ou `/api/statistics` compartilham a mesma `Promise` `inFlightSync` (`L42-L44`) ou sofrem supressão mútua de sincronização (`L36-L40`).
- **Impacto:** Quebra de isolamento multiusuário em memória, retorno cruzado de resultado de sync e bloqueio de atualização de telemetria entre contas distintas.
- **Recomendação de Correção:** Escopar o controle de concorrência (`lastSyncTimeMs`, `inFlightSync`) e os clientes de stream MQTT por `userId` (`Map<string, ...>`).

---

### [SEC-09] Tokens Stateless Irrevogáveis (7 Dias) e Alteração de E-mail Sem Reautenticação
- **Arquivos e Linhas:**
  - `src/domain/services/AuthenticationTokenService.ts` (`L29-L77`)
  - `src/pages/api/auth/logout.ts` (`L4-L10`)
  - `src/pages/api/auth/change-password.ts` (`L101-L112`)
  - `src/pages/api/auth/profile.ts` (`L97-L166`)
- **Análise Técnica:**
  - Tokens de sessão duram 7 dias sem identificador de sessão (`jti`) ou `tokenVersion` persistido no banco. `logout.ts` apenas remove o cookie local do navegador, e `change-password.ts` não revoga tokens emitidos antes da troca de senha.
  - `PATCH /api/auth/profile` (`L107-L146`) permite alterar o endereço de e-mail da conta sem exigir `currentPassword`.
- **Impacto:** Persistência de acesso por até 7 dias com cookies roubados mesmo após logout ou troca de senha; sequestro permanente da conta a partir de uma sessão aberta via alteração direta de e-mail.
- **Recomendação de Correção:** Introduzir campo `tokenVersion` no modelo `User` validado a cada requisição autenticada (incrementando-o em logout, troca de senha, troca de e-mail e alterações de 2FA) e exigir confirmação da senha atual para alterar o e-mail no perfil.

---

## 3. Severidade: MÉDIO

### [SEC-10] Ausência de Proteção CSRF e Mutação de Estado via `GET` (`/api/sync` e `/api/auth/logout`)
- **Arquivos e Linhas:**
  - `src/infrastructure/auth/sessionHelper.ts` (`L43`, `L51`)
  - `src/pages/api/sync.ts` (`L17-L62`)
  - `src/pages/api/auth/logout.ts` (`L4-L10`)
- **Análise Técnica:** Nenhum endpoint valida token CSRF ou cabeçalho `Origin`/`Host`. Com `SameSite=Lax`, navegações top-level `GET` enviam o cookie de sessão: `GET /api/sync` (`L17`) executa sincronização e eventual comutação AC da conta autenticada, enquanto `/api/auth/logout` aceita `GET` e permite encerramento forçado de sessão por páginas de terceiros.
- **Impacto:** Logout forçado cross-site, acionamento indevido de sincronização via links externos e superfície de CSRF a partir de subdomínios irmãos.
- **Recomendação de Correção:** Restringir `/api/auth/logout` e chamadas autenticadas por sessão em `/api/sync` exclusivamente ao método `POST`, configurar o cookie com `SameSite=Strict` e validar `Origin` contra o `Host` em todos os métodos mutáveis (`POST`, `PUT`, `PATCH`, `DELETE`).

---

### [SEC-11] Exceções Não Tratadas em Parsing (`URIError` / `JSON`), Ausência de Schemas e Injeção HTML no Telegram
- **Arquivos e Linhas:**
  - `src/infrastructure/auth/sessionHelper.ts` (`L66`)
  - `src/domain/services/AuthenticationTokenService.ts` (`L67-L76`)
  - `src/infrastructure/notifications/NotificationDispatcher.ts` (`L119-L123`, `L182-L210`)
  - `src/pages/api/auth/login.ts` (`L28`), `src/pages/api/auth/register.ts` (`L27`), `src/pages/api/automations.ts` (`L66`), `src/pages/api/settings.ts` (`L87`)
- **Análise Técnica:**
  - `decodeURIComponent(rawValue)` (`sessionHelper.ts:66`) e `JSON.parse` (`AuthenticationTokenService.ts:68`) não possuem `try/catch`; sequências percent-encoded inválidas no header `Cookie` disparam `URIError` e retornam HTTP 500.
  - Vários handlers desestruturam `request.body` sem validar tipo objeto e não aplicam schemas (ex.: Zod) com limites máximos de comprimento (`maxLength`) em `fullName`, `name` de passkey, `ecoflowAccessKey` e `ecoflowSerialNumber`.
  - `NotificationDispatcher.ts` (`L122`) envia `parse_mode: "HTML"` interpolando `title` e `message` sem escapar `<`, `>` e `&`.
- **Impacto:** Erros HTTP 500 por cookies/bodies malformados, armazenamento de payloads excessivamente grandes no banco e injeção/quebra de marcação HTML em alertas do Telegram.
- **Recomendação de Correção:** Tratar erros em `decodeURIComponent` e `JSON.parse` retornando `null`; validar todos os payloads de entrada com Zod (incluindo limites estritos de tamanho); aplicar função `escapeHtml()` nos campos interpolados antes do envio ao Telegram.

---

### [SEC-12] Timing Side-Channel (`===`), Falta de Anti-Replay TOTP e Exposição de Token na Query String
- **Arquivos e Linhas:**
  - `src/pages/api/sync.ts` (`L31-L35`)
  - `src/pages/api/mqtt-stream.ts` (`L10-L12`)
  - `src/infrastructure/auth/totpHelper.ts` (`L83-L98`)
  - `docker-compose.yml` (`L89`) e `scripts/local-sync-daemon.js` (`L13-L14`)
- **Análise Técnica:**
  - As comparações de `CRON_SECRET_TOKEN` e `validCode` TOTP utilizam `===` em vez de `crypto.timingSafeEqual`.
  - `verifyTotpCode` permite reutilizar o mesmo código de 6 dígitos repetidamente dentro da janela de 90 segundos (`offset` `0, -1, 1`).
  - `CRON_SECRET_TOKEN` é trafegado via query string (`?token=...`), ficando visível em logs HTTP e listagens de processos.
- **Impacto:** Vazamento do segredo de Cron em logs/processos, canal lateral de tempo na verificação de segredos e reutilização (replay) de códigos TOTP interceptados.
- **Recomendação de Correção:** Aceitar `CRON_SECRET_TOKEN` exclusivamente via header HTTP (`Authorization: Bearer` ou `x-cron-token`), comparar digest SHA-256 dos segredos com `timingSafeEqual` e gravar o último time-step TOTP consumido (`lastTotpCounter`) no banco para impedir replay.

---

### [SEC-13] Ausência de Timeouts em Chamadas Externas (`fetch`) e de Cabeçalhos HTTP de Segurança
- **Arquivos e Linhas:**
  - `src/infrastructure/http/EcoFlowHttpClient.ts` (`L130-L138`, `L245-L253`, `L446-L456`)
  - `src/infrastructure/notifications/NotificationDispatcher.ts` (`L116-L124`, `L153`)
  - `next.config.js` (`L1-L10`)
- **Análise Técnica:**
  - Chamadas `fetch()` para EcoFlow, Telegram e CallMeBot não configuram `AbortSignal.timeout(...)`. Em `setAcOutputState`, até 4 requisições `PUT` em cascata podem reter workers indefinidamente caso a API externa não responda.
  - `next.config.js` não define `Content-Security-Policy`, `X-Frame-Options: DENY`, `X-Content-Type-Options: nosniff`, `Referrer-Policy` e `Strict-Transport-Security`.
- **Impacto:** Exaustão de conexões do servidor sob degradação de rede externa e exposição da UI de controle de energia a Clickjacking.
- **Recomendação de Correção:** Adicionar `signal: AbortSignal.timeout(8000)` em todas as chamadas `fetch` externas e configurar headers de segurança globais em `next.config.js`.

---

## 4. Severidade: BAIXO

### [SEC-14] Enumeração de Usuários, Exposição de Erros Internos em HTTP 500, Logs Verbosos e `prisma db push --accept-data-loss`
- **Arquivos e Linhas:**
  - `src/pages/api/auth/register.ts` (`L50-L56`) e `src/pages/api/auth/login.ts` (`L53-L62`)
  - `src/pages/api/sync.ts` (`L70-L75`) e `src/pages/api/test-control.ts` (`L112-L119`)
  - `src/infrastructure/http/EcoFlowHttpClient.ts` (`L467`)
  - `docker-entrypoint.sh` (`L14-L19`)
- **Análise Técnica:**
  - `register.ts` revela contas existentes via HTTP 409 e `login.ts` pula o cálculo `scrypt` quando o e-mail não existe (diferença mensurável de tempo de resposta).
  - `sync.ts` e `test-control.ts` retornam `caughtError.message` diretamente ao cliente em falhas HTTP 500.
  - `EcoFlowHttpClient.ts` (`L467`) executa `console.log` com o JSON completo retornado pela EcoFlow em produção.
  - `docker-entrypoint.sh` executa `prisma db push --accept-data-loss` automaticamente a cada inicialização do container e possui fallback `npx --yes prisma` (download não fixado em runtime).
- **Impacto:** Enumeração de e-mails cadastrados, vazamento de detalhes internos de banco/rede em mensagens de erro e risco de perda acidental de dados ou execução de pacote externo no boot.
- **Recomendação de Correção:** Executar hash dummy em logins de usuários inexistentes, retornar mensagens genéricas em erros 500, remover logs brutos de payload em produção e substituir `prisma db push --accept-data-loss` / `npx --yes` por `prisma migrate deploy` usando o binário local empacotado na imagem.
