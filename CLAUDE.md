# CLAUDE.md — AutoControl Project Context

## Reglas de comportamiento del agente

- Piensa antes de actuar. Lee los archivos antes de escribir código.
- Edita solo lo que cambia. Nunca reescribas archivos enteros.
- No releas archivos que ya hayas leído salvo que hayan cambiado.
- No repitas código sin cambios en tus respuestas.
- Sin preámbulos, sin resúmenes al final, sin explicar lo obvio.
- Testea antes de dar por terminado.

## Skills obligatorias por tipo de cambio

Antes de iniciar cualquier desarrollo, invocar las siguientes skills según el escenario. No son opcionales.

- **Feature nuevo o bugfix** → invocar `tdd-workflow` ANTES de escribir código (test primero).
- **Cambios al schema de Prisma** → invocar `database-migrations` antes de generar la migración.
- **Endpoints nuevos o modificados** → invocar `api-design` al diseñar el contrato (paginación, errores, status codes).
- **Flujos críticos de UI o nuevas pantallas** → invocar `e2e-testing` para agregar/actualizar Playwright.
- **Antes de marcar un cambio como completo** → invocar `verification-loop` (build + lint + tests + security).
- **Queries Postgres lentas, nuevos índices o cambios de tablas con datos** → invocar `postgres-best-practices`.

Si el cambio toca varios escenarios, invocar todas las que apliquen, en el orden listado.

## Proyecto
AutoControl es un sistema de gestión financiera para compra y venta de vehículos en Colombia.
Stack: React 18 + Vite + TailwindCSS (frontend) | Node.js + Express + Prisma + PostgreSQL (backend).

## Arquitectura
- Frontend y Backend son proyectos separados en `/frontend` y `/backend`
- El backend sigue el patrón Controller → Service → Prisma (no lógica de negocio en controllers)
- Todos los cálculos financieros están centralizados en `backend/src/utils/financial.js`
- El frontend usa Context API (AuthContext + AppContext) — no Redux

## Estándares de Código
- Backend: CommonJS (`require`), no ES Modules
- Frontend: ES Modules (`import`)
- Validación con Joi en todos los endpoints (schemas en `middleware/validation.js`)
- Moneda: COP (Pesos Colombianos), sin decimales
- Idioma de la UI: Español (Colombia)
- Idioma del código: Inglés (variables, funciones, comentarios técnicos)

## Modelo de Claude

**Política**: este proyecto siempre usa el modelo de Claude **más avanzado disponible** en producción. Cuando Anthropic libere una versión superior (ej. Opus 5.x), actualizar TODOS los lugares listados abajo al mismo tiempo para evitar mezclas de versiones.

**Versión actual:** Claude **Opus 4.8** (ID: `claude-opus-4-8`)

**Familia Claude 4.X (referencia):**

| Tier | Modelo | ID | Uso recomendado |
|---|---|---|---|
| Top | Opus 4.8 | `claude-opus-4-8` | Razonamiento profundo, código complejo, decisiones arquitectónicas |
| Estándar | Sonnet 4.6 | `claude-sonnet-4-6` | Coding diario, refactors, features estándar |
| Económico | Haiku 4.5 | `claude-haiku-4-5-20251001` | Tareas mecánicas frecuentes, batch, embeddings |

**Lugares donde está hard-codeado el modelo** (mantener en sync al actualizar):

| Archivo | Línea | Propósito |
|---|---|---|
| `.claude/settings.json` | `"model"` | Modelo que usa Claude Code en este proyecto |
| `backend/src/utils/aiExtractor.js` | `const MODEL` | Modelo para extracción IA de tarjeta de propiedad |

**Cómo actualizar a una nueva versión:**
1. Verificar el ID exacto del modelo nuevo en docs.anthropic.com
2. Reemplazar el ID en los 2 archivos listados arriba en un solo PR
3. Actualizar la tabla "Familia Claude 4.X" si la familia cambia
4. Ejecutar suite e2e + unit completa para verificar que el modelo nuevo se comporta igual

## Base de Datos
- Schema en `backend/prisma/schema.prisma` — es la fuente de verdad
- Enums: VehicleStage, ExpenseCategory, DocumentType, Role
- Relaciones: Vehicle → Expenses (1:N), Vehicle → Documents (1:N), User → Vehicles (1:N)
- Cascade delete en expenses y documents al eliminar vehículo

## Convenciones
- Nombrar archivos: camelCase para JS, PascalCase para componentes React
- Nuevos features: crear service + controller + route + validación schema
- Nuevos componentes: crear en `frontend/src/components/{domain}/`
- Tests: (pendiente) se ubicarán en `__tests__/` junto a cada archivo

## Comandos Frecuentes
- `cd backend && npm run dev` — Backend en modo desarrollo
- `cd frontend && npm run dev` — Frontend con Vite
- `cd backend && npx prisma migrate dev` — Crear migración
- `cd backend && npx prisma studio` — UI visual de la DB
- `docker compose up -d` — Levantar todo con Docker

## Reglas de Negocio Importantes
- Gastos fijos mensuales se prorratean por vehículo según días en inventario
- La participación es un decimal entre 0 y 1 (ej: 0.5 = 50%)
- Al mover a "COMPRADO" se auto-asigna fecha de compra si no existe
- Al mover a "VENDIDO" se auto-asigna fecha de venta si no existe
- Un vehículo recibido como cruce debe poder convertirse en nuevo vehículo
