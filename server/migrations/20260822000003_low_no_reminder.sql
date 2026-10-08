-- Migration 20260822000003: low importance no longer auto-reminds
--
-- Before: `importance = 'low'` defaulted to a 180-day cadence. Every low
-- contact got a keep-in_touch reminder, which is mostly noise — most
-- "low importance" contacts are deliberate passives the user doesn't
-- want to be nagged about.
--
-- This migration removes any existing reminder for contacts that
--   importance = 'low' AND keep_in_touch_cadence_days IS NULL
-- so the new "low = no reminder" rule takes effect on existing data.
-- Contacts that already have a user-set override (positive cadence)
-- keep their reminder, since the user opted in explicitly.

DELETE FROM reminder r
 USING contact c
 WHERE r.contact_id = c.id
   AND r.kind = 'keep_in_touch'
   AND c.importance = 'low'
   AND c.keep_in_touch_cadence_days IS NULL;