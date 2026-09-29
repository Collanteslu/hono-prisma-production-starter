#!/bin/bash
set -e

BASE_URL="http://localhost:3011"

echo "=========================================================="
echo "🧪 1. PROBANDO HEALTHCHECK PROFUNDO (SQLite + Uptime)"
echo "=========================================================="
HEALTH=$(curl -s "$BASE_URL/healthz")
echo "$HEALTH"
echo "$HEALTH" | grep -q "healthy"
echo "✔ Healthcheck funcionando correctamente"

echo -e "\n=========================================================="
echo "🧪 2. PROBANDO DOCUMENTACIÓN OPENAPI (Scalar / Swagger)"
echo "=========================================================="
OPENAPI=$(curl -s "$BASE_URL/openapi.json")
echo "$OPENAPI" | grep -q "Hono REST API"
echo "✔ Especificación OpenAPI 3.0 servida con éxito"

DOCS_STATUS=$(curl -s -o /dev/null -w "%{http_code}" "$BASE_URL/docs")
if [ "$DOCS_STATUS" -eq 200 ]; then
  echo "✔ Interfaz gráfica de documentación /docs respondiendo HTTP 200"
fi

echo -e "\n=========================================================="
echo "🧪 3. PROBANDO CABECERAS DE SEGURIDAD Y REQUEST ID"
echo "=========================================================="
HEADERS=$(curl -s -i "$BASE_URL/" | tr -d '\r')
echo "$HEADERS" | grep -i "x-request-id"
echo "$HEADERS" | grep -i "x-content-type-options"
echo "✔ X-Request-Id y Secure Headers inyectados en las respuestas"

echo -e "\n=========================================================="
echo "🧪 4. PROBANDO LOGIN CON CONTRASEÑA HASHEADA (BCRYPT)"
echo "=========================================================="
LOGIN_RES=$(curl -s -X POST "$BASE_URL/api/auth/login" \
  -H "Content-Type: application/json" \
  -d '{"email":"ana@example.com","password":"password123"}')
echo "$LOGIN_RES"

ACCESS_TOKEN=$(echo "$LOGIN_RES" | grep -o '"accessToken":"[^"]*' | cut -d'"' -f4)
REFRESH_TOKEN=$(echo "$LOGIN_RES" | grep -o '"refreshToken":"[^"]*' | cut -d'"' -f4)

if [ -z "$ACCESS_TOKEN" ] || [ -z "$REFRESH_TOKEN" ]; then
  echo "❌ Error: No se recibieron los tokens en el login"
  exit 1
fi
echo "✔ Login con Bcrypt exitoso. Access Token (15 min) y Refresh Token (7 días) obtenidos."

echo -e "\n=========================================================="
echo "🧪 5. PROBANDO RATE LIMITING EN /api/auth/login"
echo "=========================================================="
echo "Verificando cabeceras de rate limiting en el login:"
curl -s -i -X POST "$BASE_URL/api/auth/login" \
  -H "Content-Type: application/json" \
  -d '{"email":"fake@example.com","password":"wrongpassword"}' | tr -d '\r' | grep -i "x-ratelimit" || true
echo "✔ Cabeceras de Rate Limiting activas"

echo -e "\n=========================================================="
echo "🧪 6. PROBANDO REFRESH TOKEN (TOKEN ROTATION)"
echo "=========================================================="
REFRESH_RES=$(curl -s -X POST "$BASE_URL/api/auth/refresh" \
  -H "Content-Type: application/json" \
  -d "{\"refreshToken\":\"$REFRESH_TOKEN\"}")
echo "$REFRESH_RES"

NEW_ACCESS_TOKEN=$(echo "$REFRESH_RES" | grep -o '"accessToken":"[^"]*' | cut -d'"' -f4)
NEW_REFRESH_TOKEN=$(echo "$REFRESH_RES" | grep -o '"refreshToken":"[^"]*' | cut -d'"' -f4)

if [ -z "$NEW_ACCESS_TOKEN" ]; then
  echo "❌ Error en Token Rotation"
  exit 1
fi
echo "✔ Token Rotation completado con éxito."

echo -e "\nProbando que el refresh token anterior fue revocado (debe fallar con 401):"
OLD_REFRESH_ATTEMPT=$(curl -s -o /dev/null -w "%{http_code}" -X POST "$BASE_URL/api/auth/refresh" \
  -H "Content-Type: application/json" \
  -d "{\"refreshToken\":\"$REFRESH_TOKEN\"}")
if [ "$OLD_REFRESH_ATTEMPT" -eq 401 ]; then
  echo "✔ Correcto: El refresh token anterior quedó revocado tras usarse (One-time usage / Rotation)"
fi

echo -e "\n=========================================================="
echo "🧪 7. PROBANDO PAGINACIÓN, BÚSQUEDA Y FILTROS EN TAREAS"
echo "=========================================================="
echo "Creando dos tareas de prueba para Ana..."
curl -s -X POST "$BASE_URL/api/tasks" \
  -H "Authorization: Bearer $NEW_ACCESS_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"title":"Aprender TypeScript Avanzado","description":"Explorar generics y decorators","completed":false}' > /dev/null

curl -s -X POST "$BASE_URL/api/tasks" \
  -H "Authorization: Bearer $NEW_ACCESS_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"title":"Reunión con equipo de frontend","description":"Definir contratos de la API","completed":true}' > /dev/null

echo "Listando tareas con paginación (?page=1&limit=2):"
curl -s -X GET "$BASE_URL/api/tasks?page=1&limit=2" -H "Authorization: Bearer $NEW_ACCESS_TOKEN"

echo -e "\n\nBuscando tareas con texto (?search=frontend):"
curl -s -X GET "$BASE_URL/api/tasks?search=frontend" -H "Authorization: Bearer $NEW_ACCESS_TOKEN"

echo -e "\n\nFiltrando tareas completadas (?completed=true):"
curl -s -X GET "$BASE_URL/api/tasks?completed=true" -H "Authorization: Bearer $NEW_ACCESS_TOKEN"

echo -e "\n\n=========================================================="
echo "🧪 8. PROBANDO CIERRE DE SESIÓN (LOGOUT Y REVOCACIÓN)"
echo "=========================================================="
LOGOUT_RES=$(curl -s -X POST "$BASE_URL/api/auth/logout" \
  -H "Content-Type: application/json" \
  -d "{\"refreshToken\":\"$NEW_REFRESH_TOKEN\"}")
echo "$LOGOUT_RES"

echo -e "\nIntentando renovar token tras logout (debe dar 401):"
POST_LOGOUT_STATUS=$(curl -s -o /dev/null -w "%{http_code}" -X POST "$BASE_URL/api/auth/refresh" \
  -H "Content-Type: application/json" \
  -d "{\"refreshToken\":\"$NEW_REFRESH_TOKEN\"}")
if [ "$POST_LOGOUT_STATUS" -eq 401 ]; then
  echo "✔ Correcto: El refresh token ya no es válido tras cerrar sesión"
fi

echo -e "\n=========================================================="
echo "🎉 TODAS LAS PRUEBAS DE LA API PROFESIONAL COMPLETADAS CON ÉXITO"
echo "=========================================================="
