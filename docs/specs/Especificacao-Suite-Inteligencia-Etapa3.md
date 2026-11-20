# ESPECIFICAÇÃO TÉCNICA: SUÍTE DE INTELIGÊNCIA OPERACIONAL (ETAPA 3)
**Projeto:** WATTFLOW (G:\projetos\wattflow)  
**Pacote:** Etapa 3 - Tarifas Dinâmicas / Horário de Ponta & Alertas Críticos Multi-Canal  
**Features:** 
- Feature 1.1: Tarifas Dinâmicas / Horário de Ponta (Tarifa Branca & Otimização Financeira)
- Feature 5.2: Alertas Críticos em Tempo Real (WhatsApp via CallMeBot & Telegram Bot com Anti-Flood)
**Autor:** Atlas - Arquiteto & Planejador  
**Destinatários:** Maestro (Orquestrador), Apex (Backend), Prism (Frontend), Sentry (QA)  

---

## 1. Visão Geral da Etapa 3
A Etapa 3 consolida a inteligência econômica e a segurança operacional máxima do ecossistema WattFlow:
1. **Tarifas Dinâmicas (Tarifa Branca):** A concessionária cobra até 3x mais caro no Horário de Ponta (17h30 às 20h30). O WattFlow sincroniza o descarregamento da EcoFlow exatamente nessa janela, forçando a residência a consumir 100% da bateria/solar no horário mais caro, gerando o maior ROI financeiro possível.
2. **Alertas Críticos em Tempo Real:** Monitoramento proativo com disparos instantâneos paralelos no WhatsApp e no Telegram para situações de risco (queda da rede, sobrecarga do inversor > 90%, sobreaquecimento de células e falha de comutação da ATS) com trava anti-flood de 10 minutos para evitar spam.

---

## 2. Modelagem de Dados (prisma/schema.prisma)

### 2.1. Alterações no modelo `UserConfiguration`
```prisma
model UserConfiguration {
  id                         String             @id @default(uuid())
  userId                     String             @unique
  user                       User               @relation(fields: [userId], references: [id], onDelete: Cascade)
  ...
  // Feature 1.1: Tarifas Dinâmicas (Tarifa Branca)
  isDynamicTariffActive      Boolean            @default(false)
  peakTariffPerKwh           Float              @default(1.85) // R$/kWh no Horário de Ponta
  intermediateTariffPerKwh   Float              @default(1.15) // R$/kWh no Horário Intermediário
  offPeakTariffPerKwh        Float              @default(0.65) // R$/kWh Fora de Ponta
  peakStartTime              String             @default("17:30") // Início da Ponta (HH:mm)
  peakEndTime                String             @default("20:30") // Fim da Ponta (HH:mm)
  intermediateStartTime1     String             @default("16:30") // Intermediário pré-ponta
  intermediateEndTime1       String             @default("17:30")
  intermediateStartTime2     String             @default("20:30") // Intermediário pós-ponta
  intermediateEndTime2       String             @default("21:30")
  peakReserveThreshold       Int                @default(15) // Limite de corte agressivo na ponta (ex: desce até 15%)

  // Feature 5.2: Alertas Críticos em Tempo Real & Cooldowns
  inverterMaxWatts           Int                @default(2400) // Capacidade nominal do inversor (ex: 2400W Delta 2 Max)
  isAlertOnBlackout          Boolean            @default(true)
  isAlertOnGridRestore       Boolean            @default(true)
  isAlertOnOverload          Boolean            @default(true)
  isAlertOnThermalRisk       Boolean            @default(true)
  isAlertOnAtsFailure        Boolean            @default(true)
  alertCooldownMinutes       Int                @default(10) // Trava anti-flood (default: 10 minutos)
  ...
  createdAt                  DateTime           @default(now())
  updatedAt                  DateTime           @updatedAt
  syncExecutionLogs          SyncExecutionLog[]

  @@map("user_configurations")
}
```

---

## 3. Arquitetura Backend & Regras de Negócio (Apex - Backend)

### 3.1. Serviço Tarifário (`src/domain/services/TariffScheduleService.ts`)
Criar serviço de domínio puro para avaliar o período e a tarifa ativa com fuso de Brasília (`America/Sao_Paulo`):
- **Dias Úteis (Segunda a Sexta):**
  - Se hora:minuto $\in [	ext{peakStartTime}, 	ext{peakEndTime}[$: `PEAK` (Tarifa: `peakTariffPerKwh`).
  - Se hora:minuto $\in [	ext{intermediateStartTime1}, 	ext{intermediateEndTime1}[ \cup [	ext{intermediateStartTime2}, 	ext{intermediateEndTime2}[$: `INTERMEDIATE` (Tarifa: `intermediateTariffPerKwh`).
  - Demais horários: `OFF_PEAK` (Tarifa: `offPeakTariffPerKwh`).
- **Fins de Semana (Sábado e Domingo):**
  - 100% `OFF_PEAK` (conforme regulamentação da ANEEL).
- **Modo Estático:**
  - Se `isDynamicTariffActive === false`, retorna `OFF_PEAK` com a tarifa fixa `energyCostPerKwh`.

### 3.2. Lógica no `OrchestratorSyncUseCase.ts` (Priorização no Horário de Ponta)
No ciclo de decisão:
1. `isStormModeActive === true` $	o$ **Precedência Máxima:** suspende tudo e mantém 100% reserva na rede.
2. `isDynamicTariffActive === true` e período atual for `PEAK`:
   - O custo da rede elétrica está no patamar máximo (R$ 1,85+/kWh).
   - **Regra de Ouro da Ponta:** Se a bateria estiver com $	ext{SOC} \ge 	ext{peakReserveThreshold}$ (ex: 15%), a saída AC é mantida forçadamente **LIGADA** para que a residência consuma 100% da bateria/solar, impedindo o gasto com a concessionária.
   - Somente se a bateria cair abaixo de `peakReserveThreshold` (15%), a ATS transfere para a concessionária para evitar corte total por descarga profunda.
3. Fora do Horário de Ponta: segue a histerese adaptativa (solar) ou a histerese padrão configurada.

### 3.3. Agregação Financeira Ponderada em `/api/statistics.ts`
- O cálculo de economia real do dia e do mês passa a multiplicar cada Watt de saída consumido pela tarifa ativa no minuto exato da medição.
- Retorno de nó enriquecido:
  ```json
  "financialSavings": {
    "isDynamicTariffActive": true,
    "currentTariffPeriod": "PEAK",
    "currentTariffRate": 1.85,
    "todaySavings": 14.80,
    "todayKwh": 8.2,
    "peakSavingsToday": 10.45,
    "offPeakSavingsToday": 4.35,
    "monthSavings": 218.40,
    "currencySymbol": "R$"
  }
  ```

### 3.4. Sistema de Alertas Críticos em Tempo Real (`src/infrastructure/services/CriticalAlertService.ts`)
Criar gerenciador singleton com trava anti-flood em memória:
- **Gatilhos de Disparo:**
  1. `BLACKOUT_DETECTED`: Rede cai enquanto AC está ligada e residência passa a operar 100% isolada.
  2. `GRID_RESTORED`: Tensão da rede retorna após evento de apagão.
  3. `INVERTER_OVERLOAD`: `outputWatts >= (inverterMaxWatts * 0.90)`. Dispara alerta imediato para desligamento de eletrodomésticos pesados.
  4. `THERMAL_WARNING` ($\ge 45^\circ	ext{C}$) & `THERMAL_CRITICAL` ($\ge 50^\circ	ext{C}$ com desarme forçado).
  5. `ATS_ANOMALY`: Falha na resposta da chave de transferência.
- **Trava Anti-Flood:**
  - Armazena timestamp do último disparo de cada chave `userId:alertType`.
  - Ignora disparos adicionais se `elapsedMs < alertCooldownMinutes * 60 * 1000`.
  - Alertas de resolução (ex: retorno da rede ou alívio de carga) resetam o cooldown do alerta anterior para prontidão imediata.
- **Disparo Multi-Canal Paralelo:**
  - Utiliza `NotificationDispatcher.dispatchNotification`, disparando simultaneamente para Telegram Bot e WhatsApp (CallMeBot) via `Promise.allSettled`.

### 3.5. Contratos Zod & API (`apiSchemas.ts` e `/api/settings.ts`)
- Adicionar validações de horário (`HH:mm`), tarifas positivas ($> 0$ e $\le 50$) e flags de alerta no `settingsPostBodySchema`.

---

## 4. Requisitos de Interface & UX (Prism - Frontend)

### 4.1. Configurações (`src/pages/settings.tsx`)
1. **Card "Tarifas Dinâmicas & Horário de Ponta (Tarifa Branca)"**:
   - Switch de ativação da Tarifa Branca.
   - Grid com os 3 valores de tarifa (Ponta, Intermediário e Fora de Ponta).
   - Inputs de Horário com visual timeline (Início e Fim da Ponta e Intermediário).
   - Slider de "Corte Agressivo na Ponta" (ex: 15% de reserva mínima).
2. **Card "Alertas Críticos & Canais em Tempo Real"**:
   - Checkboxes de ativação para cada categoria de alerta (Apagão, Retorno, Sobrecarga, Térmico, ATS).
   - Seletor de Cooldown anti-flood (5 min, 10 min, 15 min).
   - Teste rápido de envio instantâneo em ambos os canais.

### 4.2. Dashboard Principal (`src/pages/index.tsx`) & Estatísticas (`src/pages/statistics.tsx`)
1. **Badge de Faixa Tarifária Ativa (Topo/Dashboard)**:
   - Indicador com cor dinâmica:
     - 🔴 **HORÁRIO DE PONTA (R$ 1,85/kWh)** — *"Alimentando residência pela bateria para blindar a conta de luz."*
     - 🟡 **INTERMEDIÁRIO (R$ 1,15/kWh)**
     - 🟢 **FORA DE PONTA (R$ 0,65/kWh)**
2. **Card de Sobrecarga do Inversor**:
   - Barra de carga com percentual de uso da saída AC frente à capacidade nominal (ex: `1420W / 2400W - 59%`). Se passar de 90%, pisca em alerta vermelho com aviso sonoro/visual.
3. **Card de Economia Segmentada**:
   - Gráfico de pizza ou barras mostrando quanto foi economizado especificamente no Horário de Ponta vs Fora de Ponta.

---

## 5. Critérios de Aceite para QA (Sentry - Tester QA)
1. **Tarifa Branca no Fim de Semana:** Comprovar que em sábados e domingos o sistema classifica 100% do tempo como `OFF_PEAK`, mesmo no horário das 18h.
2. **Priorização no Pico:** Em dia útil às 18h30 com bateria a 22% (abaixo do corte padrão de 30% mas acima de 15%), a saída AC deve permanecer **LIGADA** para economizar na ponta.
3. **Trava Anti-Flood:** Simulação de 10 chamadas consecutivas de sobrecarga dentro de 2 minutos deve disparar **apenas 1 notificação** no WhatsApp/Telegram.
4. **Sobrecarga Inversor:** Simulação de saída AC em 2200W (em inversor de 2400W = 91,6%) dispara alerta de sobrecarga com os detalhes da potência.
5. **Cálculo Ponderado:** Comprovar que 2 kWh gerados na ponta geram economia de $2 	imes 1.85 = 	ext{R\$} 3,70$, enquanto 2 kWh fora de ponta geram $2 	imes 0.65 = 	ext{R\$} 1,30$.
