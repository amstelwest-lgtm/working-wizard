package com.milonfinance.app;

import android.app.Application;
import android.content.Context;
import java.util.List;

/**
 * Starts Firebase only when the google-services plugin has generated an app id.
 * Without google-services.json that resource is absent, the init provider is
 * removed, and push stays off. The json is never committed.
 */
public class MilonApplication extends Application {

    @Override
    public void onCreate() {
        super.onCreate();
        firebaseReady(this);
    }

    static boolean firebaseReady(Context context) {
        if (context == null) return false;
        int id = context.getResources().getIdentifier("google_app_id", "string", context.getPackageName());
        if (id == 0) return false;
        try {
            Class<?> firebase = Class.forName("com.google.firebase.FirebaseApp");
            Object apps = firebase.getMethod("getApps", Context.class).invoke(null, context);
            if (apps instanceof List && ((List<?>) apps).isEmpty()) {
                firebase.getMethod("initializeApp", Context.class).invoke(null, context);
            }
            return true;
        } catch (Throwable ignored) {
            return false;
        }
    }
}
