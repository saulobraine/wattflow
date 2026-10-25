# WattFlow &bull; Upgrades, Melhorias de UI/UX e Propostas Futuras

Este documento consolida a auditoria completa de frontend, as melhorias de experiência de usuário (UI/UX), consistência visual, responsividade e acessibilidade (a11y) implementadas no **WattFlow**, além de mapear as propostas estratégicas de evolução visual e funcional para o produto.

---

## 1. Visão Geral e Princípios de Design

O WattFlow opera como um orquestrador de missão crítica para estações de energia solar **EcoFlow** integradas a **Chaves de Transferência Automática (ATS)**. Por gerenciar fluxos de alta tensão e comutações físicas entre concessionária e bateria, a interface adota os seguintes pilares:

- **Precisão e Ergonomia:** Informações de estado (SOC, PV Watts, modo ATS) identificáveis em menos de 1 segundo.
- **Zero Ruído Visual / Dark Mode Nativo:** Fundo `bg-slate-950` com cartões `bg-slate-900` e acentos semânticos de alta legibilidade (verde esmeralda para solar/bateria, âmbar para histerese/solar, rosa carmim para corte/rede).
- **Leveza Extrema e Desempenho (60 FPS):** CSS puro e utilitários estendidos do Tailwind CSS, sem bibliotecas pesadas de animação em JavaScript.
- **Compatibilidade Estrita:** 100% aderente ao **React 19** e **Next.js 15**, preservando compilação instantânea e builds de produção sem alertas.

---

## 2. Melhorias Implementadas no Código

### 2.1. Camada de Estilos e Animações (`globals.css` e `tailwind.config.js`)
- **Keyframes de Alta Performance:** Definição de `fadeIn`, `fadeOut`, `slideUpIn`, `slideDownIn`, `scaleIn`, `modalIn`, `modalOut`, `alertIn` e `pulseGlow` operando exclusivamente sobre `transform` e `opacity` com aceleração por hardware (GPU).
- **Curvas de Aceleração Suaves:** Emprego de curvas personalizadas `cubic-bezier(0.16, 1, 0.3, 1)` inspiradas no design de sistemas modernos (Linear / iOS), proporcionando transições ágeis e sem trepidação.
- **Entrada Escalonada (Stagger):** Classes `.stagger-1` a `.stagger-6` para aparição sequencial e natural dos cartões de métrica e seções da página.
- **Suporte Nativo a View Transitions:** Preservação e enriquecimento da View Transitions API para transições contínuas entre páginas sem piscar elementos estáticos (como o header global).
- **Scrollbar Moderna e Fina:** Substituição de barras de rolagem nativas por scrollbars discretas (`rgba(51, 65, 85, 0.6)`) com cantos arredondados.
- **Prevenção de Zoom Indesejado no iOS Safari:** Configuração de tipografia adaptada para telas móveis (`font-size: 16px` em `<input>` e `<select>`), eliminando o zoom automático que quebra o layout em dispositivos Apple.

### 2.2. Acessibilidade (a11y - WCAG 2.1 AA)
- **Foco de Teclado Consistente:** Estilização global de `:focus-visible` com anel esmeralda de 2px e deslocamento (`outline-offset: 2px`), permitindo navegação 100% funcional via Tab/Shift+Tab.
- **Respeito a Preferências de Movimento:** Implementação da diretiva `@media (prefers-reduced-motion: reduce)`, desativando animações e transições automaticamente para usuários com sensibilidade a movimento.
- **Landmarks Semânticos e ARIA:**
  - Header com `role="banner"` e navegação com `role="navigation"`.
  - Área principal com `role="main"` e rodapé com `role="contentinfo"`.
  - Atributos `aria-current="page"` nos links ativos e `aria-label` explícito em botões de ícone (Logout, Fechar Modal, Alternar Olho de Senha, Testes).
  - Ícones decorativos acompanhados de `aria-hidden="true"`.
- **Associação Rígida entre Rótulos e Campos:** Inserção de `id` e `htmlFor` em todos os inputs, selects e checkboxes nas telas de Automações, Configurações, Login e Registro.
- **Regiões Vivas (Live Regions):** Alertas de feedback e erro configurados com `role="alert"` e `aria-live="polite"` para leitura imediata por leitores de tela (NVDA, VoiceOver, TalkBack).

### 2.3. Refinamento de Componentes e Telas

#### Dashboard (`/`)
- **Banner de Status Reativo:** Cartão de boas-vindas com micro-animação no ícone central e botão de sincronização com estado de rotação suave.
- **Barra de Progresso SOC:** Barra de bateria com `role="progressbar"`, valores `aria-valuenow`, `aria-valuemin="0"`, `aria-valuemax="100"` e iluminação volumétrica gradiente dependente da faixa (verde acima de 90%, vermelho abaixo de 30%, âmbar intermediário).
- **Estado Vazio Acolhedor:** Substituição do texto puro por ilustração de estado vazio (`Inbox` com texto explicativo sobre sincronização agendada) quando não há logs registrados.
- **Indicadores ATS:** Badges dinâmicos com setas direcionais indicando com clareza visual a fonte ativa (Rede vs. Bateria).

#### Estatísticas de Geração Solar (`/statistics`)
- **Gráfico Ocupando 100% do Espaço Útil:** Eliminação de rolagem horizontal desnecessária, com barras flexíveis (`flex-1 min-w-0 max-w-[32px]`) contidas com perfeição em qualquer largura de tela.
- **Escalas Automáticas com Folga (Headroom de 25%):** Linhas de grade tracejadas (topo, meio e base) ajustadas dinamicamente para patamares legíveis (100W, 200W, 400W, 600W, 800W, 1000W+).
- **Barra de Inspeção Ativa:** Exibição contínua dos dados do ponto sob o cursor (Potência W, Bateria %, Horário exato), além de tooltips inteligentes com auto-alinhamento nas bordas da tela.
- **Tabela de Telemetria:** Cabeçalhos marcados com `scope="col"`, linhas com hover suave e destaque colorido para leitura de potência fotovoltaica.

#### Automações (`/automations`)
- **Sliders de Histerese Acessíveis:** Controles deslizantes superiores e inferiores vinculados a `aria-valuenow`, `aria-valuemin`, `aria-valuemax` e `aria-describedby`, facilitando ajustes finos.
- **Cartões de Faixa de Comutação:** Destaque em 3 blocos comparativos (Corte na Rede, Histerese Estável e Comutação para Bateria) com respostas cromáticas instantâneas aos limites escolhidos.

#### Configurações e BYOK (`/settings`)
- **Modal de Confirmação com Ciclo Completo de Abertura e Saída:** O popup de segurança contra acionamentos acidentais agora fecha com transição reversa graciosa (`animate-backdrop-out` e `animate-modal-out`), suporte a fechamento via clique externo e tecla `Escape`.
- **Acessibilidade Dialog:** Modal configurado com `role="dialog"`, `aria-modal="true"`, `aria-labelledby` e `aria-describedby`.
- **Alternância de Visibilidade de Segredos:** Botões de olho para `Secret Key`, `Bot Token` e `API Key` devidamente nomeados para leitores de tela e estilizados com transição de clique ativo.
- **Testes de Notificação Separados:** Seções independentes para Telegram Bot e WhatsApp (CallMeBot) com seus próprios botões de disparo de teste e alertas contextuais.

#### Login e Registro (`/login`, `/register`)
- **Suporte Total a Gerenciadores de Senha:** Campos enriquecidos com atributos padrão `autoComplete="email"`, `autoComplete="current-password"` e `autoComplete="new-password"`.
- **Aparência Unificada:** Cartões com elevação sutil, feedback tátil no clique dos botões e mensagens de erro destacadas em painéis flutuantes.

---

## 3. Matriz de Conformidade e Responsividade

| Tela / Componente | Mobile (<640px) | Tablet (640-1024px) | Desktop (>1024px) | Acessibilidade (a11y) | Animações |
| :--- | :---: | :---: | :---: | :---: | :---: |
| **Header & Navegação** | Ícones compactos | Ícones + Textos | Barra completa + Usuário | `role="banner"`, `aria-label` | Hover + Active scale |
| **Dashboard** | 1 Coluna vertical | 3 Colunas adaptadas | 3 Colunas + Logs | `role="progressbar"`, Live alerts | Stagger 1 a 5 |
| **Estatísticas** | 1 Coluna / Gráfico 100% | 2 Colunas / Grade | 4 KPIs + Grade completa | `scope="col"`, Seção rotulada | Barras fluidas + Tooltip |
| **Automações** | Sliders verticais | Grade de Comportamento | Painel com histerese | `role="slider"`, IDs vinculados | Entrada de cartões |
| **Configurações** | Formulário 1 Coluna | Grade 2 Colunas | Painel BYOK + ATS Test | `role="dialog"`, `aria-modal` | Modal in/out com backdrop |
| **Login / Registro** | Card central fluido | Card max-w-md | Card centralizado | `autoComplete`, Prevenção zoom | Fade-in + Float |

---

## 4. Propostas Futuras de Valor para o WattFlow

Para consolidar o WattFlow como a solução definitiva de gerenciamento de microgeração solar residencial e comercial, propõem-se as seguintes melhorias para as próximas versões:

### 4.1. Visualização Financeira e Economia em Tempo Real
- **Cálculo da Tarifa em R$:** Permitir que o usuário cadastre o valor do kWh da concessionária local (ex: R$ 0,95/kWh) e o adicional de bandeira tarifária (Verde, Amarela, Vermelha 1 e 2).
- **Card de Economia Estimada:** Exibir no Dashboard quanto dinheiro foi economizado no dia, na semana e no mês pelo uso da energia solar armazenada na EcoFlow vs. rede elétrica.
- **Relatório de Retorno sobre Investimento (Payback):** Aba dedicada para acompanhar a amortização do investimento nos painéis solares e na estação EcoFlow.

### 4.2. Gráficos Comparativos Multitemporais (Dia / Semana / Mês)
- **Filtros de Período no Módulo de Estatísticas:** Seletor de visualização (Últimas 24h, 7 dias, 30 dias, Anual).
- **Curva Comparativa Sobreposta:** Exibição da curva solar de hoje comparada à curva solar do dia anterior, facilitando identificar perda de eficiência por sujidade nos painéis ou nebulosidade.
- **Exportação de Dados:** Botão de download de relatórios em CSV e PDF para prestação de contas ou estudos técnicos.

### 4.3. Modo Live-Sync via Server-Sent Events (SSE) ou WebSockets
- **Atualização Sem Polling:** Substituição gradual do `setInterval` de 30 segundos por um canal unidirecional SSE (`/api/live-stream`), atualizando o nível de bateria e a potência solar milissegundos após a EcoFlow publicar os dados via MQTT/Open API.
- **Indicador de Conexão em Tempo Real:** Ponto luminoso no header indicando status da conexão com a API da EcoFlow (Verde: Conectado e transmitindo; Amarelo: Reconectando; Vermelho: Offline).

### 4.4. PWA (Progressive Web App) e Modo Tablet de Parede (Kiosk)
- **Instalação como Aplicativo Nativo:** Inclusão de `manifest.json` e Service Worker para instalação no Android, iOS, Windows e iPad.
- **Modo Kiosk / Painel Dedicado:** Botão no cabeçalho para tela cheia com visual otimizado para tablets baratos fixados na parede do quadro elétrico (fonte ampliada, relógio integrado, ausência de menus de navegação supérfluos).
- **Notificações Push Nativas:** Recebimento de alertas de corte ou recarga mesmo com o navegador fechado no smartphone.

### 4.5. Automações Inteligentes com Previsão do Tempo (Meteorologia)
- **Integração com API Meteorológica (ex: Open-Meteo gratuita):** Consultar o índice de radiação UV e nebulosidade prevista para o dia seguinte.
- **Ajuste Preventivo de Histerese:** Se houver previsão de tempestade ou chuva forte no dia seguinte, o WattFlow pode elevar temporariamente o limite de corte para 50%, preservando reserva emergencial de bateria para caso a rede caia (modo no-break preventivo).

### 4.6. Suporte a Tarifação Horária (Tarifa Branca / Time-of-Use)
- **Comutação por Horário de Ponta:** No Brasil, o horário de ponta (geralmente das 17h30 às 20h30) tem tarifa energética até 3x mais cara. O WattFlow poderá forçar a comutação para a bateria durante o horário de ponta, mesmo que o limite superior ainda não tenha sido plenamente atingido, maximizando a economia na fatura.

---

*Documento gerado e validado pelo Engenheiro Frontend (PixelCraft) para o projeto WattFlow. Todos os direitos reservados.*
