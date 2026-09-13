import { describe, expect, it } from 'vitest';

import { creatableForCenter, ALL_CREATABLE_KINDS } from '../GraphQuickCreateModal';

describe('creatableForCenter', () => {
  it('lists every kind for contact centers (the common case)', () => {
    const got = creatableForCenter('contact').sort();
    expect(got).toEqual(
      ALL_CREATABLE_KINDS.filter((k) => k !== 'contact').sort(),
    );
  });

  it('omits project from non-contact centers', () => {
    expect(creatableForCenter('project')).not.toContain('project');
    expect(creatableForCenter('event')).not.toContain('project');
    expect(creatableForCenter('action')).not.toContain('project');
  });

  it('never offers contact on contact centers (no self-link)', () => {
    expect(creatableForCenter('contact')).not.toContain('contact');
  });

  it('offers contact for project/event/action centers (link-existing or create)', () => {
    expect(creatableForCenter('project')).toContain('contact');
    expect(creatableForCenter('event').sort()).toEqual(['contact', 'note']);
    expect(creatableForCenter('action').sort()).toEqual(['contact', 'note']);
  });

  it('offers no interaction for event/action centers (system auto-logs those)', () => {
    expect(creatableForCenter('event')).not.toContain('interaction');
    expect(creatableForCenter('action')).not.toContain('interaction');
  });

  it('offers no contact for note centers (no updatable link)', () => {
    expect(creatableForCenter('note')).not.toContain('contact');
  });

  it('interaction centers: contact (fix missing person) + note, no recursion', () => {
    expect(creatableForCenter('interaction').sort()).toEqual(['contact', 'note']);
  });

  it('returns an empty list for note and other terminal centers', () => {
    expect(creatableForCenter('note')).toEqual([]);
  });

  it('intersects with caller-supplied kinds', () => {
    // Note detail passes the full list; nothing should make it through.
    const noteOptions = creatableForCenter('note', ALL_CREATABLE_KINDS);
    expect(noteOptions).toEqual([]);

    // A caller that restricts to only "note" gets the empty set as well.
    expect(creatableForCenter('event', ['note'])).toEqual(['note']);
    expect(creatableForCenter('event', ['project'])).toEqual([]);
  });

  it('falls back to ALL_CREATABLE_KINDS when no kinds are provided', () => {
    expect(creatableForCenter('project', undefined)).toContain('contact');
    expect(creatableForCenter('project', undefined)).not.toContain('project');
  });
});