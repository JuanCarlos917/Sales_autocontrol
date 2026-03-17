# AutoControl — Motor de Inteligencia Financiera Vehicular

Sistema de gestión end-to-end para negocio de compra y venta de vehículos.
CRM + Tesorería + Control de Gastos con pipeline Kanban y dashboard financiero.

## Arquitectura

```
autocontrol-project/
├── backend/             → API REST (Node.js + Express + Prisma + PostgreSQL)
│   ├── src/
│   │   ├── config/      → Variables de entorno, constantes
│   │   ├── controllers/ → Lógica de request/response
│   │   ├── middleware/   → Auth JWT, validación, error handling
│   │   ├── models/      → Prisma schema (fuente de verdad del DB)
│   │   ├── routes/      → Definición de endpoints
│   │   ├── services/    → Lógica de negocio
│   │   └── utils/       → Helpers, formatters, cálculos financieros
│   ├── prisma/          → Schema + migraciones
│   └── package.json
├── frontend/            → React + Vite + TailwindCSS
│   ├── src/
│   │   ├── components/  → Componentes UI modulares
│   │   ├── contexts/    → Estado global (Auth, App data)
│   │   ├── hooks/       → Custom hooks (useAuth, useVehicles, etc.)
│   │   ├── lib/         → API client, utilidades
│   │   ├── pages/       → Vistas principales
│   │   └── styles/      → CSS global + theme
│   └── package.json
├── nginx/               → Configuración de proxy inverso
├── scripts/             → Scripts de deploy, backup, seed
├── docker-compose.yml   → Orquestación de servicios
└── .env.example         → Template de variables de entorno
```

## Tech Stack

| Capa | Tecnología | Justificación |
|------|-----------|---------------|
| Frontend | React 18 + Vite | SPA rápida, HMR, build optimizado |
| Estilos | TailwindCSS | Utility-first, responsive, consistente |
| Backend | Node.js + Express | Ecosistema amplio, fácil de escalar |
| ORM | Prisma | Type-safe, migraciones, introspección |
| Base de datos | PostgreSQL | ACID, relacional, robusto para finanzas |
| Auth | JWT + bcrypt | Stateless, seguro, estándar |
| Archivos | Multer + disco/S3 | Upload de documentos y fotos |
| Proxy | Nginx | SSL, rate limiting, static files |
| Deploy | Docker Compose | Reproducible, portable |

## Despliegue Rápido

```bash
# 1. Clonar y configurar
cp .env.example .env
# Editar .env con tus credenciales

# 2. Levantar con Docker
docker-compose up -d

# 3. Correr migraciones
docker-compose exec backend npx prisma migrate deploy

# 4. Seed inicial (usuario admin)
docker-compose exec backend node scripts/seed.js

# La app estará en https://tu-dominio.com
```

## Despliegue Manual (VPS)

```bash
# Backend
cd backend && npm install && npx prisma migrate deploy && npm start

# Frontend
cd frontend && npm install && npm run build
# Servir /frontend/dist con Nginx

# Ver nginx/autocontrol.conf para configuración
```
