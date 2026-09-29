import path from 'node:path';
import { PrismaClient } from './generated/client/client.js';
import { PrismaLibSql } from '@prisma/adapter-libsql';

/**
 * Configuración del cliente de base de datos SQLite con Prisma 7.
 * 
 * En Prisma 7, las conexiones a motores de bases de datos se realizan mediante Driver Adapters.
 * Para SQLite, utilizamos '@prisma/adapter-libsql' que ofrece alto rendimiento y compatibilidad
 * tanto con archivos SQLite locales (.db) como con Turso / LibSQL en la nube.
 */
const dbPath = path.resolve(process.cwd(), 'dev.db');

const adapter = new PrismaLibSql({
  url: `file:${dbPath}`
});

export const prisma = new PrismaClient({ adapter });

/**
 * Función de inicialización y siembra (Seed) de datos iniciales.
 * Crea los usuarios y tareas por defecto si la base de datos está vacía.
 */
export async function seedDatabase() {
  const usersCount = await prisma.user.count();

  if (usersCount === 0) {
    console.log(' Inicializando base de datos SQLite con datos iniciales (Seed)...');

    // 1. Crear Usuario Admin
    const admin = await prisma.user.create({
      data: {
        id: 'user-1',
        name: 'Luis Admin',
        email: 'admin@example.com',
        password: 'password123',
        role: 'admin',
        tasks: {
          create: [
            {
              id: 'task-1',
              title: 'Aprender Hono Framework',
              description: 'Comprender el router, middlewares y context de Hono.',
              completed: false
            },
            {
              id: 'task-2',
              title: 'Configurar JWT y roles',
              description: 'Proteger rutas privadas usando middleware de autenticación.',
              completed: true
            }
          ]
        }
      }
    });

    // 2. Crear Usuario Regular
    const user = await prisma.user.create({
      data: {
        id: 'user-2',
        name: 'Ana García',
        email: 'ana@example.com',
        password: 'password123',
        role: 'user',
        tasks: {
          create: [
            {
              id: 'task-3',
              title: 'Diseñar interfaz frontend',
              description: 'Crear vistas para consumir la API de tareas y usuarios.',
              completed: false
            }
          ]
        }
      }
    });

    console.log('✔ Base de datos inicializada con éxito (Admin:', admin.email, ', User:', user.email, ')');
  }
}
