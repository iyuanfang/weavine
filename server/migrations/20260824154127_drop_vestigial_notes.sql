-- Drop vestigial free-text columns on contact/event/project.
-- Their functionality is fully replaced by the new Notes feature
-- (Markdown body + entity_links + backlinks). Kept around for too long
-- without being used: <20 short strings across all production rows.
--
-- action never had these columns; only contact/event/project did.

ALTER TABLE contact DROP COLUMN notes;
ALTER TABLE event   DROP COLUMN notes;
ALTER TABLE project DROP COLUMN description;