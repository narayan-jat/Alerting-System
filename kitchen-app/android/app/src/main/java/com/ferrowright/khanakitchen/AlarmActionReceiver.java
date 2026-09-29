package com.ferrowright.khanakitchen;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;

import org.json.JSONObject;

import java.util.HashSet;
import java.util.Set;

/** Handles the "Aa raha hoon" / "Ho gaya" buttons on the alarm notification without opening the app. */
public class AlarmActionReceiver extends BroadcastReceiver {
    static final String ACTION_COMING = "com.ferrowright.khanakitchen.COMING";
    static final String ACTION_DONE = "com.ferrowright.khanakitchen.DONE";
    static final String EXTRA_PG = "pg";
    static final String EXTRA_TAG = "tag";
    static final String EXTRA_NAME = "name";

    @Override
    public void onReceive(Context context, Intent intent) {
        String pg = intent.getStringExtra(EXTRA_PG);
        String tag = intent.getStringExtra(EXTRA_TAG);
        String name = intent.getStringExtra(EXTRA_NAME);
        if (pg == null || tag == null) return;
        boolean coming = ACTION_COMING.equals(intent.getAction());

        // Stop the ringing on this phone right away; the server then stops the other phones.
        AlarmNotifier.cancel(context, tag);
        AlarmNotifier.cancelPending(context, tag);
        rememberAck(context, tag, coming);

        PendingResult pending = goAsync();
        new Thread(() -> {
            try {
                JSONObject fields = new JSONObject().put("status", coming ? "coming" : "done");
                int code = FirestoreRest.update("pgs/" + pg + "/alerts/" + tag, fields, coming ? "comingAt" : "doneAt");
                // 403 = someone else already took it; nothing left for this phone to do.
                if (coming && code == 200) AlarmNotifier.showPending(context, pg, tag, name);
                if (code == -1) AlarmNotifier.show(context, pg, tag, name, "⚠️ Net nahi hai", "Update nahi hua, dobara try karo");
            } catch (Exception ignored) {
                // Unreachable in practice: JSONObject.put only throws for non-finite numbers.
            } finally {
                pending.finish();
            }
        }).start();
    }

    /** The kitchen page reads these (getAcks) so it keeps showing the card to the person bringing it. */
    private static void rememberAck(Context ctx, String tag, boolean coming) {
        SharedPreferences prefs = ctx.getSharedPreferences(KitchenMessagingService.PREFS, Context.MODE_PRIVATE);
        Set<String> acks = new HashSet<>(prefs.getStringSet("acks", new HashSet<>()));
        if (coming) acks.add(tag);
        else acks.remove(tag);
        prefs.edit().putStringSet("acks", acks).apply();
    }
}
