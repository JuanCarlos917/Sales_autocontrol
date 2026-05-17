# Skill: Deployment — AutoControl

## Orquestación con Docker Compose

```bash
# Levantar todos los servicios (db + backend + frontend + nginx)
docker compose up -d

# Ver estado de los servicios
docker compose ps

# Ver logs en tiempo real
docker compose logs -f backend

# Detener todos los servicios
docker compose down
```

Servicios: `db` (PostgreSQL 16), `backend` (puerto 4000), `frontend` (puerto 3000), `nginx` (80/443).

## Variables de entorno

Nunca commitear `.env`. Copiar desde `.env.example` y configurar:

```bash
cp .env.example .env
# Editar .env con valores reales antes de deployar
```

Variables críticas a cambiar en producción:
- `JWT_SECRET` — mínimo 64 caracteres aleatorios
- `JWT_REFRESH_SECRET` — diferente al anterior
- `DB_PASSWORD` — password fuerte para PostgreSQL
- `ADMIN_PASSWORD` — password del usuario admin inicial
- `FRONTEND_URL` — URL real del frontend
- `VITE_API_URL` — URL real de la API

## Secuencia de deploy en producción

```bash
# 1. Backup de la DB antes de cualquier cambio
pg_dump -U autocontrol autocontrol_db > backup_$(date +%Y%m%d_%H%M%S).sql

# 2. Bajar los servicios
docker compose down

# 3. Actualizar el código
git pull origin main

# 4. Rebuild de imágenes
docker compose build --no-cache

# 5. Levantar DB primero y esperar health check
docker compose up -d db
sleep 5

# 6. Correr migraciones ANTES de iniciar el backend
docker compose run --rm backend npx prisma migrate deploy

# 7. Levantar el resto de servicios
docker compose up -d

# 8. Verificar health check
curl http://localhost:4000/api/health
```

## Verificación post-deploy

```bash
# Health check del backend
curl http://localhost:4000/api/health
# Esperado: { "status": "ok", "timestamp": "..." }

# Ver logs por errores
docker compose logs backend | grep -i error

# Verificar que la DB responde
docker compose exec db pg_isready -U autocontrol -d autocontrol_db
```

Si el health check falla, revisar logs antes de intentar cualquier otra acción:
```bash
docker compose logs backend --tail=50
```

## Backup de base de datos

```bash
# Backup manual
docker compose exec db pg_dump -U autocontrol autocontrol_db > backup.sql

# Restaurar desde backup
docker compose exec -T db psql -U autocontrol autocontrol_db < backup.sql
```

El script `scripts/backup.sh` automatiza el backup con timestamp.

## Rollback en caso de falla

```bash
# 1. Bajar servicios
docker compose down

# 2. Volver al commit anterior
git checkout <commit-anterior>

# 3. Restaurar backup de DB si la migración falló
docker compose up -d db
docker compose exec -T db psql -U autocontrol autocontrol_db < backup_<timestamp>.sql

# 4. Rebuild y levantar
docker compose build --no-cache && docker compose up -d
```
