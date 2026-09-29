package com.ferrowright.khanakitchen;

import android.content.Context;
import android.content.SharedPreferences;

import androidx.annotation.NonNull;

import com.google.firebase.messaging.FirebaseMessagingService;
import com.google.firebase.messaging.RemoteMessage;

import org.json.JSONObject;

import java.util.Map;

/** Receives data messages from the Khana Cloud Functions, even when the app is closed. */
public class KitchenMessagingService extends FirebaseMessagingService {
    static final String PREFS = "khana";

    @Override
    public void onMessageReceived(@NonNull RemoteMessage message) {
        Map<String, String> data = message.getData();
        String type = data.get("type");

        if ("ping".equals(type)) {
            reportAlive(this);
            return;
        }
        String tag = data.get("tag");
        if (tag == null) return;

        if ("clear".equals(type)) {
            AlarmNotifier.cancel(this, tag);
            return;
        }
        if (!MainActivity.inForeground) {
            // When the kitchen screen is open, the page itself rings and speaks.
            AlarmNotifier.show(this, data.get("pg"), tag, data.get("name"), data.get("title"), data.get("body"));
        }
        reportAlive(this);
    }

    @Override
    public void onNewToken(@NonNull String token) {
        // The kitchen page re-saves the current token every time it starts duty.
    }

    /** Sets kitchenPhones/{phoneId}.lastSeen, so the setup page knows this phone can still be reached. */
    static void reportAlive(Context ctx) {
        SharedPreferences prefs = ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
        String pg = prefs.getString("pg", null);
        String phoneId = prefs.getString("phoneId", null);
        if (pg == null || phoneId == null) return;
        FirestoreRest.update("pgs/" + pg + "/kitchenPhones/" + phoneId, new JSONObject(), "lastSeen");
    }
}
