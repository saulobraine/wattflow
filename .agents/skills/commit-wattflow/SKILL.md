---
name: commit-wattflow
description: Analisa alterações não commitadas, sempre parte de develop, cria uma branch semântica para o contexto do WattFlow e cria commits coerentes em PT-BR.
argument-hint: [contexto-extra]
disable-model-invocation: true
allowed-tools: [Bash, PowerShell, AskUserQuestion]
---

O usuário invocou este comando com: $ARGUMENTS

Objetivo: revisar todas as alterações não commitadas do working tree atual, garantir que o trabalho parta da branch `develop`, criar uma nova branch semântica para o contexto do WattFlow e criar um ou mais commits coerentes por assunto, usando tipos semânticos corretos.

## Regras obrigatórias:
- Trabalhe com comandos git via shell (PowerShell/Bash).
- A base de todo commit criado por esta skill deve ser sempre a branch local `develop`.
- Se a branch atual não for `develop`, execute `git switch develop` antes de propor commits ou criar a branch de trabalho. Se o switch falhar por conflitos com alterações locais, branch inexistente ou qualquer outro erro, pare e peça decisão do usuário.
- Nunca crie commit diretamente em `develop` ou `main`, nem em qualquer branch que já existia antes da execução da skill sem consentimento.
- Sempre derive uma nova branch de trabalho semântica a partir do tipo, escopo e intenção das alterações atuais, por exemplo:
  - `feat/ecoflow-signature-v2`
  - `fix/tuya-relay-interlock`
  - `refactor/orchestrator-sync-pipeline`
  - `chore/docker-compose-postgres-healthcheck`
- Mensagens de commit sempre em português brasileiro (PT-BR) correto, culto e gramaticalmente adequado, COM TODAS AS ACENTUAÇÕES PADRÃO DA LÍNGUA PORTUGUESA (ex: `detecção`, `automática`, `sincronização`, `orquestração`, `inversor`, `intertravamento`, `usuários`, `validação`, `resolução`, `geração`, `saída`, `inclusão`, `alteração`, etc.). É expressamente proibido omitir acentos ou usar palavras sem acentuação nas mensagens e corpos de commit.
- Nunca inclua `Co-Authored-By` nem qualquer trailer de IA.
- Nunca use `git add .` ou `git add -A`. Faça stage apenas de arquivos específicos.
- Nunca use `--amend`, `--no-verify`, `--no-gpg-sign` ou comandos destrutivos como `git reset --hard`, `git checkout --`, `git restore .`.
- Nunca crie commit vazio.
- **Segurança de credenciais e chaves**: Nunca comite arquivos que pareçam conter credenciais ou segredos, como `.env`, `.env*.local`, chaves da Tuya (`TUYA_ACCESS_KEY`, `TUYA_ACCESS_SECRET`), chaves da EcoFlow (`ECOFLOW_ACCESS_KEY`, `ECOFLOW_SECRET_KEY`) ou tokens de sessão. Se isso aparecer, pare e avise imediatamente.
- Prefira múltiplos commits pequenos e coerentes por tema, combinando arquivos quando fizerem parte da mesma mudança funcional.
- Use tipos semânticos padronizados: `fix`, `feat`, `refactor`, `chore`, `docs`, `test`, `build`, `perf`, `revert`.
- Use `scope` específico do domínio do WattFlow:
  - `core` / `orchestrator`: lógica de orquestração e sync do motor de automação.
  - `safety`: regras de proteção elétrica, detecção anti-retorno e intertravamento *break-before-make*.
  - `ecoflow`: cliente HTTP, cálculo de assinatura HMAC-SHA256, telemetria de bateria/solar.
  - `tuya`: cliente de integração Tuya Cloud, assinatura, tokens e comandos de relés/switches.
  - `api`: rotas e endpoints do Next.js (`/api/sync`, `/api/test-control`, `/api/settings`, etc.).
  - `auth`: sessões JWT, cadastro, login e verificação de usuário.
  - `ui` / `dashboard`: componentes React, páginas Next.js, gráficos e Tailwind CSS.
  - `db` / `prisma`: schemas do Prisma, migrações, models e repositórios PostgreSQL.
  - `docker` / `deploy`: Dockerfile, docker-compose, scripts de inicialização.
  - `config`: configurações do TypeScript, Next.js, ESLint ou Git.
- Proibição de mensagens genéricas ou vagas: Nunca use mensagens como "ajustes gerais", "correções diversas" ou "atualizações no sistema". Especifique os componentes e comportamentos alterados.
- **Detalhamento obrigatório de regras elétricas, endpoints e comandos**: Sempre que houver adição, modificação ou refatoração de regras de intertravamento elétrico, algoritmos de orquestração, rotas de API (`src/pages/api/*`), schemas do Prisma (`prisma/schema.prisma`) ou scripts Docker, a mensagem de commit e o corpo DEVEM citar nominalmente os arquivos, entidades e comportamentos alterados com acentuação correta.
- **Uso de corpo de commit detalhado**: Quando o commit envolver múltiplos arquivos ou regras importantes, inclua no corpo do commit (após linha em branco) uma lista em tópicos detalhando as alterações específicas implementadas.
- Se `$ARGUMENTS` trouxer contexto extra, use-o para orientar agrupamento, redação das mensagens e derivação do nome da nova branch.
- Antes de propor commits, verifique se a nova branch proposta é compatível com o conteúdo das alterações.
- Se o usuário não confirmar exatamente o plano proposto, não crie a branch de trabalho, não altere stage e não crie commits.

## Processo:

1. Colete o contexto inicial com comandos Git:
   - `git status --short --branch`
   - `git branch --show-current`
   - `git branch --list develop`
   - `git diff --cached`
   - `git diff`
   - `git log --oneline -10 --decorate`

2. Normalize a base em `develop` antes de analisar o plano final:
   - Se `git branch --show-current` retornar algo diferente de `develop`, execute `git switch develop`.
   - Se o switch falhar por conflitos locais, pare e solicite decisão do usuário sem usar comandos destrutivos.
   - Após entrar em `develop`, colete novamente o status e diffs locais.

3. Analise as alterações staged e unstaged em cima de `develop` e derive uma nova branch semântica:
   - Identifique o tipo principal (`feat`, `fix`, `refactor`, `chore`, etc.) e o escopo (`safety`, `ecoflow`, `tuya`, `orchestrator`, `api`, `ui`, `db`, `docker`).
   - Monte o nome no padrão `<tipo>/<escopo>-<contexto>`.
   - Classifique a compatibilidade entre a intenção, os diffs e os arquivos afetados.

4. Monte o agrupamento por intenção funcional:
   - Mudanças do mesmo fluxo (ex: novo cálculo de assinatura + cliente HTTP) ficam no mesmo commit.
   - Mudanças independentes (ex: ajuste de estilo na UI + correção em migração de banco) tornam-se commits separados.

5. Apresente ao usuário o plano proposto:
   - Branch base (`develop`), nova branch proposta, avaliação de compatibilidade.
   - Lista de commits propostos com tipo, escopo, mensagem e arquivos envolvidos.
   - Solicite aprovação explícita antes de criar a branch e comitar.

6. Após confirmação explícita do usuário:
   - Crie e mude para a nova branch: `git switch -c <nome-da-branch>`.
   - Adicione os arquivos específicos de cada grupo via `git add <arquivo>`.
   - Realize o commit com mensagem clara em PT-BR e corpo explicativo. Exemplo:

```bash
git commit -m "$(cat <<'EOF'
feat(safety): implementar intertravamento break-before-make no controle de relés

- Garantir desligamento prévio da rede concessionária antes da ativação do inversor solar
- Adicionar intervalo de segurança (deadband) configurável entre comandos de alternância
- Validar estado de confirmação dos switches Tuya antes da transição de carga
EOF
)"
```

7. Finalize informando:
   - Branch base usada (`develop`) e nova branch criada.
   - Lista de commits criados com hashes curtos e mensagens.
   - Status atual da árvore de trabalho.
