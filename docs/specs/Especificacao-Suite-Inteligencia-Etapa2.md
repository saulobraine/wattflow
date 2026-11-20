# ESPECIFICAÇÃO TÉCNICA: SUÍTE DE INTELIGÊNCIA OPERACIONAL (ETAPA 2)
**Projeto:** WATTFLOW (G:\projetos\wattflow)  
**Pacote:** Etapa 2 - Previsão Solar Preditiva & Diagnóstico BMS da Bateria  
**Features:** 
- Feature 3.1: Descarregamento Preditivo Solar (Integração Open-Meteo & Histerese Adaptativa)
- Feature 4.1: Saúde da Bateria EcoFlow (BMS Analytics & Segurança Térmica)
**Autor:** Atlas - Arquiteto & Planejador  
**Destinatários:** Maestro (Orquestrador), Apex (Backend), Prism (Frontend), Sentry (QA)  

---

## 1. Visão Geral da Etapa 2
A Etapa 2 eleva o WattFlow ao patamar de gerenciador energético autônomo e preditivo:
1. **Descarregamento Preditivo Solar:** Consulta previsões meteorológicas abertas (Open-Meteo) para antecipar a irradiância solar diária. Em dias de sol abundante, permite um descarregamento mais agressivo da bateria à noite; em dias nublados ou chuvosos, preserva uma reserva superior de segurança para evitar cortes de energia.
2. **BMS Analytics & Segurança Térmica:** Decodifica a telemetria direta do BMS (Battery Management System) da EcoFlow via MQTT, rastreando temperatura real das células, ciclos DOD acumulados, State of Health (SOH) e acionando proteções preventivas de sobreaquecimento.

---

## 2. Modelagem de Dados (prisma/schema.prisma)

### 2.1. Alterações no modelo `UserConfiguration`
```prisma
model UserConfiguration {
  id                         String             @id @default(uuid())
  userId                     String             @unique
  user                       User               @relation(fields: [userId], references: [id], onDelete: Cascade)
  ...
  // Feature 3.1: Descarregamento Preditivo Solar & Histerese Adaptativa
  latitude                   Float?             // Ex: -23.5505 (São Paulo)
  longitude                  Float?             // Ex: -46.6333
  isAdaptiveHysteresisActive Boolean            @default(false)
  minAdaptiveThreshold       Int                @default(20) // Corte inferior em dia ensolarado (ex: 20%)
  maxAdaptiveThreshold       Int                @default(50) // Corte inferior em dia nublado/chuvoso (ex: 50%)
  lastSolarIrradianceMj      Float?             // Última irradiância diária prevista em MJ/m²
  lastSolarForecastCheckAt   DateTime?

  // Feature 4.1: BMS Analytics & Segurança Térmica
  thermalWarningThreshold    Float              @default(45.0) // Alerta preventivo a partir de 45°C
  thermalShutdownThreshold   Float              @default(50.0) // Corte de segurança a partir de 50°C
  lastBatteryTempCelsius     Float?             // Última temperatura registrada das células
  lastBatterySoh             Int?               // State of Health (0-100%)
  lastBatteryCycles          Int?               // Ciclos acumulados pelo BMS
  maxRecordedBatteryTemp     Float?             // Pico histórico de temperatura
  ...
  createdAt                  DateTime           @default(now())
  updatedAt                  DateTime           @updatedAt
  syncExecutionLogs          SyncExecutionLog[]

  @@map("user_configurations")
}
```

### 2.2. Alterações no modelo `SyncExecutionLog`
Adicionar campos térmicos e de BMS para permitir gráficos históricos de temperatura e telemetria:
```prisma
model SyncExecutionLog {
  id                  String            @id @default(uuid())
  userConfigurationId String
  batteryPercentage   Int
  solarInputWatts     Int               @default(0)
  outputWatts         Int               @default(0)
  actionTriggered     String
  executionDetails    String?
  // Novos campos de telemetria BMS
  batteryTempCelsius  Float?            // Temperatura média das células (°C)
  batterySoh          Int?              // State of Health informado pelo BMS (%)
  batteryCycles       Int?              // Ciclos DOD do BMS
  executedAt          DateTime          @default(now())
  userConfiguration   UserConfiguration @relation(fields: [userConfigurationId], references: [id], onDelete: Cascade)

  @@map("sync_execution_logs")
}
```

---

## 3. Arquitetura Backend & Serviços (Apex - Backend)

### 3.1. Serviço Open-Meteo (`src/infrastructure/services/OpenMeteoSolarForecastService.ts`)
Criar serviço singleton para consumo da API aberta Open-Meteo (sem custos de API key):
- **URL Base:** `https://api.open-meteo.com/v1/forecast`
- **Query Params:**
  `latitude={lat}&longitude={lon}&daily=shortwave_radiation_sum,sunshine_duration,weathercode&timezone=auto`
- **Cache Inteligente:** Armazenar previsões em memória por 2 horas por coordenada para respeitar rate limits e otimizar tempo de resposta.
- **Classificação da Expectativa Solar:**
  - `SOLAR_EXCELLENT` ($> 18\,MJ/m^2$ e weathercode $< 3$): Previsão de sol pleno.
  - `SOLAR_GOOD` ($13 \sim 18\,MJ/m^2$): Parcialmente nublado com boa geração.
  - `SOLAR_FAIR` ($8 \sim 13\,MJ/m^2$): Nublado com geração moderada.
  - `SOLAR_POOR` ($< 8\,MJ/m^2$ ou weathercode $\ge 51$): Chuva / tempestade / céu encoberto.

### 3.2. Algoritmo de Histerese Adaptativa (`OrchestratorSyncUseCase.ts`)
Durante o ciclo de automação:
1. Se `isStormModeActive === true`: Modo Tempestade tem precedência absoluta (suspende descarregamento e mantém 100% reserva).
2. Se `isAdaptiveHysteresisActive === true` e `latitude/longitude` estiverem preenchidos:
   - Consultar `OpenMeteoSolarForecastService.getTodayForecast(lat, lon)`.
   - Ajustar o limite inferior de desligamento (`effectiveTurnOffThreshold`):
     - `SOLAR_EXCELLENT` $	o$ `effectiveTurnOffThreshold = minAdaptiveThreshold` (ex: 20%).
     - `SOLAR_GOOD` $	o$ `effectiveTurnOffThreshold = turnOffThreshold` (ex: 30%, configurado).
     - `SOLAR_FAIR` $	o$ `effectiveTurnOffThreshold = Math.min(maxAdaptiveThreshold, turnOffThreshold + 10)`.
     - `SOLAR_POOR` $	o$ `effectiveTurnOffThreshold = maxAdaptiveThreshold` (ex: 50%).
   - Se a bateria estiver abaixo de `effectiveTurnOffThreshold`, comuta para a rede e desliga saída AC.
3. Se `isAdaptiveHysteresisActive === false`: segue o `turnOffThreshold` fixo estático.

### 3.3. Decodificação BMS via MQTT (`EcoFlowMqttStreamService.ts` & `EcoFlowHttpClient.ts`)
Extrair do payload MQTT:
- **Temperatura das Células:**
  - `bmsMaster.temp` (temperatura em °C ou décimos de grau `temp / 10`).
  - Fallbacks: `bmsMaster.cellTemp[0]`, `bmsMaster.maxCellTemp`, `pd.temp`.
- **Ciclos Acumulados do BMS:**
  - `bmsMaster.cycles` ou `bms.cycles`.
- **State of Health (SOH):**
  - `bmsMaster.soh` (inteiro 0-100 representando a saúde química retida das células).
- **Tensão e Corrente:**
  - `bmsMaster.vol` (mV / 1000 = Volts) e `bmsMaster.amp` (mA / 1000 = Amperes).

### 3.4. Mecanismo de Alerta & Proteção Térmica
1. Se `batteryTemp >= thermalWarningThreshold` (ex: 45°C):
   - Disparar notificação via `NotificationDispatcher` no WhatsApp/Telegram:
     *"⚠️ Alerta de Temperatura EcoFlow: Células atingiram 45°C. Verifique a ventilação do local."*
2. Se `batteryTemp >= thermalShutdownThreshold` (ex: 50°C):
   - **Desligamento Preventivo da Saída AC:**
     Comutar a ATS para a Concessionária (`setAcOutputState(false)`), cessando o estresse de descarregamento na bateria até que a temperatura caia abaixo de 42°C (histerese térmica de 8°C).
   - Disparar alerta crítico de corte térmico.

### 3.5. Contratos de API & Zod (`apiSchemas.ts` e `/api/settings.ts`)
Atualizar schemas:
- `latitude`: `z.number().min(-90).max(90).nullable().optional()`.
- `longitude`: `z.number().min(-180).max(180).nullable().optional()`.
- `isAdaptiveHysteresisActive`: `z.boolean().optional()`.
- `minAdaptiveThreshold`: `z.number().int().min(10).max(50).optional()`.
- `maxAdaptiveThreshold`: `z.number().int().min(30).max(80).optional()`.
- `thermalWarningThreshold`: `z.number().min(30).max(60).optional()`.
- `thermalShutdownThreshold`: `z.number().min(40).max(65).optional()`.

### 3.6. Novo Nó em `/api/statistics.ts`
Incluir:
```json
{
  "solarForecast": {
    "isAdaptiveActive": true,
    "radiationMj": 21.4,
    "expectation": "SOLAR_EXCELLENT",
    "effectiveTurnOffThreshold": 20,
    "forecastSummary": "Sol pleno previsto para hoje (21.4 MJ/m²). Descarregamento expandido para até 20%."
  },
  "bmsAnalytics": {
    "temperatureCelsius": 29.5,
    "maxRecordedTemp": 38.2,
    "sohPercentage": 99,
    "bmsCycles": 84,
    "thermalStatus": "NORMAL",
    "thermalWarningThreshold": 45.0,
    "voltageVolts": 51.4,
    "recentThermalTrend": [ ... ]
  }
}
```

---

## 4. Requisitos de Interface & UX (Prism - Frontend)

### 4.1. Configurações (`src/pages/settings.tsx`)
1. **Card: "Previsão Solar & Histerese Adaptativa" (Ícone `CloudSun`)**:
   - Switch principal `isAdaptiveHysteresisActive`.
   - Campos de `Latitude` e `Longitude` com botão *"Obter Localização Atual"* (usando `navigator.geolocation`).
   - Sliders visuais para `minAdaptiveThreshold` (20%) e `maxAdaptiveThreshold` (50%).
   - Tooltip explicativo demonstrando como a radiação prevista modula o corte.
2. **Card: "Monitoramento Térmico & BMS da Bateria" (Ícone `Thermometer`)**:
   - Ajuste do limiar de alerta térmico (padrão: 45°C) e corte de emergência (padrão: 50°C).

### 4.2. Dashboard Principal (`src/pages/index.tsx`) & Estatísticas (`src/pages/statistics.tsx`)
1. **Card "Previsão Solar Preditiva"**:
   - Badge com o nível de sol do dia (`Sol Pleno`, `Bom`, `Nublado`, `Chuva`).
   - Indicação visual: *"Corte adaptado para 20% hoje"* com gráfico comparativo.
2. **Card Executivo "Saúde da Bateria (BMS EcoFlow)"**:
   - **Termômetro das Células:** Mostrador em °C com gradiente de cor (Verde $< 38^\circ	ext{C}$, Amarelo $38-45^\circ	ext{C}$, Vermelho $> 45^\circ	ext{C}$).
   - **State of Health (SOH):** Barra circular com a integridade química da bateria (ex: `99%`).
   - **Ciclos BMS:** Contador de ciclos químicos de carga/descarga da bateria comparados à vida útil LFP (~3.000 ciclos até 80%).

---

## 5. Critérios de Aceite para QA (Sentry - Tester QA)
1. **Validação Open-Meteo:**
   - Requisição mockada ou real com coordenadas de São Paulo (-23.55, -46.63) retorna `radiationMj` e classifica corretamente o dia.
   - Fallback gracioso: caso o serviço Open-Meteo esteja inacessível ou sem internet, o orquestrador reverte para a histerese padrão configurada sem travar a sincronização.
2. **Histerese Adaptativa:**
   - Em dia `SOLAR_EXCELLENT`, comprovar que o orquestrador permite descarregar até `minAdaptiveThreshold` (20%).
   - Em dia `SOLAR_POOR`, comprovar que o orquestrador comuta para a rede ao atingir `maxAdaptiveThreshold` (50%).
3. **Decodificação BMS:**
   - Teste unitário alimentando payload MQTT com `bmsMaster.temp: 320` e `bmsMaster.soh: 98` confirmando extração de 32.0°C e 98%.
4. **Proteção Térmica:**
   - Simulação de temperatura das células a 46°C gera notificação de alerta.
   - Simulação a 51°C desliga a saída AC e comuta para a rede, registrando a causa no log de auditoria.
5. **UI & Responsividade:**
   - Renderização limpa e precisa no desktop e mobile, sem erros de hidratação no Next.js.
