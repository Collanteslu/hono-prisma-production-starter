import path from 'node:path';
import { PrismaClient } from './generated/client/client.js';
import { PrismaLibSql } from '@prisma/adapter-libsql';
import { hashPassword } from './utils/password.js';

/**
 * Configuración del cliente de base de datos SQLite con Prisma 7.
 */
const dbPath = path.resolve(process.cwd(), 'dev.db');

const adapter = new PrismaLibSql({
  url: `file:${dbPath}`
});

export const prisma = new PrismaClient({ adapter });

/**
 * Función de inicialización y siembra (Seed) de datos iniciales.
 * Hashea las contraseñas de forma segura con bcrypt antes de guardarlas.
 */
export async function seedDatabase() {
  const usersCount = await prisma.user.count();

  if (usersCount === 0) {
    console.log(' Inicializando base de datos SQLite con contraseñas hasheadas (Seed)...');

    const hashedPassword = await hashPassword('password123');

    // 1. Crear Usuario Admin
    const admin = await prisma.user.create({
      data: {
        id: 'user-1',
        name: 'Luis Admin',
        email: 'admin@example.com',
        password: hashedPassword,
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
        password: hashedPassword,
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

    console.log('✔ Base de datos inicializada con contraseñas seguras (Admin:', admin.email, ', User:', user.email, ')');
  }
}
