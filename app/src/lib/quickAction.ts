import { CATEGORIES, type Category } from "@pawary/shared";

/**
 * Parses the quick-add deep-link contract from a URL query string:
 *   ?action=quickadd[&category=<known category>]
 * Used by Shell to open the Quick Add sheet on launch (Android manifest
 * shortcuts, iOS Apple Shortcuts, home-screen bookmarks). Unknown category
 * values are dropped so the grid shows all presets.
 */
export function parseQuickAction(search: string): {
  open: boolean;
  category?: Category;
} {
  const params = new URLSearchParams(search);
  if (params.get("action") !== "quickadd") return { open: false };
  const category = params.get("category");
  if (category && (CATEGORIES as readonly string[]).includes(category)) {
    return { open: true, category: category as Category };
  }
  return { open: true };
}
