/** Map browser keyboard events to Android hardware keyboard KEY control packets. */

const EDITABLE_SELECTOR =
  "input, textarea, select, [contenteditable=''], [contenteditable='true']";

function isEditableElement(element: Element | null): boolean {
  if (!element || !(element instanceof HTMLElement)) return false;
  if (element.isContentEditable) return true;

  const tag = element.tagName;
  if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return true;

  return element.closest(EDITABLE_SELECTOR) != null;
}

/** True when keystrokes should go to the remote device (not a page text field). */
export function shouldForwardKeyboardToDevice(focusTarget: Element | null): boolean {
  if (isEditableElement(focusTarget)) return false;

  // Leaflet and similar widgets capture arrow keys when focused — still forward to device.
  return true;
}

const ANDROID_KEYCODE: Record<string, string> = {
  Backspace: "KEYCODE_DEL",
  Delete: "KEYCODE_FORWARD_DEL",
  Enter: "KEYCODE_ENTER",
  Tab: "KEYCODE_TAB",
  Escape: "KEYCODE_ESCAPE",
  " ": "KEYCODE_SPACE",
  ArrowUp: "DPAD_UP",
  ArrowDown: "DPAD_DOWN",
  ArrowLeft: "DPAD_LEFT",
  ArrowRight: "DPAD_RIGHT",
  Home: "HOME",
  End: "KEYCODE_MOVE_END",
  PageUp: "KEYCODE_PAGE_UP",
  PageDown: "KEYCODE_PAGE_DOWN",
  Insert: "KEYCODE_INSERT",
  CapsLock: "KEYCODE_CAPS_LOCK",
  ContextMenu: "RECENTS",
  F1: "KEYCODE_F1",
  F2: "KEYCODE_F2",
  F3: "KEYCODE_F3",
  F4: "KEYCODE_F4",
  F5: "KEYCODE_F5",
  F6: "KEYCODE_F6",
  F7: "KEYCODE_F7",
  F8: "KEYCODE_F8",
  F9: "KEYCODE_F9",
  F10: "KEYCODE_F10",
  F11: "KEYCODE_F11",
  F12: "KEYCODE_F12",
};

function letterKeyCode(key: string): string | null {
  if (key.length !== 1) return null;
  const upper = key.toUpperCase();
  if (upper >= "A" && upper <= "Z") return `KEYCODE_${upper}`;
  if (key >= "0" && key <= "9") return `KEYCODE_${key}`;
  return null;
}

export function normalizeControlKey(e: KeyboardEvent): string | null {
  const modifierOnly = new Set(["Control", "Shift", "Alt", "Meta"]);
  if (modifierOnly.has(e.key)) return null;

  const parts: string[] = [];
  if (e.ctrlKey) parts.push("Ctrl");
  if (e.altKey) parts.push("Alt");
  if (e.shiftKey) parts.push("Shift");
  if (e.metaKey) parts.push("Meta");

  let key = ANDROID_KEYCODE[e.key] ?? e.key;
  if (key === e.key) {
    const letter = letterKeyCode(e.key);
    if (letter) key = letter;
    else if (e.key === " ") key = "KEYCODE_SPACE";
  }

  if (parts.length > 0) {
    parts.push(key);
    return parts.join("+");
  }

  return key;
}
