# ESPECIFICAÇÃO TÉCNICA: MÓDULO DE RELATÓRIOS ANALÍTICOS & EXPORTAÇÃO EM CSV E PDF
**Projeto:** WATTFLOW (G:\projetos\wattflow)  
**Branch Alvo:** `feature/relatorios-exportacao-csv-pdf` (derivada de `develop`)  
**Autor:** Atlas - Arquiteto & Planejador  
**Destinatários:** Maestro (Orquestrador), Apex (Backend/Serviço/API), Prism (Frontend/UI/Modal/Print), Sentry (Tester QA), Sentinel (Code Reviewer)  
**Documento de Referência:** `UPGRADES_E_MELHORIAS_UI.md` (Item 4.2)

---

## 1. Visão Geral & Objetivos Estratégicos
O WattFlow acumula telemetria minuto a minuto contendo grandezas elétricas (Watts solares, Watts de saída AC, nível de bateria SOC %, temperatura das células LiFePO4, tensão, corrente e estados da chave comutadora ATS).
Proprietários de sistemas solares e estações EcoFlow necessitam de **relatórios analíticos executivos consolidados** para:
- **Prestação de Contas & Auditoria:** Demonstrar a economia financeira real proporcionada pelo sistema em relação à concessionária.
- **Análise de Eficiência Operacional:** Avaliar o Duty Cycle da Chave ATS (quantas horas a residência permaneceu alimentada por energia solar vs rede pública).
- **Estudos Técnicos & Homologação:** Exportação de dados brutos e agregados compatíveis com Excel, LibreOffice e planilhas eletrônicas no padrão pt-BR.
- **Fechamento Mensal Imprimível (PDF/A4):** Relatório de fechamento com diagramação executiva limpa, compatível com impressão direta ou salvamento em PDF em formato de folha A4.

---

## 2. Arquitetura de Dados & Backend (Apex - Backend)

### 2.1. Serviço Analítico de Relatórios (`src/domain/services/AnalyticalReportService.ts`)
Novo serviço de domínio responsável pela compilação estatística, cálculo de duty cycle e geração de arquivos exportáveis.

**Interfaces & DTOs:**
```typescript
export type ReportPeriod = "24h" | "7d" | "30d" | "month" | "custom";
export type ReportFormat = "csv" | "pdf" | "json";

export interface ReportExecutiveSummary {
  periodLabel: string;
  startDateIso: string;
  endDateIso: string;
  totalSolarGeneratedKwh: number;
  averageDailySolarKwh: number;
  peakSolarWatts: number;
  peakSolarAt: string;
  totalResidentialConsumedKwh: number;
  peakResidentialOutputWatts: number;
  peakResidentialAt: string;
  netEnergyBalanceKwh: number;
  totalEstimatedSavingsBrl: number;
  peakPeriodSavingsBrl: number;
  offPeakPeriodSavingsBrl: number;
  solarCoveragePercentage: number; // % da energia atendida pela bateria solar
  atsOperationMetrics: {
    hoursOnBattery: number;
    hoursOnGrid: number;
    batteryDutyCyclePercentage: number;
    gridDutyCyclePercentage: number;
    totalAtsSwitchesCount: number;
  };
  bmsHealthSummary: {
    averageSocPercentage: number;
    minTempCelsius: number;
    maxTempCelsius: number;
    averageTempCelsius: number;
    thermalThrottlingEventsCount: number;
    thermalCutoffEventsCount: number;
    estimatedCyclesConsumed: number;
    currentSohPercentage: number | null;
  };
}

export interface ReportDataPoint {
  timestampIso: string;
  formattedDatePtBr: string;
  batterySoc: number;
  solarWatts: number;
  outputWatts: number;
  netWatts: number;
  activeSource: "BATTERY" | "GRID";
  tariffPeriod: "PEAK" | "INTERMEDIATE" | "OFF_PEAK";
  savingsBrl: number;
  batteryTempCelsius: number | null;
  bmsEventNote: string;
}
```

### 2.2. Cálculo de Duty Cycle da ATS & Horas em Bateria
O cálculo do tempo de operação em bateria vs concessionária deve ser apurado por integração temporal entre os registros de `SyncExecutionLog`:
- **Condição Bateria:** Log com `actionTriggered === "ENABLE_ECOFLOW_AC"` ou `outputWatts > 0` e ausência de corte.
- **Condição Concessionária:** Log com `actionTriggered === "DISABLE_ECOFLOW_AC"` ou `actionTriggered === "AUTO_STORM_DEFENSE"` ou `actionTriggered === "THERMAL_CUTOFF_PROTECTION"`.
- As horas acumuladas são calculadas pela soma dos deltas temporais entre leituras consecutivas (`deltaHours = (t_atual - t_anterior) / 3600000`).

### 2.3. Formatação CSV Especializada (RFC 4180 / Padrão pt-BR)
- **Delimitador Padrão:** Ponto-e-vírgula (`;`), garantindo abertura automática com separação correta de colunas no Excel brasileiro.
- **Codificação:** UTF-8 com BOM (`\uFEFF`) para preservar acentuação gráfica sem falhas de mojibake.
- **Formatação Numérica:** Vírgula como separador decimal (ex: `14,85`), datas no padrão `DD/MM/AAAA HH:mm:ss`.
- **Cabeçalho Executivo de Metadados:**
```csv
# RELATÓRIO ANALÍTICO WATTFLOW - FECHAMENTO OPERACIONAL
# Período: 01/11/2026 a 20/11/2026 | Emissão: 20/11/2026 06:00:00
# Energia Solar Gerada: 142,50 kWh | Economia Financeira: R$ 138,42
# Horas em Bateria: 214,5 h (74,5%) | Horas na Concessionária: 73,5 h (25,5%)
# Comutações da ATS: 42 ciclos | Pico de Carga Residencial: 1840 W
# Temperatura Máxima do BMS: 38,4 °C | SOC Médio: 71,2 %
#
Data_Hora;Bateria_SOC_Percent;Geracao_Solar_Watts;Consumo_Residencial_Watts;Saldo_Liquido_Watts;Fonte_Ativa;Faixa_Tarifaria;Economia_Estimada_BRL;Temp_Bateria_Celsius;Notas_Operacionais
```
- **Proteção Mandatória contra CSV Injection (Formula Injection):**
  Qualquer célula que inicie com `=`, `+`, `-` ou `@` é desarmada com prefixo de apóstrofo (`'`).

### 2.4. Endpoint Dedicado (`GET /api/reports/export`)
- **Query Params (Validação Zod):**
  - `format`: `z.enum(["csv", "pdf", "json"]).default("csv")`
  - `period`: `z.enum(["24h", "7d", "30d", "month", "custom"]).default("30d")`
  - `startDate`: `z.string().optional()` (exige formato ISO ou YYYY-MM-DD quando `period === "custom"`)
  - `endDate`: `z.string().optional()`
  - `delimiter`: `z.enum([";", ","]).default(";")`
- **Headers HTTP:**
  - `Content-Type: text/csv; charset=utf-8` ou `text/html; charset=utf-8`
  - `Content-Disposition: attachment; filename="wattflow-relatorio-[periodo]-[timestamp].[ext]"`
  - `Cache-Control: no-store, no-cache, must-revalidate`

---

## 3. Frontend & Experiência de Usuário (Prism - Frontend)

### 3.1. Componente Modal de Relatórios (`src/components/ReportExportModal.tsx`)
Modal responsivo disparado pelo botão de exportação na página `/statistics`:
- **Seleção Dinâmica de Período:**
  - Pílulas de seleção: `Últimas 24 Horas`, `Últimos 7 Dias`, `Últimos 30 Dias`, `Mês Atual (Fechamento)` e `Personalizado (Campos De / Até)`.
- **Card de Prévia Executiva (Preview Sintético):**
  - Exibe antes do download os 4 principais indicadores do período selecionado:
    * Geração Total (kWh)
    * Economia Projetada (R$)
    * Tempo em Bateria (%)
    * Temperatura Máxima BMS (°C)
- **Botões de Ação com Feedback de Carregamento:**
  - `[ 📊 Baixar Planilha CSV ]` (Download direto do arquivo com separador `;` para Excel).
  - `[ 📄 Visualizar / Imprimir Relatório PDF ]` (Abre o relatório formatado para impressão A4 via `window.print()`).

### 3.2. Layout de Impressão Executivo A4 (`@media print`)
Estrutura visual dedicada ativada na impressão de relatórios:
- Fundo branco absoluto com tipografia escura de alto contraste.
- Ocultação automática de barras de navegação, Bottom Nav mobile, cabeçalho da página, botões e controles interativos (`no-print`).
- **Diagramação A4:**
  - Logotipo WattFlow e dados do comissionamento.
  - Tabela sintética consolidada com quebra de página controlada (`page-break-inside: avoid`).
  - Assinatura digital com hash de autenticidade dos dados.

---

## 4. Divisão de Tarefas do Squad

| Especialista | Módulo / Camada | Arquivos Alvo | Atribuições Detalhadas |
| :--- | :--- | :--- | :--- |
| **Apex** (Backend / Domínio / API) | Serviço & Endpoint | `src/domain/services/AnalyticalReportService.ts`<br>`src/pages/api/reports/export.ts`<br>`src/infrastructure/validation/apiSchemas.ts` | 1. Implementar `AnalyticalReportService.ts` com cálculo de duty cycle da ATS, agregações de kWh/R$, métricas térmicas e gerador de CSV RFC 4180 pt-BR.<br>2. Criar endpoint `/api/reports/export` com autenticação de sessão e validação Zod.<br>3. Blindar contra CSV Formula Injection.<br>4. Desenvolver suíte de testes unitários no Vitest cobrindo cálculos de duty cycle e formatação de arquivos. |
| **Prism** (Frontend / UI / Modal) | Componentes & Estilos | `src/components/ReportExportModal.tsx`<br>`src/pages/statistics.tsx`<br>`src/styles/globals.css` | 1. Construir o modal `ReportExportModal.tsx` com seletores de período, prévia de KPIs e botões de download.<br>2. Integrar o modal na página de Estatísticas (`statistics.tsx`).<br>3. Refinar estilos `@media print` para renderização executiva em formato A4.<br>4. Garantir responsividade perfeita em 360px–430px sem overflow. |
| **Sentry** (Tester QA) | Testes & QA | `tests/unit/analyticalReportService.test.ts`<br>`tests/unit/reportsExportApi.test.ts`<br>`e2e/reports-export.spec.ts` | 1. Testes unitários para cálculos de integração temporal de duty cycle da ATS e serialização CSV.<br>2. Suíte Playwright E2E validando bloqueio 401 sem sessão, abertura do modal de relatórios e download dos arquivos. |
| **Sentinel** (Code Reviewer) | Quality Gate & Segurança | Todo o diff da branch | 1. Auditoria rigorosa de segurança contra injeção de fórmulas CSV.<br>2. Validação de performance nas queries de agregação em períodos longos.<br>3. Conformidade WCAG 2.1 AA e integridade da impressão A4. |

---

## 5. Critérios de Aceite para Homologação (DoD - Definition of Done)

1. **Cálculo Fidedigno de Métricas:**
   - A soma de horas em bateria + horas na rede totaliza exatamente o tempo total do período analisado.
   - O percentual de cobertura solar reflete a proporção real de kWh consumidos da bateria.
2. **Compatibilidade e Segurança CSV:**
   - O arquivo CSV abre diretamente no Excel (pt-BR) com separação perfeita de colunas pelo delimitador `;`.
   - Caracteres especiais (`=`, `+`, `-`, `@`) são desarmados, eliminando riscos de execução remota de código.
3. **Relatório A4 / PDF:**
   - A impressão (`window.print()`) gera layout limpo sem elementos de interface, adaptado para página única ou múltiplas páginas sem cortes bruscos de linhas de tabela.
4. **Qualidade de Código & Testes:**
   - 100% dos testes unitários no Vitest aprovados (`npm test`).
   - 100% dos testes E2E do fluxo de relatórios aprovados (`npx playwright test e2e/reports-export.spec.ts`).
   - `npm run lint` e `npm run build` executam com zero erros e zero advertências.
