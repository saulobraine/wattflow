# ESPECIFICAÇÃO TÉCNICA: SAÚDE OPERACIONAL DA CHAVE DE TRANSFERÊNCIA AUTOMÁTICA (ATS)
**Projeto:** WATTFLOW (G:\projetos\wattflow)  
**Autor:** Atlas - Arquiteto & Planejador  
**Destinatários:** Maestro (Orquestrador), Apex (Backend), Prism (Frontend), Sentry (QA)  

---

## 1. Visão Geral & Requisitos de Negócio
A Chave de Transferência Automática (ATS) é o componente eletromecânico crítico que comuta a alimentação dos circuitos residenciais entre a estação de energia solar/bateria (EcoFlow AC) e a Rede Elétrica da Concessionária.
- **Vida útil nominal da fabricante:** 10.000 ciclos mecânicos de comutação.
- **Consumo de ciclo:** Cada evento físico de comutação consome exatamente 1 ciclo.
- **Objetivo da Feature:** Prover rastreabilidade de desgaste, configuração personalizada da vida útil nominal, contabilidade fidedigna de comutações e projeção estatística da longevidade operacional em anos.

---

## 2. Modelagem de Dados (prisma/schema.prisma)
Na tabela user_configurations (model UserConfiguration):

```prisma
model UserConfiguration {
  id                    String             @id @default(uuid())
  userId                String             @unique
  user                  User               @relation(fields: [userId], references: [id], onDelete: Cascade)
  ...
  // Parâmetros de Saúde Operacional da ATS
  atsLifespanCycles     Int                @default(10000)
  atsCurrentCycles      Int                @default(0)
  atsLastSwitchedAt     DateTime?
  ...
  createdAt             DateTime           @default(now())
  updatedAt             DateTime           @updatedAt
  syncExecutionLogs     SyncExecutionLog[]

  @@map("user_configurations")
}
```

### Explicação dos Campos:
1. atsLifespanCycles: Capacidade nominal máxima de ciclos segundo o fabricante (default: 10000).
2. atsCurrentCycles: Contagem cumulativa de comutações físicas efetuadas (default: 0).
3. atsLastSwitchedAt: Timestamp exato da última comutação física registrada.

---

## 3. Arquitetura Backend & Casos de Uso (Apex - Backend)

### 3.1. ConfigurationRepository.ts
Implementar método atômico no repositório:
```typescript
public async incrementAtsCycle(configurationId: string): Promise<number> {
  const updated = await this.databaseClient.userConfiguration.update({
    where: { id: configurationId },
    data: {
      atsCurrentCycles: { increment: 1 },
      atsLastSwitchedAt: new Date(),
    },
    select: { atsCurrentCycles: true },
  });
  return updated.atsCurrentCycles;
}
```
Atualizar RetrievedConfigurationRecord para expor atsLifespanCycles, atsCurrentCycles e atsLastSwitchedAt.

### 3.2. Gatilhos de Comutação

#### A) Automação Contínua (OrchestratorSyncUseCase.ts):
No método dispatchEcoFlowAcAction:
- **Comutação para Solar/Bateria:**
  Quando desiredAction.isEnableEcoFlowAc() é acionado e isCurrentlyAcEnabled !== true:
  Ao receber retorno com sucesso de ecoflowClient.setAcOutputState(ecoflowDevice, true):
  await this.repository.incrementAtsCycle(databaseRecordId);
- **Comutação para Concessionária:**
  Quando desiredAction.isDisableEcoFlowAc() é acionado e isCurrentlyAcEnabled !== false:
  Ao receber retorno com sucesso de ecoflowClient.setAcOutputState(ecoflowDevice, false):
  await this.repository.incrementAtsCycle(databaseRecordId);
- **Regra Anti-Falso-Positivo:** Se a saída AC já estava no estado desejado (ex: isCurrentlyAcEnabled === true ao checar nível superior), a chamada HTTP não é disparada e o ciclo NÃO é incrementado.

#### B) Controle Manual de Teste (src/pages/api/test-control.ts):
- Quando actionTarget === "ECOFLOW_ON" ou actionTarget === "ECOFLOW_OFF":
  Se result.isSuccess === true:
  Incrementar o contador de ciclos atômico no banco:
  await prisma.userConfiguration.update({ where: { id: savedConfiguration.id }, data: { atsCurrentCycles: { increment: 1 }, atsLastSwitchedAt: new Date() } });
- O teste de telemetria (ECOFLOW_TELEMETRY) é somente leitura e NÃO consome ciclos.

---

## 4. Endpoints & Validação Zod

### 4.1. apiSchemas.ts (settingsPostBodySchema):
```typescript
export const settingsPostBodySchema = z.object({
  ...
  atsLifespanCycles: z
    .number({ message: "Vida útil da ATS deve ser um número." })
    .int("A vida útil deve ser um número inteiro.")
    .min(100, "Vida útil da ATS deve ser de no mínimo 100 ciclos.")
    .max(1000000, "Vida útil excede o limite máximo permitido.")
    .optional(),
  atsCurrentCycles: z
    .number({ message: "Ciclos atuais da ATS deve ser um número." })
    .int("Os ciclos atuais devem ser um número inteiro.")
    .min(0, "Ciclos atuais não podem ser negativos.")
    .optional(),
});
```

### 4.2. /api/settings.ts:
- **GET:** Retorna atsLifespanCycles (default 10000), atsCurrentCycles (default 0) e atsLastSwitchedAt.
- **POST:** Aceita atualização de atsLifespanCycles e calibração de atsCurrentCycles.

### 4.3. /api/statistics.ts:
Compilar métricas de saúde da ATS no objeto atsHealth:
- lifespanCycles: Limite configurado.
- currentCycles: Total já comutado.
- remainingCycles: Math.max(0, lifespan - current).
- healthPercentage: Math.max(0, Math.min(100, Number(((remaining / lifespan) * 100).toFixed(1)))).
- **Cálculo da Taxa Diária e Durabilidade em Anos:**
  1. Contar eventos de comutação registrados em SyncExecutionLog nos últimos 30 dias (ou total de dias ativos).
  2. dailyRate = comutacoes / dias.
  3. Se dailyRate > 0: estimatedYears = Number((remaining / (dailyRate * 365)).toFixed(1)).
  4. Se não houver histórico suficiente (< 2 dias), fornecer fallback com base na taxa padrão de transição solar (~2 ciclos/dia -> ~13,7 anos) com flag informativa isProratedEstimate: true.
- status: "EXCELLENT" (>=80%), "GOOD" (50-79%), "ATTENTION" (20-49%), "CRITICAL" (<20%).

---

## 5. Interface do Usuário (Prism - FrontEnd Designer)

### 5.1. Tela de Configurações (settings.tsx):
- Novo card: "Chave de Transferência Automática (ATS)" com ícone ArrowLeftRight.
- Input para Ciclo de Vida Útil Nominal: Campo numérico com valor padrão 10.000 e descrição explicativa.
- Input para Calibração de Ciclos Atuais: Permite ao usuário sincronizar ou resetar o contador físico ao trocar a ATS.

### 5.2. Tela de Estatísticas (statistics.tsx):
- Card executivo de Saúde Operacional:
  - Gauge / Barra de Vida Útil: Progresso visual percentual com cores dinâmicas (Verde #10b981, Amarelo #f59e0b, Vermelho #ef4444).
  - Contador Realizado: 142 / 10.000 ciclos.
  - Estimativa de Durabilidade: ~13.4 anos restantes (taxa de 2.1 ciclos/dia).
  - Data da Última Comutação: Timestamp formatado (ex: 19/11/2026 às 17:42).
  - Badge de Status: Excelente, Bom, Atenção, Troca Recomendada.

---

## 6. Critérios de Aceite para QA (Sentry)
1. prisma/schema.prisma atualizado e sincronizado via npx prisma db push sem falhas.
2. Contrato de API /api/settings permite ler e gravar atsLifespanCycles e atsCurrentCycles.
3. Validação Zod rejeita números negativos ou valores decimais.
4. Execução de sincronização (OrchestratorSyncUseCase) comuta AC e incrementa exatamente +1 ciclo no banco.
5. Reexecuções no mesmo estado (AC já ligada ou já desligada) mantêm o contador inalterado.
6. Teste manual via test-control com ECOFLOW_ON ou ECOFLOW_OFF incrementa +1 ciclo se executado com sucesso.
7. Estatísticas em statistics.tsx refletem a saúde da chave, ciclos restantes e estimativa em anos de forma responsiva e em tempo real.
