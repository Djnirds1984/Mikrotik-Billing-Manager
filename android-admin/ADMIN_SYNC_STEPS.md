# Admin APK — platform folder approach & sync steps

## Approach used: manual copy + transform (NOT CLI-native)

Capacitor CLI 7.6.8 was verified (`npx.cmd cap --help`, `npx.cmd cap add --help`,
`node_modules/@capacitor/cli/dist/config.js`):

- The config schema DOES declare `android.path` (since 3.0.0), **but** the CLI
  has **no `--config` flag** and hard-codes loading `capacitor.config.ts` from
  the project root (`loadExtConfig()` only probes capacitor.config.ts/js/json).
- Therefore there is no way to point `cap add/copy/sync` at
  `capacitor.admin.config.ts` without renaming the customer config, which is
  forbidden (customer app must stay untouched).

So `android-admin/` was created by **copying `android/` and transforming it**:

1. Copied `android/` → `android-admin/` (excluding `.gradle/`, `app/build/`,
   `capacitor-cordova-android-plugins/build/`, `customer-app.keystore`).
2. Package rename `com.mikrotikbilling.customer` → `com.mikrotikbilling.admin`:
   - `app/build.gradle`: `namespace` + `applicationId`
   - Java sources moved to `app/src/main/java/com/mikrotikbilling/admin/`
   - `res/values/strings.xml`: `app_name`/`title_activity_main` → "ISP Billing
     Admin", `package_name`/`custom_url_scheme` → `com.mikrotikbilling.admin`
   - `AndroidManifest.xml` uses relative `.MainActivity`, so only the added
     `SEND_SMS` permission was needed.
3. `capacitor.settings.gradle` / `app/capacitor.build.gradle` reference
   `../node_modules/...` — same depth as `android/`, so they work unchanged.
4. Runtime config: `app/src/main/assets/capacitor.config.json` rewritten with
   the admin values (this JSON is what the native runtime actually reads; it
   must mirror `capacitor.admin.config.ts`).
5. Web assets: `app/src/main/assets/public/` overwritten with the contents of
   `mobile-app-admin/` (cordova.js / cordova_plugins.js stubs kept).
6. Signing: `android-admin/admin-app.keystore` (alias `admin`), wired in
   `app/build.gradle` `signingConfigs.release`.

## Rebuild / future sync steps (PowerShell)

After editing `mobile-app-admin/` web assets:

```powershell
Copy-Item mobile-app-admin\index.html, mobile-app-admin\setup.js, mobile-app-admin\styles.css android-admin\app\src\main\assets\public\ -Force
```

After changing `capacitor.admin.config.ts`, mirror the same values into
`android-admin\app\src\main\assets\capacitor.config.json` by hand
(appId / appName / plugins / android / server keys — webDir is unused at
runtime but kept consistent).

After a Capacitor version upgrade (`npm install`), run the normal customer
sync (`npx.cmd cap sync android`) and then diff-port any changes made to
`android/app/capacitor.build.gradle`, `android/capacitor.settings.gradle` and
`android/app/src/main/assets/capacitor.plugins.json` into the `android-admin/`
counterparts (paths are depth-compatible, copy verbatim).

Debug build:

```powershell
$env:JAVA_HOME = "C:\Program Files\Android\Android Studio\jbr"
cd android-admin
.\gradlew.bat assembleDebug
# APK: android-admin\app\build\outputs\apk\debug\app-debug.apk
```

Release build (signed with admin-app.keystore automatically):

```powershell
$env:JAVA_HOME = "C:\Program Files\Android\Android Studio\jbr"
cd android-admin
.\gradlew.bat assembleRelease
# APK: android-admin\app\build\outputs\apk\release\app-release.apk
```

## Native SMS plugin

`app/src/main/java/com/mikrotikbilling/admin/SmsPlugin.java`, registered in
`MainActivity.onCreate()` **before** `super.onCreate()`. WebView API
(`Capacitor.Plugins.NativeSms`):

- `checkPermission()` → `{granted: boolean}`
- `requestPermission()` → `{granted: boolean}` (runtime SEND_SMS prompt)
- `send({phone, message})` → `{success: true}` or `{success: false, error}`.
  Security guard: rejected unless the current WebView URL host matches the
  tunnel domain saved by setup.js (Preferences key `tunnel_domain`, stored in
  the `CapacitorStorage` SharedPreferences file). Multipart-safe, 30s timeout.
- `setKeepScreenOn({enabled: boolean})` → `{success: true}`
