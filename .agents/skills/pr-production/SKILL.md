---
name: pr-production
description: Cria Pull Request de produção de develop para main no GitHub com descrição completa, técnica e orientada ao valor da entrega no WattFlow.
argument-hint: [contexto-extra-opcional]
disable-model-invocation: false
allowed-tools: [Bash, PowerShell, AskUserQuestion]
---

O usuário invocou este comando com: $ARGUMENTS

Objetivo: criar uma Pull Request de produção da branch `develop` para `main` no GitHub, redigindo a descrição em Markdown com base no diff real entre `develop` e `main`, além de commits e/ou anotações fornecidas pelo usuário, sempre seguindo o template obrigatório abaixo.

Destino padrão da PR: `main`.
Origem padrão da PR: `develop`.

## Regras obrigatórias de segurança e fluxo

- Esta skill é exclusivamente para PR de produção: origem `develop` e destino `main`.
- Nunca crie PR de produção a partir de branch diferente de `develop` nem para destino diferente de `main` sem confirmação explícita do usuário.
- A invocação desta skill autoriza explicitamente a publicação da PR. Após coletar o contexto e gerar título e descrição, crie ou atualize a PR sem apresentar plano prévio nem solicitar confirmação adicional.
- Antes da publicação, valide e registre internamente:
  - branch de origem (`develop` por padrão);
  - branch de destino (`main` por padrão);
  - quantidade de commits no range;
  - arquivos alterados no range;
  - status do working tree;
  - título e descrição que serão publicados.
- Se `develop` local não estiver atualizada com `origin/develop`, informe o usuário e use `origin/develop` como fonte de verdade.
- Se `main` local não estiver atualizada com `origin/main`, informe o usuário e use `origin/main` como fonte de verdade para análise.
- Nunca execute merge, rebase, pull, reset ou checkout destrutivo.
- Não altere commits existentes.
- Não inclua emojis em nenhuma parte do título ou da descrição.
- Não use trailers como `Co-Authored-By`.
- A descrição da PR deve ser baseada obrigatoriamente no diff entre `develop` e `main`; mensagens de commit e `$ARGUMENTS` servem apenas como contexto complementar.
- Use `origin/develop` e `origin/main` como referências após `git fetch origin --prune`. Se uma referência remota não existir, use a branch local correspondente e registre o alerta.
- Para análise de alterações, use diff de três pontos (`<ref-main>...<ref-develop>`) para comparar `develop` contra o merge-base com `main`, reproduzindo o escopo esperado de um release de produção.
- Se `$ARGUMENTS` trouxer anotações, use-as como fonte de contexto, validando com o diff real de `develop` contra `main`.
- Se não houver commits nem diff entre `develop` e `main`, interrompa e informe que não há conteúdo para PR de produção.
- Se já existir PR aberta de `develop` para `main`, atualize automaticamente o título e a descrição com base no diff atual e informe o link no resultado.

## Coleta de contexto

Use comandos Git e GitHub CLI (`gh`) para obter, no mínimo:

1. `git status --short --branch`
2. `git fetch origin --prune`
3. Defina a referência de origem como `origin/develop`; se indisponível, use `develop`.
4. Defina a referência de destino como `origin/main`; se indisponível, use `main`.
5. `git merge-base <ref-main> <ref-develop>`
6. `git rev-list --count <ref-main>..<ref-develop>`
7. `git diff --shortstat <ref-main>...<ref-develop>`
8. `git diff --name-only <ref-main>...<ref-develop>`
9. `git log --pretty=format:%s <ref-main>..<ref-develop>`
10. `git diff --stat <ref-main>...<ref-develop>` e trechos relevantes de `git diff <ref-main>...<ref-develop> -- <arquivos>`.

## Regras obrigatórias para a descrição da PR

Atue como um Engenheiro de Software Sênior e Tech Lead. Sua tarefa é redigir a descrição de um Pull Request de Produção destacando a estabilidade operacional, segurança elétrica, mudanças em esquemas de dados e variáveis de ambiente.

1. NÃO resuma o PR apenas com métricas. A descrição deve ser técnica, discursiva e orientada ao valor do release em produção.
2. NÃO utilize emojis em nenhuma parte do texto.
3. Mantenha tom técnico, formal, direto e objetivo.
4. Redija SEMPRE em português brasileiro (PT-BR) correto, culto e gramaticalmente adequado, utilizando todas as acentuações gráficas da língua portuguesa.
5. Agrupe as alterações por domínio de negócio do WattFlow:
   - `Orquestração & Automação`: sincronização, transição de estados e limiares de energia.
   - `Segurança Elétrica & Intertravamento`: transições break-before-make, anti-retorno e relés de proteção.
   - `Integrações Cloud (EcoFlow & Tuya)`: APIs de telemetria e comutação física.
   - `API & Segurança`: autenticação, rotas Next.js e sessões.
   - `Banco de Dados & Migrações`: alterações no Prisma e integridade de dados.
   - `Deploy & Infraestrutura`: Dockerfile, compose e variáveis de ambiente.
6. Siga ESTRITAMENTE a estrutura em Markdown fornecida no template obrigatório abaixo.
7. **Detalhamento Mandatório de Procedimentos de Deploy e Migração**:
   - Cada migração de banco (`prisma migrate`), variável nova de ambiente (`.env.example`) ou ajuste em container Docker DEVE ser explicitamente documentado na seção de notas operacionais.
8. Não invente alterações; baseie-se estritamente no diff real.

## Template obrigatório da descrição

```markdown
## Release para Produção: [Escreva um Título Limpo e Descritivo em PT-BR com Acentuação]

### Contexto do Release
[Escreva 1 ou 2 parágrafos explicando o objetivo do release de produção, as funcionalidades consolidadas a partir da develop, correções de segurança elétrica e impactos no sistema de energia.]

### Detalhamento das Alterações

#### [Nome do Domínio ou Módulo 1 (ex: Segurança Elétrica & Intertravamento)]
* **[Entidade ou Funcionalidade principal]:** [Descrição técnica detalhada da implementação, validações aplicadas e proteção física dos circuitos].
* **[Entidade ou Funcionalidade principal]:** [Descrição técnica detalhada da implementação, validações aplicadas e proteção física dos circuitos].

#### [Nome do Domínio ou Módulo 2 (ex: Banco de Dados & Prisma)]
* **[Entidade ou Migração principal]:** [Descrição técnica detalhada das tabelas criadas/alteradas e índices adicionados].
* **[Entidade ou Migração principal]:** [Descrição técnica detalhada das tabelas criadas/alteradas e índices adicionados].

> **Nota de Implantação:** [Instruções mandatórias para deploy em produção, migrações de banco e checagens pós-deploy].
> ```bash
> # Procedimento de migração em produção
> npx prisma migrate deploy
> docker compose restart app
> ```

### Impactos Esperados e Garantias de Segurança
* [Escreva o impacto na confiabilidade operacional e economia de energia].
* [Escreva garantias de intertravamento e proteção contra curtos elétricos].
* [Escreva instruções para monitoramento pós-deploy].
```

## Título da PR

- Gere um título curto, técnico e representativo para o release (ex: "Release de Produção: Intertravamento seguro de relés e sincronização EcoFlow").
- Não use emojis nem títulos genéricos como `Release`, `Produção` ou `PR produção`.

## Criação e Atualização da PR no GitHub

A invocação de `/pr-production` autoriza a execução direta via GitHub CLI (`gh`):

1. Garanta que `develop` esteja publicada no `origin`.
2. Verifique se já existe PR aberta de `develop` para `main`:
   ```bash
   gh pr list --head develop --base main --json number,url
   ```
3. Se não existir, crie a PR:
   ```bash
   gh pr create --base main --head develop --title "<titulo>" --body "<descricao-markdown>"
   ```
4. Se já existir, atualize a PR existente:
   ```bash
   gh pr edit <numero-ou-url> --title "<titulo>" --body "<descricao-markdown>"
   ```
5. Responda ao final com:
   - Número da PR;
   - Título;
   - Origem e destino (`develop` -> `main`);
   - URL do GitHub;
   - Se foi criada ou atualizada;
   - Notas de implantação relevantes.
