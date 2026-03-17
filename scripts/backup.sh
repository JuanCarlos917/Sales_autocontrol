#!/bin/bash
# ═══════════════════════════════════════════════════════════════
# AutoControl — Backup de Base de Datos
# Uso: ./scripts/backup.sh
# Programar con cron: 0 3 * * * /ruta/scripts/backup.sh
# ═══════════════════════════════════════════════════════════════

BACKUP_DIR="./backups"
DATE=$(date +%Y-%m-%d_%H-%M)
FILENAME="autocontrol_backup_${DATE}.sql.gz"

mkdir -p $BACKUP_DIR

echo "🗄️  Creando backup: $FILENAME"

docker compose exec -T db pg_dump -U autocontrol autocontrol_db | gzip > "${BACKUP_DIR}/${FILENAME}"

# Mantener solo los últimos 30 backups
ls -t ${BACKUP_DIR}/autocontrol_backup_*.sql.gz | tail -n +31 | xargs rm -f 2>/dev/null

echo "✅ Backup completado: ${BACKUP_DIR}/${FILENAME}"
echo "📦 Tamaño: $(du -h ${BACKUP_DIR}/${FILENAME} | cut -f1)"
