# ======================================================
# WattFlow - Dockerfile Multi-Stage de Produção
# ======================================================

# 1. Base com suporte a OpenSSL para engines do Prisma
FROM node:20-alpine AS base
RUN apk add --no-cache libc6-compat openssl

WORKDIR /app

# 2. Instalação das dependências
FROM base AS deps
WORKDIR /app

COPY package.json package-lock.json ./
COPY prisma ./prisma/

RUN npm ci && \
    node -e 'const fs=require("fs"),path=require("path"),srcRoot="/app/node_modules",dstRoot="/app/prisma-cli/node_modules",seen=new Set();function copyPkg(n){if(seen.has(n))return;seen.add(n);const s=path.join(srcRoot,...n.split("/"));if(!fs.existsSync(s))return;const d=path.join(dstRoot,...n.split("/"));fs.mkdirSync(path.dirname(d),{recursive:true});fs.cpSync(s,d,{recursive:true,dereference:true});const p=path.join(s,"package.json");if(!fs.existsSync(p))return;const pkg=JSON.parse(fs.readFileSync(p,"utf8"));for(const dep of Object.keys(pkg.dependencies||{}))copyPkg(dep);}copyPkg("prisma");' && \
    node /app/prisma-cli/node_modules/prisma/build/index.js --version

# 3. Compilação da aplicação Next.js (Standalone)
FROM base AS builder
WORKDIR /app

COPY --from=deps /app/node_modules ./node_modules
COPY . .

ENV NEXT_TELEMETRY_DISABLED=1

# Gera os tipos do Prisma Client e compila o Next.js
RUN npx prisma generate
RUN npm run build

# 4. Imagem Final de Execução (Leve e Segura)
FROM base AS runner
WORKDIR /app

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV PORT=3000
ENV HOSTNAME="0.0.0.0"
ENV PATH="/app/node_modules/.bin:$PATH"

# Ferramentas úteis para healthcheck e rede
RUN apk add --no-cache curl openssl

# Criação de usuário não-root por segurança
RUN addgroup --system --gid 1001 nodejs && \
    adduser --system --uid 1001 nextjs

# Copia os artefatos compilados standalone, estáticos e schema prisma (root:root, somente leitura para nextjs)
COPY --from=builder /app/public ./public
COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static
COPY --from=builder /app/prisma ./prisma
COPY --from=deps /app/prisma-cli /app/prisma-cli

# Mantém gravável para o usuário nextjs apenas o diretório de cache do Next.js
RUN mkdir -p .next/cache && chown -R nextjs:nodejs .next/cache

# Script de entrada para sincronização automática do banco
COPY docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh
RUN chmod +x /usr/local/bin/docker-entrypoint.sh

USER nextjs
RUN node /app/prisma-cli/node_modules/prisma/build/index.js --version

EXPOSE 3000

ENTRYPOINT ["/usr/local/bin/docker-entrypoint.sh"]
CMD ["node", "server.js"]
