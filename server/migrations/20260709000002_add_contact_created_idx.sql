-- Add index on contact(user_id, created_at) for "最近添加" sort order
CREATE INDEX IF NOT EXISTS idx_contact_user_created ON contact(user_id, created_at);