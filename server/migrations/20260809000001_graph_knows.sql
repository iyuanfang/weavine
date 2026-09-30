ALTER TABLE entity_links
    DROP CONSTRAINT IF EXISTS entity_links_relation_type_check;

ALTER TABLE entity_links
    ADD CONSTRAINT entity_links_relation_type_check
        CHECK (relation_type IN ('participated', 'involved', 'regards',
                                  'knows', 'colleague', 'friend', 'family',
                                  'mentor', 'mentee', 'investor', 'advisor'));

ALTER TABLE entity_links
    ADD COLUMN IF NOT EXISTS label TEXT;

CREATE INDEX IF NOT EXISTS ix_entity_link_knows_from
    ON entity_links (user_id, from_id)
    WHERE from_type = 'contact' AND relation_type = 'knows';

CREATE INDEX IF NOT EXISTS ix_entity_link_knows_to
    ON entity_links (user_id, to_id)
    WHERE to_type = 'contact' AND relation_type = 'knows';