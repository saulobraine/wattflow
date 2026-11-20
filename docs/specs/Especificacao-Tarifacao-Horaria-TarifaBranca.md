# ESPECIFICAÇÃO TÉCNICA: SUPORTE A TARIFAÇÃO HORÁRIA INTELIGENTE (TARIFA BRANCA / TIME-OF-USE & HORÁRIO DE PONTA)
**Projeto:** WATTFLOW (G:\projetos\wattflow)  
**Branch Alvo:** `feature/tarifa-branca-time-of-use`  
**Autor:** Atlas - Arquiteto & Planejador  
**Destinatários:** Maestro (Orquestrador), Apex (Backend/Domínio/Orquestrador), Prism (Frontend/UI/Tarifas/Widgets), Sentry (Tester QA), Sentinel (Code Reviewer)  
**Documento de Referência:** `UPGRADES_E_MELHORIAS_UI.md` (Item 4.6)

---

## 1. Visão Geral & Objetivos Estratégicos
No Brasil, a regulamentação da ANEEL estabelece a **Tarifa Branca (Time-of-Use)**, onde a energia elétrica consumida da rede pública possui valores drasticamente diferentes conforme a hora do dia em dias úteis:
- **Horário Fora de Ponta (Off-Peak):** Tarifa econômica (ex: ~R$ 0,65/kWh). Vigora na maior parte do dia e em 100% dos fins de semana e feriados nacionais.
- **Horário Intermediário (Intermediate):** Tarifa intermediária (~R$ 1,15/kWh). 1 hora antes e 1 hora após a ponta (tipicamente 16h30–17h30 e 20h30–21h30).
- **Horário de Ponta (Peak):** Tarifa crítica (até 3x a 5x mais cara, ~R$ 1,85 a R$ 2,50/kWh). Período de 3 horas consecutivas (tipicamente 17h30–20h30).

**Missão do Ciclo:**
Transformar o WattFlow em um **gerenciador de arbitragem tarifária autônomo**:
1. **Comutação Forçada para Bateria na Ponta:** Durante o Horário de Ponta, a casa DEVE ser alimentada exclusivamente pela bateria/solar (saída AC ligada e ATS em Bateria) desde que o SOC esteja acima da reserva de segurança (`peakDischargeReserveLimit`, padrão 20%), evitando a compra de energia caríssima da concessionária.
2. **Bloqueio Estrito de Recarga AC na Ponta:** Proibição absoluta de recarga da bateria pela tomada durante o pico (`blockAcChargingDuringPeak = true`), garantindo que a estação EcoFlow não puxe nenhum watt da rede nos horários mais caros.
3. **Respeito às Regras Oficiais ANEEL:** Fins de semana (Sábado e Domingo) operam em regime 100% Fora de Ponta.
4. **Histerese Solar Normal Fora da Ponta:** Nos períodos intermediário e fora de ponta, o sistema opera sob sua histerese solar adaptativa usual.
5. **Visibilidade Operacional em Tempo Real:** Novo endpoint `/api/tariff/status`, badges dinâmicos de tarifa no Dashboard (`index.tsx`), painel de configuração tátil em `automations.tsx` e monitoramento no Modo Kiosk (`kiosk.tsx`).

---

## 2. Modelagem de Dados (prisma/schema.prisma)

Na tabela `user_configurations` (`UserConfiguration`), adicionar e harmonizar os seguintes campos:

```prisma
model UserConfiguration {
  id                         String             @id @default(uuid())
  ...
  // Parâmetros de Tarifação Horária Inteligente (Tarifa Branca / Time-of-Use)
  isTimeOfUseActive          Boolean            @default(false)  // Habilita arbitragem ativa no horário de ponta
  timeOfUseWeekdaysOnly      Boolean            @default(true)   // Aplica ponta apenas de Segunda a Sexta (Norma ANEEL)
  peakStartTime              String             @default("17:30")// Início do Horário de Ponta
  peakEndTime                String             @default("20:30")// Fim do Horário de Ponta
  intermediateStartTime      String?            @default("16:30")// Início do Horário Intermediário 1
  intermediateEndTime        String?            @default("21:30")// Fim do Horário Intermediário 2
  peakDischargeReserveLimit  Int                @default(20)     // SOC mínimo de reserva na ponta (10% a 40%)
  blockAcChargingDuringPeak  Boolean            @default(true)   // Bloqueia recarga AC pela tomada no pico
  peakTariffPerKwh           Float              @default(1.85)   // Tarifa Ponta (R$/kWh)
  intermediateTariffPerKwh   Float              @default(1.15)   // Tarifa Intermediária (R$/kWh)
  offPeakTariffPerKwh        Float              @default(0.65)   // Tarifa Fora de Ponta (R$/kWh)
  ...
}
```

---

## 3. Arquitetura de Domínio & Serviços Backend (Apex - Backend)

### 3.1. Refatoração de `TariffScheduleService.ts`
Implementar método canônico de avaliação detalhada:

```typescript
export interface TariffStatusDetail {
  isTimeOfUseActive: boolean;
  currentPeriod: "PEAK" | "INTERMEDIATE" | "OFF_PEAK";
  currentRate: number;
  currencySymbol: string;
  isPeakActive: boolean;
  isChargingBlocked: boolean;
  isWeekend: boolean;
  timeStringBrasilia: string;
  nextPeriod: "PEAK" | "INTERMEDIATE" | "OFF_PEAK";
  nextTransitionTime: string;
  minutesToNextTransition: number;
  dischargeReserveLimit: number;
  description: string;
}

export class TariffScheduleService {
  // Avaliação temporal rica com cálculo de transição iminente
  public evaluateTariffPeriod(
    config: DynamicTariffConfig & {
      isTimeOfUseActive?: boolean;
      timeOfUseWeekdaysOnly?: boolean;
      peakDischargeReserveLimit?: number;
      blockAcChargingDuringPeak?: boolean;
    },
    date: Date = new Date()
  ): TariffStatusDetail {
    // 1. Resolução de timezone oficial 'America/Sao_Paulo'
    // 2. Verificação de dias úteis (Segunda a Sexta) se timeOfUseWeekdaysOnly === true
    // 3. Classificação em PEAK, INTERMEDIATE ou OFF_PEAK
    // 4. Cálculo da próxima janela (ex: "Faltam 45 minutos para o Horário de Ponta")
    // 5. Determinação de bloqueio de recarga AC (isChargingBlocked = isTimeOfUseActive && isPeakActive && blockAcChargingDuringPeak)
  }
}
```

### 3.2. Regras de Decisão no `OrchestratorSyncUseCase.ts`
No método de avaliação da automação (`dispatchEcoFlowAcAction`):

1. **Prioridade Máxima do Modo Tempestade (Auto-Storm):**
   Se houver alerta meteorológico ativo (`isStormAlertActive === true`), o Modo Tempestade prevalece sobre a tarifa, preservando a reserva de segurança contra blackout.
2. **Avaliação da Tarifa Branca (`isTimeOfUseActive === true`):**
   O orquestrador avalia `tariffStatus = TariffScheduleService.getInstance().evaluateTariffPeriod(config)`.
   
   - **CENÁRIO A: HORÁRIO DE PONTA (`tariffStatus.currentPeriod === "PEAK"`)**
     - **Caso A.1 (Bateria Saudável: `SOC > peakDischargeReserveLimit`):**
       - Ligar saída AC da EcoFlow (`setAcOutputState(true)`). A ATS comuta para Bateria/Solar.
       - A residência deixa de comprar energia de R$ 1,85/kWh da concessionária.
       - Se `blockAcChargingDuringPeak === true`, enviar comando para zerar a potência de recarga AC (`setAcChargingSpeed(0)`).
       - Disparar notificação de início da ponta: *"⚡ [WattFlow] Horário de Ponta Ativo (R$ 1,85/kWh). Cargas transferidas para a Bateria Solar. Recarga da tomada bloqueada."*
     - **Caso A.2 (Reserva Esgotada: `SOC <= peakDischargeReserveLimit`):**
       - Desligar saída AC (`setAcOutputState(false)`). A ATS comuta para a Concessionária para não degradar a bateria abaixo do limite.
       - Notificar: *"⚠️ [WattFlow] Reserva de Ponta Atingida (SOC <= 20%). Comutando para Concessionária para proteger a bateria."*
   
   - **CENÁRIO B: FORA DE PONTA OU INTERMEDIÁRIO (`OFF_PEAK` / `INTERMEDIATE`)**
     - Operação por histerese solar convencional: liga AC ao atingir `turnOnThreshold` (ex: 90%) e desliga ao atingir `turnOffThreshold` (ex: 30% ou adaptativo).
     - Recarga AC permitida conforme a lógica de `SolarSmartChargingService` (apenas com excedente ou fora de ponta).

### 3.3. Novo Endpoint REST (`GET /api/tariff/status`)
- Retorna o estado instantâneo do ciclo tarifário para o frontend e Kiosk:
```json
{
  "success": true,
  "data": {
    "isTimeOfUseActive": true,
    "currentPeriod": "PEAK",
    "currentRate": 1.85,
    "currencySymbol": "R$",
    "isPeakActive": true,
    "isChargingBlocked": true,
    "timeStringBrasilia": "18:42",
    "nextTransition": {
      "period": "INTERMEDIATE",
      "time": "20:30",
      "minutesRemaining": 108
    },
    "dischargeReserveLimit": 20,
    "description": "Horário de Ponta Ativo: Tarifa Máxima (R$ 1,85/kWh)"
  }
}
```

### 3.4. Validação Zod & Configurações (`/api/settings.ts` e `apiSchemas.ts`)
Estender o schema de configurações para validar:
- `isTimeOfUseActive`: `z.boolean().optional()`
- `timeOfUseWeekdaysOnly`: `z.boolean().optional()`
- `peakStartTime`: `z.string().regex(/^([01]\d|2[0-3]):([0-5]\d)$/).optional()`
- `peakEndTime`: `z.string().regex(/^([01]\d|2[0-3]):([0-5]\d)$/).optional()`
- `intermediateStartTime`: `z.string().regex(/^([01]\d|2[0-3]):([0-5]\d)$/).nullable().optional()`
- `intermediateEndTime`: `z.string().regex(/^([01]\d|2[0-3]):([0-5]\d)$/).nullable().optional()`
- `peakDischargeReserveLimit`: `z.number().int().min(10).max(50).optional()`
- `blockAcChargingDuringPeak`: `z.boolean().optional()`

---

## 4. Frontend & Experiência de Usuário (Prism - Frontend)

### 4.1. Painel de Automações (`src/pages/automations.tsx`)
- **Card Executivo:** **"Arbitragem Tarifária & Horário de Ponta (Tarifa Branca ANEEL)"** com ícone `Clock` / `Zap` e acento semântico Âmbar/Esmeralda:
  - Toggle Principal: `Ativar Automação por Horário de Ponta`.
  - Toggle: `Aplicar apenas em dias úteis (Segunda a Sexta)` (com badge informativo: *"Conforme regulamentação ANEEL"*).
  - Campos de Horário de Início e Fim da Ponta (inputs time com `min-h-[44px]` e `text-base sm:text-sm`).
  - Campos de Horário Intermediário (opcionais).
  - Slider de **Reserva de Segurança na Ponta** (10% a 40%, padrão 20%).
  - Toggle de Segurança: **"Bloqueio Estrito de Recarga pela Tomada na Ponta"** (impede que o inversor carregue a bateria com energia cara).
  - Tabela comparativa dinâmica de economia projetada.

### 4.2. Badge de Tarifa no Dashboard (`src/pages/index.tsx`)
- Componente `TariffStatusBadge.tsx`:
  - **No Horário de Ponta:** Badge pulsante Vermelho/Laranja:
    `[ ⚡ HORÁRIO DE PONTA ATIVO: R$ 1,85/kWh • Bateria Prioritária (Faltam 48 min) ]`
  - **No Horário Intermediário:** Badge Âmbar:
    `[ ⏳ Horário Intermediário: R$ 1,15/kWh ]`
  - **Fora de Ponta:** Badge Esmeralda suave:
    `[ 🟢 Fora de Ponta: R$ 0,65/kWh • Próximo pico às 17:30 ]`
- Posicionamento orgânico no topo dos cards de métricas, garantindo visibilidade imediata.

### 4.3. Modo Kiosk / Wall Panel (`src/pages/kiosk.tsx`)
- Indicador compacto de faixa tarifária no canto superior do painel elétrico:
  - Ícone de relógio com o valor atual do kWh e tempo restante para a virada tarifária.

---

## 5. Divisão de Tarefas do Squad

| Especialista | Módulo / Camada | Arquivos Alvo | Atribuições Detalhadas |
| :--- | :--- | :--- | :--- |
| **Apex** (Backend / Domínio / Orquestrador) | Lógica Tarifária & Endpoints | `prisma/schema.prisma`<br>`src/domain/services/TariffScheduleService.ts`<br>`src/application/OrchestratorSyncUseCase.ts`<br>`src/pages/api/tariff/status.ts`<br>`src/infrastructure/validation/apiSchemas.ts`<br>`src/pages/api/settings.ts` | 1. Atualizar schema Prisma com novos campos de Time-of-Use e rodar migration segura.<br>2. Implementar `evaluateTariffPeriod()` com cálculo de transição em `TariffScheduleService`.<br>3. Integrar no `OrchestratorSyncUseCase` a comutação forçada para bateria na ponta e bloqueio de recarga AC.<br>4. Criar endpoint `/api/tariff/status` e atualizar schemas Zod.<br>5. Escrever suíte de testes unitários no Vitest cobrindo transições de horário, fins de semana e bloqueio de carga. |
| **Prism** (Frontend / UI / Componentes) | Telas & Widgets | `src/pages/automations.tsx`<br>`src/pages/index.tsx`<br>`src/pages/kiosk.tsx`<br>`src/components/TariffStatusBadge.tsx`<br>`src/hooks/useLiveTelemetry.ts` | 1. Construir card de configuração da Tarifa Branca com inputs acessíveis em `automations.tsx`.<br>2. Criar `TariffStatusBadge.tsx` com badges dinâmicos para Ponta, Intermediário e Fora de Ponta.<br>3. Integrar no Dashboard e no Modo Kiosk.<br>4. Garantir responsividade rigorosa em telas móveis (`360px–430px`) com alvos >= 44x44px. |
| **Sentry** (Tester QA) | Qualidade & Testes | `tests/unit/tariffScheduleService.test.ts`<br>`tests/unit/timeOfUseOrchestrator.test.ts`<br>`e2e/tariff-time-of-use.spec.ts` | 1. Testes unitários para regras de dias úteis/fim de semana, cálculo de minutos restantes e bloqueio de recarga.<br>2. Suíte Playwright E2E validando fluxo de configuração, visualização de badges e simulação de horário de ponta. |
| **Sentinel** (Code Reviewer) | Quality Gate & Segurança | Todo o diff da branch | 1. Auditoria de timezone (garantia de uso exclusivo de `America/Sao_Paulo` sem desvios de UTC).<br>2. Verificação de conflito entre Modo Tempestade e Horário de Ponta (Modo Tempestade sempre vence).<br>3. Conformidade WCAG 2.1 AA e zero regressão no desktop. |

---

## 6. Critérios de Aceite para Homologação (DoD - Definition of Done)

1. **Precisão de Horário & Dias Úteis:**
   - O sistema identifica Segunda a Sexta e aplica as janelas configuradas no fuso de Brasília.
   - Sábados e Domingos são 100% classificados como `OFF_PEAK` quando `timeOfUseWeekdaysOnly === true`.
2. **Automação de Comutação na Ponta:**
   - Durante a ponta com `SOC > peakDischargeReserveLimit`, a saída AC permanece ligada e a carga fica na bateria.
   - Ao atingir a reserva (`SOC <= 20%`), a carga é transferida com segurança para a concessionária.
   - Quando `blockAcChargingDuringPeak === true`, a recarga AC pela tomada é imediatamente zerada na ponta.
3. **Endpoint `/api/tariff/status`:**
   - Responde em `< 50ms` com status do período, tarifa em R$ e contagem regressiva para a próxima mudança.
4. **Interface & Usabilidade:**
   - Configurações salvas e validadas sem recarregar a página.
   - Badge no Dashboard destaca o Horário de Ponta de forma visível e compreensível.
5. **Suíte de Testes 100% Verde:**
   - `npm test` verde em 100% dos testes unitários no Vitest.
   - `npm run lint` e `npm run build` executam sem warnings ou erros.
   - `npx playwright test e2e/tariff-time-of-use.spec.ts` aprovado.
