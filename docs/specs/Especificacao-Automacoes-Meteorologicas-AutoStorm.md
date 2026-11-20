# ESPECIFICAÇÃO TÉCNICA: AUTOMAÇÕES INTELIGENTES COM PREVISÃO DO TEMPO & MODO NO-BREAK PREVENTIVO (AUTO-STORM)
**Projeto:** WATTFLOW (G:\projetos\wattflow)  
**Autor:** Atlas - Arquiteto & Planejador  
**Destinatários:** Maestro (Orquestrador), Apex (Backend/Meteorologia/Orquestrador), Prism (Frontend/UI/Automações/Widgets), Sentry (Tester QA), Sentinel (Code Reviewer)  
**Documento de Referência:** `UPGRADES_E_MELHORIAS_UI.md` (Item 4.5)

---

## 1. Visão Geral & Objetivos Estratégicos
O WattFlow opera controlando hardware de alta tensão comutando cargas residenciais entre a estação solar EcoFlow e a rede concessionária.
Em cenários de tempestades severas, chuvas torrenciais, granizo e ventanias, a rede elétrica pública frequentemente entra em colapso (quedas de postes, transformadores atingidos por raios). Se o WattFlow estiver descarregando a bateria no momento da tempestade (ex: SOC em 20% ou 30%), a residência fica desprotegida e sem autonomia durante o apagão subsequente.

O objetivo deste ciclo é transformar o WattFlow em um **sistema de defesa energética residencial preditiva**:
1. **Inteligência Meteorológica Contínua:** Integração avançada com a API aberta Open-Meteo para coletar códigos meteorológicos da OMM (WMO Weather Codes), probabilidade e volume de precipitação (mm), velocidade máxima do vento e radiação solar.
2. **Modo No-Break Preventivo Automático (Auto-Storm Mode):** Ao detectar tempestade iminente nas próximas 12-24h (WMO 80-82, 95, 96, 99 ou chuva forte > 20mm), o WattFlow ativa autonomamente o modo de proteção:
   - Eleva o limiar de corte de descarregamento para um valor de reserva emergencial configurável (padrão 80% ou 100%).
   - Se a bateria estiver abaixo da reserva, aciona pré-recarga AC rápida via EcoFlow para atingir a meta antes do início do temporal.
   - Comuta preventivamente o ATS para a concessionária, mantendo a bateria 100% carregada para atuar como no-break durante o apagão.
3. **Notificações Pró-Ativas de Defesa Civil:** Envio imediato de alerta via WhatsApp e Telegram detalhando a aproximação da tempestade e a proteção ativada.
4. **Desativação Autônoma e Retorno ao Modo Solar:** Quando a janela meteorológica severa passa, o sistema restaura automaticamente o modo econômico solar de rotina.
5. **Widget Meteorológico no Dashboard & Kiosk:** Indicadores visuais claros do tempo, temperatura, UV, chuva esperada e status de risco de tempestade.

---

## 2. Modelagem de Dados (prisma/schema.prisma)

Na tabela `user_configurations` (`UserConfiguration`):

```prisma
model UserConfiguration {
  id                         String             @id @default(uuid())
  ...
  // Parâmetros de Automação Meteorológica & Auto-Storm
  isAutoStormActive          Boolean            @default(false)
  autoStormReserveThreshold  Int                @default(80)    // SOC mínimo a preservar no temporal (50% a 100%)
  autoStormRainThresholdMm   Float              @default(20.0)  // Limiar de precipitação em 24h para gatilho (mm)
  autoStormPrechargeAc       Boolean            @default(true)  // Força recarga AC rápida pré-tempestade
  isStormAlertActive         Boolean            @default(false) // Flag de estado: tempestade ativa pelo sistema
  lastStormAlertCode         Int?                               // WMO code detectado (ex: 95)
  lastStormAlertDescription  String?                            // Ex: "Trovoada com granizo"
  lastStormAlertTriggeredAt  DateTime?                          // Timestamp do início do alerta
  lastStormAlertEndedAt      DateTime?                          // Timestamp do fim do alerta
  ...
}
```

---

## 3. Arquitetura de Serviços Backend (Apex - Backend)

### 3.1. Extensão de `OpenMeteoSolarForecastService.ts`
Expandir as consultas à Open-Meteo para enriquecer a telemetria meteorológica.

**Nova Interface e Detecção de Risco:**
```typescript
export type StormSeverity = "NORMAL" | "MODERATE" | "SEVERE";

export interface WeatherRiskAssessment {
  isStormRisk: boolean;
  severity: StormSeverity;
  weatherCode: number;
  weatherDescription: string;
  precipitationSumMm: number;
  precipitationProbabilityMax: number;
  windSpeedMaxKmh: number;
  temperatureMaxCelsius: number;
  temperatureMinCelsius: number;
  alertSummary: string;
}
```

**Mapeamento de Códigos WMO (WMO 4677):**
- **Tempestade Severa (SEVERE):** Códigos `96`, `99` (Trovoada com granizo pesado) ou vento `> 65 km/h`.
- **Tempestade / Chuva Forte (MODERATE):** Códigos `95` (Trovoada leve/moderada), `65` (Chuva forte contínua), `82` (Pancada violenta) ou precipitação prevista `>= autoStormRainThresholdMm`.
- **Tempo Estável / Chuva Fraca (NORMAL):** Códigos `0` a `63`, `80`, `81`.

**Método `evaluateWeatherRisk(latitude, longitude, rainThresholdMm)`:**
- Consulta Open-Meteo:
  `daily=weather_code,precipitation_sum,precipitation_probability_max,wind_speed_10m_max,temperature_2m_max,temperature_2m_min&timezone=auto`
- Cache em memória com TTL de 1 hora para evitar chamadas redundantes.
- Fail-safe absoluto: Em caso de timeout ou indisponibilidade da API, retorna `isStormRisk: false` com severidade `NORMAL` (nunca bloqueia a operação física).

### 3.2. Integração no `OrchestratorSyncUseCase.ts`
No ciclo de avaliação das automações:
1. Se `isAutoStormActive === true` e coordenadas geográficas válidas cadastradas:
   - Invoca `forecastService.evaluateWeatherRisk(lat, lon, rainThreshold)`.
   - **Gatilho de Ativação do Auto-Storm:**
     Se `risk.isStormRisk === true` e `isStormAlertActive === false`:
     - Grava no banco `isStormAlertActive: true`, `lastStormAlertCode: risk.weatherCode`, `lastStormAlertDescription: risk.weatherDescription`, `lastStormAlertTriggeredAt: new Date()`.
     - Eleva temporariamente o limiar de corte efetivo para `autoStormReserveThreshold` (ex: 80%).
     - Comuta ATS para Concessionária para cessar descarregamento.
     - Se `autoStormPrechargeAc === true` e a bateria estiver abaixo de `autoStormReserveThreshold`, aciona recarga AC preventiva via EcoFlow API (`setChargingSpeed`).
     - Dispara notificação de emergência no WhatsApp e Telegram com trava anti-flood.
   - **Gatilho de Desativação e Normalização:**
     Se `risk.isStormRisk === false` e `isStormAlertActive === true`:
     - Grava no banco `isStormAlertActive: false`, `lastStormAlertEndedAt: new Date()`.
     - Restaura o corte para o valor padrão de automação.
     - Envia notificação de normalização: *"☀️ Alerta meteorológico encerrado. Sistema retornou à histerese solar econômica."*

### 3.3. Novos Endpoints & Validações Zod
- **`GET /api/weather/forecast`:** Retorna a previsão completa para o dia atual e seguinte (código do tempo, chuva, vento, temperaturas, status de risco e resumo de ação).
- **`POST /api/settings` e `apiSchemas.ts`:**
  - `isAutoStormActive`: `z.boolean().optional()`
  - `autoStormReserveThreshold`: `z.number().int().min(50).max(100).optional()`
  - `autoStormRainThresholdMm`: `z.number().min(5).max(150).optional()`
  - `autoStormPrechargeAc`: `z.boolean().optional()`
- **Ação Rápida em `/api/storm-mode`:**
  - Manter suporte ao toggle manual de modo tempestade, com indicação se está em modo manual ou automático.

---

## 4. Frontend & Experiência de Usuário (Prism - Frontend)

### 4.1. Painel de Automações (`src/pages/automations.tsx`)
- Novo Card Responsivo: **"Modo No-Break Preventivo Inteligente (Auto-Storm)"** com ícone `CloudLightning` (Esmeralda se ativo, Âmbar se alerta disparado).
- Toggle principal de ativação (`isAutoStormActive`).
- Slider interativo de **Reserva Emergencial** (50% a 100%, com destaque para 80% e 100%).
- Slider de **Sensibilidade de Precipitação** (10mm a 50mm).
- Checkbox acessível: *"Ativar recarga acelerada na rede se bateria estiver abaixo da reserva ao detectar tempestade"*.
- Feedback ao vivo: Status atual da previsão meteorológica local na tela de automações.

### 4.2. Widget Meteorológico no Dashboard (`src/pages/index.tsx`)
- Card no grid principal: **"Previsão & Clima Local"**:
  - Temperatura Máx/Mín e Probabilidade de Chuva.
  - Ícone climático dinâmico (Sun, CloudSun, CloudRain, CloudLightning).
  - Badge de Status:
    - `Condições Normais` (Verde suave).
    - `⚠️ Alerta de Tempestade Ativo` (Vermelho carmim pulsante com aviso explicativo).
- **Banner Flutuante de Emergência (Quando Alerta Ativo):**
  - Banner destacado no topo da página: *"⛈️ Modo No-Break Preventivo Ativo: Previsão de tempestade severa detectada. Bateria preservada em 80% para proteção contra apagões."* com botão de ação para "Dispensar Alerta Temporariamente".

### 4.3. Modo Kiosk / Wall Panel (`src/pages/kiosk.tsx`)
- Mini-widget climático discreto no topo ao lado do relógio com temperatura e ícone climático.
- Se o alerta de tempestade estiver ativo, o badge da fonte exibe `MODO PROTEÇÃO TEMPESTADE`.

---

## 5. Divisão de Tarefas do Squad

| Especialista | Módulo / Camada | Arquivos Alvo | Atribuições Detalhadas |
| :--- | :--- | :--- | :--- |
| **Apex** (Backend / Meteorologia / Orquestrador) | Lógica de Risco & Sincronização | `prisma/schema.prisma`<br>`src/infrastructure/services/OpenMeteoSolarForecastService.ts`<br>`src/application/OrchestratorSyncUseCase.ts`<br>`src/pages/api/weather/forecast.ts`<br>`src/infrastructure/validation/apiSchemas.ts`<br>`src/pages/api/settings.ts` | 1. Atualizar schema Prisma com campos de Auto-Storm e executar migration segura.<br>2. Expandir `OpenMeteoSolarForecastService` para mapear códigos WMO de tempestade, chuva e vento.<br>3. Integrar motor de ativação/desativação autônoma do Auto-Storm no `OrchestratorSyncUseCase` com notificações.<br>4. Criar endpoint `/api/weather/forecast` e atualizar validações Zod.<br>5. Escrever suíte de testes unitários no Vitest cobrindo cenários de tempestade, normalização e falhas de rede. |
| **Prism** (Frontend / UI / Widgets) | Telas & Componentes | `src/pages/automations.tsx`<br>`src/pages/index.tsx`<br>`src/pages/kiosk.tsx`<br>`src/components/WeatherWidget.tsx`<br>`src/components/StormAlertBanner.tsx` | 1. Desenvolver card de configuração do Auto-Storm com sliders táteis em `automations.tsx`.<br>2. Criar componente `WeatherWidget.tsx` para o Dashboard com clima em tempo real e badges semânticos.<br>3. Criar `StormAlertBanner.tsx` com alerta visual destacado durante tempestades ativas.<br>4. Integrar indicador climático no Modo Kiosk (`kiosk.tsx`).<br>5. Garantir responsividade perfeita em 360px–430px sem overflow horizontal. |
| **Sentry** (Tester QA) | Testes & Homologação | `tests/unit/autoStormWeather.test.ts`<br>`tests/unit/weatherForecastApi.test.ts`<br>`e2e/auto-storm-flow.spec.ts` | 1. Testes unitários para a matriz de decisão de risco WMO e acionamento no orquestrador.<br>2. Suíte Playwright E2E cobrindo configuração em `automations.tsx`, exibição do widget climático e reação visual ao banner de tempestade. |
| **Sentinel** (Code Reviewer) | Quality Gate & Segurança | Todo o diff do PR | 1. Auditoria de resiliência e fail-safe (garantir que falha da API Open-Meteo nunca cause pane no ATS).<br>2. Proteção anti-flood no envio de alertas via WhatsApp/Telegram.<br>3. Conformidade WCAG 2.1 AA e ergonomia em dispositivos móveis. |

---

## 6. Critérios de Aceite para Homologação (DoD - Definition of Done)

1. **Classificação de Risco Meteorológico:**
   - Códigos WMO 95, 96 e 99 classificam o estado imediatamente como `isStormRisk: true`.
   - Volumes de chuva acima de `autoStormRainThresholdMm` ativam o alerta de forma confiável.
   - Falhas de conexão com a Open-Meteo são absorvidas com fallback gracioso sem interrupção operacional.
2. **Ativação e Reversão Autônoma:**
   - Ao entrar em risco meteorológico com `isAutoStormActive: true`, o sistema comuta o ATS para concessionária, eleva o SOC de corte e envia alerta de texto ao usuário.
   - Ao cessar o risco, o sistema restaura as metas normais e emite notificação de alívio.
3. **Interface & Usabilidade:**
   - Tela de Automações permite alternar e calibrar todos os parâmetros de Auto-Storm com validação numérica estrita.
   - Dashboard exibe clima local e banner flutuante apenas quando houver tempestade ativa.
4. **Qualidade de Código & Testes:**
   - 100% dos testes unitários no Vitest aprovados (`npm test`).
   - 100% dos testes E2E do fluxo meteorológico aprovados (`npx playwright test e2e/auto-storm-flow.spec.ts`).
   - `npm run lint` e `npm run build` executam com zero erros e zero advertências.
