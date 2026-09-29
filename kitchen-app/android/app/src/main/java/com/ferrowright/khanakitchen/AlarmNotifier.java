package com.ferrowright.khanakitchen;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.media.AudioAttributes;
import android.media.AudioManager;
import android.net.Uri;
import android.os.Build;

import androidx.core.app.NotificationCompat;
import androidx.core.app.NotificationManagerCompat;

/** Alarm-style notification: plays on the alarm stream and loops until handled, with action buttons. */
final class AlarmNotifier {
    // Android never lets an app change a channel's sound or vibration after creation; bump the id to change them.
    static final String CHANNEL_ID = "kitchen_alarm_v2";
    private static final String PENDING_CHANNEL_ID = "kitchen_pending_v1";
    private static final String[] OLD_CHANNELS = {"kitchen_alarm_v1"};
    private static final int ALARM_ID = 1;
    private static final int PENDING_ID = 2;
    private static final long RING_LIMIT_MS = 15 * 60 * 1000L;
    private static final long PENDING_LIMIT_MS = 30 * 60 * 1000L;
    // FLAG_INSISTENT loops this pattern together with the sound until the alert is handled.
    private static final long[] VIBRATION = {0, 1000, 400, 1000, 400, 1000, 800};

    private AlarmNotifier() {}

    private static Uri soundUri(Context ctx) {
        return Uri.parse("android.resource://" + ctx.getPackageName() + "/" + R.raw.alarm);
    }

    static void ensureChannel(Context ctx) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return;
        NotificationManager nm = ctx.getSystemService(NotificationManager.class);
        for (String old : OLD_CHANNELS) nm.deleteNotificationChannel(old);

        if (nm.getNotificationChannel(CHANNEL_ID) == null) {
            NotificationChannel channel = new NotificationChannel(CHANNEL_ID, "Khana khatam alarm", NotificationManager.IMPORTANCE_HIGH);
            channel.setDescription("Jab resident koi item khatam report kare");
            AudioAttributes attrs = new AudioAttributes.Builder()
                    .setUsage(AudioAttributes.USAGE_ALARM)
                    .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION)
                    .build();
            channel.setSound(soundUri(ctx), attrs);
            channel.enableVibration(true);
            channel.setVibrationPattern(VIBRATION);
            channel.setLockscreenVisibility(Notification.VISIBILITY_PUBLIC);
            channel.setBypassDnd(true);
            nm.createNotificationChannel(channel);
        }
        if (nm.getNotificationChannel(PENDING_CHANNEL_ID) == null) {
            NotificationChannel quiet = new NotificationChannel(PENDING_CHANNEL_ID, "Le ja rahe ho (reminder)", NotificationManager.IMPORTANCE_DEFAULT);
            quiet.setDescription("'Aa raha hoon' ke baad 'Ho gaya' dabane ki yaad");
            quiet.setSound(null, null);
            quiet.enableVibration(false);
            quiet.setLockscreenVisibility(Notification.VISIBILITY_PUBLIC);
            nm.createNotificationChannel(quiet);
        }
    }

    private static PendingIntent openApp(Context ctx, String tag) {
        Intent open = new Intent(ctx, MainActivity.class)
                .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_SINGLE_TOP);
        return PendingIntent.getActivity(ctx, tag.hashCode(), open,
                PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
    }

    private static PendingIntent button(Context ctx, String action, String pg, String tag, String name) {
        Intent i = new Intent(ctx, AlarmActionReceiver.class)
                .setAction(action)
                .putExtra(AlarmActionReceiver.EXTRA_PG, pg)
                .putExtra(AlarmActionReceiver.EXTRA_TAG, tag)
                .putExtra(AlarmActionReceiver.EXTRA_NAME, name);
        return PendingIntent.getBroadcast(ctx, (action + tag).hashCode(), i,
                PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
    }

    static void show(Context ctx, String pg, String tag, String name, String title, String body) {
        ensureChannel(ctx);
        PendingIntent open = openApp(ctx, tag);
        NotificationCompat.Builder b = new NotificationCompat.Builder(ctx, CHANNEL_ID)
                .setSmallIcon(android.R.drawable.ic_lock_idle_alarm)
                .setContentTitle(title)
                .setContentText(body)
                .setPriority(NotificationCompat.PRIORITY_MAX)
                .setCategory(NotificationCompat.CATEGORY_ALARM)
                .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
                .setContentIntent(open)
                .setFullScreenIntent(open, true)
                .setAutoCancel(true)
                .setSound(soundUri(ctx), AudioManager.STREAM_ALARM)
                .setVibrate(VIBRATION)
                .setTimeoutAfter(RING_LIMIT_MS);
        if (pg != null) {
            b.addAction(0, "🏃 Aa raha hoon", button(ctx, AlarmActionReceiver.ACTION_COMING, pg, tag, name));
            b.addAction(0, "✅ Ho gaya", button(ctx, AlarmActionReceiver.ACTION_DONE, pg, tag, name));
        }
        Notification n = b.build();
        n.flags |= Notification.FLAG_INSISTENT;
        post(ctx, tag, ALARM_ID, n);
    }

    /** Quiet follow-up after "Aa raha hoon", so the person bringing it can close it with one tap. */
    static void showPending(Context ctx, String pg, String tag, String name) {
        ensureChannel(ctx);
        String item = name == null ? "Item" : name;
        Notification n = new NotificationCompat.Builder(ctx, PENDING_CHANNEL_ID)
                .setSmallIcon(android.R.drawable.ic_menu_send)
                .setContentTitle("🏃 " + item + " le ja rahe ho")
                .setContentText("Buffet par rakh ke 'Ho gaya' dabao")
                .setContentIntent(openApp(ctx, tag))
                .setOnlyAlertOnce(true)
                .setAutoCancel(true)
                .setTimeoutAfter(PENDING_LIMIT_MS)
                .addAction(0, "✅ Ho gaya", button(ctx, AlarmActionReceiver.ACTION_DONE, pg, tag, name))
                .build();
        post(ctx, tag, PENDING_ID, n);
    }

    private static void post(Context ctx, String tag, int id, Notification n) {
        try {
            NotificationManagerCompat.from(ctx).notify(tag, id, n);
        } catch (SecurityException ignored) {
            // Notification permission not granted; the in-app setup card asks for it.
        }
    }

    static void cancel(Context ctx, String tag) {
        NotificationManagerCompat.from(ctx).cancel(tag, ALARM_ID);
    }

    static void cancelPending(Context ctx, String tag) {
        NotificationManagerCompat.from(ctx).cancel(tag, PENDING_ID);
    }

    static void cancelAll(Context ctx) {
        NotificationManagerCompat.from(ctx).cancelAll();
    }
}
