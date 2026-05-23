#!/bin/bash
# ═══════════════════════════════════════════════════════════════
# AutoControl — Reset de producción a CERO (quirúrgico)
# Borra los datos de la DB y los archivos subidos (volumen local + S3),
# pero CONSERVA el certificado HTTPS de Caddy (re-emitirlo gasta cupo de
# Let's Encrypt). Operación IRREVERSIBLE.
#
# Tip: si quieres rotar las credenciales del admin, edita ADMIN_PASSWORD /
# ADMIN_PIN en .env ANTES de correr esto (el seed las vuelve a aplicar).
#
# Uso: ./scripts/reset-prod.sh
# ═══════════════════════════════════════════════════════════════
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
cd "$PROJECT_DIR"

if [ ! -f .env ]; then
  echo "❌ No se encontró .env en $PROJECT_DIR"
  exit 1
fi

# El nombre del proyecto compose = nombre del directorio = prefijo de los volúmenes.
PROJECT_NAME="$(basename "$PROJECT_DIR")"
DB_VOLUME="${PROJECT_NAME}_postgres_data"
UPLOADS_VOLUME="${PROJECT_NAME}_uploads_data"

# Helper: leer una variable del .env sin sourcearlo.
read_env() { grep -E "^$1=" .env 2>/dev/null | head -1 | cut -d= -f2- | tr -d '"' | tr -d "'"; }

S3_BUCKET="$(read_env S3_BUCKET)"
S3_REGION="$(read_env S3_REGION)"
AWS_KEY="$(read_env AWS_ACCESS_KEY_ID)"
AWS_SECRET="$(read_env AWS_SECRET_ACCESS_KEY)"

echo "⚠️  RESET DE PRODUCCIÓN — esto BORRA de forma IRREVERSIBLE:"
echo "    • Base de datos:     volumen $DB_VOLUME"
echo "    • Subidas locales:   volumen $UPLOADS_VOLUME"
[ -n "$S3_BUCKET" ] && echo "    • Archivos en S3:    bucket $S3_BUCKET"
echo "    Se CONSERVA el certificado HTTPS (volumen de Caddy)."
echo ""
read -r -p "Escribe BORRAR para confirmar: " confirm
if [ "$confirm" != "BORRAR" ]; then
  echo "Cancelado."
  exit 1
fi

echo ""
echo "1/4 — Deteniendo servicios..."
docker compose down

echo "2/4 — Borrando volúmenes de datos (se conserva el de Caddy)..."
docker volume rm "$DB_VOLUME" "$UPLOADS_VOLUME" 2>/dev/null || true

echo "3/4 — Vaciando archivos subidos en S3..."
if [ -z "$S3_BUCKET" ]; then
  echo "    (sin S3_BUCKET en .env; nada que vaciar en S3)"
elif ! command -v aws >/dev/null 2>&1; then
  echo "    ⚠️  AWS CLI no instalado en el host: vacía el bucket '$S3_BUCKET'"
  echo "        manualmente (consola S3 → Empty) si quieres borrar las subidas."
elif AWS_ACCESS_KEY_ID="$AWS_KEY" AWS_SECRET_ACCESS_KEY="$AWS_SECRET" \
     AWS_DEFAULT_REGION="${S3_REGION:-us-east-1}" \
     aws s3 rm "s3://$S3_BUCKET" --recursive; then
  echo "    Bucket $S3_BUCKET vaciado."
else
  echo "    ⚠️  No se pudo vaciar el bucket (¿credenciales?). Vacíalo desde la consola S3."
fi

echo "4/4 — Levantando limpio (DB vacía → migraciones → seed del admin)..."
./scripts/deploy.sh

echo ""
echo "✅ Producción reseteada a cero. Ingresa con el ADMIN_EMAIL / ADMIN_PASSWORD / ADMIN_PIN de tu .env."
