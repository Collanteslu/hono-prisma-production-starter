# ==========================================
# Etapa 1: Dependencias y Compilación
# ==========================================
FROM node:20-alpine AS builder

WORKDIR /app

# Instalar dependencias del sistema requeridas por Prisma / SQLite
RUN apk add --no-cache openssl

COPY package*.json ./
COPY prisma.config.ts ./
COPY prisma ./prisma/

RUN npm ci

COPY tsconfig.json ./
COPY src ./src

# Generar cliente de Prisma y compilar TypeScript
RUN npx prisma generate
RUN npm run build

# ==========================================
# Etapa 2: Imagen Final Ligera para Producción
# ==========================================
FROM node:20-alpine AS runner

WORKDIR /app

ENV NODE_ENV=production
ENV PORT=3011

RUN apk add --no-cache openssl

# Crear directorio de datos persistente con permisos para el usuario node
RUN mkdir -p /app/data && chown -R node:node /app

COPY --chown=node:node package*.json ./
COPY --chown=node:node prisma.config.ts ./
COPY --chown=node:node prisma ./prisma/
COPY --chown=node:node docker-entrypoint.sh ./

# Instalar dependencias de producción (incluye prisma para ejecutar db push en el entrypoint)
USER node
RUN npm ci --omit=dev

# Copiar el código compilado y el cliente generado de Prisma
COPY --chown=node:node --from=builder /app/dist ./dist
COPY --chown=node:node --from=builder /app/src/generated ./src/generated

EXPOSE 3011

ENTRYPOINT ["./docker-entrypoint.sh"]
CMD ["node", "dist/index.js"]

