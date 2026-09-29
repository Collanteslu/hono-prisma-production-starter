import dotenv from 'dotenv';
import { z } from 'zod';

// Cargar variables desde el archivo .env
dotenv.config();

/**
 * Esquema Zod para validar las variables de entorno al arrancar.
 * Garantiza que la API nunca se inicie con configuraciones inválidas o secretos faltantes.
 */
const envSchema = z.object({
  PORT: z.coerce.number().default(3011),
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  JWT_SECRET: z.string().min(16, 'JWT_SECRET debe tener al menos 16 caracteres para garantizar seguridad'),
  JWT_REFRESH_SECRET: z.string().min(16, 'JWT_REFRESH_SECRET debe tener al menos 16 caracteres'),
  DATABASE_URL: z.string().default('file:./dev.db')
});

const parsedEnv = envSchema.safeParse(process.env);

if (!parsedEnv.success) {
  console.error('❌ Error crítico: Variables de entorno inválidas o faltantes:');
  console.error(JSON.stringify(parsedEnv.error.flatten().fieldErrors, null, 2));
  process.exit(1);
}

export const env = parsedEnv.data;
