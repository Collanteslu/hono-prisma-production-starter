import { User, Task } from './types/index.js';

/**
 * Base de datos simulada en memoria.
 * Permite probar de inmediato sin necesidad de instalar o configurar bases de datos externas (PostgreSQL, MongoDB, etc.).
 *
 * Contiene datos iniciales de prueba para facilitar los testeos inmediatos.
 */
export const users: User[] = [
  {
    id: 'user-1',
    name: 'Luis Admin',
    email: 'admin@example.com',
    password: 'password123',
    role: 'admin',
    createdAt: new Date().toISOString()
  },
  {
    id: 'user-2',
    name: 'Ana García',
    email: 'ana@example.com',
    password: 'password123',
    role: 'user',
    createdAt: new Date().toISOString()
  }
];

export const tasks: Task[] = [
  {
    id: 'task-1',
    userId: 'user-1',
    title: 'Aprender Hono Framework',
    description: 'Comprender el router, middlewares y context de Hono.',
    completed: false,
    createdAt: new Date().toISOString()
  },
  {
    id: 'task-2',
    userId: 'user-1',
    title: 'Configurar JWT y roles',
    description: 'Proteger rutas privadas usando middleware de autenticación.',
    completed: true,
    createdAt: new Date().toISOString()
  },
  {
    id: 'task-3',
    userId: 'user-2',
    title: 'Diseñar interfaz frontend',
    description: 'Crear vistas para consumir la API de tareas y usuarios.',
    completed: false,
    createdAt: new Date().toISOString()
  }
];
