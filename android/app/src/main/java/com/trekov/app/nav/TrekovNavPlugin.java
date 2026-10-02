package com.trekov.app.nav;

import android.app.Activity;
import android.content.pm.ApplicationInfo;
import android.content.pm.PackageManager;
import android.content.res.Configuration;
import android.animation.ValueAnimator;
import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import android.graphics.Canvas;
import android.graphics.Color;
import android.graphics.Paint;
import android.graphics.RectF;
import android.graphics.Typeface;
import android.location.Location;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.util.Base64;
import android.view.animation.LinearInterpolator;
import android.view.View;
import android.view.ViewGroup;
import android.webkit.WebView;

import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.google.android.gms.maps.GoogleMap;
import com.google.android.gms.maps.model.CameraPosition;
import com.google.android.gms.maps.model.BitmapDescriptor;
import com.google.android.gms.maps.model.BitmapDescriptorFactory;
import com.google.android.gms.maps.model.LatLng;
import com.google.android.gms.maps.model.Marker;
import com.google.android.gms.maps.model.MarkerOptions;
import com.google.android.libraries.navigation.ArrivalEvent;
import com.google.android.libraries.navigation.NavigationApi;
import com.google.android.libraries.navigation.NavigationView;
import com.google.android.libraries.navigation.Navigator;
import com.google.android.libraries.navigation.RoadSnappedLocationProvider;
import com.google.android.libraries.navigation.RoutingOptions;
import com.google.android.libraries.navigation.SimulationOptions;
import com.google.android.libraries.navigation.TimeAndDistance;
import com.google.android.libraries.navigation.Waypoint;

import org.json.JSONObject;

import java.util.ArrayList;
import java.util.HashMap;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;

/**
 * Google's own turn-by-turn navigation inside Trekov (Punit, 2026-09-14: "the
 * app should use the real Google Maps, not the web version").
 *
 * The Navigation SDK's view is laid over the map area of the web navigation
 * screen — the rectangle the page reports — so everything else on that screen
 * stays in the web view: STOP / WAIT / LET'S GO, voice, the riders panel. The
 * page keeps the group running; this class draws the road, the route, the
 * guidance and the other riders, and reports where the rider is.
 */
@CapacitorPlugin(name = "TrekovNav")
public class TrekovNavPlugin extends Plugin {

    private NavigationView navView;
    private Navigator navigator;
    private GoogleMap map;
    private RoadSnappedLocationProvider locations;
    private boolean resumed = true;
    private boolean simulating = false;
    // Each start is a session. A ride stopped or restarted while Google was
    // still answering must not have that old answer start guidance, or touch a
    // navigator that has already been released (launch audit, 2026-09-14).
    private int session = 0;
    private boolean voice = true;
    private int mapType = GoogleMap.MAP_TYPE_NORMAL;
    private boolean traffic = true;

    /**
     * A vehicle seen from 36 directions at the navigation tilt, plus from
     * straight above (src/lib/vehicleSprites.js, scripts/vehicles/sheets.py).
     * The map shows the frame for (heading - camera bearing), so the vehicle
     * looks solid as the road bends; on a flat map it is the top view, turned.
     */
    private static final class Sheet {
        Bitmap[] frames;
        BitmapDescriptor[] descriptors;
        Bitmap top;
        BitmapDescriptor topDescriptor;
    }

    /** Each other rider: their vehicle and their name above it. */
    private static final class Rider {
        Marker vehicle;
        Marker label;
        String labelLook = "";
        String sheetKey = "";
        float heading;
    }
    private final Map<String, Rider> riders = new HashMap<>();
    /** Vehicle sheets the page has sent, by model id. */
    private final Map<String, Sheet> sheets = new HashMap<>();

    // Our own vehicle, drawn over Google's blue arrow.
    private Marker self;
    private Sheet selfSheet;
    private ValueAnimator glide;
    private LatLng selfAt;
    private float selfHeading = 0f;       // where the road points
    private boolean headingKnown = false;  // false until the phone has moved
    private float selfHeadingShown = 0f;  // where the vehicle is drawn pointing, catching up
    private float cameraBearing = 0f, cameraTilt = 0f;
    private final Handler ui = new Handler(Looper.getMainLooper());
    // Ten times a second: the camera turns and tilts on its own during
    // navigation, and every vehicle's frame follows it.
    private final Runnable camTick = new Runnable() {
        @Override
        public void run() {
            if (map == null) return;
            CameraPosition cp = map.getCameraPosition();
            cameraBearing = cp.bearing;
            cameraTilt = cp.tilt;
            // Standing still the phone has no direction, but navigation turns
            // the camera along the route: face that way rather than due north,
            // which had the vehicle sideways across the road before setting off.
            if (!headingKnown) { selfHeading = cameraBearing; if (glide == null || !glide.isRunning()) selfHeadingShown = cameraBearing; }
            if (self != null && selfSheet != null) pose(self, selfSheet, selfHeadingShown);
            for (Rider r : riders.values()) {
                Sheet sh = sheets.get(r.sheetKey);
                if (r.vehicle != null && sh != null) pose(r.vehicle, sh, r.heading);
            }
            ui.postDelayed(this, 100);
        }
    };

    private final RoadSnappedLocationProvider.LocationListener onLocation = new RoadSnappedLocationProvider.LocationListener() {
        @Override
        public void onLocationChanged(Location l) {
            JSObject o = new JSObject();
            o.put("lat", l.getLatitude());
            o.put("lng", l.getLongitude());
            o.put("accuracy", l.hasAccuracy() ? l.getAccuracy() : null);
            o.put("speed", l.hasSpeed() ? l.getSpeed() : null);
            o.put("heading", l.hasBearing() ? l.getBearing() : null);
            o.put("time", l.getTime());
            notifyListeners("location", o);
            final Location copy = new Location(l);
            ui.post(() -> moveSelf(copy));
        }
    };

    private final Navigator.RemainingTimeOrDistanceChangedListener onProgress = this::sendProgress;

    private final Navigator.ArrivalListener onArrival = new Navigator.ArrivalListener() {
        @Override
        public void onArrival(ArrivalEvent event) {
            JSObject o = new JSObject();
            o.put("final", event.isFinalDestination());
            o.put("title", event.getWaypoint() != null ? event.getWaypoint().getTitle() : "");
            notifyListeners("arrival", o);
            // A trip goes on to its next stop by itself, as the Google Maps app does.
            if (!event.isFinalDestination() && navigator != null) {
                navigator.continueToNextDestination();
                navigator.startGuidance();
            }
        }
    };

    /** Whether this build carries a Navigation SDK key. Without one the page uses its web navigation. */
    @PluginMethod
    public void isAvailable(PluginCall call) {
        JSObject o = new JSObject();
        o.put("available", !apiKey().isEmpty());
        call.resolve(o);
    }

    /**
     * { stops: [{ lat, lng, title }], mode: 'bike' | 'car', rect: { x, y, width, height }, simulate }
     * Resolves once guidance has started; rejects with a code the page can act on:
     * terms, unauthorized, network, location, no_route, error.
     */
    @PluginMethod
    public void start(PluginCall call) {
        if (apiKey().isEmpty()) { call.reject("No Navigation SDK key in this build", "unavailable"); return; }
        JSArray stops = call.getArray("stops");
        if (stops == null || stops.length() == 0) { call.reject("No destination", "no_route"); return; }
        final List<Waypoint> waypoints = new ArrayList<>();
        try {
            for (int i = 0; i < stops.length(); i++) {
                JSONObject s = stops.getJSONObject(i);
                waypoints.add(Waypoint.builder()
                        .setLatLng(s.getDouble("lat"), s.getDouble("lng"))
                        .setTitle(s.optString("title", ""))
                        .build());
            }
        } catch (Exception e) {
            call.reject("Bad stops", "no_route");
            return;
        }
        final int mode = "bike".equals(call.getString("mode"))
                ? RoutingOptions.TravelMode.TWO_WHEELER
                : RoutingOptions.TravelMode.DRIVING;
        final JSObject rect = call.getObject("rect");
        // Driving the route without moving is for testing builds only.
        final boolean simulate = (com.trekov.app.BuildConfig.DEBUG || com.trekov.app.BuildConfig.ALLOW_SIMULATE) && Boolean.TRUE.equals(call.getBoolean("simulate", false));
        voice = !Boolean.FALSE.equals(call.getBoolean("voice", true));
        mapType = mapTypeOf(call.getString("mapType", "roadmap"));
        traffic = !Boolean.FALSE.equals(call.getBoolean("traffic", true));

        final Activity activity = getActivity();
        activity.runOnUiThread(() -> {
            // One ride at a time: whatever was running goes first.
            teardown();
            // Set after teardown(), which clears it — set before, desk testing
            // silently rode the real GPS instead (2026-09-14).
            simulating = simulate;
            final int mine = ++session;
            showView(rect);
            final JSObject from = simulate ? call.getObject("simulateFrom") : null;
            // Shows Google's terms the first time; a rider has to accept them once.
            NavigationApi.getNavigator(activity, new NavigationApi.NavigatorListener() {
                @Override
                public void onNavigatorReady(Navigator nav) {
                    if (mine != session) { call.reject("Navigation was stopped", "error"); return; }
                    navigator = nav;
                    // Testing builds can start the ride somewhere else — store
                    // screenshots shouldn't show the street a tester lives on.
                    if (from != null && from.has("lat") && from.has("lng")) {
                        nav.getSimulator().setUserLocation(new LatLng(from.optDouble("lat"), from.optDouble("lng")));
                        // Routed straight away, Google still used the phone's last real
                        // fix — the tester's own street (2026-09-16). Give it a moment.
                        ui.postDelayed(() -> { if (mine == session && navigator == nav) route(call, waypoints, mode, mine); }, 2500);
                        return;
                    }
                    route(call, waypoints, mode, mine);
                }

                @Override
                public void onError(int code) {
                    if (mine == session) removeView();
                    String reason = code == NavigationApi.ErrorCode.TERMS_NOT_ACCEPTED ? "terms"
                            : code == NavigationApi.ErrorCode.NOT_AUTHORIZED ? "unauthorized"
                            : code == NavigationApi.ErrorCode.NETWORK_ERROR ? "network"
                            : code == NavigationApi.ErrorCode.LOCATION_PERMISSION_MISSING ? "location"
                            : "error";
                    android.util.Log.w("TrekovNav", "navigator error code " + code);
                    call.reject("Navigation could not start: " + reason, reason);
                }
            });
        });
    }

    private void route(PluginCall call, List<Waypoint> waypoints, int mode, int mine) {
        RoutingOptions options = new RoutingOptions().travelMode(mode);
        final Navigator nav = navigator;
        nav.setDestinations(waypoints, options).setOnResultListener(status -> {
            if (mine != session || navigator != nav) { call.reject("Navigation was stopped", "error"); return; }
            if (status != Navigator.RouteStatus.OK) {
                String reason = status == Navigator.RouteStatus.NETWORK_ERROR ? "network"
                        : status == Navigator.RouteStatus.LOCATION_DISABLED || status == Navigator.RouteStatus.LOCATION_UNKNOWN ? "location"
                        : status == Navigator.RouteStatus.QUOTA_CHECK_FAILED ? "unauthorized"
                        : "no_route";
                navigator.clearDestinations();
                removeView();
                android.util.Log.w("TrekovNav", "route status " + status);
                call.reject("No route: " + status, reason);
                return;
            }
            applyVoice();
            navigator.addArrivalListener(onArrival);
            navigator.addRemainingTimeOrDistanceChangedListener(10, 25, onProgress);
            locations = NavigationApi.getRoadSnappedLocationProvider(getActivity().getApplication());
            if (locations != null) locations.addLocationListener(onLocation);
            // Google's guidance notification stays on. One UI draws it as a
            // pill across the top of the navigation screen; it was switched off
            // for a day as a "Trekov popup" until it turned out to be Google's
            // own turn-by-turn, which Punit wants kept (2026-09-17). It is also
            // what carries the next turn into the notification shade while the
            // app is in the background.
            navigator.startGuidance();
            ui.post(this::hideGoogleArrow);
            // For testing at a desk: drive the route without moving.
            if (simulating) navigator.getSimulator().simulateLocationsAlongExistingRoute(new SimulationOptions().speedMultiplier(2));
            sendProgress();
            call.resolve();
        });
    }

    /** { on } — spoken turn-by-turn. Off leaves the screen guiding silently. */
    @PluginMethod
    public void setVoice(PluginCall call) {
        voice = !Boolean.FALSE.equals(call.getBoolean("on", true));
        getActivity().runOnUiThread(() -> { applyVoice(); call.resolve(); });
    }

    /** { mapType: 'roadmap' | 'satellite' | 'hybrid' | 'terrain', traffic } */
    @PluginMethod
    public void setMapStyle(PluginCall call) {
        mapType = mapTypeOf(call.getString("mapType", "roadmap"));
        traffic = !Boolean.FALSE.equals(call.getBoolean("traffic", true));
        getActivity().runOnUiThread(() -> { applyMap(); call.resolve(); });
    }

    private void applyVoice() {
        if (navigator != null) {
            navigator.setAudioGuidance(voice ? Navigator.AudioGuidance.VOICE_ALERTS_AND_GUIDANCE
                    : Navigator.AudioGuidance.SILENT);
        }
    }

    private void applyMap() {
        if (map == null) return;
        map.setMapType(mapType);
        map.setTrafficEnabled(traffic);
    }

    private static int mapTypeOf(String id) {
        if ("satellite".equals(id)) return GoogleMap.MAP_TYPE_SATELLITE;
        if ("hybrid".equals(id)) return GoogleMap.MAP_TYPE_HYBRID;
        if ("terrain".equals(id)) return GoogleMap.MAP_TYPE_TERRAIN;
        return GoogleMap.MAP_TYPE_NORMAL;
    }

    /** { x, y, width, height, visible } in CSS pixels of the page. */
    @PluginMethod
    public void setRect(PluginCall call) {
        final JSObject rect = call.getData();
        getActivity().runOnUiThread(() -> {
            place(rect);
            call.resolve();
        });
    }

    /** The rider's own vehicle: { sheet, cols, rows, cellDp } (src/lib/vehicleSprites.js). */
    @PluginMethod
    public void setVehicle(PluginCall call) {
        final JSObject data = call.getData();
        getActivity().runOnUiThread(() -> {
            Sheet sh = sheet(data);
            if (sh == null) { call.reject("No image"); return; }
            selfSheet = sh;
            if (self != null) { self.setTag(null); pose(self, sh, selfHeadingShown); }
            else if (selfAt != null) moveSelf(null);
            call.resolve();
        });
    }

    /**
     * { riders: [{ id, name, lat, lng, heading, stale, captain, colour, icon }],
     *   icons: { id: { sheet, cols, rows, cellDp } } } — everyone else on the trip.
     * `icon` names a sheet sent now or earlier; without one a rider is a coloured dot.
     */
    @PluginMethod
    public void setRiders(PluginCall call) {
        final JSArray list = call.getArray("riders");
        final JSObject sent = call.getObject("icons");
        getActivity().runOnUiThread(() -> {
            if (sent != null) {
                java.util.Iterator<String> keys = sent.keys();
                while (keys.hasNext()) {
                    String key = keys.next();
                    JSONObject spec = sent.optJSONObject(key);
                    Sheet sh = spec != null ? sheet(spec) : null;
                    if (sh != null) sheets.put(key, sh);
                }
            }
            if (map == null || list == null) { call.resolve(); return; }
            Set<String> seen = new HashSet<>();
            for (int i = 0; i < list.length(); i++) {
                JSONObject r = list.optJSONObject(i);
                if (r == null || !r.has("lat") || !r.has("lng")) continue;
                String id = r.optString("id");
                seen.add(id);
                LatLng at = new LatLng(r.optDouble("lat"), r.optDouble("lng"));
                String name = r.optString("name", "Rider");
                boolean stale = r.optBoolean("stale", false);
                boolean captain = r.optBoolean("captain", false);
                String colour = r.optString("colour", "#00C08B");
                String key = r.optString("icon", "");
                Sheet sh = sheets.get(key);

                Rider rider = riders.get(id);
                if (rider == null) { rider = new Rider(); riders.put(id, rider); }
                rider.heading = (float) r.optDouble("heading", 0);

                String wanted = sh != null ? key : "";
                if (rider.vehicle == null || !wanted.equals(rider.sheetKey)) {
                    if (rider.vehicle != null) rider.vehicle.remove();
                    MarkerOptions o = new MarkerOptions().position(at).zIndex(10f).anchor(0.5f, 0.5f);
                    o.icon(sh != null ? topDescriptor(sh) : BitmapDescriptorFactory.fromBitmap(dotIcon(colour, stale)));
                    rider.vehicle = map.addMarker(o);
                    rider.sheetKey = wanted;
                    if (rider.vehicle != null && sh != null) pose(rider.vehicle, sh, rider.heading);
                } else {
                    rider.vehicle.setPosition(at);
                }
                // A touch see-through, so the road under a rider still reads.
                if (rider.vehicle != null) rider.vehicle.setAlpha(stale ? 0.4f : 0.88f);

                // The name stays upright above the vehicle.
                String labelLook = name + "|" + stale + "|" + captain;
                if (rider.label == null || !labelLook.equals(rider.labelLook)) {
                    if (rider.label != null) rider.label.remove();
                    rider.label = map.addMarker(new MarkerOptions().position(at).zIndex(11f).anchor(0.5f, 1f)
                            .icon(BitmapDescriptorFactory.fromBitmap(labelIcon(name, stale, captain))));
                    rider.labelLook = labelLook;
                } else {
                    rider.label.setPosition(at);
                }
            }
            for (String id : new ArrayList<>(riders.keySet())) {
                if (!seen.contains(id)) removeRider(riders.remove(id));
            }
            call.resolve();
        });
    }

    @PluginMethod
    public void stop(PluginCall call) {
        getActivity().runOnUiThread(() -> {
            session++;
            teardown();
            call.resolve();
        });
    }

    /* ------------------------------------------------------------ view */

    private void showView(JSObject rect) {
        if (navView == null) {
            Activity activity = getActivity();
            navView = new NavigationView(activity);
            navView.onCreate(null);
            navView.onStart();
            if (resumed) navView.onResume();
            // The page draws the destination and group chrome; Google draws the rest.
            navView.getMapAsync(m -> {
                map = m;
                applyMap();
                // Tapping your own vehicle opens the vehicle picker on the page.
                m.setOnMarkerClickListener(marker -> {
                    if (marker.equals(self)) { notifyListeners("vehicleTap", new JSObject()); return true; }
                    return false;
                });
                // Trekov's own vehicle takes the place of Google's blue arrow once
                // its images have arrived; until then Google's stays.
                if (selfAt != null) moveSelf(null);
                ui.removeCallbacks(camTick);
                ui.post(camTick);
            });
            ViewGroup parent = (ViewGroup) getBridge().getWebView().getParent();
            parent.addView(navView, new ViewGroup.LayoutParams(1, 1));
        }
        place(rect);
    }

    private void place(JSObject rect) {
        if (navView == null || rect == null) return;
        WebView web = getBridge().getWebView();
        float density = getActivity().getResources().getDisplayMetrics().density;
        int width = Math.max(1, Math.round((float) rect.optDouble("width", 0) * density));
        int height = Math.max(1, Math.round((float) rect.optDouble("height", 0) * density));
        ViewGroup.LayoutParams lp = navView.getLayoutParams();
        if (lp.width != width || lp.height != height) {
            lp.width = width;
            lp.height = height;
            navView.setLayoutParams(lp);
        }
        navView.setX(web.getX() + (float) rect.optDouble("x", 0) * density);
        navView.setY(web.getY() + (float) rect.optDouble("y", 0) * density);
        navView.setVisibility(rect.optBoolean("visible", true) ? View.VISIBLE : View.INVISIBLE);
    }

    private void removeView() {
        if (navView == null) return;
        for (Rider r : riders.values()) removeRider(r);
        riders.clear();
        ui.removeCallbacks(camTick);
        if (glide != null) { glide.cancel(); glide = null; }
        if (self != null) { self.remove(); self = null; }
        headingKnown = false;
        selfAt = null;
        // Descriptors belong to this map; the next one makes its own.
        for (Sheet sh : sheets.values()) forget(sh);
        if (selfSheet != null) forget(selfSheet);
        map = null;
        if (resumed) navView.onPause();
        navView.onStop();
        navView.onDestroy();
        ViewGroup parent = (ViewGroup) navView.getParent();
        if (parent != null) parent.removeView(navView);
        navView = null;
    }

    private void teardown() {
        // The map view goes first: destroyed after the navigator, it brought
        // the SDK's location requests straight back (Android, 2026-09-14).
        removeView();
        if (locations != null) {
            locations.removeLocationListener(onLocation);
            locations = null;
        }
        if (navigator != null) {
            if (simulating) navigator.getSimulator().unsetUserLocation();
            navigator.removeArrivalListener(onArrival);
            navigator.removeRemainingTimeOrDistanceChangedListener(onProgress);
            navigator.stopGuidance();
            navigator.clearDestinations();
            // Released, not just stopped: a navigator left alive keeps asking for
            // high-accuracy location every second after the ride is over. The
            // next ride makes a new one.
            navigator.cleanup();
            navigator = null;
        }
        simulating = false;
    }

    private void sendProgress() {
        if (navigator == null) return;
        TimeAndDistance td = navigator.getCurrentTimeAndDistance();
        if (td == null) return;
        JSObject o = new JSObject();
        o.put("meters", td.getMeters());
        o.put("seconds", td.getSeconds());
        o.put("delay", td.getDelaySeverity());
        notifyListeners("progress", o);
    }

    /**
     * Glide our vehicle to the new fix over about the time the fix took, and
     * turn it towards the road's direction. Fixes come roughly once a second;
     * jumping between them made the vehicle hop.
     */
    private void moveSelf(Location l) {
        if (l != null && l.hasBearing() && l.hasSpeed() && l.getSpeed() > 0.7f) { selfHeading = l.getBearing(); headingKnown = true; }
        if (map == null || selfSheet == null) {
            if (l != null) selfAt = new LatLng(l.getLatitude(), l.getLongitude());
            return;
        }
        LatLng to = l != null ? new LatLng(l.getLatitude(), l.getLongitude()) : selfAt;
        if (to == null) return;
        // Starting guidance turns Google's blue arrow back on, so it is switched
        // off again here rather than once when the map loads: it was still drawn
        // on top of the vehicle (Android, 2026-09-14).
        hideGoogleArrow();
        if (self == null) {
            selfHeadingShown = selfHeading;
            self = map.addMarker(new MarkerOptions().position(to).icon(topDescriptor(selfSheet))
                    .anchor(0.5f, 0.5f).zIndex(20f));
            if (self != null) pose(self, selfSheet, selfHeadingShown);
            selfAt = to;
            return;
        }
        final LatLng from = self.getPosition();
        final float h0 = selfHeadingShown;
        final float h1 = h0 + (((selfHeading - h0) % 360f + 540f) % 360f) - 180f;
        if (glide != null) glide.cancel();
        glide = ValueAnimator.ofFloat(0f, 1f);
        glide.setDuration(900);
        glide.setInterpolator(new LinearInterpolator());
        glide.addUpdateListener(va -> {
            if (self == null) return;
            float f = (float) va.getAnimatedValue();
            self.setPosition(new LatLng(from.latitude + (to.latitude - from.latitude) * f,
                    from.longitude + (to.longitude - from.longitude) * f));
            selfHeadingShown = h0 + (h1 - h0) * f;
            pose(self, selfSheet, selfHeadingShown);
        });
        glide.start();
        selfAt = to;
    }

    /**
     * Shows a vehicle the way the camera sees it. Tilted: the frame for the
     * heading relative to the camera, standing up. Flat: the top view, lying on
     * the map and turned to the heading. Icons change only when the frame does.
     */
    private void pose(Marker m, Sheet sh, float heading) {
        if (map == null) return;
        boolean tilted = cameraTilt > 12f && sh.frames.length > 0;
        Object tag = m.getTag();
        if (tilted) {
            int n = sh.frames.length;
            float rel = ((heading - cameraBearing) % 360f + 360f) % 360f;
            int k = Math.round(rel / (360f / n)) % n;
            if (!(tag instanceof Integer) || (Integer) tag != k) {
                m.setFlat(false);
                m.setRotation(0f);
                BitmapDescriptor d = frameDescriptor(sh, k);
                if (d != null) m.setIcon(d);
                m.setTag(k);
            }
        } else {
            if (!(tag instanceof Integer) || (Integer) tag != -1) {
                m.setFlat(true);
                BitmapDescriptor d = topDescriptor(sh);
                if (d != null) m.setIcon(d);
                m.setTag(-1);
            }
            m.setRotation(heading);
        }
    }

    /** { sheet: base64 image, cols, rows, cellDp }: frames first, the top view in the cell after them. */
    private Sheet sheet(JSONObject spec) {
        try {
            byte[] bytes = Base64.decode(spec.optString("sheet", ""), Base64.DEFAULT);
            Bitmap raw = BitmapFactory.decodeByteArray(bytes, 0, bytes.length);
            if (raw == null) return null;
            int cols = spec.optInt("cols", 6), rows = spec.optInt("rows", 7);
            int count = spec.optInt("frames", 36);
            int cw = raw.getWidth() / cols, ch = raw.getHeight() / rows;
            float density = getActivity().getResources().getDisplayMetrics().density;
            int px = Math.max(8, Math.round((float) spec.optDouble("cellDp", 64) * density));
            Sheet sh = new Sheet();
            sh.frames = new Bitmap[count];
            sh.descriptors = new BitmapDescriptor[count];
            for (int k = 0; k < count; k++) {
                Bitmap cell = Bitmap.createBitmap(raw, (k % cols) * cw, (k / cols) * ch, cw, ch);
                sh.frames[k] = Bitmap.createScaledBitmap(cell, px, px, true);
            }
            Bitmap top = Bitmap.createBitmap(raw, (count % cols) * cw, (count / cols) * ch, cw, ch);
            sh.top = Bitmap.createScaledBitmap(top, px, px, true);
            return sh;
        } catch (Exception e) {
            return null;
        }
    }

    // Made on first use: the map has to exist before a descriptor can.
    private BitmapDescriptor frameDescriptor(Sheet sh, int k) {
        if (map == null) return null;
        if (sh.descriptors[k] == null) sh.descriptors[k] = BitmapDescriptorFactory.fromBitmap(sh.frames[k]);
        return sh.descriptors[k];
    }

    private BitmapDescriptor topDescriptor(Sheet sh) {
        if (map == null) return null;
        if (sh.topDescriptor == null) sh.topDescriptor = BitmapDescriptorFactory.fromBitmap(sh.top);
        return sh.topDescriptor;
    }

    private static void forget(Sheet sh) {
        java.util.Arrays.fill(sh.descriptors, null);
        sh.topDescriptor = null;
    }

    private void hideGoogleArrow() {
        if (map == null || selfSheet == null) return;
        try { if (map.isMyLocationEnabled()) map.setMyLocationEnabled(false); } catch (SecurityException ignored) { }
    }

    private void removeRider(Rider r) {
        if (r == null) return;
        if (r.vehicle != null) r.vehicle.remove();
        if (r.label != null) r.label.remove();
    }

    /** A rider's name in a dark pill, with room under it for their vehicle. */
    private Bitmap labelIcon(String name, boolean stale, boolean captain) {
        float d = getActivity().getResources().getDisplayMetrics().density;
        String label = (captain ? "★ " : "") + name;
        Paint text = new Paint(Paint.ANTI_ALIAS_FLAG);
        // Small and close over the vehicle: a big tag high above it hid as
        // much road as the vehicle did (2026-09-14).
        text.setTextSize(10 * d);
        text.setTypeface(Typeface.create(Typeface.DEFAULT, Typeface.BOLD));
        text.setColor(Color.WHITE);
        float textW = Math.min(text.measureText(label), 110 * d);
        int w = (int) (textW + 12 * d);
        float pillH = 15 * d;
        // Room under the name for a (rider-sized) vehicle standing up on a tilted map.
        int h = (int) (pillH + 26 * d);
        Bitmap bmp = Bitmap.createBitmap(w, h, Bitmap.Config.ARGB_8888);
        Canvas c = new Canvas(bmp);
        int alpha = stale ? 130 : 200;
        Paint pill = new Paint(Paint.ANTI_ALIAS_FLAG);
        pill.setColor(Color.argb(alpha, 11, 15, 14));
        c.drawRoundRect(new RectF(0, 0, w, pillH), pillH / 2, pillH / 2, pill);
        text.setAlpha(stale ? 170 : 255);
        // Cut to fit rather than run off the pill.
        CharSequence fitted = android.text.TextUtils.ellipsize(label, new android.text.TextPaint(text), 110 * d, android.text.TextUtils.TruncateAt.END);
        c.drawText(fitted, 0, fitted.length(), 6 * d, 11 * d, text);
        return bmp;
    }

    /** A plain dot in the rider's colour, for a rider whose vehicle has no image. */
    private Bitmap dotIcon(String colour, boolean stale) {
        float d = getActivity().getResources().getDisplayMetrics().density;
        int size = (int) (32 * d);
        Bitmap bmp = Bitmap.createBitmap(size, size, Bitmap.Config.ARGB_8888);
        Canvas c = new Canvas(bmp);
        Paint ring = new Paint(Paint.ANTI_ALIAS_FLAG);
        ring.setColor(Color.WHITE);
        c.drawCircle(size / 2f, size / 2f, 14 * d, ring);
        Paint dot = new Paint(Paint.ANTI_ALIAS_FLAG);
        int fill;
        try { fill = Color.parseColor(colour); } catch (Exception e) { fill = Color.parseColor("#00C08B"); }
        dot.setColor(stale ? Color.GRAY : fill);
        c.drawCircle(size / 2f, size / 2f, 11 * d, dot);
        return bmp;
    }

    /** A dot in the rider's colour with their name under it. Stale riders fade. */
    private Bitmap riderIcon(String name, String colour, boolean stale, boolean captain) {
        float d = getActivity().getResources().getDisplayMetrics().density;
        String label = (captain ? "★ " : "") + name;
        Paint text = new Paint(Paint.ANTI_ALIAS_FLAG);
        text.setTextSize(12 * d);
        text.setTypeface(Typeface.create(Typeface.DEFAULT, Typeface.BOLD));
        text.setColor(Color.WHITE);
        float textW = Math.min(text.measureText(label), 140 * d);
        int w = (int) Math.max(34 * d, textW + 16 * d);
        int h = (int) (58 * d);
        Bitmap bmp = Bitmap.createBitmap(w, h, Bitmap.Config.ARGB_8888);
        Canvas c = new Canvas(bmp);
        int alpha = stale ? 150 : 255;

        Paint pill = new Paint(Paint.ANTI_ALIAS_FLAG);
        pill.setColor(Color.argb(alpha, 11, 15, 14));
        c.drawRoundRect(new RectF((w - textW) / 2 - 8 * d, 0, (w + textW) / 2 + 8 * d, 18 * d), 9 * d, 9 * d, pill);
        text.setAlpha(alpha);
        c.drawText(label, 0, label.length(), (w - textW) / 2, 13 * d, text);

        float cx = w / 2f, cy = 40 * d, r = 13 * d;
        Paint ring = new Paint(Paint.ANTI_ALIAS_FLAG);
        ring.setColor(Color.argb(alpha, 255, 255, 255));
        c.drawCircle(cx, cy, r + 3 * d, ring);
        Paint dot = new Paint(Paint.ANTI_ALIAS_FLAG);
        int fill;
        try { fill = Color.parseColor(colour); } catch (Exception e) { fill = Color.parseColor("#00C08B"); }
        dot.setColor(stale ? Color.GRAY : fill);
        dot.setAlpha(alpha);
        c.drawCircle(cx, cy, r, dot);
        Paint initial = new Paint(Paint.ANTI_ALIAS_FLAG);
        initial.setColor(Color.WHITE);
        initial.setTextSize(13 * d);
        initial.setTypeface(Typeface.create(Typeface.DEFAULT, Typeface.BOLD));
        initial.setTextAlign(Paint.Align.CENTER);
        String letter = name.isEmpty() ? "?" : name.substring(0, 1).toUpperCase();
        c.drawText(letter, cx, cy + 4.5f * d, initial);
        return bmp;
    }

    private String apiKey() {
        try {
            ApplicationInfo info = getContext().getPackageManager()
                    .getApplicationInfo(getContext().getPackageName(), PackageManager.GET_META_DATA);
            Bundle meta = info.metaData;
            String key = meta != null ? meta.getString("com.google.android.geo.API_KEY") : null;
            return key == null ? "" : key.trim();
        } catch (Exception e) {
            return "";
        }
    }

    /* ------------------------------------------------------- lifecycle */

    @Override
    protected void handleOnStart() {
        super.handleOnStart();
        if (navView != null) navView.onStart();
    }

    @Override
    protected void handleOnResume() {
        super.handleOnResume();
        resumed = true;
        if (navView != null) navView.onResume();
    }

    @Override
    protected void handleOnPause() {
        super.handleOnPause();
        resumed = false;
        if (navView != null) navView.onPause();
    }

    @Override
    protected void handleOnStop() {
        super.handleOnStop();
        if (navView != null) navView.onStop();
    }

    @Override
    protected void handleOnDestroy() {
        teardown();
        super.handleOnDestroy();
    }

    @Override
    protected void handleOnConfigurationChanged(Configuration newConfig) {
        super.handleOnConfigurationChanged(newConfig);
        if (navView != null) navView.onConfigurationChanged(newConfig);
    }
}
