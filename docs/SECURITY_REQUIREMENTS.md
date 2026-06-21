# EUD Remote Assist - External Security Requirements

This document outlines the external requirements, policy decisions, and runbook updates necessary to maintain the security posture of the EUD Remote Assist deployment. These items require conscious acknowledgement and management by the infrastructure or administrative teams.

## 1. Transport Security & Infrastructure (HSTS)
**Context (O-2):** The portal server itself does not emit `Strict-Transport-Security` (HSTS) headers because it typically sits behind a reverse proxy (e.g., Caddy or Nginx) in production profiles (like infra-TAK) that handles TLS termination.
**Requirement:** 
- Ensure that your external reverse proxy or ingress controller explicitly emits the HSTS header on all secure endpoints (typically ports `443` and `8448`).
- Example Caddy configuration block: `header Strict-Transport-Security "max-age=31536000;"`

## 2. Unattended Screen Capture Policy
**Context (D-1):** The EUD Remote Assist Android application automatically accepts the system-level `MediaProjection` consent dialog ("Start recording or casting?"). This eliminates the need for human interaction on the target device when an administrator initiates a screen share.
**Requirement:**
- **Explicit Sign-off:** Management and legal/compliance teams must explicitly acknowledge and sign off on this behavior.
- **User Policy:** End-user policies and terms of service must explicitly state that MDM-enrolled devices are subject to unattended remote screen viewing and control by authorized administrators.

## 3. Device Reflashing & Re-enrollment Runbook
**Context (D-2):** To prevent device takeover attacks, the portal enforces Proof-of-Possession (PoP) during device re-registration. If a device is factory reset or reflashed, it permanently loses its cryptographic `connection_secret`. Because the server still expects this secret for that specific hardware `uid`, the wiped device will be rejected with a `400 Bad Request` if it attempts to re-enroll.
**Requirement:**
- **Runbook Update:** Update your device provisioning and maintenance runbooks. **Before** a wiped or reflashed device can be re-enrolled into the EUD Remote Assist portal, an administrator **must** manually delete the old device record from the portal UI.

## 4. Certificate Pinning Provisioning
**Context (M-2):** The Android agent supports TLS certificate pinning to protect against active Man-in-the-Middle (MITM) attacks, but this feature is only active if the `tls_pin_hash` is explicitly provided to the device.
**Requirement:**
- **MDM Configuration:** Ensure your Mobile Device Management (MDM) platform is configured to universally push the `tls_pin_hash` to all devices via Managed Configurations. Do not treat certificate pinning as automatic.
