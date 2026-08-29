/**
 * The `.md` file the editor edits when the user opens a non-`.md` source
 * (docx / pdf / html / xlsx / pptx / txt). It sits next to the original so
 * related files stay together; the original is never modified.
 *
 * Shared by the OS "Open With" / argv path (App.tsx) and the in-app "📂 打开"
 * dialog (MdEditor.tsx). These two used to compute it independently and
 * drifted: the dialog called the `convert_sibling_md_path` command and, when
 * that failed, fell back to opening the *original binary* as markdown — which
 * decodes a .docx (a ZIP archive) as text and crashes the editor. One
 * implementation means one behaviour for both entry points.
 */
export function siblingMdPath(originalPath: string): string {
  const dot = originalPath.lastIndexOf('.');
  const slash = Math.max(
    originalPath.lastIndexOf('/'),
    originalPath.lastIndexOf('\\'),
  );
  // Only treat `dot` as an extension separator when it follows the last path
  // separator — otherwise a path like `C:\dir.name\file` would be truncated.
  return dot > slash
    ? originalPath.slice(0, dot) + '.md'
    : originalPath + '.md';
}
