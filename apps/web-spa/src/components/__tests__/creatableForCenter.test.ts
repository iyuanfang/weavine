import { describe, expect, it } from 'vitest';

import { creatableForCenter, ALL_CREATABLE_KINDS } from '../GraphQuickCreateModal';

describe('creatableForCenter', () => {
  it('lists every kind for contact centers (the common case)', () => {
    const got = creatableForCenter('contact').sort();
    expect(got).toEqual([...ALL_CREATABLE_KINDS].sort());
  });

  it('omits project from non-contact centers', () => {
    expect(creatableForCenter('project')).not.toContain('project');
    expect(creatableForCenter('event')).not.toContain('project');
    expect(creatableForCenter('action')).not.toContain('project');
  });

  it('keeps only note/interaction for event and action centers', () => {
    expect(creatableForCenter('event').sort()).toEqual(['interaction', 'note']);
    expect(creatableForCenter('action').sort()).toEqual(['interaction', 'note']);
  });

  it('only allows note for interaction centers (no interaction recursion)', () => {
    expect(creatableForCenter('interaction')).toEqual(['note']);
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
    expect(creatableForCenter('contact', undefined).sort()).toEqual([...ALL_CREATABLE_KINDS].sort());
  });
});