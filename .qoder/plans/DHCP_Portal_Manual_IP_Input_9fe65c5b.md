# Refactor DHCP Portal Server Address to Manual Input

## Summary
Change the "Portal Server IP Address" field in `DhcpCaptivePortalInstaller.tsx` from a non-editable auto-detected value to a standard text input that is pre-filled with `window.location.hostname` but can be manually edited by the user.

## Changes in `components/DhcpCaptivePortalInstaller.tsx`

1. Replace the read-only `<div>` display (lines 117-119) with an `<input type="text">` element:
   - Keep `panelIp` state and `setPanelIp` as-is (already in place)
   - Still auto-fill with `window.location.hostname` on mount as a default/suggestion
   - Add `onChange` handler to allow user to type a custom IP
   - Add a `placeholder` like "e.g. 192.168.1.100"
   - Style it consistently with the LAN Interface select field

2. Update the helper text (line 120) from "This is auto-detected" to indicate it is pre-filled but editable (e.g., "Pre-filled from browser hostname. Change this if your panel runs on a different IP address.").

## No Other Files Affected
- The `panelIp` state is already a string passed to the API — no backend or type changes needed.
- The `handleInstall` function already validates that `panelIp` is truthy before enabling the button.
