/**
 * Drawer entry for phones, rendered in the page header.
 *
 * The shell's own hamburger (`.app-shell__hamburger`) is hidden below 640px
 * on purpose: the Today page renders its own top bar and dispatches
 * `weavine:open-drawer`. But no other page had any way to reach the drawer,
 * and the bottom nav has no 「更多」 tab — so 项目 / 标签 / 设置 were
 * unreachable on a phone unless you first navigated back to 今天.
 *
 * This dispatches the very same event the Today ☰ does. CSS keeps it hidden
 * from 641px up, where the shell hamburger takes over.
 */
export function MobileMenuButton() {
  return (
    <button
      type="button"
      className="page-header__menu"
      onClick={() => window.dispatchEvent(new CustomEvent('weavine:open-drawer'))}
      aria-label="打开菜单"
      data-testid="page-header-menu"
    >
      ☰
    </button>
  );
}
