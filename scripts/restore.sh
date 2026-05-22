#!/bin/bash
# ═══════════════════════════════════════════════════════════════
# AutoControl — Restauración de Base de Datos
# Uso: ./scripts/restore.sh <ruta/al/backup.sql.gz>
# Un backup sin restauración probada NO es un backup: prueba esto al menos una vez.
# ═══════════════════════════════════════════════════════════════
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
cd "$PROJECT_DIR"

FILE="${1:-}"
if [ -z "$FILE" ] || [ ! -f "$FILE" ]; then
  echo "❌ Uso: $0 <ruta/al/backup.sql.gz>"
  echo "   Backups disponibles en ./backups:"
  ls -1t backups/autocontrol_backup_*.sql.gz 2>/dev/null || echo "   (ninguno)"
  exit 1
fi

echo "⚠️  Esto SOBREESCRIBE la base de datos 'autocontrol_db' con:"
echo "    $FILE"
read -r -p "Escribe 'si' para confirmar: " confirm
if [ "$confirm" != "si" ]; then
  echo "Cancelado."
  exit 1
fi

echo "🔄 Restaurando..."
gunzip -c "$FILE" | docker compose exec -T db psql -v ON_ERROR_STOP=1 -U autocontrol -d autocontrol_db

echo "✅ Restauración completada desde: $FILE"
