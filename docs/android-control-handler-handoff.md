# Android App — Remote Control Handler Handoff

**Audience:** Android/EUD app team  
**Server:** `https://remote.tak-solutions.com`  
**Verified on production (2026-06):** Portal sends `KEY` packets; server logs show delivery to device WebSocket (e.g. `Control KEY uid=568b166b3dd461eb key=KEYCODE_T`). **Touch and keyboard share the same WebSocket message type — implement both.**

Related: [android-app-requirements.md §9](android-app-requirements.md#9-remote-control-touch-input)

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
| **Capture size tracking** | Map `x_percent` / `y_percent` to pixels; update on rotation (§8.1) |
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

Drop-in handler class. Pass your running `AccessibilityService` and lambdas that return **current capture width/height** (must match MediaProjection / touch injection space).

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
    private val captureWidth: () -> Int,
    private val captureHeight: () -> Int,
    private val keyInjector: KeyInjector = UiAutomationKeyInjector(service),
) {
    private val tag = "RemoteControlHandler"

    fun handle(message: JSONObject) {
        if (message.optString("type") != "control") return

        when (message.optString("action")) {
            "CLICK" -> injectClick(
                message.getDouble("x_percent"),
                message.getDouble("y_percent"),
            )
            "SWIPE" -> injectSwipe(
                message.getDouble("x_percent"),
                message.getDouble("y_percent"),
                message.getDouble("x2_percent"),
                message.getDouble("y2_percent"),
                message.optLong("duration_ms", 350L),
            )
            "LONG_PRESS" -> injectLongPress(
                message.getDouble("x_percent"),
                message.getDouble("y_percent"),
            )
            "KEY" -> injectKey(
                message.optString("key"),
                message.optString("input_method"),
            )
            else -> Log.w(tag, "Unknown control action: ${message.optString("action")}")
        }
    }

    private fun toX(xPercent: Double): Float {
        val w = captureWidth().coerceAtLeast(1)
        return (xPercent * w).toFloat().coerceIn(0f, w - 1f)
    }

    private fun toY(yPercent: Double): Float {
        val h = captureHeight().coerceAtLeast(1)
        return (yPercent * h).toFloat().coerceIn(0f, h - 1f)
    }

    private fun injectClick(xPercent: Double, yPercent: Double) {
        val x = toX(xPercent)
        val y = toY(yPercent)
        dispatchStroke(x, y, x, y, durationMs = 50L)
        Log.d(tag, "CLICK at $x,$y")
    }

    private fun injectLongPress(xPercent: Double, yPercent: Double) {
        val x = toX(xPercent)
        val y = toY(yPercent)
        dispatchStroke(x, y, x, y, durationMs = 600L)
        Log.d(tag, "LONG_PRESS at $x,$y")
    }

    private fun injectSwipe(
        x1Percent: Double,
        y1Percent: Double,
        x2Percent: Double,
        y2Percent: Double,
        durationMs: Long,
    ) {
        val x1 = toX(x1Percent)
        val y1 = toY(y1Percent)
        val x2 = toX(x2Percent)
        val y2 = toY(y2Percent)
        val duration = durationMs.coerceIn(100L, 2000L)
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

### Option A — `UiAutomation` (try first)

Works on many builds when called from an enabled `AccessibilityService` on API 24+:

```kotlin
interface KeyInjector {
    fun inject(event: KeyEvent): Boolean
}

class UiAutomationKeyInjector(
    private val service: AccessibilityService,
) : KeyInjector {
    override fun inject(event: KeyEvent): Boolean {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.N) return false
        return try {
            service.uiAutomation.injectInputEvent(event, true)
        } catch (e: Exception) {
            Log.w("KeyInjector", "UiAutomation inject failed", e)
            false
        }
    }
}
```

### Option B — Device-owner shell fallback (common on fully managed phones)

If Option A returns `false`, many enterprise apps run:

```kotlin
class ShellKeyInjector : KeyInjector {
    override fun inject(event: KeyEvent): Boolean {
        if (event.action != KeyEvent.ACTION_DOWN) return true // one shot per key
        return try {
            val cmd = arrayOf("sh", "-c", "input keyevent ${event.keyCode}")
            Runtime.getRuntime().exec(cmd).waitFor() == 0
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

### Option C — Global actions only (minimal)

If key injection is blocked by OEM policy, at minimum implement `BACK` / `HOME` / `RECENTS` via `performGlobalAction` and document that alphanumeric keys need Option A or B.

---

## 6. Service wiring example

```kotlin
class RemoteAssistAccessibilityService : AccessibilityService() {

    private lateinit var controlHandler: RemoteControlHandler

    override fun onServiceConnected() {
        super.onServiceConnected()
        controlHandler = RemoteControlHandler(
            service = this,
            captureWidth = { RemoteSessionManager.captureWidth },
            captureHeight = { RemoteSessionManager.captureHeight },
            keyInjector = ChainedKeyInjector(
                UiAutomationKeyInjector(this),
                ShellKeyInjector(),
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
- [ ] After rotation, touch coords still correct (capture width/height updated)

### Logcat filter

```bash
adb logcat -s RemoteControlHandler KeyInjector
```

---

## 8. Common mistakes

| Symptom | Cause |
|---------|--------|
| Server logs KEY, nothing on device | WebSocket handler ignores `type: "control"` or only handles touch |
| Keys logged, `down=false` | `KeyInjector` blocked — enable UiAutomation or device-owner shell |
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
