package com.mikrotikbilling.admin;

import android.Manifest;
import android.app.Activity;
import android.app.PendingIntent;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.IntentFilter;
import android.content.SharedPreferences;
import android.net.Uri;
import android.os.Build;
import android.os.Handler;
import android.os.Looper;
import android.telephony.SmsManager;
import android.view.WindowManager;
import android.webkit.WebView;

import com.getcapacitor.JSObject;
import com.getcapacitor.PermissionState;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;

import java.util.ArrayList;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.concurrent.atomic.AtomicInteger;

/**
 * Native SMS sender for the admin APK.
 *
 * Exposed to the WebView as `Capacitor.Plugins.NativeSms`. Only pages served
 * from the operator's saved tunnel domain (Preferences key "tunnel_domain",
 * written by the bundled setup page) may trigger an SMS — any other origin is
 * rejected before touching SmsManager.
 */
@CapacitorPlugin(
    name = "NativeSms",
    permissions = {
        @Permission(strings = { Manifest.permission.SEND_SMS }, alias = SmsPlugin.SMS_ALIAS)
    }
)
public class SmsPlugin extends Plugin {

    static final String SMS_ALIAS = "send_sms";

    /** SharedPreferences file used by @capacitor/preferences (default group). */
    private static final String CAPACITOR_STORAGE = "CapacitorStorage";
    /** Key the setup page saves the tunnel domain under (see setup.js DOMAIN_KEY). */
    private static final String DOMAIN_KEY = "tunnel_domain";

    private static final long SEND_TIMEOUT_MS = 30_000L;

    /** Unique PendingIntent request codes / broadcast actions across sends. */
    private static final AtomicInteger SEND_SEQUENCE = new AtomicInteger(1);

    private final Handler mainHandler = new Handler(Looper.getMainLooper());

    /* ------------------------------------------------------------ permissions */

    @PluginMethod
    public void checkPermission(PluginCall call) {
        JSObject result = new JSObject();
        result.put("granted", getPermissionState(SMS_ALIAS) == PermissionState.GRANTED);
        call.resolve(result);
    }

    @PluginMethod
    public void requestPermission(PluginCall call) {
        if (getPermissionState(SMS_ALIAS) == PermissionState.GRANTED) {
            JSObject result = new JSObject();
            result.put("granted", true);
            call.resolve(result);
            return;
        }
        requestPermissionForAlias(SMS_ALIAS, call, "smsPermissionCallback");
    }

    @PermissionCallback
    private void smsPermissionCallback(PluginCall call) {
        JSObject result = new JSObject();
        result.put("granted", getPermissionState(SMS_ALIAS) == PermissionState.GRANTED);
        call.resolve(result);
    }

    /* ------------------------------------------------------------------- send */

    @PluginMethod
    public void send(PluginCall call) {
        String phone = call.getString("phone");
        String message = call.getString("message");

        if (phone == null || phone.trim().isEmpty()) {
            call.reject("Missing 'phone'");
            return;
        }
        if (message == null || message.trim().isEmpty()) {
            call.reject("Missing 'message'");
            return;
        }
        if (getPermissionState(SMS_ALIAS) != PermissionState.GRANTED) {
            call.reject("SEND_SMS permission not granted");
            return;
        }

        // WebView.getUrl() must run on the UI thread.
        final String trimmedPhone = phone.trim();
        mainHandler.post(() -> {
            WebView webView = bridge.getWebView();
            String currentUrl = webView != null ? webView.getUrl() : null;

            if (!isTrustedOrigin(currentUrl)) {
                call.reject("SMS blocked: page origin does not match the saved server domain");
                return;
            }
            dispatchSms(call, trimmedPhone, message);
        });
    }

    /**
     * Security guard: the calling page's host must match the tunnel domain the
     * operator saved during setup. The bundled setup page itself (Capacitor's
     * local https://localhost origin) is intentionally NOT trusted.
     */
    private boolean isTrustedOrigin(String currentUrl) {
        if (currentUrl == null) return false;

        SharedPreferences prefs = getContext()
            .getSharedPreferences(CAPACITOR_STORAGE, Context.MODE_PRIVATE);
        String savedDomain = prefs.getString(DOMAIN_KEY, null);
        if (savedDomain == null || savedDomain.isEmpty()) return false;

        // @capacitor/preferences may persist values JSON-encoded (wrapped in
        // double quotes) — strip them defensively before parsing.
        if (savedDomain.length() >= 2 && savedDomain.startsWith("\"") && savedDomain.endsWith("\"")) {
            savedDomain = savedDomain.substring(1, savedDomain.length() - 1);
        }
        if (savedDomain.isEmpty()) return false;

        try {
            Uri current = Uri.parse(currentUrl);
            Uri saved = Uri.parse(savedDomain);

            String currentHost = current.getHost();
            String savedHost = saved.getHost();
            if (currentHost == null || savedHost == null || !currentHost.equalsIgnoreCase(savedHost)) {
                return false;
            }

            String currentScheme = current.getScheme();
            String savedScheme = saved.getScheme();
            if (currentScheme == null || savedScheme == null || !currentScheme.equalsIgnoreCase(savedScheme)) {
                return false;
            }

            // Uri.getPort() returns -1 when no explicit port (scheme default);
            // ports must be equal, or both unspecified (-1 == -1).
            return current.getPort() == saved.getPort();
        } catch (Exception e) {
            return false;
        }
    }

    private void dispatchSms(PluginCall call, String phone, String message) {
        final Context context = getContext();
        final int sendId = SEND_SEQUENCE.getAndIncrement();
        final String sentAction = "com.mikrotikbilling.admin.SMS_SENT_" + sendId;

        SmsManager smsManager;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            smsManager = context.getSystemService(SmsManager.class);
        } else {
            smsManager = SmsManager.getDefault();
        }
        if (smsManager == null) {
            call.reject("SMS service unavailable on this device");
            return;
        }

        ArrayList<String> parts = smsManager.divideMessage(message);
        final int partCount = parts.size();
        final AtomicInteger deliveredParts = new AtomicInteger(0);
        final AtomicBoolean settled = new AtomicBoolean(false);

        final BroadcastReceiver[] receiverHolder = new BroadcastReceiver[1];
        final Runnable[] timeoutHolder = new Runnable[1];

        final Runnable cleanup = () -> {
            if (receiverHolder[0] != null) {
                try {
                    context.unregisterReceiver(receiverHolder[0]);
                } catch (IllegalArgumentException ignored) {
                    // Already unregistered.
                }
                receiverHolder[0] = null;
            }
            if (timeoutHolder[0] != null) {
                mainHandler.removeCallbacks(timeoutHolder[0]);
                timeoutHolder[0] = null;
            }
        };

        receiverHolder[0] = new BroadcastReceiver() {
            @Override
            public void onReceive(Context ctx, Intent intent) {
                int resultCode = getResultCode();

                if (resultCode != Activity.RESULT_OK) {
                    if (settled.compareAndSet(false, true)) {
                        cleanup.run();
                        JSObject result = new JSObject();
                        result.put("success", false);
                        result.put("error", describeSentResult(resultCode));
                        call.resolve(result);
                    }
                    return;
                }

                // Success only once every part reports RESULT_OK.
                if (deliveredParts.incrementAndGet() >= partCount && settled.compareAndSet(false, true)) {
                    cleanup.run();
                    JSObject result = new JSObject();
                    result.put("success", true);
                    call.resolve(result);
                }
            }
        };

        IntentFilter filter = new IntentFilter(sentAction);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            context.registerReceiver(receiverHolder[0], filter, Context.RECEIVER_NOT_EXPORTED);
        } else {
            context.registerReceiver(receiverHolder[0], filter);
        }

        // Never leave the WebView hanging if the platform drops the broadcast.
        timeoutHolder[0] = () -> {
            if (settled.compareAndSet(false, true)) {
                cleanup.run();
                JSObject result = new JSObject();
                result.put("success", false);
                result.put("error", "Timed out waiting for the SMS sent confirmation");
                call.resolve(result);
            }
        };
        mainHandler.postDelayed(timeoutHolder[0], SEND_TIMEOUT_MS);

        try {
            ArrayList<PendingIntent> sentIntents = new ArrayList<>(partCount);
            int pendingIntentFlags = PendingIntent.FLAG_ONE_SHOT;
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
                pendingIntentFlags |= PendingIntent.FLAG_IMMUTABLE;
            }
            for (int i = 0; i < partCount; i++) {
                Intent sentIntent = new Intent(sentAction).setPackage(context.getPackageName());
                // Unique request code per part per send so PendingIntents never collide.
                int requestCode = sendId * 1000 + i;
                sentIntents.add(PendingIntent.getBroadcast(context, requestCode, sentIntent, pendingIntentFlags));
            }

            smsManager.sendMultipartTextMessage(phone, null, parts, sentIntents, null);
        } catch (Exception e) {
            if (settled.compareAndSet(false, true)) {
                cleanup.run();
                JSObject result = new JSObject();
                result.put("success", false);
                result.put("error", "Send failed: " + e.getMessage());
                call.resolve(result);
            }
        }
    }

    private String describeSentResult(int resultCode) {
        switch (resultCode) {
            case SmsManager.RESULT_ERROR_GENERIC_FAILURE:
                return "GENERIC_FAILURE (" + resultCode + ")";
            case SmsManager.RESULT_ERROR_NO_SERVICE:
                return "NO_SERVICE (" + resultCode + ")";
            case SmsManager.RESULT_ERROR_NULL_PDU:
                return "NULL_PDU (" + resultCode + ")";
            case SmsManager.RESULT_ERROR_RADIO_OFF:
                return "RADIO_OFF (" + resultCode + ")";
            case SmsManager.RESULT_ERROR_LIMIT_EXCEEDED:
                return "LIMIT_EXCEEDED (" + resultCode + ")";
            default:
                return "SEND_FAILED (" + resultCode + ")";
        }
    }

    /* --------------------------------------------------------- keep screen on */

    @PluginMethod
    public void setKeepScreenOn(PluginCall call) {
        final boolean enabled = Boolean.TRUE.equals(call.getBoolean("enabled", false));
        final Activity activity = getActivity();
        if (activity == null) {
            call.reject("Activity unavailable");
            return;
        }

        activity.runOnUiThread(() -> {
            if (enabled) {
                activity.getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
            } else {
                activity.getWindow().clearFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
            }
            JSObject result = new JSObject();
            result.put("success", true);
            call.resolve(result);
        });
    }
}
