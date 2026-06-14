# Android App — Remote Control Handler Handoff

**Audience:** Android/EUD app team  
**Server:** `https://remote.tak-solutions.com`  
**Verified on production (2026-06):** Portal sends `KEY` packets; server logs show delivery to device WebSocket (e.g. `Control KEY uid=568b166b3dd461eb key=KEYCODE_T`). **Touch and keyboard share the same WebSocket message type — implement both.**

Related: [android-app-requirements.md §9](android-app-requirements.md#9-remote-control-touch-input)

---

## ⚠️ Critical: touch injection uses **display** pixels, not capture pixels

If clicks land in the **wrong place** (often ~half offset on both axes), you are almost certainly multiplying `x_percent` / `y_percent` by the **WebRTC capture buffer size** instead of the **physical display size**.

**Verified from production logcat (uid `568b166b3dd461eb`, Galaxy XCover6 Pro):**

| | Width | Height |
|---|------:|-------:|
| Physical display | 1080 | 2408 |
| WebRTC capture (`ScreenShare: Starting capture at`) | 540 | 1204 |
| Scale | 2× | 2× |

Portal sent bottom-center click: `x_percent=0.499`, `y_percent=0.891`.

| Mapping | Result | Correct? |
|---------|--------:|:--------:|
| `0.499 × 540`, `0.891 × 1204` → **269, 1072** | What `RemoteControlHandler` logged | ❌ |
| `0.499 × 1080`, `0.891 × 2408` → **539, 2146** | What `dispatchGesture()` needs | ✅ |

`AccessibilityService.dispatchGesture()` coordinates are always in **full display pixel space**, even when MediaProjection captures at half resolution for bandwidth.

**Rule:** `x = x_percent × displayWidth`, `y = y_percent × displayHeight` using `WindowManager.currentWindowMetrics.bounds` (refresh on rotation). **Do not** use `captureWidth` / `captureHeight` from the WebRTC capturer unless they exactly equal display size.

The portal may include optional metadata on touch packets for debugging:

```json
{
  "type": "control",
  "action": "CLICK",
  "x_percent": 0.499,
  "y_percent": 0.891,
  "stream_width": 540,
  "stream_height": 1204
}
```

If `stream_width × 2 ≈ displayWidth`, percentages are correct and only the injection mapping is wrong.

---

## 1. Wire into existing WebSocket handler

After auth on `wss://{host}/ws/device`, handle incoming JSON:

```kotlin
when (message.optString("type")) {
    "command" -> handleCommand(message)
    "webrtc" -> handleWebRtc(message)
    "control" -> remoteControlHandler.handle(message)  // ← add this
    "pong" -> { /* keepalive */ }
}
```

The portal/server sends **flat** control objects (no nested payload):

```json
{ "type": "control", "action": "KEY", "key": "KEYCODE_T", "input_method": "hardware_keyboard" }
```

---

## 2. Prerequisites

| Requirement | Why |
|-------------|-----|
| **AccessibilityService** enabled for your app | `dispatchGesture()` for touch; `performGlobalAction()` for Back/Home/Recents |
| **Display size tracking** | Map `x_percent` / `y_percent` to **physical display pixels** for injection; refresh on rotation |
| **Key injection path** | See §5 — MDM device-owner apps typically use `UiAutomation` and/or `input keyevent` shell |

### Accessibility service manifest (minimum)

```xml
<service
    android:name=".remote.RemoteAssistAccessibilityService"
    android:permission="android.permission.BIND_ACCESSIBILITY_SERVICE"
    android:exported="true">
    <intent-filter>
        <action android:name="android.accessibilityservice.AccessibilityService" />
    </intent-filter>
    <meta-data
        android:name="android.accessibilityservice"
        android:resource="@xml/remote_assist_accessibility_config" />
</service>
```

`res/xml/remote_assist_accessibility_config.xml`:

```xml
<?xml version="1.0" encoding="utf-8"?>
<accessibility-service xmlns:android="http://schemas.android.com/apk/res/android"
    android:accessibilityEventTypes="typeWindowStateChanged"
    android:accessibilityFeedbackType="feedbackGeneric"
    android:accessibilityFlags="flagDefault|flagRetrieveInteractiveWindows"
    android:canPerformGestures="true"
    android:canRetrieveWindowContent="true"
    android:description="@string/remote_assist_accessibility_description"
    android:notificationTimeout="100" />
```

Prompt the user (or MDM policy) to enable this service before remote assist.

---

## 3. `RemoteControlHandler` (touch + keyboard)

Drop-in handler class. Pass your running `AccessibilityService` and lambdas that return **current physical display width/height** (from `WindowManager`, not WebRTC capture size).

```kotlin
package com.example.cfdremoteassist.remote

import android.accessibilityservice.AccessibilityService
import android.accessibilityservice.GestureDescription
import android.graphics.Path
import android.os.Build
import android.os.SystemClock
import android.util.Log
import android.view.KeyEvent
import org.json.JSONObject
import java.util.Locale

class RemoteControlHandler(
    private val service: AccessibilityService,
    /** Physical display width in pixels — `WindowManager.currentWindowMetrics.bounds.width()` */
    private val displayWidth: () -> Int,
    /** Physical display height in pixels — `WindowManager.currentWindowMetrics.bounds.height()` */
    private val displayHeight: () -> Int,
    private val keyInjector: KeyInjector = UiAutomationKeyInjector(service),
) {
    private val tag = "RemoteControlHandler"

    fun handle(message: JSONObject) {
        if (message.optString("type") != "control") return

        when (message.optString("action")) {
            "CLICK" -> injectClick(
                message.getDouble("x_percent"),
                message.getDouble("y_percent"),
                message,
            )
            "SWIPE" -> injectSwipe(
                message.getDouble("x_percent"),
                message.getDouble("y_percent"),
                message.getDouble("x2_percent"),
                message.getDouble("y2_percent"),
                message.optLong("duration_ms", 350L),
                message,
            )
            "LONG_PRESS" -> injectLongPress(
                message.getDouble("x_percent"),
                message.getDouble("y_percent"),
                message,
            )
            "KEY" -> injectKey(
                message.optString("key"),
                message.optString("input_method"),
            )
            else -> Log.w(tag, "Unknown control action: ${message.optString("action")}")
        }
    }

    private fun toX(xPercent: Double): Float {
        val w = displayWidth().coerceAtLeast(1)
        return (xPercent * w).toFloat().coerceIn(0f, w - 1f)
    }

    private fun toY(yPercent: Double): Float {
        val h = displayHeight().coerceAtLeast(1)
        return (yPercent * h).toFloat().coerceIn(0f, h - 1f)
    }

    private fun logScaleHint(message: JSONObject) {
        val sw = message.optInt("stream_width", 0)
        val sh = message.optInt("stream_height", 0)
        if (sw > 0 && sh > 0) {
            val dw = displayWidth()
            val dh = displayHeight()
            Log.d(tag, "display=${dw}x${dh} stream=${sw}x${sh}")
        }
    }

    private fun injectClick(xPercent: Double, yPercent: Double, message: JSONObject) {
        val x = toX(xPercent)
        val y = toY(yPercent)
        logScaleHint(message)
        dispatchStroke(x, y, x, y, durationMs = 50L)
        Log.d(tag, "CLICK at $x,$y (${displayWidth()}x${displayHeight()})")
    }

    private fun injectLongPress(xPercent: Double, yPercent: Double, message: JSONObject) {
        val x = toX(xPercent)
        val y = toY(yPercent)
        logScaleHint(message)
        dispatchStroke(x, y, x, y, durationMs = 600L)
        Log.d(tag, "LONG_PRESS at $x,$y")
    }

    private fun injectSwipe(
        x1Percent: Double,
        y1Percent: Double,
        x2Percent: Double,
        y2Percent: Double,
        durationMs: Long,
        message: JSONObject,
    ) {
        val x1 = toX(x1Percent)
        val y1 = toY(y1Percent)
        val x2 = toX(x2Percent)
        val y2 = toY(y2Percent)
        val duration = durationMs.coerceIn(100L, 2000L)
        logScaleHint(message)
        dispatchStroke(x1, y1, x2, y2, durationMs = duration)
        Log.d(tag, "SWIPE ($x1,$y1)→($x2,$y2) ${duration}ms")
    }

    private fun dispatchStroke(
        x1: Float,
        y1: Float,
        x2: Float,
        y2: Float,
        durationMs: Long,
    ) {
        val path = Path().apply {
            moveTo(x1, y1)
            lineTo(x2, y2)
        }
        val stroke = GestureDescription.StrokeDescription(path, 0, durationMs)
        val gesture = GestureDescription.Builder().addStroke(stroke).build()
        service.dispatchGesture(gesture, null, null)
    }

    private fun injectKey(key: String, inputMethod: String) {
        if (key.isBlank()) return

        // Navigation shortcuts — no KeyEvent needed
        when (key.uppercase(Locale.US)) {
            "BACK" -> {
                service.performGlobalAction(AccessibilityService.GLOBAL_ACTION_BACK)
                return
            }
            "HOME" -> {
                service.performGlobalAction(AccessibilityService.GLOBAL_ACTION_HOME)
                return
            }
            "RECENTS" -> {
                service.performGlobalAction(AccessibilityService.GLOBAL_ACTION_RECENTS)
                return
            }
        }

        val parsed = PortalKeyParser.parse(key)
        if (parsed == null) {
            Log.w(tag, "Unmapped key: $key")
            return
        }

        val source = when (inputMethod) {
            "hardware_keyboard" -> KeyEvent.KEYBOARD
            else -> KeyEvent.KEYBOARD
        }

        val down = KeyEvent(
            SystemClock.uptimeMillis(),
            SystemClock.uptimeMillis(),
            KeyEvent.ACTION_DOWN,
            parsed.keyCode,
            0,
            parsed.metaState,
            0,
            0,
            KeyEvent.FLAG_FROM_SYSTEM,
            source,
        )
        val up = KeyEvent(
            SystemClock.uptimeMillis(),
            SystemClock.uptimeMillis(),
            KeyEvent.ACTION_UP,
            parsed.keyCode,
            0,
            parsed.metaState,
            0,
            0,
            KeyEvent.FLAG_FROM_SYSTEM,
            source,
        )

        val okDown = keyInjector.inject(down)
        val okUp = keyInjector.inject(up)
        Log.d(tag, "KEY $key → keyCode=${parsed.keyCode} meta=${parsed.metaState} down=$okDown up=$okUp")
    }
}
```

---

## 4. Portal key name → `KeyEvent` mapping

The portal sends names like `KEYCODE_T`, `DPAD_UP`, `Ctrl+c`, `Shift+KEYCODE_A`.

```kotlin
object PortalKeyParser {
    data class ParsedKey(val keyCode: Int, val metaState: Int)

    private val aliases = mapOf(
        "BACK" to KeyEvent.KEYCODE_BACK,
        "HOME" to KeyEvent.KEYCODE_HOME,
        "RECENTS" to KeyEvent.KEYCODE_APP_SWITCH,
        "DPAD_UP" to KeyEvent.KEYCODE_DPAD_UP,
        "DPAD_DOWN" to KeyEvent.KEYCODE_DPAD_DOWN,
        "DPAD_LEFT" to KeyEvent.KEYCODE_DPAD_LEFT,
        "DPAD_RIGHT" to KeyEvent.KEYCODE_DPAD_RIGHT,
        "KEYCODE_DEL" to KeyEvent.KEYCODE_DEL,
        "KEYCODE_FORWARD_DEL" to KeyEvent.KEYCODE_FORWARD_DEL,
        "KEYCODE_ENTER" to KeyEvent.KEYCODE_ENTER,
        "KEYCODE_TAB" to KeyEvent.KEYCODE_TAB,
        "KEYCODE_ESCAPE" to KeyEvent.KEYCODE_ESCAPE,
        "KEYCODE_SPACE" to KeyEvent.KEYCODE_SPACE,
        "KEYCODE_MOVE_END" to KeyEvent.KEYCODE_MOVE_END,
        "KEYCODE_PAGE_UP" to KeyEvent.KEYCODE_PAGE_UP,
        "KEYCODE_PAGE_DOWN" to KeyEvent.KEYCODE_PAGE_DOWN,
        "KEYCODE_INSERT" to KeyEvent.KEYCODE_INSERT,
        "KEYCODE_CAPS_LOCK" to KeyEvent.KEYCODE_CAPS_LOCK,
    )

    fun parse(raw: String): ParsedKey? {
        var meta = 0
        var token = raw.trim()

        if (token.contains("+")) {
            val parts = token.split("+").map { it.trim() }
            val keyPart = parts.last()
            for (mod in parts.dropLast(1)) {
                meta = meta or when (mod.lowercase(Locale.US)) {
                    "ctrl" -> KeyEvent.META_CTRL_ON
                    "alt" -> KeyEvent.META_ALT_ON
                    "shift" -> KeyEvent.META_SHIFT_ON
                    "meta" -> KeyEvent.META_META_ON
                    else -> 0
                }
            }
            token = keyPart
        }

        val code = resolveKeyCode(token) ?: return null
        return ParsedKey(code, meta)
    }

    private fun resolveKeyCode(token: String): Int? {
        aliases[token.uppercase(Locale.US)]?.let { return it }

        if (token.startsWith("KEYCODE_", ignoreCase = true)) {
            val suffix = token.substring(8)
            if (suffix.length == 1 && suffix[0] in 'A'..'Z') {
                return KeyEvent.keyCodeFromString("KEYCODE_${suffix.uppercase(Locale.US)}")
            }
            if (suffix.length == 1 && suffix[0] in '0'..'9') {
                return KeyEvent.keyCodeFromString("KEYCODE_$suffix")
            }
            if (suffix.startsWith("F") && suffix.length <= 3) {
                return KeyEvent.keyCodeFromString("KEYCODE_${suffix.uppercase(Locale.US)}")
            }
            return KeyEvent.keyCodeFromString(token.uppercase(Locale.US))
        }

        if (token.length == 1) {
            val upper = token.uppercase(Locale.US)
            if (upper[0] in 'A'..'Z') return KeyEvent.keyCodeFromString("KEYCODE_$upper")
            if (token[0] in '0'..'9') return KeyEvent.keyCodeFromString("KEYCODE_$token")
        }

        return null
    }
}
```

---

## 5. Key injection (`KeyInjector`)

Production logs prove keys reach the device WebSocket — you must inject them into the system. Pick **one** strategy (or chain fallbacks) for your MDM deployment.

### ⚠️ Do **not** use `Instrumentation.sendKeySync`

Logcat from uid `568b166b3dd461eb` (2026-06-13) shows this failure on every key:

```
SecurityException: Injecting input events requires ... INJECT_EVENTS permission.
    at android.app.Instrumentation.sendKeySync(...)
    at InstrumentationKeyInjector.inject(KeyInjector.kt:19)
```

`Instrumentation` requires the **`INJECT_EVENTS` signature/privileged permission** — normal apps and accessibility services **cannot** use it on Samsung/production builds. Parsing is fine (`KEYCODE_A → keyCode=29`); injection is blocked.

**Remove `InstrumentationKeyInjector` from your chain.** Use Option A (`UiAutomation`) and/or Option B (shell) below.

### How KEY packets arrive (portal → device)

The portal sends **one WebSocket message per physical key press** (not a full string). For typing `ataktest1` you will receive **10 separate packets**:

```json
{"type":"control","action":"KEY","key":"KEYCODE_A","input_method":"hardware_keyboard"}
{"type":"control","action":"KEY","key":"KEYCODE_T","input_method":"hardware_keyboard"}
{"type":"control","action":"KEY","key":"KEYCODE_A","input_method":"hardware_keyboard"}
{"type":"control","action":"KEY","key":"KEYCODE_K","input_method":"hardware_keyboard"}
{"type":"control","action":"KEY","key":"KEYCODE_T","input_method":"hardware_keyboard"}
{"type":"control","action":"KEY","key":"KEYCODE_E","input_method":"hardware_keyboard"}
{"type":"control","action":"KEY","key":"KEYCODE_S","input_method":"hardware_keyboard"}
{"type":"control","action":"KEY","key":"KEYCODE_T","input_method":"hardware_keyboard"}
{"type":"control","action":"KEY","key":"KEYCODE_1","input_method":"hardware_keyboard"}
{"type":"control","action":"KEY","key":"KEYCODE_ENTER","input_method":"hardware_keyboard"}
```

Server logs each relay as: `Control KEY uid=568b166b3dd461eb key=KEYCODE_A` (one line per key).

**Android read/parse (minimal):**

```kotlin
fun handle(message: JSONObject) {
    if (message.optString("type") != "control") return
    when (message.optString("action")) {
        "KEY" -> injectKey(
            key = message.optString("key"),           // e.g. "KEYCODE_A", "KEYCODE_1", "Ctrl+c"
            inputMethod = message.optString("input_method"), // "hardware_keyboard"
        )
    }
}

private fun injectKey(key: String, inputMethod: String) {
    if (key.isBlank()) return

    // Navigation — no KeyEvent needed
    when (key.uppercase(Locale.US)) {
        "BACK" -> { service.performGlobalAction(GLOBAL_ACTION_BACK); return }
        "HOME" -> { service.performGlobalAction(GLOBAL_ACTION_HOME); return }
        "RECENTS" -> { service.performGlobalAction(GLOBAL_ACTION_RECENTS); return }
    }

    val parsed = PortalKeyParser.parse(key) ?: run {
        Log.w(tag, "Unmapped key: $key"); return
    }

    val source = KeyEvent.SOURCE_KEYBOARD  // external keyboard semantics
    val down = KeyEvent(..., ACTION_DOWN, parsed.keyCode, ..., parsed.metaState, ..., source)
    val up   = KeyEvent(..., ACTION_UP,   parsed.keyCode, ..., parsed.metaState, ..., source)

    val okDown = keyInjector.inject(down)
    val okUp   = keyInjector.inject(up)
    Log.d(tag, "KEY $key → keyCode=${parsed.keyCode} down=$okDown up=$okUp")
}
```

**Verified keyCode mapping from your logcat** (parser is correct):

| Portal `key` | Android `keyCode` | Character |
|--------------|------------------:|-----------|
| `KEYCODE_A` | 29 | a |
| `KEYCODE_T` | 48 | t |
| `KEYCODE_K` | 39 | k |
| `KEYCODE_E` | 33 | e |
| `KEYCODE_S` | 47 | s |
| `KEYCODE_1` | 8 | 1 |
| `KEYCODE_ENTER` | 66 | enter |
| `KEYCODE_DEL` | 67 | backspace |

Success looks like: `KEY KEYCODE_A → keyCode=29 down=true up=true` (both true).

### Diagnosing `down=false up=true` (your current logcat)

If every key shows **`down=false up=true`**, parsing is fine but **nothing is injected into the focused app**:

| Step | What happens |
|------|----------------|
| `ACTION_DOWN` | `UiAutomation.injectInputEvent` returns `false` (common on Samsung without main-thread dispatch) |
| `ACTION_DOWN` | `ShellKeyInjector` runs `input keyevent` → fails (app is not device-owner / no shell) |
| `ACTION_UP` | `ShellKeyInjector` returns `true` **without injecting** (by design — see Option B) |

So `up=true` is a **false positive** — it does not mean the key reached the UI.

**Fix order for Galaxy XCover / Samsung MDM:**

1. Dispatch `UiAutomation` on the **main thread** (Option A below).
2. Add **`AccessibilitySetTextInjector`** (Option C) — works when a text field is focused; this is what most remote-assist apps use when `injectInputEvent` is blocked.
3. Confirm device-owner shell if you rely on Option B (`adb shell input keyevent 48` from the app UID).

**Prerequisite:** Tap/click a text field on the device **before** typing from the portal so `findFocus(FOCUS_INPUT)` returns an editable node.

### Option A — `UiAutomation` (main thread required on Samsung)

Works on many builds when called from an enabled `AccessibilityService` on API 24+:

```kotlin
interface KeyInjector {
    fun inject(event: KeyEvent): Boolean
}

class UiAutomationKeyInjector(
    private val service: AccessibilityService,
) : KeyInjector {
    private val mainHandler = Handler(Looper.getMainLooper())

    override fun inject(event: KeyEvent): Boolean {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.N) return false

        // WebSocket callbacks are background threads — Samsung often rejects inject off main.
        if (Looper.myLooper() != Looper.getMainLooper()) {
            var result = false
            val latch = CountDownLatch(1)
            mainHandler.post {
                result = injectOnMainThread(event)
                latch.countDown()
            }
            latch.await(500, TimeUnit.MILLISECONDS)
            return result
        }
        return injectOnMainThread(event)
    }

    private fun injectOnMainThread(event: KeyEvent): Boolean {
        return try {
            val ok = service.uiAutomation.injectInputEvent(event, true)
            if (!ok) Log.w("KeyInjector", "UiAutomation returned false action=${event.action} keyCode=${event.keyCode}")
            ok
        } catch (e: Exception) {
            Log.w("KeyInjector", "UiAutomation inject failed", e)
            false
        }
    }
}
```

Add imports: `android.os.Handler`, `android.os.Looper`, `java.util.concurrent.CountDownLatch`, `java.util.concurrent.TimeUnit`.

### Option B — Device-owner shell fallback (common on fully managed phones)

If Option A returns `false`, many enterprise apps run:

```kotlin
class ShellKeyInjector : KeyInjector {
    override fun inject(event: KeyEvent): Boolean {
        if (event.action != KeyEvent.ACTION_DOWN) return false // do NOT fake success on UP
        return try {
            val exit = Runtime.getRuntime()
                .exec(arrayOf("sh", "-c", "input keyevent ${event.keyCode}"))
                .waitFor()
            val ok = exit == 0
            if (!ok) Log.w("KeyInjector", "shell input keyevent ${event.keyCode} exit=$exit")
            ok
        } catch (e: Exception) {
            Log.w("KeyInjector", "shell input keyevent failed", e)
            false
        }
    }
}

class ChainedKeyInjector(
    private vararg val injectors: KeyInjector,
) : KeyInjector {
    override fun inject(event: KeyEvent): Boolean {
        for (injector in injectors) {
            if (injector.inject(event)) return true
        }
        return false
    }
}

// Usage:
// keyInjector = ChainedKeyInjector(UiAutomationKeyInjector(service), ShellKeyInjector())
```

Requires device-owner / privileged shell on managed devices. **Do not** rely on this alone on unmanaged Play Store builds.

### Option C — `ACTION_SET_TEXT` on focused field (recommended Samsung fallback)

When Options A and B both return `false`, inject text through the accessibility tree into the **currently focused editable** node. This is not a hardware keyboard event, but it **does** put characters on screen in ATAK, Chrome, Settings search, etc.

```kotlin
class AccessibilitySetTextInjector(
    private val service: AccessibilityService,
) : KeyInjector {
    override fun inject(event: KeyEvent): Boolean {
        if (event.action != KeyEvent.ACTION_DOWN) return false

        val node = service.findFocus(AccessibilityNodeInfo.FOCUS_INPUT)
            ?: service.rootInActiveWindow?.findFocus(AccessibilityNodeInfo.FOCUS_INPUT)
            ?: run {
                Log.w("KeyInjector", "SetText: no focused input — click a text field on device first")
                return false
            }

        if (!node.isEditable) {
            Log.w("KeyInjector", "SetText: focused node not editable class=${node.className}")
            node.recycle()
            return false
        }

        val current = node.text?.toString().orEmpty()
        val newText = when (event.keyCode) {
            KeyEvent.KEYCODE_DEL -> current.dropLast(1)
            KeyEvent.KEYCODE_ENTER -> {
                val ok = node.performAction(AccessibilityNodeInfo.ACTION_IME_ACTION)
                node.recycle()
                return ok
            }
            else -> {
                val ch = keyCodeToChar(event.keyCode, event.metaState)
                    ?: run {
                        node.recycle()
                        return false
                    }
                current + ch
            }
        }

        val args = Bundle().apply {
            putCharSequence(
                AccessibilityNodeInfo.ACTION_ARGUMENT_SET_TEXT_CHARSEQUENCE,
                newText,
            )
        }
        val ok = node.performAction(AccessibilityNodeInfo.ACTION_SET_TEXT, args)
        node.recycle()
        if (!ok) Log.w("KeyInjector", "SetText performAction failed keyCode=${event.keyCode}")
        return ok
    }

    private fun keyCodeToChar(keyCode: Int, metaState: Int): Char? {
        val shift = metaState and KeyEvent.META_SHIFT_ON != 0
        return when (keyCode) {
            in KeyEvent.KEYCODE_A..KeyEvent.KEYCODE_Z -> {
                val c = ('a'.code + (keyCode - KeyEvent.KEYCODE_A)).toChar()
                if (shift) c.uppercaseChar() else c
            }
            in KeyEvent.KEYCODE_0..KeyEvent.KEYCODE_9 ->
                ('0'.code + (keyCode - KeyEvent.KEYCODE_0)).toChar()
            KeyEvent.KEYCODE_SPACE -> ' '
            else -> null
        }
    }
}
```

Add to manifest accessibility config if not already present:

```xml
android:canPerformGestures="true"
android:canRetrieveWindowContent="true"
```

### Option D — Global actions only (minimal)

If all injectors fail, at minimum implement `BACK` / `HOME` / `RECENTS` via `performGlobalAction` (already in `RemoteControlHandler`).

### Recommended injector chain (Samsung / MDM)

```kotlin
keyInjector = ChainedKeyInjector(
    UiAutomationKeyInjector(this),       // main-thread UiAutomation
    ShellKeyInjector(),                  // device-owner only
    AccessibilitySetTextInjector(this), // fallback when injectInputEvent blocked
)
```

With Option C in the chain, logcat for a successful key should show **`down=true`** (SetText handles DOWN only; UP may stay `false` — that is OK if text appears).

---

## 6. Service wiring example

```kotlin
class RemoteAssistAccessibilityService : AccessibilityService() {

    private lateinit var controlHandler: RemoteControlHandler

    override fun onServiceConnected() {
        super.onServiceConnected()
        controlHandler = RemoteControlHandler(
            service = this,
            displayWidth = { RemoteSessionManager.displayWidth },
            displayHeight = { RemoteSessionManager.displayHeight },
            keyInjector = ChainedKeyInjector(
                UiAutomationKeyInjector(this),
                ShellKeyInjector(),
                AccessibilitySetTextInjector(this),
            ),
        )
    }

    /** Called from your device WebSocket client when a message arrives. */
    fun onControlMessage(json: JSONObject) {
        controlHandler.handle(json)
    }
}
```

In your WebSocket layer:

```kotlin
private fun onWebSocketText(text: String) {
    val json = JSONObject(text)
    when (json.optString("type")) {
        "control" -> {
            RemoteAssistAccessibilityService.instance?.onControlMessage(json)
                ?: Log.w(TAG, "control message but accessibility service not running")
        }
        // ...
    }
}
```

---

## 7. QA checklist

Before closing the keyboard ticket:

- [ ] Enable accessibility service → connect remote assist from portal
- [ ] Server log shows `Control KEY uid=... key=KEYCODE_*` while typing (already working)
- [ ] **App logcat** shows `RemoteControlHandler: KEY KEYCODE_T → keyCode=... down=true up=true`
- [ ] Typed characters appear in focused field on device (Notes, search bar, etc.)
- [ ] `BACK` / `HOME` / `RECENTS` work via `performGlobalAction`
- [ ] Click / swipe still work after adding KEY handler
- [ ] After rotation, touch coords still correct (`displayWidth` / `displayHeight` refreshed from `WindowManager`)

### Logcat filter

```bash
adb logcat -s RemoteControlHandler KeyInjector
```

---

## 8. Common mistakes

| Symptom | Cause |
|---------|--------|
| Clicks land ~half offset (wrong spot entirely) | Multiplying by WebRTC **capture** size (e.g. 540×1204) instead of **display** size (1080×2408) — see top of this doc |
| Keys parsed, `down=false up=true` on Samsung | UiAutomation + shell both failed; UP=true is shell no-op — add `AccessibilitySetTextInjector` + click text field first |
| Keys parsed, `down=false up=false`, `INJECT_EVENTS` in logcat | Using `Instrumentation.sendKeySync` — switch to `UiAutomationKeyInjector` (§5) |
| Server logs KEY, nothing on device | WebSocket handler ignores `type: "control"` or only handles touch |
| Keys logged, `down=false` | All injectors failed — check focus (`SetText: no focused input`) or device-owner shell |
| Wrong characters | Using IME `commitText` instead of `KeyEvent` with `SOURCE_KEYBOARD` |
| Touch works, keys don't | Separate code paths — KEY branch not implemented |
| `KEYCODE_T` not recognized | Parser missing — use `PortalKeyParser` above |

---

## 9. Production evidence (portal/server)

Server successfully relayed test typing on uid `568b166b3dd461eb`:

```
Control KEY uid=568b166b3dd461eb key=KEYCODE_T
Control KEY uid=568b166b3dd461eb key=KEYCODE_E
Control KEY uid=568b166b3dd461eb key=KEYCODE_S
Control KEY uid=568b166b3dd461eb key=KEYCODE_T
...
```

Implementation work is **entirely on the Android app** from this point.
