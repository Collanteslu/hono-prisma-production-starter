#!/bin/bash
set -e

BASE_URL="http://localhost:3000"

echo "=== 1. Probando Endpoint Raíz ==="
curl -s "$BASE_URL/" | grep "online"
echo -e "\n✔ Raíz funcionando"

echo -e "\n=== 2. Login como Usuario Ana García (user-2) ==="
LOGIN_RES=$(curl -s -X POST "$BASE_URL/api/auth/login" \
  -H "Content-Type: application/json" \
  -d '{"email":"ana@example.com","password":"password123"}')
echo "$LOGIN_RES"

TOKEN=$(echo "$LOGIN_RES" | grep -o '"token":"[^"]*' | cut -d'"' -f4)

if [ -z "$TOKEN" ]; then
  echo "Error: No se pudo obtener el token"
  exit 1
fi
echo -e "✔ Token de Ana obtenido con éxito"

echo -e "\n=== 3. Listar Tareas de Ana (GET /api/tasks) ==="
echo "Solo devolverá las tareas que pertenecen a Ana, sin enviar ningún userId:"
curl -s -X GET "$BASE_URL/api/tasks" -H "Authorization: Bearer $TOKEN"

echo -e "\n\n=== 4. Crear una nueva tarea para Ana ==="
echo "No se envía userId: el backend lo asigna directamente desde el token"
NEW_TASK=$(curl -s -X POST "$BASE_URL/api/tasks" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"title":"Mi nueva tarea privada","description":"Solo yo puedo verla"}')
echo "$NEW_TASK"

NEW_TASK_ID=$(echo "$NEW_TASK" | grep -o '"id":"[^"]*' | cut -d'"' -f4)

echo -e "\n=== 5. Intentar ver una tarea ajena (task-1 de Luis Admin) ==="
echo "Debe denegar el acceso con 403 Forbidden:"
curl -s -X GET "$BASE_URL/api/tasks/task-1" -H "Authorization: Bearer $TOKEN"

echo -e "\n\n=== 6. Intentar borrar una tarea ajena (task-1 de Luis Admin) ==="
echo "Debe denegar el acceso con 403 Forbidden:"
curl -s -X DELETE "$BASE_URL/api/tasks/task-1" -H "Authorization: Bearer $TOKEN"

echo -e "\n\n=== 7. Borrar la propia tarea recién creada ==="
curl -s -X DELETE "$BASE_URL/api/tasks/$NEW_TASK_ID" -H "Authorization: Bearer $TOKEN"

echo -e "\n\n Pruebas de seguridad completadas exitosamente."
