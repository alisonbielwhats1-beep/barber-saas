export function commandShortcutLabel(platform = ""): "⌘K" | "Ctrl K" {
  return /Mac|iPhone|iPad|iPod/i.test(platform) ? "⌘K" : "Ctrl K";
}
