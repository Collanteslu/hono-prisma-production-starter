import { Hono } from 'hono';
import { serve } from '@hono/node-server';
import { logger } from 'hono/logger';
import { cors } from 'hono/cors';
import { prettyJSON } from 'hono/pretty-json';

// Base de datos y semilla de inicio
import { seedDatabase } from './db.js';

// Importación de rutas modulares
import { authRoutes } from './routes/auth.js';
import { userRoutes } from './routes/users.js';
import { taskRoutes } from './routes/tasks.js';

// Importación del middleware de autenticación
import { authMiddleware } from './middleware/auth.js';

/**
 * Instancia principal de la aplicación Hono
 */
const app = new Hono();

/**
 * -------------------------------------------------------------
 * Middlewares Globales
 * -------------------------------------------------------------
 */
// 1. Logger: Imprime en consola cada petición HTTP entrante con su tiempo de respuesta y status code
app.use('*', logger());

// 2. CORS: Habilita el intercambio de recursos entre orígenes para consumir desde cualquier frontend
app.use('*', cors());

// 3. Pretty JSON: Formatea los JSON en las respuestas para que sean legibles en el navegador y curl
app.use('*', prettyJSON());

/**
 * -------------------------------------------------------------
 * Rutas Públicas
 * -------------------------------------------------------------
 */
// Bienvenida y Health Check
app.get('/', (c) => {
  return c.json({
    status: 'online',
    name: 'API REST con Hono, Prisma 7 y SQLite',
    version: '1.0.0',
    documentation: {
      auth: 'POST /api/auth/login',
      users: 'GET, POST, PUT, DELETE /api/users',
      tasks: 'GET, POST, PUT, DELETE /api/tasks'
    }
  });
});

// Rutas de autenticación (Login público)
app.route('/api/auth', authRoutes);

/**
 * -------------------------------------------------------------
 * Rutas Protegidas por Autenticación JWT
 * -------------------------------------------------------------
 * Cualquier endpoint bajo /api/users/* y /api/tasks/* requerirá
 * una cabecera 'Authorization: Bearer <token>' válida.
 */
app.use('/api/users/*', authMiddleware);
app.use('/api/tasks/*', authMiddleware);

// Montaje de las rutas secundarias
app.route('/api/users', userRoutes);
app.route('/api/tasks', taskRoutes);

/**
 * -------------------------------------------------------------
 * Manejo Global de Errores y Rutas no Encontradas (404)
 * -------------------------------------------------------------
 */
app.notFound((c) => {
  return c.json(
    {
      success: false,
      message: `Ruta no encontrada: ${c.req.method} ${c.req.url}`
    },
    404
  );
});

app.onError((err, c) => {
  console.error('Error no controlado en la aplicación:', err);
  return c.json(
    {
      success: false,
      message: 'Ocurrió un error interno en el servidor.',
      error: err.message
    },
    500
  );
});

/**
 * -------------------------------------------------------------
 * Inicialización del Servidor Node.js y Base de Datos
 * -------------------------------------------------------------
 */
const port = Number(process.env.PORT) || 3000;

// Inicializamos la base de datos SQLite antes de escuchar peticiones
await seedDatabase();

console.log(` Servidor Hono con Prisma 7 iniciado en http://localhost:${port}`);

serve({
  fetch: app.fetch,
  port
});

export default app;
