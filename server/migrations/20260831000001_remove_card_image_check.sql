-- Drop card_image rows left over from the removed OCR business-card media flow
-- (deef088). These rows are no longer reachable: CardScanner sends base64
-- directly to /api/cards/extract and stores nothing on the server.
--
-- DROP the old check constraint first so the DELETE does not get rolled
-- back alongside the constraint rewrite (sqlx runs each migration in a single
-- transaction, so any failure reverses the whole file).
ALTER TABLE media DROP CONSTRAINT IF EXISTS media_kind_check;
DELETE FROM media WHERE kind = 'card_image';
ALTER TABLE media ADD CONSTRAINT media_kind_check CHECK (kind IN ('avatar', 'attachment'));
