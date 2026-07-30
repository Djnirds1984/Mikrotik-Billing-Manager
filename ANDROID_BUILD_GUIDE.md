# Android Customer App — Build & Distribution Guide

This guide explains how to build, customize, and distribute the **customer Android app** for the MikroTik Billing Manager. The app is a lightweight Capacitor wrapper: on first launch the customer enters your billing panel URL (your Cloudflare tunnel domain), and from then on the app loads your existing web panel directly — no separate mobile backend is required.

**Key files:**
| Path | Purpose |
|---|---|
| `mobile-app/` | Local setup page (domain entry + redirect to your panel) |
| `capacitor.config.ts` | Capacitor configuration (`appId: com.mikrotikbilling.customer`, `webDir: mobile-app`) |
| `android/` | Generated Android Studio project |
| `proxy/server.js` | Backend with CORS enabled for the app's public endpoints |

---

## 1. Prerequisites

You only need these on the machine where you **build** the APK (not on the server):

1. **Node.js 18+** — already installed if you run the web panel. Verify:
   ```bash
   node --version
   ```
2. **Android Studio (latest stable)** — download from:
   https://developer.android.com/studio
3. **Java Development Kit (JDK 17)** — bundled with Android Studio; no separate install needed.
4. **Android SDK (API level 34 recommended)** — install via Android Studio:
   *Settings → Languages & Frameworks → Android SDK → SDK Platforms → check "Android 14 (API 34)" → Apply*.
5. **Set the `ANDROID_HOME` environment variable** to your SDK location.

   **Windows (PowerShell):**
   ```powershell
   [Environment]::SetEnvironmentVariable("ANDROID_HOME", "$env:LOCALAPPDATA\Android\Sdk", "User")
   ```
   Close and reopen your terminal afterwards.

   **Linux/Mac (add to `~/.bashrc` or `~/.zshrc`):**
   ```bash
   export ANDROID_HOME=$HOME/Android/Sdk        # Linux
   export ANDROID_HOME=$HOME/Library/Android/sdk # Mac
   export PATH=$PATH:$ANDROID_HOME/platform-tools
   ```

---

## 2. Building the APK (Development)

A debug APK is unsigned-for-store but perfectly fine for testing and even for sideloading to customers while you evaluate.

### Step-by-step

```bash
# 1. From the project root — install dependencies (first time only)
npm install

# 2. Copy the mobile-app files into the Android project
npx cap sync android

# 3. Open the Android project in Android Studio
npx cap open android
```

In **Android Studio**:

1. Wait for Gradle sync to finish (progress bar at the bottom).
2. Menu: **Build → Build Bundle(s) / APK(s) → Build APK(s)**.
3. When the "APK(s) generated" notification appears, click **locate**.

**Output location:**
```
android/app/build/outputs/apk/debug/app-debug.apk
```

### Alternative: command line (no Android Studio UI)

**Windows (PowerShell):**
```powershell
cd android
.\gradlew assembleDebug
```

**Linux/Mac:**
```bash
cd android
./gradlew assembleDebug
```

---

## 3. Building the APK (Production/Release)

Release builds are signed with your own keystore and are smaller/faster (minified). Use these for real distribution.

### 3.1 Generate a signing keystore (one time only)

Run from the `android/` folder (the `keytool` command comes with the JDK — on Windows it's in `C:\Program Files\Android\Android Studio\jbr\bin` if not on your PATH):

```bash
keytool -genkey -v -keystore customer-app.keystore -alias customer -keyalg RSA -keysize 2048 -validity 10000
```

You will be asked for a **store password**, a **key password**, and identity details.

> ⚠️ **Back up `customer-app.keystore` and the passwords somewhere safe.** If you lose them you cannot publish updates under the same signature — customers would have to uninstall and reinstall.

### 3.2 Configure signing in `android/app/build.gradle`

Add/merge the following inside the existing `android { ... }` block:

```groovy
android {
    signingConfigs {
        release {
            storeFile file('../customer-app.keystore')
            storePassword 'YOUR_STORE_PASSWORD'
            keyAlias 'customer'
            keyPassword 'YOUR_KEY_PASSWORD'
        }
    }
    buildTypes {
        release {
            signingConfig signingConfigs.release
            minifyEnabled true
            proguardFiles getDefaultProguardFile('proguard-android-optimize.txt'), 'proguard-rules.pro'
        }
    }
}
```

Replace `YOUR_STORE_PASSWORD` and `YOUR_KEY_PASSWORD` with the passwords you chose in step 3.1.

> 🔒 Don't commit real passwords to a public repository. Keep the keystore and this gradle change out of version control, or move the passwords into `~/.gradle/gradle.properties`.

### 3.3 Build the release APK

**Windows (PowerShell):**
```powershell
cd android
.\gradlew assembleRelease
```

**Linux/Mac:**
```bash
cd android
./gradlew assembleRelease
```

**Output location:**
```
android/app/build/outputs/apk/release/app-release.apk
```

---

## 4. Customization

### Change the app name
Edit `android/app/src/main/res/values/strings.xml`:
```xml
<string name="app_name">My ISP Billing</string>
```

### Change the app icon
Replace the icon files in each of the `android/app/src/main/res/mipmap-*` directories (`mipmap-mdpi`, `mipmap-hdpi`, `mipmap-xhdpi`, `mipmap-xxhdpi`, `mipmap-xxxhdpi`).

Easiest way: in Android Studio, right-click `res` → **New → Image Asset**, pick your logo, and it generates all sizes automatically.

### Change the app ID (package name)
Update `appId` in `capacitor.config.ts`:
```ts
appId: 'com.yourisp.customer',
```
Then re-sync and rebuild:
```bash
npx cap sync android
```
> Note: changing the app ID makes Android treat it as a **different app** — existing installs won't update to it.

### Change splash screen colors
Update the `SplashScreen` section in `capacitor.config.ts`:
```ts
plugins: {
  SplashScreen: {
    launchAutoHide: false,
    backgroundColor: '#1e293b',   // splash background
    showSpinner: true,
    spinnerColor: '#3b82f6'       // loading spinner color
  }
}
```
Then run `npx cap sync android` and rebuild.

---

## 5. Distribution to Customers

### Option A: Sideload (recommended for ISPs)

1. Upload `app-release.apk` to a download page (e.g., a link on your landing page) or share it directly via **Telegram / WhatsApp / Messenger**.
2. The customer opens the APK on their phone and installs it. Android may prompt them to enable **"Install from unknown sources"** (Settings → Apps → Special access → Install unknown apps → allow for their browser/Telegram).
3. On first launch, the customer enters **your billing URL** (the Cloudflare tunnel domain you provide, e.g., `https://billing.myisp.com`). The app saves it and connects.

### Option B: Google Play Store (future)

- Requires a **Google Play developer account** — $25 one-time fee: https://play.google.com/console
- Requires a **privacy policy URL** (a simple page on your website is enough).
- Play Store requires an **AAB** (Android App Bundle) instead of an APK:

  **Windows (PowerShell):**
  ```powershell
  cd android
  .\gradlew bundleRelease
  ```
  **Linux/Mac:**
  ```bash
  cd android
  ./gradlew bundleRelease
  ```
  Output: `android/app/build/outputs/bundle/release/app-release.aab`

---

## 6. How It Works (For Operators)

- The APK is a **universal wrapper** — **one APK works for ALL operators**. You do not build a separate app per ISP.
- Each operator simply gives their customers their **unique Cloudflare tunnel URL** (e.g., `billing.myisp.com`).
- The customer enters that URL **once** on first launch; the app remembers it on future launches.
- The app then loads your **existing web panel** (client portal, store, payments) through the tunnel — **no separate mobile backend** is needed.
- Because the content is loaded remotely, **any update you make to the web panel appears instantly in the app** — no APK rebuild, no customer re-download.

You only need to rebuild the APK when the *wrapper itself* changes (see section 8).

---

## 7. Troubleshooting

| Problem | Fix |
|---|---|
| **"Connection failed" on the setup screen** | Check the Cloudflare tunnel is running, the domain is typed correctly, and the URL includes `https://`. |
| **Blank screen after connecting** | Make sure the backend is running on **port 3001** on the server (`pm2 status`). |
| **Payment page doesn't load** | This is expected behavior: payment gateways (PayMongo, etc.) open in the **external browser** and return to the app when finished. |
| **App crashes on launch** | The device must run **Android 7.0 or newer** (API 24 minimum). |
| **"App not installed" error** | Enable **"Install from unknown sources"** in the device settings. If updating, the new APK must be signed with the **same keystore** as the installed one — otherwise uninstall first. |
| **CORS errors in backend logs** | Verify the `cors` package is installed in the `proxy/` folder (`cd proxy; npm install cors`) and that the server was **restarted** afterwards (`pm2 restart all`). |

---

## 8. Updating the APK

| What changed | Do you need to rebuild the APK? |
|---|---|
| Files in `mobile-app/` (setup page) | ✅ Yes — run `npx cap sync android`, then rebuild (section 2 or 3) |
| `capacitor.config.ts` (app ID, splash, plugins) | ✅ Yes — run `npx cap sync android`, then rebuild |
| Web panel changes (ClientPortal, Store, payments, etc.) | ❌ **No** — the panel loads remotely; customers see changes instantly |

Rebuild command reminder:

```bash
npx cap sync android
cd android
./gradlew assembleRelease   # or assembleDebug / use .\gradlew on Windows
```

Distribute the new APK the same way as before (section 5). Customers installing over an existing version keep their saved domain.
