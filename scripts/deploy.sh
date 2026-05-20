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

echo ""
echo "1/4 — Construyendo imágenes..."
docker compose build --no-cache

echo ""
echo "2/4 — Levantando servicios..."
docker compose up -d

echo ""
echo "3/4 — Esperando a que la base de datos esté lista..."
sleep 5

echo ""
echo "4/4 — Ejecutando migraciones y seed..."
docker compose exec -T backend npx prisma migrate deploy
docker compose exec -T backend node scripts/seed.js

echo ""
echo "════════════════════════════════════"
echo "✅ Deploy completado!"
echo ""
echo "🌐 Frontend: http://localhost:3000"
echo "📡 API:      http://localhost:4000"
echo "🗄️  DB:       postgresql://localhost:5432"
echo ""
echo "📌 Acceso admin: usa el ADMIN_EMAIL / ADMIN_PASSWORD / ADMIN_PIN definidos en el entorno (.env)."
echo "════════════════════════════════════"
