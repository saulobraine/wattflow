#!/bin/sh
set -e

echo "=== [WattFlow] Inicializando Container ==="

if [ -n "$DATABASE_URL" ]; then
  run_prisma() {
    if [ -f "/app/prisma-cli/node_modules/prisma/build/index.js" ]; then
      node /app/prisma-cli/node_modules/prisma/build/index.js "$@"
    elif [ -f "./node_modules/.bin/prisma" ]; then
      ./node_modules/.bin/prisma "$@"
    elif command -v prisma >/dev/null 2>&1; then
      prisma "$@"
    else
      echo "ERRO: Prisma CLI não encontrado no container."
      exit 1
    fi
  }

  if [ -d "./prisma/migrations" ]; then
    echo ">>> Aplicando migrações de produção do Prisma (prisma migrate deploy)..."
    run_prisma migrate deploy
  else
    echo ">>> Diretório prisma/migrations não encontrado. Sincronizando schema via fallback seguro (prisma db push)..."
    run_prisma db push --skip-generate
  fi

  echo ">>> Schema do banco de dados sincronizado com sucesso!"
fi

echo ">>> Iniciando servidor HTTP do WattFlow..."
exec "$@"
