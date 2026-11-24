#!/bin/sh
set -e

echo "=== [WattFlow] Inicializando Container ==="

if [ -n "$DATABASE_URL" ]; then
  PRISMA_BIN=""
  if [ -f "./node_modules/.bin/prisma" ]; then
    PRISMA_BIN="./node_modules/.bin/prisma"
  elif command -v prisma >/dev/null 2>&1; then
    PRISMA_BIN="prisma"
  else
    echo "ERRO: Prisma CLI não encontrado no container."
    exit 1
  fi

  if [ -d "./prisma/migrations" ]; then
    echo ">>> Aplicando migrações de produção do Prisma (prisma migrate deploy)..."
    "$PRISMA_BIN" migrate deploy
  else
    echo ">>> Diretório prisma/migrations não encontrado. Sincronizando schema via fallback seguro (prisma db push)..."
    "$PRISMA_BIN" db push --skip-generate
  fi

  echo ">>> Schema do banco de dados sincronizado com sucesso!"
fi

echo ">>> Iniciando servidor HTTP do WattFlow..."
exec "$@"
