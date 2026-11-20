# ESPECIFICAÇÃO TÉCNICA: SUÍTE DE INTELIGÊNCIA OPERACIONAL (ETAPA 4)
**Projeto:** WATTFLOW (G:\projetos\wattflow)  
**Pacote:** Etapa 4 - Painel de Autonomia por Carga (Simulador) & Solar Smart Charging  
**Features:** 
- Feature 2.3: Painel de Autonomia por Carga (Simulador de Cargas Conectadas)
- Feature 3.2: Otimização de Recarga com Excedente Solar (Solar Smart Charging & Modulação AC)
**Autor:** Atlas - Arquiteto & Planejador  
**Destinatários:** Maestro (Orquestrador), Apex (Backend), Prism (Frontend), Sentry (QA)  

---

## 1. Visão Geral da Etapa 4 (Encerramento da Suíte de Inteligência)
A Etapa 4 completa a transformação do WattFlow em uma plataforma de ponta de gestão inteligente de microrredes solares:
1. **Painel de Autonomia por Carga (Simulador de Cargas):** Permite ao proprietário prever a autonomia exata da residência com base em simulações interativas de aparelhos (ex: Geladeira, Computadores, Iluminação, Ar-Condicionado, Roteador), descobrindo instantaneamente o impacto de ligar ou desligar cada eletrodoméstico durante um blecaute.
2. **Solar Smart Charging (Recarga AC Inteligente):** Modula a potência de recarga AC da EcoFlow (de 200W a 2400W) conforme a geração solar, tarifa vigente e previsão do tempo. Bloqueia recargas na tomada no Horário de Ponta (R$ 1,85+/kWh) e programa recargas econômicas na madrugada caso o dia seguinte tenha previsão de chuva/tempestade.

---

## 2. Modelagem de Dados (prisma/schema.prisma)

### 2.1. Novo Modelo: `ApplianceLoadProfile` (Perfil de Cargas para Simulação)
```prisma
model ApplianceLoadProfile {
  id                   String            @id @default(uuid())
  userConfigurationId  String
  name                 String            // Ex: "Geladeira Inverter", "Estação de Trabalho", "Starlink + Wi-Fi"
  category             String            @default("ESSENTIAL") // ESSENTIAL, COMFORT, HEAVY, CUSTOM
  averageWatts         Int               // Consumo típico em Watts (ex: 120W)
  isActiveInSimulation Boolean           @default(false) // Toggle de simulação ativo no dashboard
  icon                 String            @default("Zap") // Nome do ícone Lucide
  createdAt            DateTime          @default(now())
  updatedAt            DateTime          @updatedAt
  userConfiguration    UserConfiguration @relation(fields: [userConfigurationId], references: [id], onDelete: Cascade)

  @@map("appliance_load_profiles")
}
```

### 2.2. Alterações no modelo `UserConfiguration`
```prisma
model UserConfiguration {
  id                         String                 @id @default(uuid())
  userId                     String                 @unique
  user                       User                   @relation(fields: [userId], references: [id], onDelete: Cascade)
  ...
  // Feature 3.2: Solar Smart Charging & Modulação de Recarga AC
  isSmartChargingActive       Boolean                @default(false)
  minAcChargingWatts          Int                    @default(200) // Potência mínima permitida de recarga AC (W)
  maxAcChargingWatts          Int                    @default(1200) // Potência máxima de recarga AC (W)
  currentAcChargingWatts      Int                    @default(400) // Potência atualmente aplicada na estação
  chargeOnlyOffPeak           Boolean                @default(true) // Bloqueia recarga AC durante horário de ponta
  cloudyPrechargeActive       Boolean                @default(true) // Pré-recarga na madrugada se previsão for SOLAR_POOR
  lastSmartChargeAdjustAt     DateTime?
  applianceProfiles           ApplianceLoadProfile[]
  ...
  createdAt                  DateTime               @default(now())
  updatedAt                  DateTime               @updatedAt
  syncExecutionLogs          SyncExecutionLog[]

  @@map("user_configurations")
}
```

---

## 3. Arquitetura Backend & Regras de Negócio (Apex - Backend)

### 3.1. CRUD e Inicialização de Cargas (`src/pages/api/appliances.ts`)
Criar endpoint REST `/api/appliances`:
- **GET:** Lista as cargas cadastradas do usuário.
  - **Auto-Seed Inteligente:** Se o usuário não possuir nenhuma carga cadastrada, inicializa automaticamente com 6 cargas padrão:
    1. *Geladeira Inverter* (100W, `ESSENTIAL`, ícone `Refrigerator`)
    2. *Iluminação LED Residencial* (60W, `ESSENTIAL`, ícone `Lightbulb`)
    3. *Starlink / ONU + Roteador Wi-Fi* (50W, `ESSENTIAL`, ícone `Wifi`)
    4. *Notebook / Computador Trabalho* (120W, `COMFORT`, ícone `Laptop`)
    5. *Smart TV + Áudio* (140W, `COMFORT`, ícone `Tv`)
    6. *Ar-Condicionado Inverter 9k* (750W, `HEAVY`, ícone `AirVent`)
- **POST:** Permite criar uma nova carga personalizada ou atualizar o toggle de simulação em lote (`toggleSimulation`).
- **DELETE:** Remove uma carga existente.

### 3.2. Algoritmo de Cálculo de Autonomia Simulada
No endpoint `/api/statistics` ou `/api/appliances`:
- $	ext{Energia Restante na Bateria (Wh)} = 	ext{batteryCapacityWh} 	imes \left(\frac{	ext{batteryPercentage}}{100}\right)$.
- $	ext{Potência de Carga Real Atual} = 	ext{outputWatts}$.
- $	ext{Potência da Carga Simulada (Watts)} = \sum 	ext{averageWatts dos itens com isActiveInSimulation: true}$.
- **Cenário Baseline (Real):**
  $$	ext{runtimeMinutesReal} = \frac{	ext{Energia Restante}}{\max(10, 	ext{outputWatts} - 	ext{solarInputWatts})} 	imes 60$$
- **Cenário Simulado:**
  $$	ext{runtimeMinutesSimulated} = \frac{	ext{Energia Restante}}{\max(10, 	ext{Potência Simulada})} 	imes 60$$
- O payload retorna ambos os cenários para comparação instantânea (ex: *"Carga real atual: 8h 20m | Com a simulação ativa: 4h 15m (Impacto: -4h 05m)"*).

### 3.3. Serviço de Recarga AC Inteligente: `SolarSmartChargingService.ts`
Criar serviço singleton para regular dinamicamente a potência de recarga AC da EcoFlow:
- **Disparo da Modulação:**
  Executado periodicamente dentro do `OrchestratorSyncUseCase` quando `isSmartChargingActive === true`.
- **Regras de Modulação:**
  1. **Precedência Máxima (Modo Tempestade):**
     Se `isStormModeActive === true`, ajusta imediatamente a recarga AC para `maxAcChargingWatts` (ex: 1200W) para maximizar o carregamento de emergência.
  2. **Bloqueio no Horário de Ponta:**
     Se `chargeOnlyOffPeak === true` e o período atual for `PEAK`, reduz a recarga AC para 0W (ou `minAcChargingWatts` 200W se 0W não for suportado pela API), eliminando despesas de pico.
  3. **Pré-Recarga Noturna Econômica:**
     Se a hora atual estiver entre 02h00 e 05h00 (Fora de Ponta, R$ 0,65/kWh) E `cloudyPrechargeActive === true` E a previsão solar de hoje for `SOLAR_POOR`:
     Ajusta a recarga para `minAcChargingWatts` (ex: 300W~400W) até que o SOC atinja 85%, garantindo que a residência amanheça com reserva suficiente para o dia de chuva.
  4. **Ajuste Fino via API EcoFlow:**
     No `EcoFlowHttpClient.ts`, implementar método:
     ```typescript
     public async setAcChargingSpeed(
       device: DeviceSerialNumber,
       watts: number
     ): Promise<{ isSuccess: boolean; feedbackMessage: string }>
     ```
     Enviando payload `operateType: "acChgCfg"` com `fastChgWatts: watts` ou `slowChgWatts: watts`.

### 3.4. Contratos Zod & Schemas (`apiSchemas.ts`)
- Adicionar validações para `appliancePostBodySchema`:
  - `name`: string de 1 a 64 chars.
  - `averageWatts`: int de 5W a 10.000W.
  - `category`: enum `["ESSENTIAL", "COMFORT", "HEAVY", "CUSTOM"]`.
- Adicionar campos de Smart Charging no `settingsPostBodySchema`:
  - `minAcChargingWatts`: int de 100 a 1000W.
  - `maxAcChargingWatts`: int de 200 a 3600W.
  - `isSmartChargingActive`, `chargeOnlyOffPeak`, `cloudyPrechargeActive`: booleans.

---

## 4. Requisitos de Interface & UX (Prism - Frontend)

### 4.1. Simulador de Autonomia por Cargas (`src/pages/index.tsx` & `src/pages/statistics.tsx`)
- **Card Interativo: "Simulador de Autonomia por Carga"**:
  - Exibição de chips/cards clicáveis para cada aparelho com ícone Lucide representativo (`Refrigerator`, `Wifi`, `Laptop`, `Tv`, `AirVent`).
  - Toggle de seleção com contorno e iluminação esmeralda quando ativado.
  - **Mostrador Central em Destaque:**
    - Carga Total Selecionada: `X Watts` (ex: `410 W`).
    - Autonomia Projetada: `11h 25m restantes`.
    - Comparativo contra o consumo real: indicador visual de economia ou estresse energético.
  - Botão modal *"Gerenciar / Adicionar Aparelhos"*.

### 4.2. Configurações (`src/pages/settings.tsx`)
- **Card "Solar Smart Charging (Recarga AC Inteligente)"**:
  - Switch de ativação geral do Smart Charging.
  - Sliders para Potência Mínima (200W) e Potência Máxima (1200W) de recarga na tomada.
  - Switch *"Bloquear recarga AC no Horário de Ponta (Evitar R$ 1,85/kWh)"*.
  - Switch *"Pré-recarga noturna na madrugada se a previsão indicar dia chuvoso"*.
- **Tabela / Lista de Cargas Personalizadas**:
  - Gerenciamento de aparelhos com edição de nome, Watts e categoria.

---

## 5. Critérios de Aceite para QA (Sentry - Tester QA)
1. **Auto-Seed de Aparelhos:** Um usuário novo sem aparelhos deve receber automaticamente as 6 cargas padrão essenciais na primeira consulta GET `/api/appliances`.
2. **Cálculo da Simulação:** Com 1024Wh úteis na bateria, simular 512W de carga deve projetar com exatidão 120 minutos (2h 00m).
3. **Smart Charging na Ponta:** Em dia útil às 18h30 com `chargeOnlyOffPeak: true`, a potência de recarga AC deve ser limitada ao mínimo ou suspensa.
4. **Pré-Recarga Noturna:** Às 03h00 com previsão `SOLAR_POOR`, o sistema deve elevar a potência de recarga AC até atingir o limiar de 85%.
5. **Precedência do Modo Tempestade:** Com Modo Tempestade ativo, a recarga AC deve ir para `maxAcChargingWatts` independentemente do horário.
6. **Responsividade & Acessibilidade:** Teste completo de usabilidade mobile e desktop nos switches do simulador de cargas.
