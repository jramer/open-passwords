# Open Passwords — security test build

Version: **0.49.1-security-test.1**

Fork: https://github.com/jramer/open-passwords

Combined branch: `test/security-fixes`. Based on upstream commit
`7bd3a9bb98e26522a4cdff825c8b06a6e7f6f092`.

## Install and test

1. In Chrome, Edge, or Brave, open the extensions page and enable Developer mode.
2. Disable Apple's official iCloud Passwords extension. This fork uses the same
   extension ID, as required by Apple's native helper.
3. Choose **Load unpacked** and select
   `/Users/kim/Developer/other/open-passwords`.
   If that folder was already loaded, click the extension's **Reload** button.
   Alternatively, extract the supplied ZIP and load its `open-passwords-security-test`
   folder.
4. Check the name is **Open Passwords (security test)**, the version is **0.49.1**,
   and the extension ID is `pejdijmoenmkgeppbflobdenhhabjlaj`.
5. Reload the website tabs you will test, so they receive the updated content script.
6. Open the extension from the browser toolbar and enter the pairing code shown
   by macOS. Pairing-code entry now stays inside the extension popup. The inline
   **Unlock to autofill…** action opens that popup; if your browser cannot open it
   automatically, click the toolbar icon yourself.
7. On a site with a saved login, select the account and verify that the username
   and password fill correctly. Check both the inline chooser and the toolbar
   **Fill** button. Check **Refresh passwords** on that same HTTPS site.
8. If you have a saved verification-code generator, check its inline dropdown and
   toolbar **Fill** button. Try a split code widget if you normally use one.
9. If you use a login embedded in another site, check its inline chooser. Toolbar
   verification-code filling is deliberately limited to the top frame; use the
   inline chooser for codes inside an iframe.

Use your normal macOS authentication prompts. No additional native-helper
installation is needed for ordinary password filling. The optional helper scripts
are unchanged by these fixes.

After testing, report whether pairing, password filling, Refresh, and verification
codes worked, along with the browser name and any failure. Upstream PRs are held
until this manual test succeeds.

## Fixes included

| Independent branch | Change |
| --- | --- |
| `fix/secure-password-delivery` | Pin password delivery, caches, and Refresh to the complete origin, including HTTPS and port. Reject origin changes during native authentication. |
| `fix/otp-context-binding` | Bind verification-code lists to their frame, document, and origins; use opaque selection IDs; reject stale selections and missing accounts; stop broadcasting codes across frames. |
| `fix/pairing-popup-only` | Remove the pairing-code input from webpages and reject pairing-secret messages from content scripts. Pair only through the extension popup. |
| `fix/hidden-autofill-fields` | Refuse hidden or transparent credential fields, including fields beneath transparent ancestors. |

Each fix branch contains one independent signed commit based directly on upstream
main, so the fixes can be submitted as separate PRs without depending on each other.
The test-build name/version changes exist only on the combined testing branch.

## Automated validation

- **18 targeted security regression tests passed**, including HTTP downgrade,
  changed ports, delayed delivery, stale OTP lists, cross-frame selections,
  account mismatches, protected pairing, and hidden fields.
- **14 existing SRP/pairing handshake checks passed.**
- **12 of 13 existing browser suites passed**, including the updated pairing
  flow and a cross-origin iframe fixture that actually loads.
- The remaining failure is the existing checkout-email false positive in
  `drive-adversarial.mjs` (21/22 checks pass). It was reproduced against unchanged
  upstream code and is outside these security fixes.

Browser tests use a separate Chromium profile and synthetic credentials. These
checks do not authenticate against your real Apple Passwords vault; the manual
steps above verify that integration on your Mac.

Run the Node regressions from the repository with:

```sh
node --test test-harness/automation/*.test.mjs
```

The browser harness setup is documented in `test-harness/automation/README.md`.

## Restore Apple's extension

Disable or remove this unpacked extension and re-enable Apple's official iCloud
Passwords extension. Reload the website tabs afterward.
