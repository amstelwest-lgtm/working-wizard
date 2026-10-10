package com.milonfinance.app;

import android.content.ActivityNotFoundException;
import android.content.Intent;
import android.net.Uri;
import com.capacitorjs.plugins.browser.Browser;
import com.capacitorjs.plugins.browser.BrowserControllerActivity;
import com.capacitorjs.plugins.browser.BrowserPlugin;
import com.getcapacitor.Plugin;
import com.getcapacitor.annotation.CapacitorPlugin;

/**
 * Opens external and OAuth navigations in Chrome Custom Tabs via the
 * Capacitor Browser plugin's controller, and closes that tab when an
 * App Link returns to Milōn.
 */
@CapacitorPlugin(name = "MilonShell")
public class MilonShellPlugin extends Plugin {

    private static final int TOOLBAR = 0xFF0A0A0A;

    private Browser browser;
    private BrowserControllerActivity controller;
    private boolean customTabOpen = false;
    private String lastUrl = "";
    private long lastOpenAt = 0L;

    @Override
    public Boolean shouldOverrideLoad(Uri url) {
        if (!MilonExternalUrls.shouldOpenInCustomTab(url)) return null;
        Uri target = MilonExternalUrls.customTabTarget(url);
        String flat = target.toString();
        long now = android.os.SystemClock.uptimeMillis();
        if (flat.equals(lastUrl) && now - lastOpenAt < 1500L) {
            return true;
        }
        lastUrl = flat;
        lastOpenAt = now;
        openCustomTab(target);
        return true;
    }

    @Override
    protected void handleOnNewIntent(Intent intent) {
        super.handleOnNewIntent(intent);
        if (intent == null || !Intent.ACTION_VIEW.equals(intent.getAction())) return;
        if (!MilonExternalUrls.isAppLinkReturn(intent.getData())) return;
        closeCustomTab();
    }

    private void openCustomTab(Uri url) {
        if (getActivity() == null) return;
        if (browser == null) browser = new Browser(getContext());
        BrowserPlugin.setBrowserControllerListener(activity -> {
            try {
                activity.open(browser, url, TOOLBAR);
                controller = activity;
                customTabOpen = true;
            } catch (ActivityNotFoundException ex) {
                Intent view = new Intent(Intent.ACTION_VIEW, url);
                try {
                    getActivity().startActivity(view);
                } catch (ActivityNotFoundException ignored) {
                    /* no browser on the device */
                }
            }
        });
        Intent launch = new Intent(getActivity(), BrowserControllerActivity.class);
        launch.addFlags(Intent.FLAG_ACTIVITY_CLEAR_TOP);
        launch.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        getActivity().startActivity(launch);
    }

    /**
     * Finish the Custom Tab controller. shell.js also calls Browser.close();
     * that call is a no-op unless BrowserPlugin recorded the activity, so this
     * finish is what takes the tab down. Starting the controller again with a
     * close extra would create a second translucent activity.
     */
    private void closeCustomTab() {
        if (!customTabOpen) return;
        customTabOpen = false;
        if (controller != null && !controller.isFinishing()) {
            controller.finish();
        }
        controller = null;
    }
}
