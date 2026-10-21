package com.milonfinance.app;

import android.Manifest;
import android.app.Activity;
import android.content.ActivityNotFoundException;
import android.content.ContentResolver;
import android.content.Intent;
import android.net.Uri;
import android.provider.MediaStore;
import androidx.activity.result.ActivityResult;
import androidx.core.content.FileProvider;
import com.capacitorjs.plugins.browser.Browser;
import com.capacitorjs.plugins.browser.BrowserControllerActivity;
import com.capacitorjs.plugins.browser.BrowserPlugin;
import com.getcapacitor.PermissionState;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.ActivityCallback;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;
import java.io.File;
import java.io.FileInputStream;
import java.io.InputStream;

/**
 * Opens external and OAuth navigations in Chrome Custom Tabs via the
 * Capacitor Browser plugin's controller, and closes that tab when an
 * App Link returns to Milōn. Also photographs a receipt or opens the
 * system document picker. The bytes go back to the page. Nothing is logged.
 */
@CapacitorPlugin(
    name = "MilonShell",
    permissions = { @Permission(strings = { Manifest.permission.CAMERA }, alias = "camera") }
)
public class MilonShellPlugin extends Plugin {

    private static final int TOOLBAR = 0xFFFFFFFF;

    private Browser browser;
    private BrowserControllerActivity controller;
    private boolean customTabOpen = false;
    private String lastUrl = "";
    private long lastOpenAt = 0L;
    private File pendingPhoto;

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

    @PluginMethod
    public void takePhoto(PluginCall call) {
        if (getActivity() == null) {
            call.reject("Camera is not available");
            return;
        }
        if (getPermissionState("camera") != PermissionState.GRANTED) {
            requestPermissionForAlias("camera", call, "cameraPermissionCallback");
            return;
        }
        launchCamera(call);
    }

    @PermissionCallback
    private void cameraPermissionCallback(PluginCall call) {
        if (getPermissionState("camera") == PermissionState.GRANTED) {
            launchCamera(call);
            return;
        }
        call.reject("Camera permission was denied");
    }

    @PluginMethod
    public void pickDocument(PluginCall call) {
        if (getActivity() == null) {
            call.reject("Document picker is not available");
            return;
        }
        Intent intent = new Intent(Intent.ACTION_OPEN_DOCUMENT);
        intent.addCategory(Intent.CATEGORY_OPENABLE);
        intent.setType("*/*");
        intent.putExtra(Intent.EXTRA_MIME_TYPES, MilonPickedFile.DOCUMENT_MIME_TYPES);
        intent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
        try {
            startActivityForResult(call, intent, "documentResult");
        } catch (ActivityNotFoundException ex) {
            call.reject("Document picker is not available");
        }
    }

    private void launchCamera(PluginCall call) {
        File dir = getContext().getCacheDir();
        File photo = new File(dir, "milon-receipt-" + System.currentTimeMillis() + ".jpg");
        Uri uri = FileProvider.getUriForFile(getContext(), getContext().getPackageName() + ".fileprovider", photo);
        Intent intent = new Intent(MediaStore.ACTION_IMAGE_CAPTURE);
        intent.putExtra(MediaStore.EXTRA_OUTPUT, uri);
        intent.addFlags(Intent.FLAG_GRANT_WRITE_URI_PERMISSION | Intent.FLAG_GRANT_READ_URI_PERMISSION);
        pendingPhoto = photo;
        try {
            startActivityForResult(call, intent, "cameraResult");
        } catch (ActivityNotFoundException ex) {
            pendingPhoto = null;
            call.reject("Camera is not available");
        }
    }

    @ActivityCallback
    private void cameraResult(PluginCall call, ActivityResult result) {
        File photo = pendingPhoto;
        pendingPhoto = null;
        if (call == null) return;
        if (result.getResultCode() != Activity.RESULT_OK || photo == null || !photo.isFile()) {
            if (photo != null) photo.delete();
            call.resolve(MilonPickedFile.cancelled());
            return;
        }
        try (FileInputStream in = new FileInputStream(photo)) {
            byte[] bytes = MilonPickedFile.readCapped(in);
            call.resolve(MilonPickedFile.fromBytes(photo.getName(), "image/jpeg", bytes));
        } catch (java.io.IOException ex) {
            call.resolve(MilonPickedFile.error(readError(ex)));
        } finally {
            photo.delete();
        }
    }

    @ActivityCallback
    private void documentResult(PluginCall call, ActivityResult result) {
        if (call == null) return;
        if (result.getResultCode() != Activity.RESULT_OK || result.getData() == null) {
            call.resolve(MilonPickedFile.cancelled());
            return;
        }
        Uri uri = result.getData().getData();
        if (uri == null) {
            call.resolve(MilonPickedFile.cancelled());
            return;
        }
        ContentResolver resolver = getContext().getContentResolver();
        String name = MilonPickedFile.displayName(resolver, uri);
        String mime = resolver.getType(uri);
        try (InputStream in = resolver.openInputStream(uri)) {
            if (in == null) {
                call.resolve(MilonPickedFile.error("The file could not be opened."));
                return;
            }
            byte[] bytes = MilonPickedFile.readCapped(in);
            call.resolve(MilonPickedFile.fromBytes(name, mime == null ? "" : mime, bytes));
        } catch (java.io.IOException ex) {
            call.resolve(MilonPickedFile.error(readError(ex)));
        }
    }

    private static String readError(java.io.IOException ex) {
        if ("file too large".equals(ex.getMessage())) return "This file is over 20 MB.";
        return "The file could not be opened.";
    }
}
