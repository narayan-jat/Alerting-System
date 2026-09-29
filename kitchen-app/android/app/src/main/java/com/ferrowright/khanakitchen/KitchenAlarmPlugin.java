package com.ferrowright.khanakitchen;

import android.app.NotificationManager;
import android.content.ActivityNotFoundException;
import android.content.Context;
import android.content.Intent;
import android.net.Uri;
import android.os.Build;
import android.os.PowerManager;
import android.provider.Settings;
import android.speech.tts.TextToSpeech;

import androidx.core.app.NotificationManagerCompat;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.google.firebase.messaging.FirebaseMessaging;

import java.util.Locale;

/** Bridge used by kitchen.js when it runs inside the Android app. */
@CapacitorPlugin(name = "KitchenAlarm")
public class KitchenAlarmPlugin extends Plugin {
    private TextToSpeech tts;
    private boolean ttsReady = false;

    @Override
    public void load() {
        tts = new TextToSpeech(getContext(), status -> {
            if (status != TextToSpeech.SUCCESS) return;
            tts.setLanguage(new Locale("hi", "IN"));
            ttsReady = true;
        });
    }

    @Override
    protected void handleOnDestroy() {
        if (tts != null) tts.shutdown();
    }

    @PluginMethod
    public void getToken(PluginCall call) {
        FirebaseMessaging.getInstance().getToken().addOnCompleteListener(task -> {
            if (!task.isSuccessful()) {
                call.reject("Could not get FCM token");
                return;
            }
            JSObject out = new JSObject();
            out.put("token", task.getResult());
            call.resolve(out);
        });
    }

    /** Lets the background message service report this phone as alive without the page open. */
    @PluginMethod
    public void setIdentity(PluginCall call) {
        getContext().getSharedPreferences(KitchenMessagingService.PREFS, Context.MODE_PRIVATE).edit()
                .putString("pg", call.getString("pg"))
                .putString("phoneId", call.getString("phoneId"))
                .apply();
        call.resolve();
    }

    /** Items this phone acknowledged from the notification buttons; the page merges them into its own list. */
    @PluginMethod
    public void getAcks(PluginCall call) {
        java.util.Set<String> acks = getContext().getSharedPreferences(KitchenMessagingService.PREFS, Context.MODE_PRIVATE)
                .getStringSet("acks", new java.util.HashSet<>());
        JSObject out = new JSObject();
        out.put("acks", new com.getcapacitor.JSArray(acks));
        call.resolve(out);
    }

    @PluginMethod
    public void speak(PluginCall call) {
        String text = call.getString("text", "");
        if (ttsReady && !text.trim().isEmpty()) tts.speak(text, TextToSpeech.QUEUE_FLUSH, null, "khana");
        call.resolve();
    }

    @PluginMethod
    public void stopSpeaking(PluginCall call) {
        if (tts != null) tts.stop();
        call.resolve();
    }

    @PluginMethod
    public void isSpeaking(PluginCall call) {
        JSObject out = new JSObject();
        out.put("speaking", tts != null && tts.isSpeaking());
        call.resolve(out);
    }

    @PluginMethod
    public void stopAll(PluginCall call) {
        AlarmNotifier.cancelAll(getContext());
        call.resolve();
    }

    @PluginMethod
    public void status(PluginCall call) {
        Context ctx = getContext();
        PowerManager pm = (PowerManager) ctx.getSystemService(Context.POWER_SERVICE);
        NotificationManager nm = ctx.getSystemService(NotificationManager.class);
        JSObject out = new JSObject();
        out.put("notifications", NotificationManagerCompat.from(ctx).areNotificationsEnabled());
        out.put("battery", pm != null && pm.isIgnoringBatteryOptimizations(ctx.getPackageName()));
        out.put("fullScreen", Build.VERSION.SDK_INT < 34 || nm.canUseFullScreenIntent());
        call.resolve(out);
    }

    @PluginMethod
    public void openBatterySettings(PluginCall call) {
        Uri pkg = Uri.parse("package:" + getContext().getPackageName());
        if (!open(new Intent(Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS, pkg))) {
            open(new Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, pkg));
        }
        call.resolve();
    }

    @PluginMethod
    public void openFullScreenSettings(PluginCall call) {
        Uri pkg = Uri.parse("package:" + getContext().getPackageName());
        if (Build.VERSION.SDK_INT < 34 || !open(new Intent(Settings.ACTION_MANAGE_APP_USE_FULL_SCREEN_INTENT, pkg))) {
            open(new Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, pkg));
        }
        call.resolve();
    }

    @PluginMethod
    public void openAppSettings(PluginCall call) {
        open(new Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, Uri.parse("package:" + getContext().getPackageName())));
        call.resolve();
    }

    private boolean open(Intent intent) {
        try {
            intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            getContext().startActivity(intent);
            return true;
        } catch (ActivityNotFoundException | SecurityException e) {
            return false;
        }
    }
}
