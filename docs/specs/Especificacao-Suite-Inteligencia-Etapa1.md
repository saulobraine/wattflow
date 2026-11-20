# ESPECIFICAÇÃO TÉCNICA: SUÍTE DE INTELIGÊNCIA OPERACIONAL (ETAPA 1)
**Projeto:** WATTFLOW (G:\projetos\wattflow)  
**Pacote:** Etapa 1 - Inteligência, Segurança de Contingência & Retorno Financeiro  
**Features:** 
- Feature 1.2: Calculadora de Economia Real (R$ Economizados & ROI)
- Feature 2.1: Estimador Dinâmico de Autonomia (Tempo Restante em Horas/Minutos)
- Feature 2.2: Modo Tempestade / Apagão (Storm Mode / Contingência 100% Reserva)
- Feature 5.1: Relatório Executivo Noturno via WhatsApp (CallMeBot às 21h)
**Autor:** Atlas - Arquiteto & Planejador  
**Destinatários:** Maestro (Orquestrador), Apex (Backend), Prism (Frontend), Sentry (QA)  

---

## 1. Visão Geral da Suíte (Etapa 1)
O objetivo do pacote unificado da Etapa 1 é transformar o WattFlow de um mero automatizador em uma central de inteligência e segurança energética:
1. **Economia Real:** Computar os R$ economizados da concessionária pelo uso da energia solar gerada e armazenada.
2. **Autonomia Preditiva:** Projetar quanto tempo de energia a residência ainda possui caso ocorra um blecaute neste momento.
3. **Modo Tempestade:** Proteger a residência em dias de intempéries, suspendendo a histerese para acumular e manter a bateria em 100% antes que a rede caia.
4. **Relatório Noturno:** Entregar no WhatsApp do proprietário o resumo do dia às 21h (energia gerada, economia em R$, ciclos da ATS e status do sistema).

---

## 2. Modelagem de Dados (prisma/schema.prisma)
Na tabela `user_configurations` (`model UserConfiguration`), adicionar os campos:

```prisma
model UserConfiguration {
  id                    String             @id @default(uuid())
  userId                String             @unique
  user                  User               @relation(fields: [userId], references: [id], onDelete: Cascade)
  ...
  // 1.2 Calculadora de Economia Real
  energyCostPerKwh      Float              @default(0.92)
  currencySymbol        String             @default("R$")

  // 2.1 Estimador Dinâmico de Autonomia
  batteryCapacityWh     Int                @default(2048) // Ex: DELTA 2 Max = 2048Wh, DELTA 2 = 1024Wh, DELTA Pro = 3600Wh

  // 2.2 Modo Tempestade / Apagão
  isStormModeActive     Boolean            @default(false)

  // 5.1 Relatório Noturno WhatsApp
  isDailyReportActive   Boolean            @default(true)
  dailyReportTime       String             @default("21:00") // Formato HH:mm
  lastDailyReportSentAt DateTime?          // Evita disparos duplicados no mesmo dia
  ...
  createdAt             DateTime           @default(now())
  updatedAt             DateTime           @updatedAt
  syncExecutionLogs     SyncExecutionLog[]

  @@map("user_configurations")
}
```

---

## 3. Arquitetura & Implementação Backend (Apex - Backend)

### 3.1. Validação Zod (`src/infrastructure/security/apiSchemas.ts`)
Estender `settingsPostBodySchema`:
```typescript
export const settingsPostBodySchema = z.object({
  ...
  // Economia Real
  energyCostPerKwh: z.number().positive("Tarifa de energia deve ser maior que zero.").max(50).optional(),
  currencySymbol: z.string().trim().min(1).max(8).optional(),

  // Autonomia
  batteryCapacityWh: z.number().int().min(200, "Capacidade mínima de 200Wh.").max(50000, "Capacidade máxima de 50.000Wh.").optional(),

  // Modo Tempestade
  isStormModeActive: z.boolean().optional(),

  // Relatório Diário
  isDailyReportActive: z.boolean().optional(),
  dailyReportTime: z.string().regex(/^([01]\d|2[0-3]):([0-5]\d)$/, "Horário inválido. Utilize o formato HH:mm (ex: 21:00).").optional(),
});

export const stormModePostBodySchema = z.object({
  isStormModeActive: z.boolean({ message: "Flag isStormModeActive deve ser booleana." }),
});
```

### 3.2. Endpoints de Configuração & Modo Tempestade
1. `/api/settings`:
   - `GET`: Retornar os novos campos com seus respectivos defaults.
   - `POST`: Persistir os campos no `upsert` do `UserConfiguration`.
2. `/api/storm-mode` (POST) [Novo Endpoint]:
   - Endpoint rápido com proteção CSRF e sessão autenticada.
   - Permite o toggle instantâneo da flag `isStormModeActive` sem trafegar todo o formulário de configurações.
   - Retorna o novo estado e status de proteção ativa.

### 3.3. Comportamento no `OrchestratorSyncUseCase.ts` (Modo Tempestade)
No fluxo de automação:
```typescript
const isStormMode = configurationRecord.isStormModeActive;

if (isStormMode) {
  // Em Modo Tempestade: a residência é mantida na Concessionária e a saída AC é desligada se estiver ligada
  // para permitir que a bateria carregue até 100% (via solar e/ou rede) e permaneça em reserva total.
  if (isAcOutputEnabled === true) {
    await ecoflowClient.setAcOutputState(ecoflowDevice, false);
    await this.repository.incrementAtsCycle(databaseRecordId);
    this.dispatchSafeAlert({
      title: "Modo Tempestade Ativo",
      message: "Saída AC desligada. Cargas comutadas para a Concessionária para preservar 100% de reserva na bateria.",
      batteryPercentage: numericBattery,
      solarWatts: numericSolarWatts,
      actionState: "GRID",
    }, notificationConfig);
  }
  actionResult = "Modo Tempestade / Alerta de Apagão Ativo: comutação suspensa, bateria preservada em reserva máxima.";
  actionName = "STORM_MODE_RESERVE";
} else if (isAutomationEnabled) {
  // Segue fluxo normal de histerese (thresholdPair.evaluateBattery)
}
```

### 3.4. Estimador Dinâmico de Autonomia em `/api/statistics.ts`
Implementar o algoritmo físico de predição de tempo restante:
- **Energia Útil Armazenada (Wh):**
  $$E_{	ext{restante}} = 	ext{batteryCapacityWh} 	imes \left(\frac{	ext{batteryPercentage}}{100}\right)$$
- **Saldo de Potência Líquida ($\Delta W$):**
  $$	ext{netDrainWatts} = 	ext{outputWatts} - 	ext{solarInputWatts}$$
- **Lógica de Autonomia:**
  1. Se $	ext{outputWatts} \le 5$: `isIdle: true`, tempo de autonomia considerado virtualmente ilimitado (`runtimeHours: null`, status: "Em Espera / Standby").
  2. Se $	ext{solarInputWatts} \ge 	ext{outputWatts}$: A geração solar supre todo o consumo e ainda recarrega a bateria (`isRecharging: true`, tempo de descarregamento infinito enquanto houver sol).
  3. Se $	ext{netDrainWatts} > 0$ (Consumo superior à geração solar):
     $$	ext{runtimeHours} = \frac{E_{	ext{restante}}}{	ext{netDrainWatts}}$$
     $$	ext{runtimeMinutes} = 	ext{Math.round}(	ext{runtimeHours} 	imes 60)$$
- **Formatação amigável:** ex: `5h 20m` ou `12h 45m`.

### 3.5. Cron do Relatório Executivo Noturno (`/api/cron/daily-report` ou no Daemon)
Execução agendada (ex: sincronizada via cron Vercel ou loop do daemon local):
- Verifica usuários com `isDailyReportActive: true` e `isNotificationActive: true`.
- Janela: se a hora atual coincidir com `dailyReportTime` (ex: 21h) e `lastDailyReportSentAt` não for da data de hoje:
  1. Consulta a telemetria do dia (kWh gerados, kWh consumidos da bateria, economia em R$, ciclos ATS hoje).
  2. Monta template rico para WhatsApp via CallMeBot:
     ```text
     🌙 *WattFlow - Relatório Diário de Operação*
     📅 Data: 19/11/2026 às 21:00

     ☀️ Geração Solar Hoje: 6,4 kWh
     🔋 Bateria Atual: 94% (Autonomia est: ~11h)
     💰 Economia de Hoje: R$ 5,88 (acumulado mês: R$ 82,25)
     ⚡ Chave ATS: 2 comutações hoje (9.818 ciclos restantes)
     🛡️ Status: Sistema 100% Operacional

     _WattFlow - Energia Inteligente_
     ```
  3. Dispara via `NotificationDispatcher.dispatchNotification` e atualiza `lastDailyReportSentAt = new Date()`.

---

## 4. Interface do Usuário (Prism - Frontend)

### 4.1. Dashboard Principal (`src/pages/index.tsx`)
1. **Banner & Toggle de Modo Tempestade (Topo):**
   - Switch de ativação rápida com ícone `CloudLightning` / `ShieldAlert`.
   - Quando ativado: banner de alerta amarelo/âmbar no topo do dashboard:
     *"⚠️ Modo Tempestade Ativo: A residência está conectada à concessionária para manter 100% de reserva na bateria para emergências."*
2. **Card de Autonomia Preditiva Dinâmica:**
   - Ícone `Hourglass` / `BatteryCharging` com texto em destaque: **"Autonomia Estimada: 7h 45m"**.
   - Subtexto explicativo: *"Consumo residencial atual: 280W | Geração solar: 0W"*.
   - Badge inteligente: se estiver recarregando pelo sol, exibe *"Geração supera consumo — Bateria carregando"*.
3. **Card de Economia Financeira Real:**
   - Destaque da economia do dia (`R$ 5,88`) e do mês (`R$ 82,25`) ao lado dos gráficos de potência.

### 4.2. Tela de Configurações (`src/pages/settings.tsx`)
1. **Seção de Capacidade & Bateria:**
   - Campo para `batteryCapacityWh` (default: 2048 Wh) com selector de presets (EcoFlow DELTA 2: 1024Wh, DELTA 2 Max: 2048Wh, DELTA Pro: 3600Wh, ou Personalizado).
2. **Seção de Tarifa & Moeda:**
   - Inputs para `energyCostPerKwh` (R$ 0,92) e `currencySymbol` (R$).
3. **Seção do Relatório Executivo WhatsApp:**
   - Toggle `isDailyReportActive` e input de horário `dailyReportTime` (default: 21:00).
   - Botão *"Enviar Relatório de Teste Agora"*.

---

## 5. Critérios de Aceite para QA (Sentry - Tester QA)
1. **Prisma:** Migração executada sem perda de dados com todos os 6 novos campos e defaults garantidos.
2. **Modo Tempestade:**
   - Toggle em `/api/storm-mode` desativa saída AC caso esteja ligada.
   - Ciclo de sincronização (`OrchestratorSyncUseCase`) não liga a saída AC enquanto a flag estiver ativa, mesmo que a bateria atinja 100%.
3. **Estimativa de Autonomia:**
   - Teste matemático: 2048Wh a 50% de carga (1024Wh) com consumo estável de 512W e 0W solar deve retornar exatamente 120 minutos (2h 00m).
   - Com consumo 0W ou solar > consumo, a interface não deve exibir valores infinitos (`Infinity` ou `NaN`), tratando adequadamente.
4. **Calculadora Financeira:**
   - Cálculo estrito: $	ext{kWh} 	imes 	ext{tarifa}$. Validação de formatação monetária respeitando `currencySymbol`.
5. **Relatório WhatsApp:**
   - Disparo formatado com sucesso sem caracteres quebrados ou falha de timeout.
   - Idempotência: o relatório não deve ser enviado mais de 1 vez no mesmo dia.
