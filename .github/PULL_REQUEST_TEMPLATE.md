## 📝 Descripción del Cambio

Por favor incluye un resumen claro de las modificaciones realizadas y el problema o funcionalidad que aborda.

## 🔗 Issue Relacionada (si aplica)

Closes #

## 🛠️ Tipo de Cambio

- [ ] 🐛 Corrección de bug (cambio que soluciona un problema sin romper compatibilidad)
- [ ] ✨ Nueva funcionalidad (cambio que añade valor o un nuevo endpoint/módulo)
- [ ] ♻️ Refactorización de código o mejoras de arquitectura
- [ ] 📚 Documentación / README / Bruno
- [ ] ⚡ Optimización de rendimiento

## ✅ Lista de Verificación (Checklist)

- [ ] Mi código sigue las convenciones y tipado estricto de TypeScript del proyecto.
- [ ] He ejecutado `npm run typecheck`, `npm run lint` y `npm test` y todo pasa.
- [ ] Si toqué autenticación o sesiones, he probado con `npm run test:e2e` o con la colección de Bruno.
- [ ] Si cambié `prisma/schema.prisma`, he incluido la migración (`npm run db:migrate -- --name ...`) y ejecutado `npm run db:generate`.
- [ ] Si añadí o cambié un endpoint, lo he declarado con `createRoute` (la especificación OpenAPI se genera sola) y actualizado la colección de `bruno/`.
- [ ] He actualizado el `README.md` si cambia el comportamiento o la configuración.
- [ ] No incluyo secretos, tokens ni archivos `.env`.
