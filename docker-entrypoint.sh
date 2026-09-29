#!/bin/sh
set -e

# Asegurar que el directorio de la base de datos existe si es una ruta local
if [ -n "$DATABASE_URL" ]; then
  DB_DIR=$(echo "$DATABASE_URL" | sed 's|^file:||' | xargs dirname)
  if [ -n "$DB_DIR" ] && [ "$DB_DIR" != "." ] && [ ! -d "$DB_DIR" ]; then
    mkdir -p "$DB_DIR"
  fi
fi

# Inicializar o sincronizar el esquema de la base de datos
echo "🚀 Sincronizando esquema de base de datos..."
npx prisma db push


# Ejecutar el proceso principal
echo "⚡ Iniciando servidor Hono..."
exec "$@"
