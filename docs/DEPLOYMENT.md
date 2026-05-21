# Guía de despliegue a producción — AutoControl

Checklist práctico para llevar AutoControl a producción. Lo que está en el código ya quedó
resuelto; aquí se listan los pasos de configuración e infraestructura que faltan.

> **Regla de oro:** en `NODE_ENV=production` el backend **no arranca** si los secretos o
> credenciales faltan o son débiles (ver §2). Es a propósito: evita exponerlo con valores por defecto.

---

## 1. Prerrequisitos
- Node.js 20 (LTS).
- PostgreSQL 16 accesible.
- (Opcional) Docker + Docker Compose (`docker-compose.yml` incluido).
- Un reverse proxy con TLS (Nginx / Caddy / Traefik / ALB).

## 2. Variables de entorno (obligatorias en prod)
Copia `.env.example` y define **valores reales** (no los de ejemplo):

| Variable | Requisito | Notas |
|---|---|---|
| `DATABASE_URL` | — | Conexión Postgres de producción |
| `JWT_SECRET` | ≥ 32 caracteres | Aleatorio. `openssl rand -hex 32` |
| `JWT_REFRESH_SECRET` | ≥ 32 caracteres, **distinto** del anterior | `openssl rand -hex 32` |
| `ADMIN_PASSWORD` | ≥ 8 caracteres | Para el seed del admin inicial |
| `ADMIN_PIN` | ≥ 6 dígitos | Login por PIN |
| `NODE_ENV` | `production` | Activa rate-limit y la guardia de arranque |
| `CORS_ORIGIN` | URL del frontend | Coma-separado si son varias |

Opcionales: `SENTRY_DSN` (monitoreo de errores), `S3_BUCKET`/`S3_REGION`/`AWS_*` (uploads), `RATE_LIMIT_*`.

## 3. Base de datos
```bash
cd backend
npx prisma migrate deploy     # aplica migraciones (NO uses migrate dev en prod)
node scripts/seed.js          # crea el usuario admin (requiere ADMIN_PASSWORD y ADMIN_PIN)
```

## 4. Archivos subidos (documentos/fotos) — **elegir una**
El disco de un contenedor es **efímero** (se pierde en cada redeploy). Opciones:
- **S3 (recomendado):** define `S3_BUCKET`, `S3_REGION` y credenciales AWS. El código sube a S3
  y sirve con URLs prefirmadas automáticamente. El bucket debe ser privado.
- **Volumen persistente:** monta un volumen en `UPLOAD_DIR` y respáldalo.

## 5. Backups de la base de datos — **pendiente de infra**
- Programar `pg_dump` diario (o usar backups gestionados del proveedor: RDS/Cloud SQL/Neon).
- **Probar la restauración** al menos una vez (un backup sin restore probado no es un backup).
- Retener ≥ 7–30 días.

## 6. TLS / cabeceras — **pendiente de infra**
- Terminar TLS en el reverse proxy (HTTPS obligatorio).
- Añadir HSTS: `Strict-Transport-Security: max-age=31536000; includeSubDomains; preload`.
  (`helmet` ya cubre el resto de cabeceras a nivel app.)
- Redirigir HTTP → HTTPS.

## 7. Build y arranque
**Frontend:** `cd frontend && npm ci && npm run build` → servir `dist/` (estático/CDN) apuntando la API al backend.
**Backend:** `cd backend && npm ci && npm start` (o `docker compose up -d`).

## 8. Observabilidad
- Define `SENTRY_DSN` para enviar errores 5xx a Sentry (sin la variable queda desactivado).
- Los errores de servidor se loguean a stdout en todos los entornos — asegúrate de capturarlos
  (Docker logs / agente de logs).

## 9. Verificación post-despliegue
- [ ] `GET /api/health` responde `200`.
- [ ] Login (PIN y email) funciona.
- [ ] Crear un vehículo, registrar compra con pago, subir un documento (verifica que el archivo persiste tras un redeploy si usas S3/volumen).
- [ ] Un usuario con rol `VIEWER` ve "Solo lectura" y no puede escribir.
- [ ] Errores aparecen en Sentry (si está configurado).

## 10. Checklist de seguridad
- [ ] Secretos reales en el entorno (no en el repo). `.env` está en `.gitignore`.
- [ ] `JWT_SECRET`/`JWT_REFRESH_SECRET` largos, aleatorios y distintos.
- [ ] `ADMIN_PASSWORD`/`ADMIN_PIN` fuertes; cambia el admin por defecto.
- [ ] `CORS_ORIGIN` restringido al dominio real.
- [ ] HTTPS + HSTS activos.
- [ ] Rate limiting activo (automático con `NODE_ENV=production`).
- [ ] Backups programados y restauración probada.

---

### Estado actual (resuelto en código)
Guardia de arranque (fail-fast), sin credenciales por defecto, rol VIEWER de solo lectura,
auditoría de cambios, logueo de errores de servidor, Sentry env-gated, y uploads con S3 + fallback a disco.
Suite: unit `node --test` + E2E Playwright en CI.
