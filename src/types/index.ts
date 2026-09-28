/**
 * Definición del modelo de Usuario.
 */
export interface User {
  id: string;
  name: string;
  email: string;
  password: string; // En producción debe almacenarse hasheada (p. ej. con bcrypt/argon2)
  role: 'admin' | 'user';
  createdAt: string;
}

/**
 * Definición del modelo de Tarea (asociada a un usuario mediante userId).
 */
export interface Task {
  id: string;
  userId: string; // Clave foránea que relaciona la tarea con el usuario
  title: string;
  description: string;
  completed: boolean;
  createdAt: string;
}

/**
 * Payload que se guarda y extrae del token JWT.
 */
export interface JwtPayload {
  userId: string;
  email: string;
  role: 'admin' | 'user';
  exp: number;
}

/**
 * Tipado de las variables almacenadas en el Contexto de Hono (c.set / c.get)
 */
export type AppVariables = {
  user: JwtPayload;
};

/**
 * Entorno de la aplicación Hono
 */
export type AppEnv = {
  Variables: AppVariables;
};
