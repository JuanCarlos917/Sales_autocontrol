#!/bin/bash
# ═══════════════════════════════════════════════════════════════
# AutoControl — Script de Deploy para VPS
# ═══════════════════════════════════════════════════════════════

set -e

echo "🚗 AutoControl — Deploy"
echo "========================"

# Check Docker
if ! command -v docker &> /dev/null; then
    echo "❌ Docker no está instalado"
    exit 1
fi

if ! command -v docker-compose &> /dev/null && ! docker compose version &> /dev/null; then
    echo "❌ Docker Compose no está instalado"
    exit 1
fi

# Check .env
if [ ! -f .env ]; then
    echo "⚠️  No se encontró .env, copiando desde .env.example..."
    cp .env.example .env
    echo "📝 Edita .env con tus credenciales antes de continuar"
    exit 1
fi

# DOMAIN solo para mostrar la URL final al terminar (compose lo usa por su cuenta).
DOMAIN=$(grep -E '^DOMAIN=' .env | head -1 | cut -d= -f2- | tr -d '"' | tr -d "'")

echo ""
echo "1/4 — Construyendo imágenes..."
docker compose build --no-cache

echo ""
echo "2/4 — Levantando servicios..."
docker compose up -d

echo ""
echo "3/4 — Esperando a que el backend esté sano..."
status=""
for _ in $(seq 1 30); do
    status=$(docker inspect --format '{{.State.Health.Status}}' autocontrol_backend 2>/dev/null || echo "starting")
    [ "$status" = "healthy" ] && break
    sleep 2
done
if [ "$status" != "healthy" ]; then
    echo "❌ El backend no quedó sano a tiempo. Revisa los logs: docker compose logs backend"
    exit 1
fi

echo ""
echo "4/4 — Aplicando migraciones y seed del admin..."
docker compose exec -T backend npx prisma migrate deploy
docker compose exec -T backend node scripts/seed.js

echo ""
echo "════════════════════════════════════"
echo "✅ Deploy completado!"
echo ""
echo "🌐 App:  https://${DOMAIN:-<tu-dominio>}  (Caddy gestiona el HTTPS automáticamente)"
echo "ℹ️  Si el HTTPS no sube, revisa que el DNS de DOMAIN apunte a este servidor: docker compose logs caddy"
echo "ℹ️  La DB y el backend no se publican al host: solo viven en la red interna de Docker."
echo ""
echo "📌 Acceso admin: usa el ADMIN_EMAIL / ADMIN_PASSWORD / ADMIN_PIN definidos en .env."
echo "════════════════════════════════════"
