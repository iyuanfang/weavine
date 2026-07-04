#!/bin/bash
# migrate-sqlite-to-pg.sh
# One-time migration: read all data from weavine-web SQLite, write to Postgres.
#
# Usage: PG_URL="postgres://user:pass@host:5432/weavine" \
#        SQLITE_PATH="/www/weavine/weavine-web.db" \
#        bash scripts/migrate-sqlite-to-pg.sh

set -euo pipefail

PG_URL="${PG_URL:?must be set}"
SQLITE="${SQLITE_PATH:-/www/weavine/weavine-web.db}"

if [ ! -f "$SQLITE" ]; then
  echo "ERROR: SQLite db not found at $SQLITE"
  exit 1
fi

sqlite3 "$SQLITE" ".tables" >/dev/null 2>&1 || {
  echo "ERROR: sqlite3 CLI not found or DB unreadable"
  exit 1
}

psql "$PG_URL" -c "SELECT 1" >/dev/null 2>&1 || {
  echo "ERROR: cannot reach Postgres at $PG_URL"
  exit 1
}

echo "=== Checking if Postgres already has data ==="
EXISTING=$(psql "$PG_URL" -tA -c "SELECT COUNT(*) FROM user_account" 2>/dev/null || echo "0")
if [ "$EXISTING" -gt 0 ] && [ "$EXISTING" != "0" ]; then
  echo "WARNING: user_account table has $EXISTING rows. Migration already run?"
  echo "Hit Ctrl-C within 5s to abort, or let it continue (will skip duplicates)"
  sleep 5
fi

echo ""
echo "=== Step 1: Migrating users (UserAccount + legacy User → user_account) ==="

# SQLite: UserAccount may have rows. Also cover legacy User table for isLocal=1 users.
# Map column names: passwordHash → password_hash, createdAt → created_at, updatedAt → updated_at
sqlite3 -separator '|' "$SQLITE" "
  SELECT id, COALESCE(email, ''), COALESCE(passwordHash, ''), createdAt, updatedAt
  FROM UserAccount
  UNION
  SELECT id, COALESCE(email, ''), COALESCE(passwordHash, ''), createdAt, updatedAt
  FROM \"User\" WHERE passwordHash IS NOT NULL AND passwordHash != ''
" | while IFS='|' read -r id email password_hash created_at updated_at; do
  if [ -z "$id" ]; then continue; fi
  if [ -z "$updated_at" ]; then updated_at="$created_at"; fi
  if [ -z "$created_at" ]; then created_at=$(date -u +"%Y-%m-%dT%H:%M:%S.000Z"); fi
  if [ -z "$updated_at" ]; then updated_at="$created_at"; fi
  psql "$PG_URL" -c "
    INSERT INTO user_account (id, email, name, password_hash, created_at, updated_at)
    VALUES ('$id', '${email:-}', NULL, '${password_hash:-}', '$created_at', '$updated_at')
    ON CONFLICT (id) DO NOTHING
  " 2>/dev/null
done
echo "  user_account: done"

echo ""
echo "=== Step 2: Migrating tags ==="
# Map: ownerId → owner_id, createdAt → created_at
sqlite3 -separator '|' "$SQLITE" "
  SELECT id, ownerId, name, COALESCE(color, ''), createdAt
  FROM Tag
" | while IFS='|' read -r id owner_id name color created_at; do
  if [ -z "$id" ]; then continue; fi
  [ -z "$created_at" ] && created_at=$(date -u +"%Y-%m-%dT%H:%M:%S.000Z")
  psql "$PG_URL" -c "
    INSERT INTO tag (id, owner_id, name, color, created_at)
    VALUES ('$id', '$owner_id', '${name//\'/''}', '${color:-NULL}', '$created_at')
    ON CONFLICT (id) DO NOTHING
  " 2>/dev/null
done
echo "  tag: done"

echo ""
echo "=== Step 3: Migrating contacts ==="
# Map: ownerId→owner_id, reminderEnabled(INT)→reminder_enabled(BOOL),
#       reminderIntervalDays→reminder_interval_days, lastContactedAt→last_contacted_at,
#       createdAt→created_at, updatedAt→updated_at
sqlite3 -separator '|' "$SQLITE" "
  SELECT id, ownerId, nickname, COALESCE(name, ''), COALESCE(company, ''),
         COALESCE(title, ''), COALESCE(city, ''), COALESCE(email, ''),
         COALESCE(phone, ''), COALESCE(wechat, ''), COALESCE(notes, ''),
         importance, reminderEnabled, reminderIntervalDays,
         lastContactedAt, createdAt, updatedAt
  FROM Contact
" | while IFS='|' read -r id owner_id nickname name company title city email phone wechat notes \
                              importance reminder_enabled reminder_interval_days \
                              last_contacted_at created_at updated_at; do
  if [ -z "$id" ]; then continue; fi
  [ -z "$created_at" ] && created_at=$(date -u +"%Y-%m-%dT%H:%M:%S.000Z")
  [ -z "$updated_at" ] && updated_at="$created_at"
  # Convert INTEGER (0/1) to BOOLEAN (true/false)
  [ "$reminder_enabled" = "1" ] && reminder_enabled="true" || reminder_enabled="false"
  [ -z "$reminder_interval_days" ] && reminder_interval_days="NULL" || reminder_interval_days="$reminder_interval_days"
  [ -z "$last_contacted_at" ] && last_contacted_at="NULL" || last_contacted_at="'$last_contacted_at'"

  psql "$PG_URL" -c "
    INSERT INTO contact (id, owner_id, nickname, name, company, title, city, email, phone, wechat,
                         notes, importance, reminder_enabled, reminder_interval_days,
                         last_contacted_at, created_at, updated_at)
    VALUES ('$id', '$owner_id', '${nickname//\'/''}', '${name//\'/''}', '${company//\'/''}',
            '${title//\'/''}', '${city//\'/''}', '${email//\'/''}', '${phone//\'/''}',
            '${wechat//\'/''}', '${notes//\'/''}', '$importance', $reminder_enabled,
            $reminder_interval_days, $last_contacted_at, '$created_at', '$updated_at')
    ON CONFLICT (id) DO NOTHING
  " 2>/dev/null
done
echo "  contact: done"

echo ""
echo "=== Step 4: Migrating contact_tags ==="
sqlite3 -separator '|' "$SQLITE" "
  SELECT ownerId, contactId, tagId FROM ContactTag
" | while IFS='|' read -r owner_id contact_id tag_id; do
  [ -z "$owner_id" ] && continue
  psql "$PG_URL" -c "
    INSERT INTO contact_tag (owner_id, contact_id, tag_id)
    VALUES ('$owner_id', '$contact_id', '$tag_id')
    ON CONFLICT DO NOTHING
  " 2>/dev/null
done
echo "  contact_tag: done"

echo ""
echo "=== Step 5: Migrating projects ==="
sqlite3 -separator '|' "$SQLITE" "
  SELECT id, ownerId, COALESCE(title,''), COALESCE(description,''), template,
         COALESCE(stage,''), startAt, dueAt, completedAt, archivedAt, createdAt, updatedAt
  FROM Project
" | while IFS='|' read -r id owner_id title description template stage \
                              start_at due_at completed_at archived_at created_at updated_at; do
  if [ -z "$id" ]; then continue; fi
  [ -z "$description" ] && description="NULL" || description="'${description//\'/''}'"
  [ -z "$start_at" ] && start_at="NULL" || start_at="'$start_at'"
  [ -z "$due_at" ] && due_at="NULL" || due_at="'$due_at'"
  [ -z "$completed_at" ] && completed_at="NULL" || completed_at="'$completed_at'"
  [ -z "$archived_at" ] && archived_at="NULL" || archived_at="'$archived_at'"
  [ -z "$created_at" ] && created_at=$(date -u +"%Y-%m-%dT%H:%M:%S.000Z")
  [ -z "$updated_at" ] && updated_at="$created_at"

  psql "$PG_URL" -c "
    INSERT INTO project (id, owner_id, title, description, template, stage,
                         start_at, due_at, completed_at, archived_at, created_at, updated_at)
    VALUES ('$id', '$owner_id', '${title//\'/''}', $description, '$template', '$stage',
            $start_at, $due_at, $completed_at, $archived_at, '$created_at', '$updated_at')
    ON CONFLICT (id) DO NOTHING
  " 2>/dev/null
done
echo "  project: done"

echo ""
echo "=== Step 6: Migrating project_contacts ==="
sqlite3 -separator '|' "$SQLITE" "
  SELECT ownerId, projectId, contactId, COALESCE(role,''), addedAt
  FROM ProjectContact
" | while IFS='|' read -r owner_id project_id contact_id role added_at; do
  [ -z "$owner_id" ] && continue
  [ -z "$added_at" ] && added_at=$(date -u +"%Y-%m-%dT%H:%M:%S.000Z")
  psql "$PG_URL" -c "
    INSERT INTO project_contact (owner_id, project_id, contact_id, role, added_at)
    VALUES ('$owner_id', '$project_id', '$contact_id', '${role:-NULL}', '$added_at')
    ON CONFLICT DO NOTHING
  " 2>/dev/null
done
echo "  project_contact: done"

echo ""
echo "=== Step 7: Migrating events ==="
sqlite3 -separator '|' "$SQLITE" "
  SELECT id, ownerId, title, type, startAt, endAt, location, notes,
         reminderLeadMinutes, contactId, projectId, archivedAt, createdAt, updatedAt
  FROM Event
" | while IFS='|' read -r id owner_id title event_type start_at end_at location notes \
                              reminder_lead_minutes contact_id project_id archived_at created_at updated_at; do
  if [ -z "$id" ]; then continue; fi
  [ -z "$notes" ] && notes="NULL" || notes="'${notes//\'/''}'"
  [ -z "$end_at" ] && end_at="NULL" || end_at="'$end_at'"
  [ -z "$location" ] && location="NULL" || location="'${location//\'/''}'"
  [ -z "$reminder_lead_minutes" ] && reminder_lead_minutes="NULL" || reminder_lead_minutes="$reminder_lead_minutes"
  [ -z "$contact_id" ] && contact_id="NULL" || contact_id="'$contact_id'"
  [ -z "$project_id" ] && project_id="NULL" || project_id="'$project_id'"
  [ -z "$archived_at" ] && archived_at="NULL" || archived_at="'$archived_at'"
  [ -z "$created_at" ] && created_at=$(date -u +"%Y-%m-%dT%H:%M:%S.000Z")
  [ -z "$updated_at" ] && updated_at="$created_at"

  psql "$PG_URL" -c "
    INSERT INTO event (id, owner_id, title, event_type, start_at, end_at, location, notes,
                       reminder_lead_minutes, contact_id, project_id, archived_at,
                       created_at, updated_at)
    VALUES ('$id', '$owner_id', '${title//\'/''}', '$event_type', '$start_at', $end_at,
            $location, $notes, $reminder_lead_minutes, $contact_id, $project_id,
            $archived_at, '$created_at', '$updated_at')
    ON CONFLICT (id) DO NOTHING
  " 2>/dev/null
done
echo "  event: done"

echo ""
echo "=== Step 8: Migrating actions ==="
sqlite3 -separator '|' "$SQLITE" "
  SELECT id, ownerId, title, COALESCE(description,''), COALESCE(status,'inbox'),
         COALESCE(priority,0), COALESCE(category,''), dueAt, contactId, completedAt,
         projectId, archivedAt, createdAt, updatedAt
  FROM Action
" | while IFS='|' read -r id owner_id title description status priority category \
                              due_at contact_id completed_at project_id archived_at created_at updated_at; do
  if [ -z "$id" ]; then continue; fi
  [ -z "$description" ] && description="NULL" || description="'${description//\'/''}'"
  [ -z "$category" ] && category="NULL" || category="'${category//\'/''}'"
  [ -z "$due_at" ] && due_at="NULL" || due_at="'$due_at'"
  [ -z "$contact_id" ] && contact_id="NULL" || contact_id="'$contact_id'"
  [ -z "$completed_at" ] && completed_at="NULL" || completed_at="'$completed_at'"
  [ -z "$project_id" ] && project_id="NULL" || project_id="'$project_id'"
  [ -z "$archived_at" ] && archived_at="NULL" || archived_at="'$archived_at'"
  [ -z "$created_at" ] && created_at=$(date -u +"%Y-%m-%dT%H:%M:%S.000Z")
  [ -z "$updated_at" ] && updated_at="$created_at"

  psql "$PG_URL" -c "
    INSERT INTO action (id, owner_id, title, description, status, priority, category,
                        due_at, contact_id, completed_at, project_id, archived_at,
                        created_at, updated_at)
    VALUES ('$id', '$owner_id', '${title//\'/''}', $description, '$status', $priority,
            $category, $due_at, $contact_id, $completed_at, $project_id,
            $archived_at, '$created_at', '$updated_at')
    ON CONFLICT (id) DO NOTHING
  " 2>/dev/null
done
echo "  action: done"

echo ""
echo "=== Step 9: Migrating interactions ==="
sqlite3 -separator '|' "$SQLITE" "
  SELECT id, ownerId, contactId, actionId, eventId, occurredAt,
         COALESCE(channel,''), summary, createdAt
  FROM Interaction
" | while IFS='|' read -r id owner_id contact_id action_id event_id occurred_at channel summary created_at; do
  if [ -z "$id" ]; then continue; fi
  [ -z "$contact_id" ] && contact_id="NULL" || contact_id="'$contact_id'"
  [ -z "$action_id" ] && action_id="NULL" || action_id="'$action_id'"
  [ -z "$event_id" ] && event_id="NULL" || event_id="'$event_id'"
  [ -z "$channel" ] && channel="NULL" || channel="'${channel//\'/''}'"
  [ -z "$created_at" ] && created_at=$(date -u +"%Y-%m-%dT%H:%M:%S.000Z")

  psql "$PG_URL" -c "
    INSERT INTO interaction (id, owner_id, contact_id, action_id, event_id, occurred_at,
                             channel, summary, created_at)
    VALUES ('$id', '$owner_id', $contact_id, $action_id, $event_id, '$occurred_at',
            $channel, '${summary//\'/''}', '$created_at')
    ON CONFLICT (id) DO NOTHING
  " 2>/dev/null
done
echo "  interaction: done"

echo ""
echo "=== Step 10: Migrating reminders ==="
sqlite3 -separator '|' "$SQLITE" "
  SELECT id, ownerId, contactId, eventId, triggerAt, kind, dispatched, dismissed, createdAt
  FROM Reminder
" | while IFS='|' read -r id owner_id contact_id event_id trigger_at kind dispatched dismissed created_at; do
  if [ -z "$id" ]; then continue; fi
  [ -z "$contact_id" ] && contact_id="NULL" || contact_id="'$contact_id'"
  [ -z "$event_id" ] && event_id="NULL" || event_id="'$event_id'"
  [ "$dispatched" = "1" ] && dispatched="true" || dispatched="false"
  [ "$dismissed" = "1" ] && dismissed="true" || dismissed="false"
  [ -z "$created_at" ] && created_at=$(date -u +"%Y-%m-%dT%H:%M:%S.000Z")

  psql "$PG_URL" -c "
    INSERT INTO reminder (id, owner_id, contact_id, event_id, trigger_at, kind,
                          dispatched, dismissed, created_at)
    VALUES ('$id', '$owner_id', $contact_id, $event_id, '$trigger_at', '$kind',
            $dispatched, $dismissed, '$created_at')
    ON CONFLICT (id) DO NOTHING
  " 2>/dev/null
done
echo "  reminder: done"

echo ""
echo "=== Step 11: Migrating settings ==="
sqlite3 -separator '|' "$SQLITE" "
  SELECT id, ownerId, key, value, updatedAt
  FROM Setting
" | while IFS='|' read -r id owner_id key value updated_at; do
  if [ -z "$id" ]; then continue; fi
  [ -z "$updated_at" ] && updated_at=$(date -u +"%Y-%m-%dT%H:%M:%S.000Z")
  psql "$PG_URL" -c "
    INSERT INTO setting (id, owner_id, key, value, updated_at)
    VALUES ('$id', '$owner_id', '${key//\'/''}', '${value//\'/''}', '$updated_at')
    ON CONFLICT (id) DO NOTHING
  " 2>/dev/null
done
echo "  setting: done"

echo ""
echo "=== Step 12: Migrating push_subscriptions ==="
sqlite3 -separator '|' "$SQLITE" "
  SELECT id, ownerId, endpoint, p256dh, auth, createdAt
  FROM PushSubscription
" | while IFS='|' read -r id owner_id endpoint p256dh auth created_at; do
  if [ -z "$id" ]; then continue; fi
  [ -z "$created_at" ] && created_at=$(date -u +"%Y-%m-%dT%H:%M:%S.000Z")
  psql "$PG_URL" -c "
    INSERT INTO push_subscription (id, owner_id, endpoint, p256dh, auth, created_at)
    VALUES ('$id', '$owner_id', '${endpoint//\'/''}', '${p256dh//\'/''}', '${auth//\'/''}', '$created_at')
    ON CONFLICT (id) DO NOTHING
  " 2>/dev/null
done
echo "  push_subscription: done"

echo ""
echo "=== Verification ==="
psql "$PG_URL" -c "
  SELECT 'user_account' as tbl, COUNT(*) as cnt FROM user_account
  UNION ALL SELECT 'tag', COUNT(*) FROM tag
  UNION ALL SELECT 'contact', COUNT(*) FROM contact
  UNION ALL SELECT 'contact_tag', COUNT(*) FROM contact_tag
  UNION ALL SELECT 'project', COUNT(*) FROM project
  UNION ALL SELECT 'project_contact', COUNT(*) FROM project_contact
  UNION ALL SELECT 'event', COUNT(*) FROM event
  UNION ALL SELECT 'action', COUNT(*) FROM action
  UNION ALL SELECT 'interaction', COUNT(*) FROM interaction
  UNION ALL SELECT 'reminder', COUNT(*) FROM reminder
  UNION ALL SELECT 'setting', COUNT(*) FROM setting
  UNION ALL SELECT 'push_subscription', COUNT(*) FROM push_subscription
  ORDER BY tbl;
"

echo ""
echo "Migration complete!"
