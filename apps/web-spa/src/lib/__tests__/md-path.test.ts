import { describe, expect, it } from 'vitest';

import { siblingMdPath } from '../md-path';

describe('siblingMdPath', () => {
  it('appends .md to a path with an extension', () => {
    expect(siblingMdPath('/home/yf/notes/report.docx')).toBe('/home/yf/notes/report.md');
    expect(siblingMdPath('/tmp/foo.pdf')).toBe('/tmp/foo.md');
  });

  it('appends .md to a path without any extension', () => {
    expect(siblingMdPath('/var/data/notes')).toBe('/var/data/notes.md');
  });

  it('treats a trailing dot as part of the stem, not a missing extension', () => {
    expect(siblingMdPath('/etc/file.')).toBe('/etc/file.md');
  });

  it('does not split at dots that appear before the last path separator', () => {
    expect(siblingMdPath('C:\\Users\\weavine.config\\report')).toBe('C:\\Users\\weavine.config\\report.md');
    expect(siblingMdPath('/var/.cache/data')).toBe('/var/.cache/data.md');
  });

  it('handles both POSIX and Windows separators', () => {
    expect(siblingMdPath('a/b/c.docx')).toBe('a/b/c.md');
    expect(siblingMdPath('a\\b\\c.docx')).toBe('a\\b\\c.md');
    expect(siblingMdPath('mixed/path\\doc.docx')).toBe('mixed/path\\doc.md');
  });

  it('returns the basename only for a single filename', () => {
    expect(siblingMdPath('README')).toBe('README.md');
    expect(siblingMdPath('readme.txt')).toBe('readme.md');
  });
});
