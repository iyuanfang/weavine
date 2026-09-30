-- 1. Drop old constraint first so UPDATE can set 'action' (old constraint only allows 'todo')
ALTER TABLE interaction DROP CONSTRAINT IF EXISTS interaction_source_check;

-- 2. Rename 'todo' → 'action'
UPDATE interaction SET source = 'action' WHERE source = 'todo';

-- 3. Add new constraint with 'action' instead of 'todo'
ALTER TABLE interaction ADD CONSTRAINT interaction_source_check CHECK (source = ANY (ARRAY['manual'::text, 'event'::text, 'action'::text]));
