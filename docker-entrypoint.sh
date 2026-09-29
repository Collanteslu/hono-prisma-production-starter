#!/bin/sh
set -e

# Asegurar que el directorio de la base de datos existe si es una ruta local
if [ -n "$DATABASE_URL" ]; then
  DB_DIR=$(echo "$DATABASE_URL" | sed 's|^file:||' | xargs dirname)
  if [ -n "$DB_DIR" ] && [ "$DB_DIR" != "." ] && [ ! -d "$DB_DIR" ]; then
    mkdir -p "$DB_DIR"
  fi
fi

# Aplicar migraciones versionadas (nunca "db push" en producción)
echo "🚀 Aplicando migraciones de base de datos..."
if ! OUTPUT=$(npx prisma migrate deploy 2>&1); then
  echo "$OUTPUT"
  # P3005: base de datos existente creada con "db push" (versiones anteriores de la plantilla).
  # Se marca la migración inicial como aplicada (baseline) y se aplican las siguientes.
  if echo "$OUTPUT" | grep -q "P3005"; then
    echo "🧱 Base de datos existente sin historial de migraciones: aplicando baseline 0_init..."
    npx prisma migrate resolve --applied 0_init
    npx prisma migrate deploy
  else
    exit 1
  fi
else
  echo "$OUTPUT"
fi

# Ejecutar el proceso principal
echo "⚡ Iniciando servidor Hono..."
exec "$@"
