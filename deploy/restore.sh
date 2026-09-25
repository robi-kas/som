#!/bin/sh
# Restore a backup made by backup.sh into a database (DANGER: replaces its contents).
#   ./restore.sh backups/cafe-20260925-0300.dump.gpg postgresql://user:pass@localhost:5432/cafe_restore
set -eu
FILE=${1:?backup .dump.gpg file}
TARGET=${2:?target DATABASE_URL}
: "${BACKUP_PASSPHRASE:?set BACKUP_PASSPHRASE}"
gpg --batch --decrypt --passphrase "$BACKUP_PASSPHRASE" "$FILE" > /tmp/restore.dump
pg_restore --clean --if-exists --no-owner --dbname="$TARGET" /tmp/restore.dump
rm -f /tmp/restore.dump
echo "Restored $FILE into $TARGET"
