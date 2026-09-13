-- Add indexes to support sort + pagination in contact list
CREATE INDEX IF NOT EXISTS Contact_user_id_last_contacted_at_idx
  ON Contact(user_id, last_contacted_at DESC);
CREATE INDEX IF NOT EXISTS Contact_user_id_created_at_idx
  ON Contact(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS Contact_user_id_nickname_idx
  ON Contact(user_id, nickname COLLATE NOCASE ASC);