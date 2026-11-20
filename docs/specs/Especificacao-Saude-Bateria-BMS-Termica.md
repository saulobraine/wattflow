# ESPECIFICAÇÃO TÉCNICA: MONITORAMENTO DE SAÚDE DA BATERIA, CICLOS LIFEPO4 & PROTEÇÃO TÉRMICA DO BMS
**Projeto:** WATTFLOW (G:\projetos\wattflow)  
**Branch Alvo:** `feature/bms-battery-health-termica` (derivada de `develop`)  
**Autor:** Atlas - Arquiteto & Planejador  
**Destinatários:** Maestro (Orquestrador), Apex (Backend/Domínio/Orquestrador), Prism (Frontend/UI/Widgets/Kiosk), Sentry (Tester QA), Sentinel (Code Reviewer)  
**Documento de Referência:** `UPGRADES_E_MELHORIAS_UI.md` (Item 4.1 e 4.5)

---

## 1. Visão Geral & Objetivos Estratégicos
As estações de energia solar EcoFlow (Delta 2, Delta 2 Max, Delta Pro) utilizam células de Lítio-Ferro-Fosfato (**LiFePO4 / LFP**), projetadas para longa vida útil (~3.000 a 3.500 ciclos até 80% do State of Health - SOH).
No entanto, a operação em quadros de distribuição fechados ou ambientes de alta insolação no Brasil, combinada com recargas AC rápidas (1.200W a 2.400W) ou descargas contínuas de alta potência, pode levar a temperatura interna das células a patamares perigosos (> 45°C a 50°C).

Temperaturas excessivas aceleram a degradação química irreversível das células, geram risco de estufamento e acionam desligamentos abruptos do hardware.

**Missão do Ciclo:**
Transformar o WattFlow em um guardião da integridade física e longevidade do banco de baterias:
1. **Thermal Throttling Preventivo (Modulação Térmica de Recarga):** Se a temperatura das células atingir o limiar de alerta (`thermalWarningThreshold`, padrão 42°C), o sistema reduz imediatamente a potência de recarga AC para `thermalThrottleSpeedWatts` (padrão 200W), permitindo resfriamento sem cessar a recarga.
2. **Thermal Cutoff de Emergência (Proteção Absoluta contra Degradação):** Se a temperatura atingir o limiar de perigo (`thermalShutdownThreshold`, padrão 48°C), o sistema executa corte preventivo:
   - Comuta a ATS imediatamente para a Concessionária;
   - Desliga a saída AC da EcoFlow (`setAcOutputState(false)`);
   - Zera a recarga AC (`setAcChargingSpeed(0)`);
   - Mantém as células em repouso térmico completo até que a temperatura caia com histerese segura de resfriamento (-4°C, ou seja, <= 44°C).
3. **Notificações Críticas de Temperatura:** Disparo imediato de alerta emergencial no WhatsApp e Telegram ao atingir patamar severo, prevenindo surpresas térmicas.
4. **Analytics de Saúde LiFePO4 & SOH:** Projeção fidedigna de ciclos restantes (com base na curva DOD de 3.000 ciclos nominais a 80% SOH), estimativa de longevidade em anos baseada na taxa diária de ciclos e acompanhamento do SOH real reportado pelo BMS.
5. **Visibilidade Operacional & Kiosk:** Novo endpoint `GET /api/battery/health`, componente `BatteryHealthWidget.tsx` no Dashboard (`/`), monitor térmico OLED no `/kiosk` e calibração fina em `/automations`.

---

## 2. Modelagem de Dados (prisma/schema.prisma)

Na tabela `user_configurations` (`UserConfiguration`), harmonizar e estender os campos de proteção térmica:

```prisma
model UserConfiguration {
  id                         String             @id @default(uuid())
  ...
  // Parâmetros de Proteção Térmica & Saúde LiFePO4
  isThermalProtectionActive  Boolean            @default(true)  // Ativa throttling e cutoff térmico automático
  thermalWarningThreshold    Float              @default(42.0)  // Temperatura de início do Thermal Throttling (°C)
  thermalShutdownThreshold   Float              @default(48.0)  // Temperatura de Thermal Cutoff de emergência (°C)
  thermalThrottleSpeedWatts  Int                @default(200)   // Potência de recarga AC durante throttling (Watts)
  isThermalThrottleActive    Boolean            @default(false) // Flag de estado: Throttling ativo
  isThermalCutoffActive      Boolean            @default(false) // Flag de estado: Corte térmico ativo
  lastThermalEventAt         DateTime?                          // Timestamp do último evento térmico
  lastThermalActionMessage   String?                            // Detalhe da última intervenção térmica
  maxRecordedBatteryTemp     Float?                             // Pico histórico de temperatura registrado
  ...
}
```

---

## 3. Arquitetura Backend & Domínio (Apex - Backend)

### 3.1. Serviço de Domínio (`src/domain/services/BatteryHealthService.ts`)
Novo serviço singleton para cálculo de métricas de degradação e estados de risco térmico:

```typescript
export type ThermalRiskLevel = "OPTIMAL" | "WARM" | "THROTTLED" | "CRITICAL_CUTOFF";

export interface BatteryHealthMetrics {
  currentTempCelsius: number | null;
  maxRecordedTempCelsius: number | null;
  thermalRiskLevel: ThermalRiskLevel;
  isThermalProtectionActive: boolean;
  isThermalThrottleActive: boolean;
  isThermalCutoffActive: boolean;
  thermalWarningThreshold: number;
  thermalShutdownThreshold: number;
  thermalThrottleSpeedWatts: number;
  bmsSohPercentage: number | null;
  bmsCycleCount: number | null;
  nominalLifespanCycles: number;      // Padrão 3000 ciclos LiFePO4
  remainingCyclesEstimate: number;
  estimatedHealthPercentage: number;  // Saúde calculada ponderando SOH e ciclos
  estimatedYearsRemaining: number;
  dailyCycleRate: number;
  voltageVolts: number | null;
  amperageAmps: number | null;
  powerWatts: number | null;
  recentThermalTrend: Array<{ time: string; temperatureCelsius: number }>;
}

export class BatteryHealthService {
  public static getInstance(): BatteryHealthService;

  public evaluateThermalRisk(
    currentTemp: number | null,
    config: {
      isThermalProtectionActive: boolean;
      thermalWarningThreshold: number;
      thermalShutdownThreshold: number;
      isThermalCutoffActive?: boolean;
    }
  ): { riskLevel: ThermalRiskLevel; shouldCutoff: boolean; shouldThrottle: boolean; shouldRecover: boolean };

  public calculateLifespanEstimate(
    cycles: number | null,
    soh: number | null,
    nominalCycles = 3000,
    dailyRate = 1.0
  ): { remainingCycles: number; healthPercentage: number; estimatedYears: number };
}
```

### 3.2. Regras de Decisão no `OrchestratorSyncUseCase.ts`
A proteção térmica opera com **Prioridade Zero de Segurança**, precedendo a histerese solar e a tarifa horária:

```
                                  [ Leitura de Temperatura ]
                                               │
                         ┌─────────────────────┴─────────────────────┐
                         ▼                                           ▼
              Temp >= Shutdown (48°C)                    Temp >= Warning (42°C)
                         │                                           │
             [ THERMAL CUTOFF ATIVO ]                    [ THERMAL THROTTLING ]
             • Comuta ATS para Concessionária            • Reduz Recarga AC para 200W
             • Desliga Saída AC (EcoFlow OFF)            • Mantém Saída AC se houver carga
             • Zera Recarga AC (Speed = 0)               • Log: "Recarga modulada por calor"
             • Notificação Emergência WhatsApp
             • Histerese de Retorno: <= 44°C
```

1. **Gatilho de Thermal Cutoff (`Temp >= thermalShutdownThreshold`):**
   - Comuta a chave ATS para a Concessionária.
   - Desliga saída AC da EcoFlow (`setAcOutputState(false)`).
   - Zera potência de recarga AC (`setAcChargingSpeed(0)`).
   - Define `isThermalCutoffActive = true`.
   - Dispara alerta emergencial via WhatsApp e Telegram com trava anti-flood:
     *"🚨 [WattFlow Alerta Crítico BMS] Temperatura da bateria atingiu patamar crítico ({temp}°C >= {shutdown}°C). Saída AC desligada e cargas transferidas para a concessionária. Recarga suspensa para resfriamento das células."*
2. **Gatilho de Thermal Throttling (`Temp >= thermalWarningThreshold` e `< thermalShutdownThreshold`):**
   - Se a estação estiver recebendo recarga AC da rede concessionária ou excedente solar, reduz imediatamente a potência de recarga para `thermalThrottleSpeedWatts` (200W).
   - Define `isThermalThrottleActive = true`.
   - Log: *"⚠️ Temperatura elevada ({temp}°C). Recarga modulada para 200W para prevenir aquecimento."*
3. **Histerese Segura de Recuperação Térmica:**
   - Se `isThermalCutoffActive === true`, o sistema NÃO religa a bateria assim que a temperatura bater 47.9°C.
   - O cutoff só é desarmado quando a temperatura cair **4°C abaixo do limiar** (`Temp <= thermalShutdownThreshold - 4.0`), ou seja, <= 44°C, garantindo resfriamento real e estável.
   - Notificação de normalização térmica: *"🛡️ [WattFlow BMS] Bateria resfriada com sucesso ({temp}°C). Operação normal restabelecida."*

### 3.3. Novo Endpoint Dedicado (`GET /api/battery/health`)
Endpoint de alta fidelidade para visualização de diagnóstico térmico e degradação:
- Retorna o DTO completo `BatteryHealthMetrics`.
- Cache rápido em memória de 5s para prevenir sobrecarga de banco.

### 3.4. Validação Zod & Configurações (`/api/settings.ts` e `apiSchemas.ts`)
- `isThermalProtectionActive`: `z.boolean().optional()`
- `thermalWarningThreshold`: `z.number().min(35).max(50).optional()`
- `thermalShutdownThreshold`: `z.number().min(45).max(60).optional()`
- `thermalThrottleSpeedWatts`: `z.number().int().min(100).max(1000).optional()`

---

## 4. Frontend & Experiência de Usuário (Prism - Frontend)

### 4.1. Widget de Saúde da Bateria no Dashboard (`src/components/BatteryHealthWidget.tsx`)
Card visual de alto impacto no grid do Dashboard (`src/pages/index.tsx`):
- **Termômetro Cromático Semântico:**
  - Azul/Verde (< 38°C): `Temperatura Ideal` (Badge Verde Esmeralda).
  - Âmbar (39°C a 44°C): `Aquecimento Moderado` (Badge Âmbar).
  - Carmim/Vermelho (>= 45°C): `Alerta Térmico BMS` (Badge Vermelho Pulsante).
- **Barra de Saúde LFP (SOH %):**
  - Indicador de capacidade remanescente com marcador de 80% (fim de vida útil nominal).
- **Contador de Ciclos LiFePO4:**
  - `142 / 3.000 Ciclos` (~95.3% de vida restante).
- **Projeção de Longevidade:**
  - `~8.2 anos restantes` estimados com base no ritmo diário de uso.
- **Badge de Status de Proteção Ativa:**
  - Exibe `"🛡️ Proteção Térmica Ativa"` ou `"⚠️ Throttling Ativo (Recarga 200W)"` ou `"🚨 Corte de Emergência Ativo"`.

### 4.2. Indicador Térmico no Modo Kiosk (`src/pages/kiosk.tsx`)
- Display térmico OLED no cabeçalho do painel elétrico:
  - Ícone de termômetro e temperatura em destaque (ex: `31.4°C`).
  - Em caso de Throttling ou Cutoff, exibe aviso luminoso pulsante de alerta térmico.

### 4.3. Painel de Calibração em Automações (`src/pages/automations.tsx`)
- Card: **"Proteção Térmica BMS & Longevidade LiFePO4"** com ícone `Thermometer` / `ShieldCheck`:
  - Toggle Principal: `Ativar Proteção Térmica Automática`.
  - Slider para **Limiar de Throttling de Recarga** (38°C a 45°C, padrão 42°C).
  - Slider para **Limiar de Corte de Emergência** (45°C a 55°C, padrão 48°C).
  - Slider para **Potência Reduzida de Recarga** (100W a 500W, padrão 200W).
  - Texto explicativo dos benefícios para a química LFP.

---

## 5. Divisão de Tarefas do Squad

| Especialista | Módulo / Camada | Arquivos Alvo | Atribuições Detalhadas |
| :--- | :--- | :--- | :--- |
| **Apex** (Backend / Domínio / Orquestrador) | Lógica Térmica & API | `prisma/schema.prisma`<br>`src/domain/services/BatteryHealthService.ts`<br>`src/application/OrchestratorSyncUseCase.ts`<br>`src/pages/api/battery/health.ts`<br>`src/infrastructure/validation/apiSchemas.ts`<br>`src/pages/api/settings.ts` | 1. Atualizar schema Prisma com novos campos térmicos e rodar migration segura.<br>2. Implementar `BatteryHealthService.ts` com avaliação de risco e projeção de ciclos.<br>3. Integrar regras de Thermal Throttling e Thermal Cutoff no `OrchestratorSyncUseCase` com histerese de 4°C e notificações.<br>4. Criar endpoint `/api/battery/health` e estender schemas Zod.<br>5. Escrever suíte de testes unitários no Vitest cobrindo throttling, cutoff, histerese de recuperação e projeção de ciclos. |
| **Prism** (Frontend / UI / Widgets / Kiosk) | Componentes & Telas | `src/components/BatteryHealthWidget.tsx`<br>`src/pages/index.tsx`<br>`src/pages/automations.tsx`<br>`src/pages/kiosk.tsx` | 1. Desenvolver `BatteryHealthWidget.tsx` com termômetro dinâmico, SOH e projeção de ciclos.<br>2. Integrar widget no Dashboard (`index.tsx`).<br>3. Construir card de configuração de sensibilidade térmica em `automations.tsx`.<br>4. Integrar indicador térmico OLED compacto no header de `kiosk.tsx`.<br>5. Garantir conformidade mobile estrita (360px–430px) com alvos >= 44x44px. |
| **Sentry** (Tester QA) | Suíte de Testes & QA | `tests/unit/batteryHealthService.test.ts`<br>`tests/unit/thermalOrchestrator.test.ts`<br>`e2e/battery-thermal-health.spec.ts` | 1. Testes unitários para a máquina de estados térmica (OPTIMAL -> WARM -> THROTTLED -> CUTOFF -> RECOVERY).<br>2. Suíte Playwright E2E validando visualização de temperatura, sliders em automations e reação do widget de saúde. |
| **Sentinel** (Code Reviewer) | Quality Gate & Segurança | Todo o diff da branch | 1. Auditoria de segurança física (garantir que falhas de leitura térmica nunca causem loop ou desarme indevido do sistema).<br>2. Proteção anti-flood nos alertas de temperatura.<br>3. Conformidade WCAG 2.1 AA e integridade visual responsiva. |

---

## 6. Critérios de Aceite para Homologação (DoD - Definition of Done)

1. **Precedência Máxima de Proteção Térmica:**
   - Em caso de temperatura >= 48°C, o sistema suspende imediatamente a alimentação pela bateria e comuta para a rede, independentemente de horários tarifários ou histerese solar.
   - Throttling reduz a recarga AC para o valor configurado (padrão 200W) ao atingir 42°C.
2. **Histerese de Recuperação Funcional:**
   - O corte térmico só é desarmado após a temperatura cair pelo menos 4°C abaixo do limiar (<= 44°C).
3. **Endpoint `/api/battery/health`:**
   - Retorna telemetria completa, projeção de ciclos LiFePO4 e status em menos de 100ms.
4. **Interface Intuitiva:**
   - O usuário consegue monitorar o calor do banco de baterias em tempo real no Dashboard e Kiosk com cores claras e sem ruído visual.
5. **Suíte de Testes 100% Verde:**
   - 100% de aprovação na suíte unitária do Vitest (`npm test`).
   - 100% de aprovação na suíte Playwright E2E (`npx playwright test e2e/battery-thermal-health.spec.ts`).
   - `npm run lint` e `npm run build` executam com zero erros e zero advertências.
