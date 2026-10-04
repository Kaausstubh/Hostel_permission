#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# HEIMDALL — Daily MongoDB Backup Script
# Performs a compressed mongodump from the Docker container and rotates
# backups keeping only the last 7 days.
#
# CRONTAB INSTALLATION:
# Add this line to your crontab using `crontab -e`:
# 0 3 * * * /home/ubuntu/HEMDALL/Hostel_permission/scripts/backup.sh >> /var/log/heimdall_backup.log 2>&1
#
# (Adjust the path if your repository is in a different location)
# ─────────────────────────────────────────────────────────────────────────────

set -euo pipefail

# Configuration
CONTAINER_NAME="${MONGO_CONTAINER:-heimdall-mongo}"
DB_NAME="${DB_NAME:-heimdall}"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"
BACKUP_DIR="${BACKUP_DIR:-$PROJECT_ROOT/backups/mongodb}"
RETENTION_DAYS=7
DATE_TAG="$(date +'%Y-%m-%d_%H%M%S')"
BACKUP_FILE="$BACKUP_DIR/${DB_NAME}_${DATE_TAG}.archive.gz"
TEMP_BACKUP_FILE="${BACKUP_FILE}.tmp"

# Create backup directory if it doesn't exist
mkdir -p "$BACKUP_DIR"

echo "================================================================="
echo "[$(date -u +'%Y-%m-%dT%H:%M:%SZ')] Starting MongoDB backup for database: '$DB_NAME'"
echo "Container:    $CONTAINER_NAME"
echo "Destination:  $BACKUP_FILE"

# Check if Docker is running
if ! command -v docker &> /dev/null; then
    echo "❌ ERROR: 'docker' command not found. Ensure Docker is installed and in PATH." >&2
    exit 1
fi

# Verify container is running
if [ "$(docker inspect -f '{{.State.Running}}' "$CONTAINER_NAME" 2>/dev/null || echo "false")" != "true" ]; then
    echo "❌ ERROR: Container '$CONTAINER_NAME' is not running!" >&2
    exit 1
fi

# Run mongodump and stream compressed archive directly to backup file
echo "Running mongodump..."
if docker exec "$CONTAINER_NAME" mongodump --db "$DB_NAME" --archive --gzip > "$TEMP_BACKUP_FILE"; then
    # Verify backup is not empty
    if [ -s "$TEMP_BACKUP_FILE" ]; then
        mv "$TEMP_BACKUP_FILE" "$BACKUP_FILE"
        FILESIZE=$(du -h "$BACKUP_FILE" | cut -f1)
        echo "✅ Backup successfully created: $BACKUP_FILE ($FILESIZE)"
    else
        rm -f "$TEMP_BACKUP_FILE"
        echo "❌ ERROR: Backup file was created but is empty." >&2
        exit 1
    fi
else
    rm -f "$TEMP_BACKUP_FILE"
    echo "❌ ERROR: mongodump failed." >&2
    exit 1
fi

# Prune old backups older than 7 days
echo "Pruning backups older than $RETENTION_DAYS days in $BACKUP_DIR..."
PRUNED_COUNT=$(find "$BACKUP_DIR" -type f -name "${DB_NAME}_*.archive.gz" -mtime +"$RETENTION_DAYS" | wc -l | tr -d ' ')
find "$BACKUP_DIR" -type f -name "${DB_NAME}_*.archive.gz" -mtime +"$RETENTION_DAYS" -exec rm -f {} +
echo "Removed $PRUNED_COUNT old backup(s)."

# List remaining backups
echo "Current backups in $BACKUP_DIR:"
ls -lh "$BACKUP_DIR"/${DB_NAME}_*.archive.gz 2>/dev/null || echo "No backups found."

echo "[$(date -u +'%Y-%m-%dT%H:%M:%SZ')] Backup and rotation finished successfully."
echo "================================================================="
