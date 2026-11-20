# ESPECIFICAÇÃO TÉCNICA: MÓDULO DE RETORNO SOBRE INVESTIMENTO (PAYBACK SOLAR & AMORTIZAÇÃO DO CAPEX)
**Projeto:** WATTFLOW (G:\projetos\wattflow)  
**Branch Alvo:** `feature/payback-amortizacao-solar` (derivada de `develop`)  
**Autor:** Atlas - Arquiteto & Planejador  
**Destinatários:** Maestro (Orquestrador), Apex (Backend/Domínio/API), Prism (Frontend/UI/Widgets/Gráficos), Sentry (Tester QA), Sentinel (Code Reviewer)  
**Documento de Referência:** `UPGRADES_E_MELHORIAS_UI.md` (Item 4.1)

---

## 1. Visão Geral & Objetivos Estratégicos
O WattFlow monitora e gerencia a microgeração solar residencial e a comutação automática da chave ATS. O investimento em infraestrutura solar (estações de energia EcoFlow DELTA 2 / Max / Pro, painéis solares monocristalinos, chaves ATS e cabeamento de corrente contínua/alternada) representa um dispêndio financeiro inicial relevante (**CAPEX**).

Embora o WattFlow já quantifique a economia financeira mensal e acumulada em R$ (`financialSavings`), o proprietário do sistema necessita de uma **visão analítica do Retorno sobre o Investimento (Payback / Break-Even)** para:
1. **Acompanhar a Amortização Real do Investimento:** Saber com precisão matemática quantos reais e qual porcentagem do investimento inicial já foi paga pela energia solar.
2. **Prever a Data Exata do Break-Even (Ponto de Equilíbrio):** Estimar quando o sistema atingirá 100% de amortização (payback simples e descontado com inflação tarifária ANEEL), passando a operar com lucro líquido puro.
3. **Calcular o Lucro Vitalício (ROI em 10 anos):** Projetar a economia total ao longo da vida útil das células LiFePO4 (~3.000 a 3.500 ciclos / 10 anos de operação).
4. **Visualizar a Curva de Amortização no Dashboard & Estatísticas:** Gráfico intuitivo mostrando a linha de investimento fixo vs. a curva ascendente de economia acumulada até o ponto de cruzamento.

---

## 2. Modelagem de Dados (prisma/schema.prisma)

Na tabela `user_configurations` (`UserConfiguration`), adicionar e harmonizar os seguintes campos:

```prisma
model UserConfiguration {
  id                            String             @id @default(uuid())
  ...
  // Parâmetros Financeiros de Retorno sobre Investimento (CAPEX / Payback)
  totalCapexBrl                 Float              @default(0.0)      // Investimento total no sistema (R$)
  installationDate              DateTime?          @default(now())    // Data de início da operação do sistema
  annualEnergyInflationRate     Float              @default(6.5)      // Inflação anual média da tarifa (% a.a., padrão Aneel)
  targetPaybackYears            Float              @default(3.0)      // Meta planejada de payback em anos
  capexNotes                    String?                               // Detalhamento opcional dos equipamentos
  ...
}
```

---

## 3. Arquitetura de Domínio & Serviços Backend (Apex - Backend)

### 3.1. Serviço de Domínio (`src/domain/services/PaybackCalculatorService.ts`)
Novo serviço singleton para consolidação das métricas financeiras de payback:

```typescript
export interface PaybackAnalysisResponse {
  isConfigured: boolean;
  totalCapexBrl: number;
  installationDateIso: string;
  daysInOperation: number;
  totalAccumulatedSavingsBrl: number;
  amortizedAmountBrl: number;
  remainingBalanceBrl: number;
  amortizationPercentage: number;
  accumulatedRoiPercentage: number;
  isBreakEvenAchieved: boolean;
  actualBreakEvenDateIso: string | null;
  dailyAverageSavingsBrl: number;
  monthlyProjectedSavingsBrl: number;
  annualProjectedSavingsBrl: number;
  simplePayback: {
    estimatedBreakEvenDateIso: string | null;
    remainingDaysEstimate: number;
    remainingMonthsEstimate: number;
    remainingYearsEstimate: number;
  };
  discountedPayback: {
    annualEnergyInflationRate: number;
    estimatedBreakEvenDateIso: string | null;
    remainingYearsEstimate: number;
  };
  tenYearProjection: {
    lifetimeGrossSavingsBrl: number;
    lifetimeNetProfitBrl: number;
    lifetimeRoiPercentage: number;
  };
  amortizationCurvePoints: Array<{
    monthIndex: number;
    label: string; // Ex: "Mai/26"
    dateIso: string;
    capexThresholdBrl: number;
    accumulatedSavingsBrl: number;
    isProjected: boolean;
  }>;
}

export class PaybackCalculatorService {
  private static instance: PaybackCalculatorService | null = null;

  public static getInstance(): PaybackCalculatorService;

  public calculate(params: {
    totalCapexBrl: number;
    installationDate: Date;
    totalAccumulatedSavingsBrl: number;
    annualEnergyInflationRate?: number;
    targetPaybackYears?: number;
    now?: Date;
  }): PaybackAnalysisResponse;
}
```

### 3.2. Regras e Fórmulas Matemáticas
1. **Ritmo Operacional Diário:**
   `daysInOperation = Math.max(1, Math.floor((now - installationDate) / 86400000))`
   `dailyVelocity = totalAccumulatedSavingsBrl / daysInOperation`
2. **Amortização e Saldo:**
   `amortizedAmount = Math.min(totalCapexBrl, totalAccumulatedSavingsBrl)`
   `remainingBalance = Math.max(0, totalCapexBrl - totalAccumulatedSavingsBrl)`
   `amortizationPercentage = totalCapexBrl > 0 ? (amortizedAmount / totalCapexBrl) * 100 : 0`
3. **Payback Simples (Break-Even):**
   - Se `remainingBalance === 0`: Break-even já atingido (`isBreakEvenAchieved = true`).
   - Se `dailyVelocity > 0`:
     `remainingDays = Math.ceil(remainingBalance / dailyVelocity)`
     `estimatedBreakEvenDate = new Date(now.getTime() + remainingDays * 86400000)`
4. **Payback Descontado (Com Inflação Energética da ANEEL):**
   - Considera que as tarifas sofrem reajustes anuais de `annualEnergyInflationRate` (padrão 6.5% a.a.), acelerando a amortização nos anos subsequentes:
     `savingsYearN = annualProjectedSavingsBrl * Math.pow(1 + inflationRate / 100, n - 1)`
5. **Lucro Vitalício em 10 Anos (LiFePO4):**
   `lifetimeGross = sum_{n=1}^{10} (savingsYearN)`
   `lifetimeNetProfit = lifetimeGross - totalCapexBrl`
   `lifetimeRoi = totalCapexBrl > 0 ? ((lifetimeNetProfit) / totalCapexBrl) * 100 : 0`

### 3.3. Endpoints REST (`/api/finance/payback.ts`)
- **`GET /api/finance/payback`:**
  - Requer autenticação de sessão (`wattflow_session`). Retorna `401 Unauthorized` se não autenticado.
  - Consulta `userConfiguration` e consolida os dados de `SyncExecutionLog`.
  - Retorna o DTO completo `PaybackAnalysisResponse` em `< 100ms`.
- **`POST /api/finance/payback` (ou extensão de `/api/settings`):**
  - Permite atualizar os parâmetros de investimento com validação Zod:
    * `totalCapexBrl`: `z.number().min(0).max(1000000)`
    * `installationDate`: `z.string().datetime().or(z.string().regex(/^\d{4}-\d{2}-\d{2}$/)).optional()`
    * `annualEnergyInflationRate`: `z.number().min(0).max(30).optional()`
    * `targetPaybackYears`: `z.number().min(0.5).max(20).optional()`
    * `capexNotes`: `z.string().max(500).optional()`

---

## 4. Frontend & Experiência de Usuário (Prism - Frontend)

### 4.1. Widget Executivo de Payback no Dashboard (`src/components/PaybackSummaryWidget.tsx`)
Card destacado no topo do Dashboard (`src/pages/index.tsx`):
- **Barra de Progresso com Gradiente:**
  - Visualização de 0% a 100% com preenchimento em Esmeralda/Teal.
  - Valores destacados: `R$ 4.250 / R$ 12.000` • `35,4% Amortizado`.
- **Badge de Break-Even:**
  - Se amortizado: `🎉 INVESTIMENTO 100% AMORTIZADO • Lucro Líquido Ativo` (Verde Esmeralda).
  - Em amortização: `🎯 Break-Even Estimado em 2.1 Anos (Maio/2028)` (Azul Céu).
- **Sub-indicadores Rápidos:**
  - Ritmo de Economia: `~R$ 380/mês`.
  - Saldo Restante: `R$ 7.750`.
  - Lucro Projetado em 10 Anos: `+R$ 34.200`.

### 4.2. Seção de Curva de Amortização em Estatísticas (`src/pages/statistics.tsx`)
Card interativo detalhado:
- **Gráfico Multi-Série SVG:**
  - Linha Horizontal Vermelho-Coral/Cinza: Linha do Investimento Inicial (CAPEX).
  - Linha Contínua Esmeralda: Economia Real Acumulada.
  - Linha Tracejada Azul Claro: Projeção Futura até o Cruzamento (Break-Even).
  - Marcador circular com bandeira no Ponto Exato de Break-Even.
- **Tabela de Projeção Anual (Ano 1 ao Ano 10):**
  - Colunas: Ano, Tarifa Projetada, Economia do Ano, Saldo devedor / Lucro acumulado, ROI %.

### 4.3. Seção de Configurações (`src/pages/settings.tsx`)
- Card: **"Investimento Inicial & Metas de Payback (CAPEX)"** com ícone `Wallet` / `TrendingUp`:
  - Input para Valor Total Investido (R$) com máscara monetária.
  - Input de Data de Início da Operação (com calendário / date picker).
  - Input para Taxa de Inflação da Energia Elétrica (% a.a., padrão 6.5%).
  - Input para Meta de Amortização Desejada (anos).
  - Campo de texto para anotações do CAPEX (ex: "EcoFlow Delta 2 + 4 painéis 100W + ATS ATS-63A").

---

## 5. Divisão de Tarefas do Squad

| Especialista | Módulo / Camada | Arquivos Alvo | Atribuições Detalhadas |
| :--- | :--- | :--- | :--- |
| **Apex** (Backend / Domínio / API) | Serviço de Cálculo & Endpoints | `prisma/schema.prisma`<br>`src/domain/services/PaybackCalculatorService.ts`<br>`src/pages/api/finance/payback.ts`<br>`src/infrastructure/validation/apiSchemas.ts`<br>`src/pages/api/settings.ts` | 1. Adicionar campos de CAPEX em `UserConfiguration` no schema Prisma e executar migration segura.<br>2. Implementar `PaybackCalculatorService.ts` com cálculo de payback simples, payback descontado, ritmo mensal e curva temporal de amortização.<br>3. Criar endpoint `/api/finance/payback` com autenticação de sessão e validações Zod.<br>4. Desenvolver suíte de testes unitários no Vitest cobrindo cálculos de break-even, inflação tarifária e projeção de 10 anos. |
| **Prism** (Frontend / UI / Widgets) | Componentes & Gráficos | `src/components/PaybackSummaryWidget.tsx`<br>`src/pages/index.tsx`<br>`src/pages/statistics.tsx`<br>`src/pages/settings.tsx` | 1. Desenvolver `PaybackSummaryWidget.tsx` com barra de progresso, valores em R$ e badge de break-even.<br>2. Integrar widget no Dashboard (`index.tsx`).<br>3. Criar card com gráfico SVG da curva de amortização (CAPEX vs Economia) em `statistics.tsx`.<br>4. Adicionar formulário de configuração de CAPEX em `settings.tsx`.<br>5. Garantir responsividade perfeita em 360px–430px sem overflow horizontal. |
| **Sentry** (Tester QA) | Testes & QA | `tests/unit/paybackCalculatorService.test.ts`<br>`tests/unit/paybackApi.test.ts`<br>`e2e/payback-roi.spec.ts` | 1. Testes unitários para cálculos de amortização, break-even e curva de projeção temporal.<br>2. Suíte Playwright E2E validando proteção 401 sem sessão, preenchimento do CAPEX em `/settings`, exibição do widget no Dashboard e renderização do gráfico de amortização. |
| **Sentinel** (Code Reviewer) | Quality Gate & Segurança | Todo o diff da branch | 1. Auditoria de sanidade matemática (prevenção de divisão por zero quando `totalCapexBrl === 0` ou sem economia).<br>2. Precisão decimal monetária (arredondamento seguro em centavos).<br>3. Conformidade WCAG 2.1 AA e integridade visual nos dispositivos móveis. |

---

## 6. Critérios de Aceite para Homologação (DoD - Definition of Done)

1. **Precisão Matemática Financeira:**
   - O cálculo de amortização nunca excede 100% nem exibe valores negativos no saldo restante.
   - O ponto de break-even reflete a projeção diária real de economia observada no histórico.
   - Cenários com CAPEX = 0 são tratados com elegância (indicando estado "Não configurado" sem quebrar a UI).
2. **Segurança de Endpoints:**
   - `/api/finance/payback` bloqueia requisições sem sessão válida com `401 Unauthorized`.
   - Entradas de formulário são estritamente sanitizadas por schema Zod.
3. **Experiência de Usuário & Mobile:**
   - O widget do Dashboard adapta-se fluidamente em viewports compactas (360px a 430px) com touch targets `>= 44x44px`.
   - O gráfico de amortização renderiza de forma nítida com tooltips interativos indicando a data de cruzamento.
4. **Qualidade de Código & Testes:**
   - 100% dos testes unitários no Vitest aprovados (`npm test`).
   - 100% dos testes E2E do fluxo de payback aprovados (`npx playwright test e2e/payback-roi.spec.ts`).
   - `npm run lint` e `npm run build` executam com zero erros e zero advertências.
