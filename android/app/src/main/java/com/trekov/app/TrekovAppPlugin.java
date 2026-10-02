package com.trekov.app;

import android.content.Context;
import android.os.Build;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/**
 * Facts about this installation the web code can't see for itself.
 *
 * An app installed from Google Play may only be updated through Play, so the
 * "new version — download" notice for the website's APK must not appear there
 * (launch audit, 2026-09-14).
 */
@CapacitorPlugin(name = "TrekovApp")
public class TrekovAppPlugin extends Plugin {

    @PluginMethod
    public void installSource(PluginCall call) {
        String installer = null;
        try {
            Context c = getContext();
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
                installer = c.getPackageManager().getInstallSourceInfo(c.getPackageName()).getInstallingPackageName();
            } else {
                installer = c.getPackageManager().getInstallerPackageName(c.getPackageName());
            }
        } catch (Exception ignored) { }
        JSObject o = new JSObject();
        o.put("installer", installer == null ? "" : installer);
        o.put("play", "com.android.vending".equals(installer));
        call.resolve(o);
    }
}
