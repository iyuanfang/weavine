import { describe, expect, it } from 'vitest';

import { mdEditorUrl, siblingMdPath } from '../md-path';

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

describe('mdEditorUrl', () => {
  it('routes a .md file to the editor without external_path', () => {
    expect(mdEditorUrl('/home/yf/notes/note.md')).toBe(
      '/md-editor?path=%2Fhome%2Fyf%2Fnotes%2Fnote.md',
    );
    expect(mdEditorUrl('C:\\notes\\report.markdown')).toBe(
      '/md-editor?path=C%3A%5Cnotes%5Creport.markdown',
    );
  });

  it('treats the extension case-insensitively', () => {
    expect(mdEditorUrl('/a/b.MD')).toBe('/md-editor?path=%2Fa%2Fb.MD');
    expect(mdEditorUrl('/a/b.Markdown')).toBe('/md-editor?path=%2Fa%2Fb.Markdown');
  });

  it('routes a non-md source to the sibling .md + external_path', () => {
    expect(mdEditorUrl('C:\\docs\\resume.docx')).toBe(
      '/md-editor?path=C%3A%5Cdocs%5Cresume.md&external_path=C%3A%5Cdocs%5Cresume.docx',
    );
    expect(mdEditorUrl('/tmp/paper.pdf')).toBe(
      '/md-editor?path=%2Ftmp%2Fpaper.md&external_path=%2Ftmp%2Fpaper.pdf',
    );
    expect(mdEditorUrl('table.xlsx')).toBe(
      '/md-editor?path=table.md&external_path=table.xlsx',
    );
  });

  it('routes every supported non-md extension through convert_external_file', () => {
    const exts = ['docx', 'pdf', 'xlsx', 'pptx', 'html', 'txt'];
    for (const ext of exts) {
      const url = mdEditorUrl(`/data/file.${ext}`);
      expect(url).toContain('external_path=');
      expect(url).toContain(`file.${ext}`);
      expect(url).toContain('file.md');
    }
  });

  it('handles a path without any extension', () => {
    expect(mdEditorUrl('/var/data/notes')).toBe(
      '/md-editor?path=%2Fvar%2Fdata%2Fnotes.md&external_path=%2Fvar%2Fdata%2Fnotes',
    );
  });
});
