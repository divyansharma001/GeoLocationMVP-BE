#!/bin/sh
set -eu

if [ "${RUN_MIGRATIONS:-true}" = "true" ]; then
  echo "[entrypoint] Running prisma migrate deploy"
  npx prisma migrate deploy
fi

echo "[entrypoint] Starting application"
exec "$@"
