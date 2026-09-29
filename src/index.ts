import { Hono } from 'hono';
import { serve } from '@hono/node-server';
import { logger } from 'hono/logger';
import { cors } from 'hono/cors';
import { prettyJSON } from 'hono/pretty-json';
import { secureHeaders } from 'hono/secure-headers';
import { apiReference } from '@scalar/hono-api-reference';

// Configuración de entorno y base de datos
import { env } from './config/env.js';
import { prisma, seedDatabase } from './db.js';
import { AppEnv } from './types/index.js';
import { openApiSpec } from './docs/openapi.js';

// Middlewares
import { authMiddleware } from './middleware/auth.js';
import { requestIdMiddleware } from './middleware/requestId.js';

// Rutas
import { authRoutes } from './routes/auth.js';
import { userRoutes } from './routes/users.js';
import { taskRoutes } from './routes/tasks.js';
import { sessionRoutes } from './routes/sessions.js';

/**
 * Instancia principal de la aplicación Hono tipada con AppEnv
 */
const app = new Hono<AppEnv>();

/**
 * -------------------------------------------------------------
 * Middlewares Globales de Seguridad y Trazabilidad
 * -------------------------------------------------------------
 */
// 1. Trazabilidad: Asigna o propaga X-Request-Id en cada petición
app.use('*', requestIdMiddleware);

// 2. Seguridad HTTP: Cabeceras HSTS, XSS Protection, CSP, No-Sniff, Frameguard
app.use('*', secureHeaders());

// 3. Logger HTTP con tiempo de respuesta
app.use('*', logger());

// 4. CORS configurado
app.use(
  '*',
  cors({
    origin: '*',
    allowMethods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowHeaders: ['Content-Type', 'Authorization', 'X-Request-Id']
  })
);

// 5. Formateador JSON legible
app.use('*', prettyJSON());

/**
 * -------------------------------------------------------------
 * Documentación Interactiva OpenAPI (Scalar) & Healthcheck
 * -------------------------------------------------------------
 */
// Especificación OpenAPI en formato JSON
app.get('/openapi.json', (c) => c.json(openApiSpec));

// Panel interactivo de documentación en /docs
app.get(
  '/docs',
  apiReference({
    pageTitle: 'API Reference | Hono + Prisma',
    spec: {
      url: '/openapi.json'
    }
  })
);

// Endpoint de Healthcheck profundo (servidor + conexión a SQLite)
app.get('/healthz', async (c) => {
  try {
    const startTime = Date.now();
    await prisma.$queryRaw`SELECT 1`;
    const dbLatencyMs = Date.now() - startTime;

    return c.json({
      status: 'healthy',
      timestamp: new Date().toISOString(),
      uptimeSeconds: Math.floor(process.uptime()),
      database: {
        status: 'connected',
        latencyMs: dbLatencyMs
      }
    });
  } catch (error) {
    return c.json(
      {
        status: 'unhealthy',
        timestamp: new Date().toISOString(),
        database: {
          status: 'disconnected',
          error: error instanceof Error ? error.message : 'Error al conectar a SQLite'
        }
      },
      503
    );
  }
});

// Endpoint raíz de bienvenida
app.get('/', (c) => {
  return c.json({
    status: 'online',
    name: 'API REST Profesional con Hono, Prisma 7, SQLite y Sesiones Activas',
    version: '1.1.0',
    documentationUrl: '/docs',
    endpoints: {
      healthcheck: '/healthz',
      documentation: '/docs',
      auth: {
        login: 'POST /api/auth/login',
        refresh: 'POST /api/auth/refresh',
        logout: 'POST /api/auth/logout'
      },
      sessions: {
        mySessions: 'GET /api/sessions/me',
        revokeSession: 'DELETE /api/sessions/:sessionId',
        revokeAll: 'POST /api/sessions/revoke-all'
      },
      users: {
        crud: 'GET, POST, PUT, DELETE /api/users',
        blockUser: 'PATCH /api/users/:id/block',
        revokeAllUserSessions: 'POST /api/users/:id/revoke-sessions'
      },
      tasks: 'GET, POST, PUT, DELETE /api/tasks'
    }
  });
});

/**
 * -------------------------------------------------------------
 * Montaje de Rutas
 * -------------------------------------------------------------
 */
// Rutas públicas de autenticación
app.route('/api/auth', authRoutes);

// Protección con autenticación JWT con Stateful Session Check
app.use('/api/sessions/*', authMiddleware);
app.use('/api/users/*', authMiddleware);
app.use('/api/tasks/*', authMiddleware);

app.route('/api/sessions', sessionRoutes);
app.route('/api/users', userRoutes);
app.route('/api/tasks', taskRoutes);

/**
 * -------------------------------------------------------------
 * Manejadores de Error y 404
 * -------------------------------------------------------------
 */
app.notFound((c) => {
  return c.json(
    {
      success: false,
      message: `Ruta no encontrada: ${c.req.method} ${c.req.url}`,
      requestId: c.get('requestId')
    },
    404
  );
});

app.onError((err, c) => {
  console.error(`[Error] RequestId: ${c.get('requestId')}:`, err);
  return c.json(
    {
      success: false,
      message: 'Ocurrió un error interno en el servidor.',
      requestId: c.get('requestId'),
      error: env.NODE_ENV === 'development' ? err.message : undefined
    },
    500
  );
});

/**
 * -------------------------------------------------------------
 * Inicialización del Servidor Node.js
 * -------------------------------------------------------------
 */
await seedDatabase();

console.log(` Servidor Hono listo en http://localhost:${env.PORT}`);
console.log(` Documentación interactiva disponible en: http://localhost:${env.PORT}/docs`);

serve({
  fetch: app.fetch,
  port: env.PORT
});

export default app;
