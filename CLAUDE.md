# CLAUDE.md — AutoControl Project Context

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
