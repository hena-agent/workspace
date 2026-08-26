# Database rollback

New durable event types require a database backup before downgrading to a Hena build that does not recognize them. Stop every Hena process before backing up or restoring the database.

```sh
DB="$(hena db path)"
sqlite3 "$DB" ".backup '${DB}.before-upgrade'"
```

Restore that backup before starting the older build:

```sh
DB="$(hena db path)"
sqlite3 "$DB" ".restore '${DB}.before-upgrade'"
```

If no pre-upgrade backup exists, first back up the current database, then remove the event types unknown to the older build:

```sh
DB="$(hena db path)"
sqlite3 "$DB" ".backup '${DB}.before-downgrade'"
sqlite3 "$DB" "DELETE FROM event WHERE type IN ('session.next.compaction.discarded.1', 'session.next.input.canceled.1', 'session.next.input.reordered.1')"
```

This fallback discards compaction-discard and input queue mutation history written by the newer build. Keep the backup and restore it before returning to the newer build.
