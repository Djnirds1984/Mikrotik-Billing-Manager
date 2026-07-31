package com.mikrotikbilling.admin;

import android.content.Intent;
import android.net.Uri;
import android.os.Bundle;
import android.webkit.WebResourceRequest;
import android.webkit.WebView;

import com.getcapacitor.BridgeActivity;
import com.getcapacitor.BridgeWebViewClient;

public class MainActivity extends BridgeActivity {

    // Payment gateway checkout hosts that should open in the external browser
    // for better UX (GCash app handoff, saved cards, etc.)
    private static final String[] EXTERNAL_CHECKOUT_HOSTS = {
        "checkout.paymongo.com",
        "links.paymongo.com",
        "checkout-v2.xendit.co",
        "checkout.xendit.co",
        "api.gcash.com",
        "payments.gcash.com"
    };

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        // Custom plugins must be registered before super.onCreate() so the
        // bridge picks them up when it is built (Capacitor 7 pattern).
        registerPlugin(SmsPlugin.class);

        super.onCreate(savedInstanceState);

        // Bridge can be null if the system WebView failed to initialize
        if (this.bridge == null) {
            return;
        }

        // Subclass BridgeWebViewClient (NOT a plain WebViewClient) so Capacitor's
        // local server request interception and page-load listeners keep working.
        this.bridge.setWebViewClient(new BridgeWebViewClient(this.bridge) {
            @Override
            public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                if (openExternallyIfCheckout(request.getUrl().toString())) {
                    return true;
                }
                return super.shouldOverrideUrlLoading(view, request);
            }

            @SuppressWarnings("deprecation")
            @Override
            public boolean shouldOverrideUrlLoading(WebView view, String url) {
                if (openExternallyIfCheckout(url)) {
                    return true;
                }
                return super.shouldOverrideUrlLoading(view, url);
            }
        });
    }

    /**
     * Opens payment gateway checkout pages in the system browser.
     * Payment return URLs (e.g. ?payment=success back on the tunnel domain)
     * do not match these hosts, so they stay inside the WebView.
     *
     * @return true if the URL was handed off to an external browser
     */
    private boolean openExternallyIfCheckout(String url) {
        if (url == null) {
            return false;
        }
        for (String host : EXTERNAL_CHECKOUT_HOSTS) {
            if (url.contains(host)) {
                try {
                    Intent intent = new Intent(Intent.ACTION_VIEW, Uri.parse(url));
                    startActivity(intent);
                } catch (Exception e) {
                    // No browser available — fall back to loading in the WebView
                    return false;
                }
                return true;
            }
        }
        return false;
    }
}
