/** Map browser keyboard events to device KEY control packets. */

export function isKeyboardExitCombo(e: KeyboardEvent): boolean {
  return e.key === "Escape" && (e.metaKey || e.ctrlKey);
}

export function metaKeyLabel(): string {
  if (typeof navigator === "undefined") return "Ctrl";
  return /Mac|iPhone|iPad/i.test(navigator.platform) ? "⌘" : "Ctrl";
}

export function keyboardExitHint(): string {
  return `${metaKeyLabel()}+Esc`;
}

export function normalizeControlKey(e: KeyboardEvent): string | null {
  if (isKeyboardExitCombo(e)) return null;

  const modifierOnly = new Set(["Control", "Shift", "Alt", "Meta"]);
  if (modifierOnly.has(e.key)) return null;

  const parts: string[] = [];
  if (e.ctrlKey) parts.push("Ctrl");
  if (e.altKey) parts.push("Alt");
  if (e.shiftKey) parts.push("Shift");
  if (e.metaKey) parts.push("Meta");

  let key = e.key;
  switch (e.key) {
    case " ":
      key = "Space";
      break;
    case "ArrowUp":
      key = "DPAD_UP";
      break;
    case "ArrowDown":
      key = "DPAD_DOWN";
      break;
    case "ArrowLeft":
      key = "DPAD_LEFT";
      break;
    case "ArrowRight":
      key = "DPAD_RIGHT";
      break;
    default:
      break;
  }

  if (parts.length > 0) {
    parts.push(key);
    return parts.join("+");
  }

  return key;
}
