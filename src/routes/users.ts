import { Hono } from 'hono';
import { users, tasks } from '../db.js';
import { User, AppEnv } from '../types/index.js';

export const userRoutes = new Hono<AppEnv>();

/**
 * Función auxiliar para limpiar la contraseña antes de responder al cliente.
 */
function sanitizeUser(user: User) {
  const { password, ...rest } = user;
  return rest;
}

/**
 * GET /api/users
 * Devuelve la lista completa de usuarios (sin contraseñas).
 */
userRoutes.get('/', (c) => {
  return c.json({
    success: true,
    count: users.length,
    data: users.map(sanitizeUser)
  });
});

/**
 * GET /api/users/:id
 * Obtiene los detalles de un usuario específico por su ID.
 */
userRoutes.get('/:id', (c) => {
  const id = c.req.param('id');
  const user = users.find((u) => u.id === id);

  if (!user) {
    return c.json(
      {
        success: false,
        message: `Usuario con id '${id}' no encontrado.`
      },
      404
    );
  }

  return c.json({
    success: true,
    data: sanitizeUser(user)
  });
});

/**
 * POST /api/users
 * Crea un nuevo usuario.
 * Solo administradores pueden asignar roles de 'admin'; por defecto se crea con rol 'user'.
 */
userRoutes.post('/', async (c) => {
  try {
    const body = await c.req.json();
    const { name, email, password, role } = body;

    // Validaciones de entrada
    if (!name || !email || !password) {
      return c.json(
        {
          success: false,
          message: 'Los campos name, email y password son requeridos.'
        },
        400
      );
    }

    // Verificar si el email ya existe
    const exists = users.some((u) => u.email.toLowerCase() === email.toLowerCase());
    if (exists) {
      return c.json(
        {
          success: false,
          message: `El email '${email}' ya se encuentra registrado.`
        },
        409
      );
    }

    // Comprobamos el usuario logueado desde el contexto tipado
    const currentUser = c.get('user');
    const finalRole: 'admin' | 'user' =
      role === 'admin' && currentUser?.role === 'admin' ? 'admin' : 'user';

    const newUser: User = {
      id: `user-${Date.now()}`,
      name,
      email,
      password,
      role: finalRole,
      createdAt: new Date().toISOString()
    };

    users.push(newUser);

    return c.json(
      {
        success: true,
        message: 'Usuario creado exitosamente.',
        data: sanitizeUser(newUser)
      },
      201
    );
  } catch (error) {
    return c.json(
      {
        success: false,
        message: 'Cuerpo de la petición inválido o malformado.'
      },
      400
    );
  }
});

/**
 * PUT /api/users/:id
 * Actualiza los datos de un usuario existente (name, email, password).
 */
userRoutes.put('/:id', async (c) => {
  try {
    const id = c.req.param('id');
    const userIndex = users.findIndex((u) => u.id === id);

    if (userIndex === -1) {
      return c.json(
        {
          success: false,
          message: `Usuario con id '${id}' no encontrado.`
        },
        404
      );
    }

    const body = await c.req.json();
    const { name, email, password } = body;

    // Si intenta cambiar el email, validamos que no pertenezca a otro usuario
    if (email && email.toLowerCase() !== users[userIndex].email.toLowerCase()) {
      const emailTaken = users.some(
        (u) => u.email.toLowerCase() === email.toLowerCase() && u.id !== id
      );
      if (emailTaken) {
        return c.json(
          {
            success: false,
            message: `El email '${email}' ya está en uso por otro usuario.`
          },
          409
        );
      }
      users[userIndex].email = email;
    }

    if (name) users[userIndex].name = name;
    if (password) users[userIndex].password = password;

    return c.json({
      success: true,
      message: 'Usuario actualizado correctamente.',
      data: sanitizeUser(users[userIndex])
    });
  } catch (error) {
    return c.json(
      {
        success: false,
        message: 'Error al actualizar el usuario.'
      },
      400
    );
  }
});

/**
 * DELETE /api/users/:id
 * Elimina un usuario y borra en cascada todas sus tareas asociadas.
 */
userRoutes.delete('/:id', (c) => {
  const id = c.req.param('id');
  const userIndex = users.findIndex((u) => u.id === id);

  if (userIndex === -1) {
    return c.json(
      {
        success: false,
        message: `Usuario con id '${id}' no encontrado.`
      },
      404
    );
  }

  // Eliminar usuario
  const deletedUser = users.splice(userIndex, 1)[0];

  // Eliminación en cascada de tareas que pertenecían al usuario
  let deletedTasksCount = 0;
  for (let i = tasks.length - 1; i >= 0; i--) {
    if (tasks[i].userId === id) {
      tasks.splice(i, 1);
      deletedTasksCount++;
    }
  }

  return c.json({
    success: true,
    message: `Usuario '${deletedUser.name}' eliminado con éxito, junto a sus ${deletedTasksCount} tarea(s) asociadas.`,
    data: sanitizeUser(deletedUser)
  });
});
