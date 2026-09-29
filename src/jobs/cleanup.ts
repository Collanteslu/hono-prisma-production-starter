import { prisma } from '../db.js';

/**
 * Rutina para purgar sesiones y refresh tokens expirados de la base de datos SQLite.
 * Mantiene la base de datos optimizada y evita la acumulación de registros obsoletos.
 */
export async function cleanupExpiredSessions(): Promise<{ deletedSessions: number; deletedTokens: number }> {
  try {
    const now = new Date();

    const [sessionsRes, tokensRes] = await Promise.all([
      // 1. Eliminar sesiones expiradas o inactivas de más de 24h
      prisma.session.deleteMany({
        where: {
          OR: [
            { expiresAt: { lt: now } },
            {
              isActive: false,
              updatedAt: { lt: new Date(now.getTime() - 24 * 60 * 60 * 1000) }
            }
          ]
        }
      }),
      // 2. Eliminar refresh tokens expirados
      prisma.refreshToken.deleteMany({
        where: {
          expiresAt: { lt: now }
        }
      })
    ]);

    if (sessionsRes.count > 0 || tokensRes.count > 0) {
      console.log(
        `🧹 [Cleanup Routine] Purgadas ${sessionsRes.count} sesión(es) y ${tokensRes.count} token(s) expirados.`
      );
    }

    return {
      deletedSessions: sessionsRes.count,
      deletedTokens: tokensRes.count
    };
  } catch (error) {
    console.error('❌ Error en rutina de limpieza de sesiones:', error);
    return { deletedSessions: 0, deletedTokens: 0 };
  }
}

/**
 * Inicia la rutina periódica de limpieza (por defecto cada 1 hora).
 */
export function startCleanupJob(intervalMs: number = 60 * 60 * 1000): NodeJS.Timeout {
  // Ejecutar una limpieza inicial no bloqueante
  cleanupExpiredSessions();

  // Programar repetición periódica
  const timer = setInterval(() => {
    cleanupExpiredSessions();
  }, intervalMs);

  // Evitar que el timer impida que Node se cierre si el proceso termina
  timer.unref();

  return timer;
}
