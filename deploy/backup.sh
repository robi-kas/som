#!/bin/sh
# Nightly encrypted backup of the database and uploaded images.
# Copy /backups off the server (rclone/rsync to cloud storage, or a USB disk) — a backup on the
# same machine doesn't survive the machine. Test a restore monthly (see docs/OPERATIONS.md).
set -eu
STAMP=$(date +%Y%m%d-%H%M)
OUT=/backups/cafe-$STAMP
pg_dump --format=custom --no-owner --file="$OUT.dump"
tar -czf "$OUT-uploads.tgz" -C /uploads . 2>/dev/null || true
for f in "$OUT.dump" "$OUT-uploads.tgz"; do
  [ -f "$f" ] || continue
  gpg --batch --yes --symmetric --cipher-algo AES256 --passphrase "$BACKUP_PASSPHRASE" -o "$f.gpg" "$f"
  rm -f "$f"
done
find /backups -name 'cafe-*.gpg' -mtime +"${KEEP_DAYS:-30}" -delete
echo "$(date -Iseconds) backup ok: $OUT"
