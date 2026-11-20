# ESPECIFICAÇÃO TÉCNICA: CALCULADORA DE ECONOMIA REAL (R$ ECONOMIZADOS & ROI)
**Projeto:** WATTFLOW (G:\projetos\wattflow)  
**Feature:** 1.2 - Calculadora de Economia Real (R$ Economizados & ROI)  
**Autor:** Atlas - Arquiteto & Planejador  
**Destinatários:** Maestro (Orquestrador), Apex (Backend), Prism (Frontend), Sentry (QA)  

---

## 1. Visão Geral & Proposta de Valor
A geração solar e a comutação da ATS alimentam as cargas residenciais diretamente via energia limpa e gratuita gerada pelos painéis e armazenada na EcoFlow. Cada kWh fornecido pela saída AC da estação representa energia que **deixou de ser faturada pela concessionária de energia elétrica**.
- **Tarifa Padrão de Referência:** R$ 0,92 por kWh (média nacional residencial com tributos/bandeira).
- **Moeda Padrão:** "R$" (Customizável para "$", "€", etc.).
- **Objetivo da Feature:** Computar a economia financeira real e acumulada do usuário em 3 horizontes temporais (Hoje, Mês Atual e Total Acumulado), exibindo a métrica de retorno sobre investimento (ROI) e energia limpa consumida.

---

## 2. Modelagem de Dados (prisma/schema.prisma)
No modelo `UserConfiguration`:

```prisma
model UserConfiguration {
  id                    String             @id @default(uuid())
  userId                String             @unique
  user                  User               @relation(fields: [userId], references: [id], onDelete: Cascade)
  ...
  // Parâmetros da Calculadora Financeira de Economia Real
  energyCostPerKwh      Float              @default(0.92)
  currencySymbol        String             @default("R$")
  ...
  createdAt             DateTime           @default(now())
  updatedAt             DateTime           @updatedAt
  syncExecutionLogs     SyncExecutionLog[]

  @@map("user_configurations")
}
```

### Explicação dos Campos:
1. `energyCostPerKwh`: Tarifa da concessionária por quilowatt-hora (ex: 0.92 = R$ 0,92/kWh). Permite ajuste fino pelo usuário conforme sua fatura de luz (com impostos ICMS/PIS/COFINS).
2. `currencySymbol`: Símbolo monetário adotado na interface (padrão: "R$").

---

## 3. Algoritmo de Cálculo de Energia & Agregação Backend (Apex - Backend)

### 3.1. Algoritmo de Integração Trapezoidal / Riemann entre Leituras de Telemetria
Diferente da geração teórica, o consumo solar atendido é medido através do campo `outputWatts` registrado em cada log `SyncExecutionLog`.
Para calcular a energia entregue em Watt-hora (Wh) e quilowatt-hora (kWh) em um período:

$$\Delta t_i = \min\left(\frac{t_i - t_{i-1}}{3600 	imes 1000},\; \Delta t_{	ext{max}}\right) \quad (	ext{em horas})$$

$$	ext{Energia (Wh)} = \sum_{i=1}^{n} \left( \frac{	ext{outputWatts}_{i} + 	ext{outputWatts}_{i-1}}{2} \right) 	imes \Delta t_i$$

- **Trava de Continuidade ($\Delta t_{	ext{max}}$):** Se o intervalo entre duas medições for superior a 15 minutos (900s) — por exemplo, desligamento do sistema ou suspensão —, o algoritmo descarta o período ocioso e calcula a amostra como $	ext{outputWatts}_i 	imes (10 / 3600)$ (amostra de 10s padrão), evitando extrapolação incorreta de consumo durante períodos desligados.
- $	ext{kWh} = \frac{	ext{Wh}}{1000}$.
- $	ext{Economia (R\$)} = 	ext{kWh} 	imes 	ext{energyCostPerKwh}$.

### 3.2. Janelas de Agregação em `/api/statistics.ts`
O endpoint compilará o nó `financialSavings`:

1. **Hoje (`todayKwh` / `todaySavings`):**
   - Logs filtrados desde a meia-noite do dia corrente (`new Date().setHours(0,0,0,0)`).
2. **Mês Corrente (`monthKwh` / `monthSavings`):**
   - Logs filtrados desde o primeiro dia do mês corrente às 00:00:00 (`new Date(now.getFullYear(), now.getMonth(), 1)`).
3. **Total Acumulado (`totalKwh` / `totalSavings`):**
   - Agregação de todo o histórico do usuário em `sync_execution_logs`. Para garantir performance mesmo com dezenas de milhares de logs, utilizar agregação baseada em média ponderada ou cálculo SQL agregado:
     - Duração total ativa $	imes$ potência média de saída, ou agregação diária pré-compilada.
4. **Tarifa & Moeda:**
   - `energyCostPerKwh`: número configurado pelo usuário.
   - `currencySymbol`: string configurada.

### Estrutura do Payload de Retorno em `/api/statistics`:
```json
{
  "financialSavings": {
    "todayKwh": 4.82,
    "todaySavings": 4.43,
    "monthKwh": 89.40,
    "monthSavings": 82.25,
    "totalKwh": 342.10,
    "totalSavings": 314.73,
    "energyCostPerKwh": 0.92,
    "currencySymbol": "R$"
  }
}
```

---

## 4. Endpoints & Validação Zod (Apex - Backend)

### 4.1. `src/infrastructure/security/apiSchemas.ts`
Atualizar `settingsPostBodySchema`:
```typescript
export const settingsPostBodySchema = z.object({
  ...
  energyCostPerKwh: z
    .number({ message: "Tarifa de energia deve ser um número." })
    .positive("Tarifa de energia deve ser maior que zero.")
    .max(50, "Tarifa de energia excede o valor máximo permitido.")
    .optional(),
  currencySymbol: z
    .string()
    .trim()
    .min(1, "Símbolo monetário é obrigatório.")
    .max(8, "Símbolo monetário deve possuir no máximo 8 caracteres.")
    .optional(),
});
```

### 4.2. `src/pages/api/settings.ts`:
- **GET:** Expor `energyCostPerKwh` (default: 0.92) e `currencySymbol` (default: "R$").
- **POST:** Aceitar e persistir os campos no `upsert` do `UserConfiguration`.

---

## 5. Interface Gráfica do Usuário (Prism - Frontend)

### 5.1. `src/pages/settings.tsx`:
- Novo bloco/card ou integração na seção de perfil energético: **"Tarifa de Energia & Economia Financeira"**:
  - Input para **Tarifa por kWh (ex: R$ 0,92)**: com máscara/formatação decimal e tooltip explicativo: *"Consulte o valor do kWh na sua fatura da distribuidora (incluindo tributos e bandeira tarifária)."*
  - Input para **Símbolo da Moeda**: padrão `R$`.

### 5.2. `src/pages/statistics.tsx` & `src/pages/index.tsx`:
- **Card Executivo de Alto Impacto: "Economia Financeira Real (R$)"**:
  - Destaque principal com ícone `PiggyBank` ou `CircleDollarSign` em tom esmeralda/dourado (`text-emerald-400`).
  - **Métrica Principal:** Economia Acumulada no Mês (`R$ 82,25`) com badge de energia atendida (`89,4 kWh poupados da rede`).
  - **Grid de 3 Colunas de Apoio:**
    1. **Hoje:** `R$ 4,43` (4,8 kWh)
    2. **Este Mês:** `R$ 82,25` (89,4 kWh)
    3. **Total Acumulado:** `R$ 314,73` (342,1 kWh)
  - **Badge de Tarifa Aplicada:** *"Calculado com base em R$ 0,92 / kWh"*.
  - Animação suave e visual premium com design system do WattFlow (Tailwind slate-900/backdrop-blur).

---

## 6. Critérios de Aceite para QA (Sentry - Tester QA)
1. **Migração & Banco:** `prisma db push` aplica `energyCostPerKwh` (0.92) e `currencySymbol` ("R$") sem falhas e sem corromper registros legados.
2. **Validação Zod:** Bloqueio de tarifas negativas, zero ou caracteres inválidos no endpoint `/api/settings`.
3. **Fórmula Matemática:** Comprovação via teste unitário de que 10 kWh com tarifa de R$ 0,92 resulta exatamente em R$ 9,20.
4. **Precisão de Integração:** O cálculo de kWh deve considerar potência de saída real e delta de tempo, descartando gaps de desligamento superiores a 15 minutos.
5. **Multi-moeda:** Se o usuário alterar para `"$"` e `0.25`, a interface e a API devem calcular e renderizar `$ 2.50` para 10 kWh.
6. **Responsividade:** Renderização impecável no desktop (1920px) e mobile (390px) sem quebra de layouts.
