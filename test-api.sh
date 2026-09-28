#!/bin/bash
set -e

BASE_URL="http://localhost:3000"

echo "=== 1. Probando Endpoint Raíz ==="
curl -s "$BASE_URL/" | grep "online"
echo -e "\n✔ Raíz funcionando"

echo -e "\n=== 2. Probando Login (Obtención de JWT) ==="
LOGIN_RES=$(curl -s -X POST "$BASE_URL/api/auth/login" \
  -H "Content-Type: application/json" \
  -d '{"email":"admin@example.com","password":"password123"}')
echo "$LOGIN_RES"

TOKEN=$(echo "$LOGIN_RES" | grep -o '"token":"[^"]*' | cut -d'"' -f4)

if [ -z "$TOKEN" ]; then
  echo "Error: No se pudo obtener el token"
  exit 1
fi
echo -e "✔ Token obtenido con éxito: ${TOKEN:0:20}..."

echo -e "\n=== 3. Probando Acceso no autorizado (sin token) ==="
UNAUTH_RES=$(curl -s -X GET "$BASE_URL/api/users")
echo "$UNAUTH_RES"

echo -e "\n=== 4. Listar Usuarios (con token) ==="
curl -s -X GET "$BASE_URL/api/users" -H "Authorization: Bearer $TOKEN"

echo -e "\n\n=== 5. Crear un Nuevo Usuario ==="
NEW_USER=$(curl -s -X POST "$BASE_URL/api/users" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"name":"Carlos Lopez","email":"carlos@example.com","password":"pass456","role":"user"}')
echo "$NEW_USER"

NEW_USER_ID=$(echo "$NEW_USER" | grep -o '"id":"[^"]*' | cut -d'"' -f4)
echo "ID del nuevo usuario: $NEW_USER_ID"

echo -e "\n=== 6. Crear Tarea para el nuevo usuario ==="
NEW_TASK=$(curl -s -X POST "$BASE_URL/api/tasks" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d "{\"title\":\"Configurar entorno de desarrollo\",\"description\":\"Instalar paquetes y dependencias\",\"userId\":\"$NEW_USER_ID\"}")
echo "$NEW_TASK"

NEW_TASK_ID=$(echo "$NEW_TASK" | grep -o '"id":"[^"]*' | cut -d'"' -f4)
echo "ID de la nueva tarea: $NEW_TASK_ID"

echo -e "\n=== 7. Listar Tareas filtradas por el nuevo usuario ==="
curl -s -X GET "$BASE_URL/api/tasks?userId=$NEW_USER_ID" -H "Authorization: Bearer $TOKEN"

echo -e "\n\n=== 8. Actualizar la Tarea (marcar como completada) ==="
curl -s -X PUT "$BASE_URL/api/tasks/$NEW_TASK_ID" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"completed":true,"description":"Instalación completada y verificada"}'

echo -e "\n\n=== 9. Actualizar el Usuario ==="
curl -s -X PUT "$BASE_URL/api/users/$NEW_USER_ID" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"name":"Carlos Lopez Actualizado"}'

echo -e "\n\n=== 10. Eliminar el Usuario (y comprobar eliminación en cascada de sus tareas) ==="
curl -s -X DELETE "$BASE_URL/api/users/$NEW_USER_ID" -H "Authorization: Bearer $TOKEN"

echo -e "\n\n=== 11. Verificar que las tareas del usuario ya no existen ==="
curl -s -X GET "$BASE_URL/api/tasks?userId=$NEW_USER_ID" -H "Authorization: Bearer $TOKEN"

echo -e "\n\n Pruebas automáticas completadas con éxito."
