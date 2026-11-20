# ESPECIFICAÇÃO TÉCNICA: PWA COMPLETO & OVERHAUL DE MOBILE UX (360PX–430PX)
**Projeto:** WATTFLOW (G:\projetos\wattflow)  
**Autor:** Atlas - Arquiteto & Planejador  
**Destinatários:** Maestro (Orquestrador), Apex (Backend/SW/CSP/Hooks), Prism (Frontend/Layout/Mobile UX), Sentry (Tester QA), Sentinel (Code Reviewer)  
**Documentos de Referência:** `docs/mobile-pwa-plan.md` e `UPGRADES_E_MELHORIAS_UI.md`

---

## 1. Visão Geral & Objetivos Estratégicos
O WattFlow é um sistema de missão crítica para gestão de energia solar e comutação automática ATS. O objetivo deste ciclo é transformar o WattFlow em um **Progressive Web App (PWA) de alta performance e instalável**, garantindo:
1. **Instalabilidade Nativa:** Suporte completo para instalação na tela inicial (Android, iOS e Desktop) com splash screen e cores semânticas dark mode (`#020617`).
2. **Resiliência Offline & Service Worker Seguro:** Estratégia de cache offline para assets estáticos e página de contingência (`offline.html`), com bypass estrito **Network-Only para todas as rotas `/api/*`** (zero risco de telemetria desatualizada ou cache de dados sensíveis).
3. **Overhaul Ergonômico de Mobile UX (360px–430px):** Otimização radical para smartphones compactos (iPhone SE, iPhone 13/14/15/16 Pro, Galaxy S series), eliminando overflows horizontais, introduzindo uma **Bottom Navigation de 5 abas** e substituindo tabelas por **Cards Mobile (`md:hidden`)**.
4. **Economia de Recursos & Bateria Móvel:** Hook reativo `useVisibilityPolling` para suspender loops de atualização quando a aba estiver em segundo plano ou desconectada.
5. **Ergonomia Tátil & Prevenção de Auto-zoom iOS:** Inputs e selects com `font-size: 16px` (`text-base sm:text-sm`) e alvos de toque com área mínima de 44x44px.
6. **Sessão Persistente 30 Dias:** Login persistente seguro via cookie `SameSite=Lax` com suporte a `rememberMe` e sliding refresh.

---

## 2. Arquitetura PWA & Camada de Infraestrutura Web

### 2.1. Manifesto da Aplicação (`public/manifest.webmanifest`)
Configuração semântica em conformidade com as diretrizes W3C Web App Manifest:
- `name`: "WattFlow • Monitoramento & Automação Solar"
- `short_name`: "WattFlow"
- `description`: "Orquestrador inteligente de energia solar EcoFlow e comutação automática ATS"
- `start_url`: "/"
- `display`: "standalone"
- `orientation`: "portrait-primary"
- `background_color`: "#020617"
- `theme_color`: "#020617"
- `categories`: ["utilities", "productivity", "energy"]
- `icons`:
  - `public/icons/icon-192x192.png` (192x192, `image/png`, `any`)
  - `public/icons/icon-192x192-maskable.png` (192x192, `image/png`, `maskable`)
  - `public/icons/icon-512x512.png` (512x512, `image/png`, `any`)
  - `public/icons/icon-512x512-maskable.png` (512x512, `image/png`, `maskable`)
  - `public/icons/apple-touch-icon.png` (180x180, `image/png`)

### 2.2. Service Worker (`public/sw.js`) — Política Rigorosa de Cache & Segurança
O Service Worker deve ser cirúrgico e seguro, respeitando as seguintes regras:
1. **Bypass Estrito Network-Only para `/api/*`:** Qualquer requisição HTTP cujo pathname inicie com `/api/` **NUNCA** deve passar pelo cache do Service Worker. Deve ir direto para a rede (`fetch(event.request)`).
2. **Cache-First / Stale-While-Revalidate para Assets Estáticos:**
   - Pre-cache de arquivos essenciais: `/`, `/offline.html`, manifest e ícones.
   - Cache de bundles Next.js (`/_next/static/*`) e fontes estáticas com estratégia Stale-While-Revalidate.
3. **Offline Fallback para Navegação HTML:** Se uma requisição de navegação (`event.request.mode === 'navigate'`) falhar devido a perda de conexão, o SW intercepta o erro e retorna `/offline.html`.
4. **Ciclo de Vida do SW:** Implementar `self.skipWaiting()` no `install` e `clients.claim()` no `activate`, com limpeza automática de caches antigos (`caches.delete(cacheName)`).

### 2.3. Página de Contingência Offline (`public/offline.html`)
Página HTML autocontida (CSS inline moderno com dark theme `bg-[#020617]`):
- Ícone de conexão ausente (WifiOff / CloudOff).
- Mensagem informativa de indisponibilidade de rede.
- Botão "Tentar Reconectar" (`window.location.reload()`).
- Detecção automática de retorno de rede (`window.addEventListener('online', ...)`).

### 2.4. Content Security Policy (CSP) & Headers HTTP (`next.config.js`)
Configurar cabeçalhos estritos de segurança e controle de cache:
- **Cache-Control para `/sw.js`:** `no-cache, no-store, must-revalidate` (garante que atualizações do SW sejam detectadas imediatamente pelo browser).
- **Extensão da CSP:**
  - `manifest-src 'self'`: Libera o carregamento do `manifest.webmanifest`.
  - `worker-src 'self'`: Autoriza o registro e execução de `public/sw.js`.
  - Preservar integridade de `script-src`, `style-src` e `connect-src` (incluindo WebSockets/WSS para o stream MQTT quando aplicável).

### 2.5. Meta Tags & Viewport (`src/pages/_document.tsx` e `_app.tsx`)
- Inclusão em `_document.tsx`:
  - `<link rel="manifest" href="/manifest.webmanifest" />`
  - `<link rel="apple-touch-icon" href="/icons/apple-touch-icon.png" />`
  - `<meta name="apple-mobile-web-app-capable" content="yes" />`
  - `<meta name="apple-mobile-web-app-status-bar-style" content="black-translucent" />`
  - `<meta name="theme-color" content="#020617" />`
- Em `_app.tsx`:
  - `<meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=5, viewport-fit=cover" />` (essencial para habilitar `safe-area-inset-*`).

---

## 3. Overhaul de Mobile UX (360px–430px)

### 3.1. Bottom Navigation Fixa de 5 Abas (`src/components/Layout.tsx`)
- **Visibilidade:** Exibida exclusivamente no mobile (`md:hidden`) fixada na base da tela (`fixed bottom-0 left-0 right-0 z-50`).
- **Respeito a Safe Areas:** Aplicar padding inferior dinâmico `pb-[env(safe-area-inset-bottom,0px)]` para acomodar a barra de navegação/gestos do iOS e Android.
- **5 Destinos Canônicos:**
  1. **Painel** (`/`): Ícone `LayoutDashboard`
  2. **Estatísticas** (`/statistics`): Ícone `BarChart3`
  3. **Automações** (`/automations`): Ícone `Cpu` / `Sliders`
  4. **Credenciais** (`/settings`): Ícone `Key` / `Shield`
  5. **Perfil** (`/profile`): Ícone `User`
- **Ergonomia Tátil:** Cada botão de aba deve ter dimensões mínimas de **44x44px**, ícone centralizado (tamanho 20px), micro-rótulo textual (10px) e feedback visual de aba ativa (anel sutil, cor esmeralda `#10b981` ou elevação).
- **Desobstrução do Layout:** O `<main>` do Layout deve receber espaçamento compensatório na base `pb-20 md:pb-8` para evitar que a Bottom Nav sobreponha cards ou botões inferiores.
- **Header Compacto no Mobile:** No mobile (`< md`), os links textuais redundantes da barra superior são ocultados (`hidden md:flex`), mantendo no header apenas o Logo WattFlow, indicador de conexão/status ATS e botão de sincronização manual.

### 3.2. Cards Mobile (`md:hidden`) vs. Tabelas Horizontais
Tabelas largas causam quebra de viewport e exigem scroll horizontal indesejado.
- **Dashboard (`src/pages/index.tsx`):**
  - Ocultar tabela de execuções recentes no mobile com `hidden md:block`.
  - Criar componente de lista de **Cards Mobile (`md:hidden space-y-3`)**:
    - Cabeçalho do Card: Timestamp formatado e badge de status (Sucesso / Falha / Em Execução).
    - Corpo do Card: SOC no momento, Fonte Ativa (Rede vs. Bateria) e Potência de Saída.
    - Rodapé do Card: Motivo da transição / Trigger ATS.
- **Estatísticas (`src/pages/statistics.tsx`):**
  - Tabela histórica de 7 colunas encapsulada em `hidden md:block`.
  - Implementar visualização em **Cards Mobile Verticais (`md:hidden`)** detalhando comutação, delta de kWh poupado, faixa horária e custo economizado.
- **Regra de Ouro:** Em qualquer resolução entre 360px e 430px, o documento deve satisfazer:
  `document.documentElement.scrollWidth <= window.innerWidth` (Zero scroll horizontal na janela).

### 3.3. Gráfico SVG Touch-Friendly (`src/pages/statistics.tsx`)
- Atualmente o gráfico depende exclusivamente do evento de mouse (`onMouseEnter`).
- **Aprimoramento Touch:** Adicionar listeners `onPointerDown`, `onTouchStart` e `onClick` nos pontos de dados a cada 5 minutos.
- **Tooltip Responsivo com Contenção de Borda:**
  - Limitar a largura do tooltip para `max-w-[260px]`.
  - Implementar cálculo de posicionamento relativo para inverter o lado do tooltip quando o ponto estiver próximo à borda direita da tela (`x > width - 100`), evitando estourar a viewport no mobile.
  - Suporte a fechamento do tooltip ao tocar fora ou selecionar outro ponto.

### 3.4. Prevenção de Auto-zoom e Ergonomia de Formulários
- No Safari iOS, qualquer campo de input com `font-size < 16px` provoca zoom in automático e irreversível da tela ao focar.
- **Padronização:** Aplicar classes Tailwind `text-base sm:text-sm` em todos os `<input>`, `<select>` e `<textarea>` em:
  - `src/pages/login.tsx`
  - `src/pages/register.tsx`
  - `src/pages/settings.tsx` (incluindo campos do modal BYOK e confirmação)
  - `src/pages/profile.tsx`
  - `src/pages/automations.tsx`
- **Altura Mínima:** Todos os campos e botões interativos devem ter `min-h-[44px]` para respeitar os critérios de ergonomia da WCAG 2.1 AA.

### 3.5. Componente de Prompt de Instalação PWA (`src/components/PwaInstallPrompt.tsx`)
- Componente não intrusivo posicionado acima da Bottom Nav.
- **Android / Chrome / Edge:** Capturar o evento `beforeinstallprompt`, guardar o prompt diferido e exibir banner amigável "Adicionar WattFlow à tela inicial" com botão "Instalar".
- **iOS Safari:** Detectar dispositivo iOS (`/iPhone|iPad|iPod/.test(navigator.userAgent)`) em modo standalone falso (`!("standalone" in window.navigator) || !window.navigator.standalone`) e exibir guia simplificado: "Toque em Compartilhar e selecione Adicionar à Tela de Início".
- Opção "Agora não" que salva dismiss no `localStorage` por 7 dias.

---

## 4. Otimização de Performance & Bateria: Hook `useVisibilityPolling`

### 4.1. Motivação
Em smartphones, manter requisições periódicas de telemetria a cada 2 ou 5 segundos enquanto a tela está bloqueada ou em outra aba drena bateria e consome dados móveis.

### 4.2. Especificação do Hook (`src/hooks/useVisibilityPolling.ts`)
```typescript
interface VisibilityPollingOptions {
  pollingIntervalMs: number;
  onPoll: () => Promise<void> | void;
  enabled?: boolean;
}

export function useVisibilityPolling({
  pollingIntervalMs,
  onPoll,
  enabled = true,
}: VisibilityPollingOptions): { isPolling: boolean; isTabVisible: boolean; isOnline: boolean }
```
- **Comportamento:**
  1. Monitora o evento `visibilitychange` (`document.visibilityState === "visible"`).
  2. Monitora os eventos `online` e `offline` do navegador.
  3. Enquanto a aba estiver oculta (`hidden`) ou o dispositivo estiver `offline`, o `setInterval` é limpo/pausado.
  4. Assim que o usuário retornar para o app (`visibilityState === "visible"` e `navigator.onLine === true`), dispara uma execução imediata de `onPoll()` para trazer dados frescos e reinicia o timer periódico.
- **Adoção Obrigatória:**
  - `src/pages/index.tsx`: Telemetria em tempo real e status da ATS.
  - `src/pages/statistics.tsx`: Gráficos e contadores de economia.

---

## 5. Sessão Persistente 30 Dias & Checkbox de Login

### 5.1. Backend & Tokens
- O cookie `wattflow_session` já opera com `SameSite=Lax`.
- Adicionar suporte ao parâmetro booleano `rememberMe` em `POST /api/auth/login` e `POST /api/auth/login-2fa`:
  - Se `rememberMe === true` (padrão): Emitir cookie persistente com `Max-Age=2592000` (30 dias) e cabeçalho explícito `Expires`.
  - Se `rememberMe === false`: Emitir cookie de sessão sem `Max-Age` / `Expires`.
- No endpoint `GET /api/auth/me`, implementar *sliding refresh* da expiração quando o cookie for persistente, mantendo o usuário conectado continuamente se ativo.

### 5.2. Frontend
- Em `src/pages/login.tsx`, adicionar checkbox moderno e acessível: "Manter conectado por 30 dias" (marcado por padrão).
- Integrar com o estado de login e envio do payload para a API.

---

## 6. Divisão de Tarefas do Squad

| Especialista | Módulo / Camada | Arquivos Alvo | Tarefas Específicas |
| :--- | :--- | :--- | :--- |
| **Apex** (Backend / SW / CSP / Hooks) | Infraestrutura PWA & Hooks | `public/sw.js`<br>`next.config.js`<br>`src/hooks/useVisibilityPolling.ts`<br>`src/pages/api/auth/*`<br>`src/infrastructure/auth/sessionHelper.ts` | 1. Implementar `public/sw.js` com bypass absoluto Network-Only para `/api/*` e fallback `/offline.html`.<br>2. Configurar headers anti-cache para `/sw.js` e atualizar CSP em `next.config.js`.<br>3. Criar o hook `useVisibilityPolling.ts` para suspender polling em aba oculta/offline.<br>4. Ajustar emissão de cookie de sessão para respeitar o parâmetro `rememberMe` e sliding refresh. |
| **Prism** (Frontend Designer / UX) | Layout Mobile & Componentes PWA | `public/manifest.webmanifest`<br>`public/offline.html`<br>`public/icons/*`<br>`src/components/Layout.tsx`<br>`src/components/PwaInstallPrompt.tsx`<br>`src/pages/index.tsx`<br>`src/pages/statistics.tsx`<br>`src/pages/login.tsx`<br>`src/pages/_document.tsx` | 1. Criar `manifest.webmanifest`, ícones 192/512 (any/maskable) e `offline.html` dark mode.<br>2. Atualizar meta tags e viewport em `_document.tsx` e `_app.tsx`.<br>3. Implementar Bottom Nav de 5 abas em `Layout.tsx` com safe-areas e ocultar rotas do header no mobile.<br>4. Substituir tabelas por Cards Mobile (`md:hidden`) em `index.tsx` e `statistics.tsx`.<br>5. Refatorar gráfico SVG em `statistics.tsx` para suporte tátil e contenção de tooltip.<br>6. Padronizar inputs `>= 16px` (`text-base sm:text-sm`) e adicionar checkbox "Manter conectado por 30 dias".<br>7. Implementar `PwaInstallPrompt.tsx`. |
| **Sentry** (Tester QA) | Suíte Unitária & E2E Mobile | `tests/unit/useVisibilityPolling.test.ts`<br>`tests/unit/pwa-sw.test.ts`<br>`e2e/mobile-pwa.spec.ts` | 1. Criar testes unitários para `useVisibilityPolling` e validação do bypass de rotas no SW.<br>2. Criar suíte E2E `e2e/mobile-pwa.spec.ts` cobrindo viewports 360x800, 390x844 e 430x932.<br>3. Validar ausência de overflow horizontal (`scrollWidth <= innerWidth`) em todas as rotas.<br>4. Validar offline fallback e sobrevivência de sessão pós-reconexão. |
| **Sentinel** (Code Reviewer) | Quality Gate & Segurança | Todo o diff do PR | 1. Auditar estritamente para garantir zero cache de dados sensíveis ou `/api/*` no SW.<br>2. Validar conformidade de CSP em `next.config.js`.<br>3. Validar ergonomia de toque (alvos >= 44x44px) e WCAG 2.1 AA.<br>4. Garantir que não haja regressão visual nas telas desktop (`>= md`). |

---

## 7. Critérios de Aceite para Homologação (DoD - Definition of Done)

1. **Validação PWA & Lighthouse:**
   - O aplicativo atinge status de "Instalável" no Chrome DevTools Application > Manifest.
   - Ícones 192x192 e 512x512 declarados com propósito `any` e `maskable`.
   - `public/sw.js` registrado com sucesso no escopo `/` sem erros no console.
2. **Blindagem de Cache:**
   - Comprovado por teste que requisições para `/api/telemetry`, `/api/statistics`, `/api/settings` e `/api/auth/*` são sempre despachadas via rede (Network-Only) e nunca armazenadas no Cache Storage.
   - Navegação offline para qualquer rota não cacheada exibe `/offline.html` limpo e funcional.
3. **Responsividade Mobile Estrita (360px a 430px):**
   - Em todas as páginas (`/`, `/statistics`, `/automations`, `/settings`, `/profile`, `/login`), `document.documentElement.scrollWidth <= window.innerWidth`.
   - Bottom Nav de 5 abas perfeitamente alinhada com `env(safe-area-inset-bottom)` e touch targets com altura mínima de 44px.
   - Tabelas extensas totalmente substituídas por Cards Mobile no breakpoint `< md`.
4. **Ergonomia de Formulários & Prevenção de Zoom iOS:**
   - Todos os inputs de texto, número, e-mail e senha possuem `font-size: 16px` em resoluções mobile, sem disparar zoom automático no Safari iOS.
5. **Otimização de Bateria:**
   - O polling de dados cessa comprovadamente quando a aba é minimizada ou colocada em segundo plano (`visibilityState === "hidden"`), e é retomado imediatamente ao focar na aba.
6. **Suíte de Testes 100% Verde:**
   - `npm test` aprovado com 100% de sucesso.
   - `npx playwright test e2e/mobile-pwa.spec.ts` aprovado para viewports mobile (360x800, 390x844, 430x932).
   - `npm run lint` e `npm run build` executam sem warnings ou erros.
