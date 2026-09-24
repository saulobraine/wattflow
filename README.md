# WattFlow &bull; Orquestrador de Energia Inteligente (EcoFlow + Tuya)

MVP de orquestração de energia portátil e IoT para automação de recarga e acionamento de dispositivos inteligentes baseados no nível de bateria da estação EcoFlow (River 2 / Delta 2) e atuadores Tuya Smart Life.

Construído sob os princípios estritos do **Object Calisthenics**, **Next.js (Pages Router)**, **Prisma ORM**, **PostgreSQL** e **Tailwind CSS**.

---

## 🚀 Como Subir o Ambiente com Docker

O projeto inclui um setup completo via **Docker** e **Docker Compose**, contendo:
1. **`app`**: Aplicação Next.js compilada em modo `standalone` com Prisma Client.
2. **`postgres`**: Banco de dados PostgreSQL 16 Alpine local (compatível com a estrutura do Supabase).
3. **`cron-scheduler`**: Container leve que dispara periodicamente o endpoint `/api/sync` para monitoramento contínuo.

### 1. Iniciar todos os serviços

Para subir a aplicação, o banco de dados e o agendador em segundo plano:

```bash
docker compose up -d --build
```

O container da aplicação executa automaticamente o `prisma db push` na inicialização para criar todas as tabelas necessárias no banco de dados.

### 2. Acessar a Aplicação

Abra o navegador em:
- **Dashboard Principal**: [http://localhost:3000](http://localhost:3000)
- **Credenciais (BYOK)**: [http://localhost:3000/settings](http://localhost:3000/settings)
- **Gatilhos de Automação**: [http://localhost:3000/automations](http://localhost:3000/automations)

### 3. Verificar Logs dos Ambientes

Para acompanhar a sincronização e logs em tempo real:

```bash
# Todos os containers
docker compose logs -f

# Apenas a aplicação WattFlow
docker compose logs -f app

# Apenas o agendador periódico (Cron)
docker compose logs -f cron-scheduler
```

### 4. Parar os Serviços

```bash
docker compose down
```

Para remover também os volumes de dados persistentes:

```bash
docker compose down -v
```

---

## ☁️ Conectando ao Supabase na Nuvem

Se preferir utilizar diretamente o PostgreSQL hospedado no Supabase em vez do container local:

1. Obtenha as strings de conexão no painel do seu projeto no Supabase (**Project Settings > Database**).
2. Atualize o arquivo `.env`:

```env
DATABASE_URL="postgresql://postgres.[SEU-PROJETO]:[SUA-SENHA]@aws-0-sa-east-1.pooler.supabase.com:6543/postgres?pgbouncer=true"
DIRECT_URL="postgresql://postgres.[SEU-PROJETO]:[SUA-SENHA]@aws-0-sa-east-1.pooler.supabase.com:5432/postgres"
```

---

## 🛠️ Comandos Locais de Desenvolvimento (Sem Docker)

Caso queira rodar localmente na máquina com Node.js instalado:

```bash
# 1. Instalar dependências
npm install

# 2. Gerar cliente do Prisma
npx prisma generate

# 3. Sincronizar banco de dados
npx prisma db push

# 4. Iniciar servidor de desenvolvimento
npm run dev
```
