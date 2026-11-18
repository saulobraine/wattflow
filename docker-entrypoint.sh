#!/bin/sh
set -e

echo "=== [WattFlow] Inicializando Container ==="

# Limpa qualquer .env estático copiado para priorizar variáveis do docker-compose
if [ -f "./.env" ]; then
  rm -f ./.env
fi

if [ -n "$DATABASE_URL" ]; then
  echo ">>> Sincronizando schema do banco de dados (Prisma db push)..."
  if [ -f "./node_modules/.bin/prisma" ]; then
    ./node_modules/.bin/prisma db push --skip-generate --accept-data-loss
  elif command -v prisma >/dev/null 2>&1; then
    prisma db push --skip-generate --accept-data-loss
  else
    npx --yes prisma db push --skip-generate --accept-data-loss
  fi
  echo ">>> Schema do banco de dados sincronizado com sucesso!"
fi

echo ">>> Iniciando servidor HTTP do WattFlow..."
exec "$@"
