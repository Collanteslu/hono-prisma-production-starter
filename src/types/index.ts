/**
 * Definición del modelo de Usuario.
 */
export interface User {
  id: string;
  name: string;
  email: string;
  password: string;
  role: string;
  createdAt: string;
}

/**
 * Definición del modelo de Tarea.
 */
export interface Task {
  id: string;
  userId: string;
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
  requestId: string;
};

/**
 * Entorno de la aplicación Hono
 */
export type AppEnv = {
  Variables: AppVariables;
};

/**
 * Metadatos para respuestas paginadas
 */
export interface PaginationMeta {
  total: number;
  page: number;
  limit: number;
  totalPages: number;
  hasNextPage: boolean;
  hasPrevPage: boolean;
}
