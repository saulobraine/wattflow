# ESPECIFICAÇÃO TÉCNICA: ESTATÍSTICAS AVANÇADAS MULTITEMPORAIS & MODO KIOSK (WALL PANEL)
**Projeto:** WATTFLOW (G:\projetos\wattflow)  
**Autor:** Atlas - Arquiteto & Planejador  
**Destinatários:** Maestro (Orquestrador), Apex (Backend/APIs/Agregações/Exportação), Prism (Frontend/Gráficos/Filtros/Modo Kiosk), Sentry (Tester QA), Sentinel (Code Reviewer)  
**Documentos de Referência:** `UPGRADES_E_MELHORIAS_UI.md` (Itens 4.2 e 4.4)

---

## 1. Visão Geral & Objetivos Estratégicos
O WattFlow avança para a maturidade analítica e operacional com dois pilares complementares de alto impacto:
1. **Estatísticas Avançadas Multitemporais & Curva Sobreposta:** Prover ao usuário filtros temporais amplos (Últimas 24h, 7 dias, 30 dias, Anual e Curva Sobreposta "Hoje vs Ontem"), permitindo diagnósticos de eficiência solar (identificação de sujidade nos painéis, sombreamento ou dias nublados) e exportação formal de dados (CSV sanitizado e Relatório Executivo PDF para estudos de ROI e homologação).
2. **Modo Kiosk / Wall Panel de Parede (Quadro Elétrico):** Criar uma interface dedicada em `/kiosk` otimizada para tablets ou telas sensíveis ao toque fixadas na parede do quadro de distribuição elétrica. Design Dark OLED absoluto (`#000000`), tipografia macroscópica visível a 3-5 metros, diagrama sinóptico de fluxo de potência em tempo real, relógio digital e integração nativa com a **Screen Wake Lock API** (impedindo que a tela apague).

---

## 2. Arquitetura de Dados & Motor de Agregação (Backend - Apex)

### 2.1. Problema de Escala & Solução por Downsampling (Buckets Temporais)
O banco de dados SQLite armazena registros frequentes de telemetria em `SyncExecutionLog`. A consulta direta de registros brutos em janelas amplas (ex: 30 dias = ~43.200 linhas; 1 ano = ~500.000 linhas) geraria latência excessiva, consumo de memória proibitivo e congelamento da UI no cliente.

**Algoritmo Obrigatório de Downsampling (Agregação por Buckets):**
- **Janela 24 Horas (`24h`):** Buckets de **15 minutos** (~96 pontos). Média de `solarInputWatts`, `outputWatts`, `batteryPercentage` e soma de kWh no intervalo.
- **Janela 7 Dias (`7d`):** Buckets de **1 hora** (168 pontos). Médias horárias e picos do dia.
- **Janela 30 Dias (`30d`):** Buckets de **4 horas** (180 pontos) ou **1 dia** (30 pontos consolidados diários).
- **Janela Anual (`year`):** Agregação por **mês** (12 pontos consolidados) ou diária compactada (365 pontos).
- **Janela Comparativa "Hoje vs Ontem" (`today-vs-yesterday`):**
  - Duas séries sincronizadas pelo horário do dia (formato `HH:mm`, buckets de 15 minutos de 00:00 às 23:59).
  - Série A: "Hoje" (de 00:00 até o horário atual).
  - Série B: "Ontem" (de 00:00 às 23:59 do dia anterior).

### 2.2. Novo Endpoint de Histórico (`GET /api/statistics/history`)
- **Query Params:**
  - `range`: `"24h" | "7d" | "30d" | "year" | "today-vs-yesterday"` (validação Zod).
- **Contrato de Resposta:**
```typescript
export interface StatisticsHistoryResponse {
  range: "24h" | "7d" | "30d" | "year" | "today-vs-yesterday";
  summary: {
    totalSolarGeneratedKwh: number;
    totalConsumedKwh: number;
    netEnergyKwh: number;
    peakSolarWatts: number;
    peakOutputWatts: number;
    averageBatteryPercentage: number;
    estimatedSavingsBrl: number;
    gridAvoidancePercentage: number; // % da carga atendida pela bateria solar
  };
  points: Array<{
    timestamp: string;
    label: string; // Ex: "14:15", "18/11", "Nov/26"
    solarWatts: number;
    outputWatts: number;
    netWatts: number;
    batteryPercentage: number;
  }>;
  comparison?: {
    todayTotalKwh: number;
    yesterdayTotalKwh: number;
    divergencePercentage: number; // Ex: +12.4% de geração solar vs ontem
    todayPeakWatts: number;
    yesterdayPeakWatts: number;
    todayPoints: Array<{ time: string; solarWatts: number; outputWatts: number; batteryPercentage: number }>;
    yesterdayPoints: Array<{ time: string; solarWatts: number; outputWatts: number; batteryPercentage: number }>;
  };
}
```

### 2.3. Endpoint de Exportação CSV Sanitizada (`GET /api/statistics/export`)
- **Query Params:**
  - `range`: `"24h" | "7d" | "30d" | "year"`
  - `format`: `"csv"`
- **Headers HTTP:**
  - `Content-Type: text/csv; charset=utf-8`
  - `Content-Disposition: attachment; filename="wattflow-telemetria-[range]-[data].csv"`
- **Colunas do CSV (RFC 4180):**
  `Data_Hora,Bateria_SOC_Percent,Geracao_Solar_Watts,Consumo_Residencial_Watts,Saldo_Liquido_Watts,Fonte_Ativa,Faixa_Tarifaria,Economia_Estimada_BRL`
- **Mitigação Mandatória contra CSV Injection (Formula Injection):**
  Qualquer valor textual que inicie com `=`, `+`, `-` ou `@` deve ser prefixado com apóstrofo `'` ou envolvido em aspas seguras para impedir execução remota em planilhas (Excel/Calc).

---

## 3. Interface de Estatísticas & Curva Sobreposta (Frontend - Prism)

### 3.1. Seletor de Períodos Dinâmico (`src/pages/statistics.tsx`)
- Barra de navegação por abas em estilo pills acima do gráfico principal:
  - `[ Hoje vs Ontem ]` (Destaque para curva comparativa)
  - `[ 24 Horas ]`
  - `[ 7 Dias ]`
  - `[ 30 Dias ]`
  - `[ Anual ]`
- Transição visual suave sem piscar o layout, com estado de loading skeleton elegante.

### 3.2. Gráfico Multi-Série SVG & Curva Sobreposta
- **Modo Padrão (`24h`, `7d`, `30d`, `year`):**
  - Linha Solar (Verde Esmeralda `#10b981`).
  - Linha Consumo Residencial (Âmbar `#f59e0b`).
  - Área de Saldo Líquido (Geração Líquida em Azul Celeste `#38bdf8`).
- **Modo Especial "Hoje vs Ontem":**
  - **Curva Solar Hoje:** Linha contínua Verde Esmeralda `#10b981` com preenchimento sutil em gradiente.
  - **Curva Solar Ontem:** Linha tracejada Cinza/Azulado (`stroke-dasharray="4 4"`, `#94a3b8`), permitindo sobreposição direta.
  - **Badge de Divergência Solar:** Indicador comparativo no topo do gráfico (ex: "Geração Solar 14.8% maior que ontem" ou "Alerta: Queda de 22% em relação a ontem - possível nebulosidade ou painel sujo").

### 3.3. Exportação de Relatórios & Estilo de Impressão (PDF)
- **Barra de Ações de Exportação:**
  - Botão "Exportar CSV" (download direto com nome de arquivo semântico).
  - Botão "Relatório PDF / Imprimir" (`window.print()`).
- **Regras CSS `@media print` Exclusivas:**
  - Ocultar cabeçalho de navegação, Bottom Nav, botões de ação e tabs de filtros (`display: none !important`).
  - Fundo forçado para branco (`bg-white`), texto em cinza escuro/preto para máxima nitidez e economia de toner.
  - Exibição de cabeçalho formal: Logo WattFlow, Nome do Usuário, Data/Hora da Emissão, Resumo dos KPIs do período selecionado e grade de métricas.

---

## 4. Modo Kiosk / Wall Panel de Parede (`src/pages/kiosk.tsx`)

### 4.1. Filosofia de Design: Quadro Elétrico & Dark OLED Puro
- **Ambiente-Alvo:** Tablets econômicos (iPad antigo, Galaxy Tab A, Fire HD ou Raspberry Pi Touch) instalados embutidos ou ao lado do quadro geral de distribuição de circuitos (QDC).
- **Fundo Preto Absoluto (`bg-black` / `#000000`):** Reduz o consumo do display OLED a níveis mínimos e previne que o tablet ilumine a área em excesso à noite.
- **Zero Distração / Zero Menus:** Sem barra de navegação, sem menus dropdown, sem rolagem de tela (`overflow-hidden h-screen`).

### 4.2. Elementos Visuais em Escala Macro (Visibilidade a 3-5 Metros)
1. **Gauge Central de Bateria (SOC %):**
   - Anel circular SVG de 260px de diâmetro com gradiente dinâmico (Verde > 80%, Âmbar 40-79%, Carmim < 40%).
   - Texto de percentual central em `text-7xl lg:text-8xl font-black tracking-tight`.
   - Estimativa de autonomia restante logo abaixo: `text-2xl font-semibold text-slate-300`.
2. **Cards de Potência Gigantes:**
   - **Geração Solar (PV):** Ícone Sun, valor em `text-5xl lg:text-6xl font-extrabold text-emerald-400`, subtítulo com total de kWh gerado hoje.
   - **Consumo Residencial (AC):** Ícone Zap, valor em `text-5xl lg:text-6xl font-extrabold text-amber-400`, subtítulo com custo horário aproximado.
3. **Diagrama Sinóptico de Fluxo de Potência (Power Flow):**
   - Visualização esquemática horizontal conectando:
     `[ Painéis Solares ] ──> [ EcoFlow Delta ] ──> [ Chave ATS ] ──> [ Cargas da Casa ]`
     `                                                    ▲`
     `                                         [ Rede Concessionária ]`
   - Setas pulsantes indicando a direção real da energia em tempo real.
   - Badge visual luminoso indicando a fonte ativa: `BATERIA SOLAR` (Verde pulsante) ou `CONCESSIONÁRIA` (Rosa/Carmim).
4. **Relógio Digital & Indicadores de Saúde:**
   - Relógio de precisão no canto superior direito (`HH:mm:ss`) e data por extenso.
   - Monitor térmico das células da EcoFlow: indicador de temperatura em graus Celsius com ícone Thermometer.

### 4.3. Screen Wake Lock API & Autonomia Contínua
- O componente Kiosk inicializa a **Screen Wake Lock API**:
```typescript
let wakeLock: WakeLockSentinel | null = null;
async function requestWakeLock() {
  if ("wakeLock" in navigator) {
    try {
      wakeLock = await navigator.wakeLock.request("screen");
    } catch (err) {
      console.warn("Wake Lock indisponível:", err);
    }
  }
}
```
- Reativação automática do wake lock ao disparar `visibilitychange` (`document.visibilityState === "visible"`).
- Suporte a alternância de tela cheia nativa (`document.documentElement.requestFullscreen()`).
- Auto-hide de botões de controle (Sair do Kiosk / Alternar Fullscreen) após 5 segundos de inatividade do cursor/toque.

---

## 5. Divisão de Tarefas do Squad

| Especialista | Módulo / Camada | Arquivos Alvo | Atribuições Detalhadas |
| :--- | :--- | :--- | :--- |
| **Apex** (Backend / APIs / Agregações) | Agregações & Exportação | `src/pages/api/statistics/history.ts`<br>`src/pages/api/statistics/export.ts`<br>`src/domain/services/AggregationEngine.ts`<br>`src/infrastructure/database/*` | 1. Implementar `history.ts` com validação Zod e motor de downsampling para `24h`, `7d`, `30d`, `year` e `today-vs-yesterday`.<br>2. Implementar `export.ts` gerando CSV RFC 4180 com cabeçalhos adequados e sanitização contra formula injection.<br>3. Otimizar queries Prisma/SQLite utilizando índices sobre `executedAt` e `userConfigurationId`.<br>4. Desenvolver testes unitários para a agregação temporal e conversão CSV. |
| **Prism** (Frontend / UI / Kiosk) | Gráficos, Filtros & Kiosk | `src/pages/statistics.tsx`<br>`src/pages/kiosk.tsx`<br>`src/components/Layout.tsx`<br>`src/components/PowerFlowDiagram.tsx`<br>`src/styles/globals.css` | 1. Integrar barra de filtros por abas em `statistics.tsx`.<br>2. Atualizar gráfico SVG para suportar multi-séries e Curva Sobreposta Hoje vs Ontem (linha tracejada).<br>3. Implementar botões de Exportação CSV e Relatório Impresso PDF com `@media print` customizado.<br>4. Desenvolver a página `kiosk.tsx` em Dark OLED puro (`#000000`), relógio, gauges gigantes e fluxo de potência.<br>5. Integrar Screen Wake Lock API e botão de acesso ao Modo Kiosk no Header do `Layout.tsx`. |
| **Sentry** (Tester QA) | Suíte Unitária & E2E | `tests/unit/aggregationEngine.test.ts`<br>`tests/unit/csvExport.test.ts`<br>`e2e/multitemporal-kiosk.spec.ts` | 1. Testes unitários para buckets de downsampling e sanitização CSV.<br>2. Suíte Playwright E2E validando filtros de período, download de CSV, acionamento do Modo Kiosk e ausência de scrolls indesejados. |
| **Sentinel** (Code Reviewer) | Quality Gate & Segurança | Todo o diff do PR | 1. Auditoria de performance nas queries de histórico (garantir ausência de estouro de memória no SQLite).<br>2. Validação rigorosa de prevenção de CSV Injection.<br>3. Conformidade visual Kiosk (Dark OLED `#000000`, a11y, touch targets). |

---

## 6. Critérios de Aceite para Homologação (DoD - Definition of Done)

1. **Agregação & Performance:**
   - As consultas para `24h`, `7d`, `30d` e `year` respondem em menos de **300ms** no backend.
   - O gráfico cliente renderiza suavemente com no máximo 300 pontos processados após downsampling.
2. **Curva Sobreposta Hoje vs Ontem:**
   - A visualização plota simultaneamente a curva de hoje e a curva de ontem alinhadas no mesmo eixo X (0h a 24h).
   - O badge de divergência percentual reflete a variação matemática real da geração solar.
3. **Exportação de Dados:**
   - O arquivo CSV é baixado com nome contendo range e timestamp, sem erros de codificação de caracteres (UTF-8 com BOM).
   - Fórmulas maliciosas são comprovadamente desarmadas.
   - A impressão em PDF (`Ctrl+P` / botão Imprimir) gera layout limpo sem menus, rodapés ou artefatos da web.
4. **Modo Kiosk Operacional:**
   - A rota `/kiosk` exibe tela cheia em fundo preto absoluto (`#000000`), sem scrollbars.
   - A Screen Wake Lock API é adquirida com sucesso e readquirida após reativação de visibilidade da aba.
   - Tipografia de bateria e potências legível a 3 metros de distância.
5. **Qualidade de Código & Testes:**
   - `npm test` verde em 100% da suíte unitária.
   - `npm run lint` e `npm run build` passam com zero erros.
   - `npx playwright test e2e/multitemporal-kiosk.spec.ts` aprovado.
