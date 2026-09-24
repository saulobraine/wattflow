# Skills do Projeto WattFlow

Esta pasta armazena as **skills** personalizadas para o Antigravity neste repositório.

## Estrutura de Diretórios

Cada skill reside em seu próprio subdiretório dentro de `.agents/skills/`:

```text
.agents/skills/<nome-da-skill>/
├── SKILL.md          # Obrigatório: Instruções principais com frontmatter YAML
├── scripts/          # Opcional: Scripts auxiliares e ferramentas de automação
├── examples/         # Opcional: Implementações e payloads de referência
├── resources/        # Opcional: Templates e ativos estáticos
└── references/       # Opcional: Documentações detalhadas ou manuais técnicos
```

## Skills Disponíveis no Projeto

1. **[`commit-wattflow`](./commit-wattflow/SKILL.md)**:
   - Normaliza o fluxo de trabalho sempre partindo de `develop`.
   - Deriva branches semânticas (`feat/*`, `fix/*`, etc.) e gera commits organizados com Conventional Commits em PT-BR com acentuação correta.
   - Escopos específicos do projeto: `orchestrator`, `safety`, `ecoflow`, `tuya`, `api`, `auth`, `ui`, `db`, `docker`, `config`.

2. **[`pr-develop`](./pr-develop/SKILL.md)**:
   - Criação e atualização automatizada de Pull Requests no **GitHub** da branch atual para `develop` via GitHub CLI (`gh`).
   - Descrição técnica estruturada cobrindo contexto, detalhamento por domínio e notas operacionais.

3. **[`pr-production`](./pr-production/SKILL.md)**:
   - Criação e atualização de Pull Requests de produção de `develop` para **`main`** no **GitHub** via GitHub CLI (`gh`).
   - Foco em garantias de estabilidade, segurança elétrica/intertravamento, migrações do Prisma e notas de deploy.

4. **[`xp`](./xp/SKILL.md)**:
   - Metodologia de Extreme Programming adaptada para o pareamento IA + Humano (TDD, simplicidade YAGNI, feedback contínuo e refatoração).
