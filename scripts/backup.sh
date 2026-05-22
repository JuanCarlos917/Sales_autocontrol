#!/bin/bash
# ═══════════════════════════════════════════════════════════════
# AutoControl — Backup de Base de Datos
# Uso: ./scripts/backup.sh
# Cron (ruta absoluta obligatoria): 0 3 * * * /ruta/autocontrol-project/scripts/backup.sh
# ═══════════════════════════════════════════════════════════════
set -euo pipefail

# Resolver rutas respecto al proyecto, NO al CWD: bajo cron el CWD es el home
# del usuario, así que sin esto los backups acababan en el lugar equivocado.
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
cd "$PROJECT_DIR"

BACKUP_DIR="${BACKUP_DIR:-$PROJECT_DIR/backups}"
RETENTION="${BACKUP_RETENTION:-30}"
DATE=$(date +%Y-%m-%d_%H-%M)
FILENAME="autocontrol_backup_${DATE}.sql.gz"

mkdir -p "$BACKUP_DIR"

echo "🗄️  Creando backup: $FILENAME"

# `--clean --if-exists` hace el dump restaurable sobre una DB existente
# (incluye los DROP necesarios). pipefail asegura que un pg_dump fallido
# no deje un .gz vacío dándose por bueno.
docker compose exec -T db pg_dump --clean --if-exists -U autocontrol autocontrol_db \
  | gzip > "${BACKUP_DIR}/${FILENAME}"

# Conservar solo los últimos N backups.
ls -t "${BACKUP_DIR}"/autocontrol_backup_*.sql.gz 2>/dev/null \
  | tail -n +$((RETENTION + 1)) | xargs rm -f 2>/dev/null || true

echo "✅ Backup completado: ${BACKUP_DIR}/${FILENAME}"
echo "📦 Tamaño: $(du -h "${BACKUP_DIR}/${FILENAME}" | cut -f1)"
