---
name: pr-develop
description: Cria Pull Request da branch atual para develop no GitHub com descrição completa, técnica e orientada ao valor da entrega no WattFlow.
argument-hint: [contexto-extra-opcional]
disable-model-invocation: false
allowed-tools: [Bash, PowerShell, AskUserQuestion]
---

O usuário invocou este comando com: $ARGUMENTS

Objetivo: criar uma Pull Request da branch atual para `develop` no GitHub, redigindo a descrição em Markdown com base nos commits, diffs e/ou anotações fornecidas pelo usuário, sempre seguindo o template obrigatório abaixo.

Destino padrão da PR: `develop`.
Origem padrão da PR: branch atual.

## Regras obrigatórias de segurança e fluxo

- Nunca crie PR diretamente de `develop` para `develop`, de `main` para `develop`, nem de qualquer branch cujo destino/origem pareça incorreto sem perguntar antes.
- A invocação desta skill autoriza explicitamente a publicação da PR. Após coletar o contexto e gerar título e descrição, crie ou atualize a PR sem apresentar plano prévio nem solicitar confirmação adicional.
- Antes da publicação, valide e registre internamente:
  - branch de origem;
  - branch de destino (`develop` por padrão);
  - quantidade de commits no range;
  - arquivos alterados no range;
  - status do working tree;
  - título e descrição que serão publicados.
- Se a branch atual não tiver upstream remoto, estiver à frente do upstream ou houver commits locais ainda não publicados, publique-a com `git push -u origin <branch>` antes de abrir a PR.
- Nunca execute merge, rebase, pull, reset ou checkout destrutivo.
- Não altere commits existentes.
- Não inclua emojis em nenhuma parte do título ou da descrição.
- Não use trailers como `Co-Authored-By`.
- A descrição da PR deve ser baseada obrigatoriamente no diff entre a branch atual e `develop`; mensagens de commit e `$ARGUMENTS` servem apenas como contexto complementar.
- Use `origin/develop` como referência de destino após `git fetch origin --prune`. Se `origin/develop` não existir, use a branch local `develop`.
- Para análise de alterações, use diff de três pontos (`<ref-develop>...HEAD`) para comparar a branch atual contra o merge-base com `develop`.
- Se `$ARGUMENTS` trouxer anotações, use-as como fonte de contexto, validando com o diff real da branch atual contra `develop`.
- Se não houver commits nem diff entre a branch atual e `develop`, interrompa e informe que não há conteúdo para PR.
- Se já existir PR aberta da mesma branch para `develop`, atualize automaticamente o título e a descrição (`gh pr edit`) com base no diff atual e informe o link no resultado.

## Coleta de contexto

Use comandos Git e GitHub CLI (`gh`) para obter, no mínimo:

1. `git status --short --branch`
2. `git branch --show-current`
3. `git fetch origin --prune`
4. Defina a referência base como `origin/develop`; se indisponível, use `develop`.
5. `git merge-base <ref-develop> HEAD`
6. `git rev-list --count <ref-develop>..HEAD`
7. `git diff --shortstat <ref-develop>...HEAD`
8. `git diff --name-only <ref-develop>...HEAD`
9. `git log --pretty=format:%s <ref-develop>..HEAD`
10. `git diff --stat <ref-develop>...HEAD` e trechos relevantes de `git diff <ref-develop>...HEAD -- <arquivos>`.

## Regras obrigatórias para a descrição da PR

Atue como um Engenheiro de Software Sênior e Tech Lead especializado em sistemas de energia solar, orquestração IoT e aplicações TypeScript/Next.js. Redija a descrição do Pull Request orientada ao valor técnico da entrega.

1. NÃO resuma o PR apenas com métricas numéricas. A descrição deve ser técnica, discursiva e orientada à arquitetura e segurança.
2. NÃO utilize emojis em nenhuma parte do texto.
3. Mantenha tom técnico, formal, direto e objetivo.
4. Redija SEMPRE em português brasileiro (PT-BR) correto, culto e gramaticalmente adequado, utilizando todas as acentuações gráficas da língua portuguesa.
5. Agrupe as alterações por domínio de negócio do WattFlow:
   - `Orquestração & Automação`: rotinas do motor de decisão, limiares de bateria/geração solar.
   - `Segurança & Intertravamento`: lógica de transição break-before-make, tempo de espera (deadband), proteção anti-retorno e testes operacionais.
   - `Integração EcoFlow`: clientes de API, cálculo de assinatura HMAC-SHA256, telemetria de entrada/saída solar e cotas.
   - `Integração Tuya`: comandos de comutação de relés, assinaturas de requisição e ciclo de vida de tokens.
   - `API & Autenticação`: rotas Next.js API, controle de sessão JWT e validação de requisições.
   - `Interface & Dashboard`: componentes React, páginas de telemetria, configurações e Tailwind CSS.
   - `Banco de Dados & Prisma`: schema, migrations, repositórios e queries.
   - `Infraestrutura & Docker`: Dockerfile, compose, variáveis de ambiente e scripts de container.
6. Siga ESTRITAMENTE a estrutura em Markdown fornecida no template obrigatório abaixo.
7. **Detalhamento de Comandos, Rotinas e Migrações**:
   - Se o PR incluir novas rotas de API, alterações no Prisma (`prisma/schema.prisma`), novas variáveis de ambiente no `.env.example`, ou comandos Docker/Node, cada um DEVE ser explicitamente documentado no detalhamento.
8. **Uso da Seção `> **Nota:**`**:
   - Utilize a seção `> **Nota:**` para destacar comandos de migração (`npx prisma migrate dev`), execução de rotinas ou avisos críticos de intertravamento e segurança elétrica.
9. Não invente alterações; baseie-se estritamente no diff real.

## Template obrigatório da descrição

```markdown
## [Escreva um Título Limpo e Descritivo em PT-BR Correto com Acentuação]

### Contexto
[Escreva 1 ou 2 parágrafos explicando o cenário geral, a motivação técnica da entrega, os problemas elétricos/lógicos resolvidos e o escopo da funcionalidade.]

### Detalhamento das Alterações

#### [Nome do Domínio ou Módulo 1 (ex: Segurança & Intertravamento)]
* **[Entidade, Classe ou Rota principal]:** [Descrição técnica detalhada da implementação, validações aplicadas e comportamento elétrico/lógico].
* **[Entidade, Classe ou Rota principal]:** [Descrição técnica detalhada da implementação, validações aplicadas e comportamento elétrico/lógico].

#### [Nome do Domínio ou Módulo 2 (ex: Integração EcoFlow)]
* **[Entidade, Classe ou Rota principal]:** [Descrição técnica detalhada da implementação, parâmetros e fluxos].
* **[Entidade, Classe ou Rota principal]:** [Descrição técnica detalhada da implementação, parâmetros e fluxos].

> **Nota:** [Utilize blockquotes (>) para destacar comandos de terminal, scripts de container, migrações de banco ou avisos de segurança elétrica].
> ```bash
> # Exemplo de execução ou migração
> npx prisma migrate deploy
> ```

### Impactos Esperados
* [Escreva o impacto técnico, de segurança operacional ou de usabilidade gerado pela entrega].
* [Escreva o impacto técnico, de segurança operacional ou de usabilidade gerado pela entrega].
```

## Título da PR

- Gere um título curto, técnico e descritivo em PT-BR com acentuação correta (ex: "Implementar intertravamento seguro break-before-make para controle de relés").
- Não use emojis nem termos vagos como "Ajustes", "Correções" ou "PR develop".

## Criação e Atualização da PR no GitHub

A invocação de `/pr-develop` autoriza a execução direta via GitHub CLI (`gh`):

1. Verifique se já existe PR aberta da branch atual para `develop`:
   ```bash
   gh pr list --head <branch-atual> --base develop --json number,url
   ```
2. Se não existir, crie a PR:
   ```bash
   gh pr create --base develop --head <branch-atual> --title "<titulo>" --body "<descricao-markdown>"
   ```
3. Se já existir, atualize a PR existente:
   ```bash
   gh pr edit <numero-ou-url> --title "<titulo>" --body "<descricao-markdown>"
   ```
4. Responda ao final com:
   - Número da PR;
   - Título;
   - Origem e destino (`<branch>` -> `develop`);
   - URL do GitHub;
   - Se foi criada ou atualizada.
