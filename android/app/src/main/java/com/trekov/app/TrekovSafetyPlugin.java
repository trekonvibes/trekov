package com.trekov.app;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.WallpaperManager;
import android.content.Context;
import android.content.Intent;
import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import android.net.Uri;
import android.os.Build;
import android.util.Base64;

import androidx.core.app.NotificationCompat;
import androidx.core.app.NotificationManagerCompat;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/**
 * The rider's ID on the lock screen (Punit, 2026-09-27).
 *
 * If a rider comes off the bike, whoever reaches them has their phone and
 * nothing else. No app may draw on Android's lock screen, so the details go
 * there the two ways Android does allow:
 *
 *   - an ongoing notification whose channel and message are PUBLIC, so the
 *     whole text is readable without unlocking, with a one-tap dial of the
 *     emergency contact;
 *   - the lock screen wallpaper, which the rider can set to a card the app
 *     draws. That one survives a phone set to hide notifications when locked.
 *     The home screen wallpaper is never touched, and clearing it puts the
 *     phone's own lock wallpaper back.
 *
 * Both are shown only while a ride is on; Navigate closes them when it ends.
 */
@CapacitorPlugin(name = "TrekovSafety")
public class TrekovSafetyPlugin extends Plugin {

    private static final String CHANNEL = "rider_id";
    private static final int NOTIFICATION_ID = 7341;

    /** show({ title, lines[], phone, callLabel }) -> { shown, reason } */
    @PluginMethod
    public void show(PluginCall call) {
        Context ctx = getContext();
        String title = call.getString("title", "");
        String text = call.getString("text", "");
        String phone = call.getString("phone", "");
        String callLabel = call.getString("callLabel", "Call");

        NotificationManagerCompat manager = NotificationManagerCompat.from(ctx);
        // The rider turned notifications off for Trekov: say so rather than
        // letting them believe their details are on the lock screen.
        if (!manager.areNotificationsEnabled()) {
            JSObject o = new JSObject();
            o.put("shown", false);
            o.put("reason", "notifications-off");
            call.resolve(o);
            return;
        }

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            NotificationChannel channel = new NotificationChannel(
                    CHANNEL, "Rider ID", NotificationManager.IMPORTANCE_LOW);
            channel.setDescription("Your emergency details while you are riding.");
            // The point of the whole feature: readable on a locked phone.
            channel.setLockscreenVisibility(Notification.VISIBILITY_PUBLIC);
            channel.setShowBadge(false);
            channel.enableVibration(false);
            channel.setSound(null, null);
            ctx.getSystemService(NotificationManager.class).createNotificationChannel(channel);
        }

        NotificationCompat.Builder b = new NotificationCompat.Builder(ctx, CHANNEL)
                .setSmallIcon(R.drawable.ic_rider_id)
                .setContentTitle(title)
                .setContentText(text)
                .setStyle(new NotificationCompat.BigTextStyle().bigText(text))
                .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
                .setCategory(NotificationCompat.CATEGORY_STATUS)
                .setPriority(NotificationCompat.PRIORITY_LOW)
                .setOngoing(true)
                .setShowWhen(false)
                .setAutoCancel(false)
                // Opening Trekov from it is the least surprising tap target.
                .setContentIntent(activityIntent(ctx));

        if (!phone.isEmpty()) {
            Intent dial = new Intent(Intent.ACTION_DIAL, Uri.parse("tel:" + phone));
            dial.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            PendingIntent pending = PendingIntent.getActivity(ctx, 1, dial,
                    PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
            // The dialer opens with the number filled in; the phone asks for the
            // lock code before it will place the call, which is Android's call.
            b.addAction(android.R.drawable.ic_menu_call, callLabel, pending);
        }

        try {
            manager.notify(NOTIFICATION_ID, b.build());
        } catch (SecurityException e) {           // POST_NOTIFICATIONS refused
            JSObject o = new JSObject();
            o.put("shown", false);
            o.put("reason", "notifications-off");
            call.resolve(o);
            return;
        }
        JSObject o = new JSObject();
        o.put("shown", true);
        call.resolve(o);
    }

    @PluginMethod
    public void hide(PluginCall call) {
        NotificationManagerCompat.from(getContext()).cancel(NOTIFICATION_ID);
        call.resolve();
    }

    /** setLockWallpaper({ png: base64 }) — the lock screen only. */
    @PluginMethod
    public void setLockWallpaper(PluginCall call) {
        String png = call.getString("png", "");
        if (png.isEmpty()) {
            call.reject("no-image");
            return;
        }
        try {
            byte[] bytes = Base64.decode(png.substring(png.indexOf(',') + 1), Base64.DEFAULT);
            Bitmap bitmap = BitmapFactory.decodeByteArray(bytes, 0, bytes.length);
            if (bitmap == null) {
                call.reject("bad-image");
                return;
            }
            WallpaperManager wm = WallpaperManager.getInstance(getContext());
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.N) {
                wm.setBitmap(bitmap, null, true, WallpaperManager.FLAG_LOCK);
            } else {
                // Before Android 7 there is one wallpaper for both screens, so
                // there is nothing safe to set. The card stays in the app.
                call.reject("no-lock-wallpaper");
                return;
            }
            call.resolve();
        } catch (Exception e) {
            call.reject(e.getMessage() == null ? "failed" : e.getMessage());
        }
    }

    @PluginMethod
    public void clearLockWallpaper(PluginCall call) {
        try {
            WallpaperManager wm = WallpaperManager.getInstance(getContext());
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.N) wm.clear(WallpaperManager.FLAG_LOCK);
            call.resolve();
        } catch (Exception e) {
            call.reject(e.getMessage() == null ? "failed" : e.getMessage());
        }
    }

    private PendingIntent activityIntent(Context ctx) {
        Intent open = new Intent(ctx, MainActivity.class);
        open.addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP);
        return PendingIntent.getActivity(ctx, 0, open,
                PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
    }
}
