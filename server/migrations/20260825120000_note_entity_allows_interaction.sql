-- Allow notes to link to interactions (v1.2.0).
--
-- Interaction was previously a first-class entity for entity_links (the
-- generic contact↔project↔event↔action↔interaction↔tag graph) but the
-- narrower note_entity check constraint excluded it, blocking the
-- "what was discussed in this call" workflow: a user clicking the
-- "+ 新建笔记" button on an interaction detail page and expecting
-- the new note to be linked back to that interaction.
--
-- Now note→interaction links are allowed, and the backlinks panel on
-- /interactions/:id renders them. See PR commit for GraphView changes
-- that also render interaction as a neighbor node (💬, sky blue) in
-- the entity graph for contact/event/action centers.

ALTER TABLE note_entity DROP CONSTRAINT note_entity_entity_type_check;
ALTER TABLE note_entity
    ADD CONSTRAINT note_entity_entity_type_check
    CHECK (entity_type IN ('contact', 'project', 'event', 'action', 'interaction'));