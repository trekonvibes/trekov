import Foundation
import UIKit
import CoreLocation
import Capacitor
import GoogleMaps
import GoogleNavigation

/**
 * Google's own turn-by-turn navigation inside the iPhone app — the iOS twin of
 * android/…/nav/TrekovNavPlugin.java (Punit, 2026-09-15: "build native google
 * navigation for ios"). Same methods, same events, so src/lib/nativeNav.js and
 * Navigate.jsx drive both.
 *
 * Google's navigation runs as a session — its routing, rerouting, spoken
 * guidance and road-snapped position — behind a Google map that fills the whole
 * iPhone screen under the page. Trekov draws everything the rider sees on it:
 * the route, their own 3D vehicle, the other riders, and (in the page) the
 * turn card. Google's map view with navigation switched on always draws its
 * own blue arrow, and iOS has no way to turn that off, so it is not used
 * (Punit, 2026-09-15: "it's showing both the vehicle and the arrow").
 */
@objc(TrekovNavPlugin)
public class TrekovNavPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "TrekovNavPlugin"
    public let jsName = "TrekovNav"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "isAvailable", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "start", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "setRect", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "setVehicle", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "setRiders", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "setVoice", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "setMapStyle", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "stop", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "recenter", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "overview", returnType: CAPPluginReturnPromise),
    ]

    /** The key from Info.plist (TrekovNavKey ← TREKOV_NAV_KEY in ios/nav-key.xcconfig). */
    static var apiKey: String {
        let key = (Bundle.main.object(forInfoDictionaryKey: "TrekovNavKey") as? String ?? "")
            .trimmingCharacters(in: .whitespaces)
        return key.hasPrefix("$(") ? "" : key
    }

    /** Called once at launch: Google has to have the key before any map exists. */
    static func configure() {
        if !apiKey.isEmpty { GMSServices.provideAPIKey(apiKey) }
    }

    /** Driving the route without moving: debug builds, or a build made with TREKOV_ALLOW_SIMULATE=YES. */
    private static var allowSimulate: Bool {
        #if DEBUG
        return true
        #else
        let flag = Bundle.main.object(forInfoDictionaryKey: "TrekovAllowSimulate") as? String ?? ""
        return flag == "YES" || flag == "1" || flag.lowercased() == "true"
        #endif
    }

    /** A vehicle seen from 36 directions at the navigation tilt, plus from straight above. */
    private final class Sheet {
        var frames: [UIImage] = []
        var top: UIImage?
    }

    /** Each other rider: their vehicle and their name above it. */
    private final class Rider {
        var vehicle: GMSMarker?
        var label: GMSMarker?
        var labelLook = ""
        var sheetKey = ""
        var heading: Double = 0
        var pose = Int.min
    }

    private var mapView: GMSMapView?
    private var navSession: GMSNavigationSession?
    private var bike = false
    // The camera rides with the vehicle until the rider moves the map.
    private var following = true
    private var routeLines: [GMSOverlay] = []
    private var lastFix: CLLocation?
    // iPhone layout: the map under the whole page, panels floating over it.
    private var underPage = false
    private var pageBackground: UIColor?
    private var pageOpaque = true
    private var simulating = false
    // Each start is a session. A ride stopped or restarted while Google was
    // still answering must not have that old answer start guidance.
    private var session = 0
    private var voice = true
    private var mapType: GMSMapViewType = .normal
    private var traffic = true
    // Stops still to reach; Google reports each arrival, not which one is last.
    private var stopsLeft = 0

    private var riders: [String: Rider] = [:]
    private var sheets: [String: Sheet] = [:]

    // Our own vehicle, drawn over Google's chevron.
    private var selfMarker: GMSMarker?
    private var selfSheet: Sheet?
    private var selfPose = Int.min
    private var selfHeading: Double = 0        // where the road points
    private var headingKnown = false            // false until the phone has moved
    private var selfHeadingShown: Double = 0   // where the vehicle is drawn pointing, catching up
    private var selfAt: CLLocationCoordinate2D?
    private var tick: Timer?

    /* ---------------------------------------------------------- methods */

    @objc func isAvailable(_ call: CAPPluginCall) {
        call.resolve(["available": !Self.apiKey.isEmpty])
    }

    /**
     * { stops: [{ lat, lng, title }], mode: 'bike' | 'car', rect, simulate, simulateFrom,
     *   voice, mapType, traffic }. Resolves once guidance has started; rejects with a
     * code the page can act on: terms, unauthorized, network, location, no_route, error.
     */
    @objc func start(_ call: CAPPluginCall) {
        if Self.apiKey.isEmpty { call.reject("No Navigation SDK key in this build", "unavailable"); return }
        let stops = call.getArray("stops", JSObject.self) ?? []
        var waypoints: [GMSNavigationWaypoint] = []
        for s in stops {
            guard let lat = Self.number(s["lat"]), let lng = Self.number(s["lng"]),
                  let wp = GMSNavigationWaypoint(location: CLLocationCoordinate2D(latitude: lat, longitude: lng),
                                                 title: s["title"] as? String ?? "") else { continue }
            waypoints.append(wp)
        }
        if waypoints.isEmpty { call.reject("No destination", "no_route"); return }
        let bike = call.getString("mode") == "bike"
        self.bike = bike
        let stopCount = waypoints.count
        let rect = call.getObject("rect")
        let simulate = Self.allowSimulate && call.getBool("simulate", false)
        let from = simulate ? call.getObject("simulateFrom") : nil
        voice = call.getBool("voice", true)
        mapType = Self.mapTypeOf(call.getString("mapType"))
        traffic = call.getBool("traffic", true)

        DispatchQueue.main.async {
            // One ride at a time: whatever was running goes first.
            self.teardown()
            self.simulating = simulate
            self.stopsLeft = stopCount
            self.session += 1
            let mine = self.session
            guard let map = self.showView(rect) else { call.reject("No screen to draw on", "error"); return }

            // Shows Google's terms the first time; a rider has to accept them once.
            let options = GMSNavigationTermsAndConditionsOptions(companyName: "Trekov")
            GMSNavigationServices.showTermsAndConditionsDialogIfNeeded(with: options) { accepted in
                guard mine == self.session, self.mapView === map else { call.reject("Navigation was stopped", "error"); return }
                guard accepted else { self.removeView(); call.reject("Navigation terms were not accepted", "terms"); return }
                guard let nav = GMSNavigationServices.createNavigationSession(), let navigator = nav.navigator else {
                    self.removeView(); call.reject("Navigation could not start", "error"); return
                }
                nav.travelMode = bike ? .twoWheeler : .driving
                nav.isStarted = true
                self.navSession = nav
                self.following = true
                // Testing builds can start the ride somewhere else — store
                // screenshots shouldn't show the street a tester lives on.
                if let from = from, let lat = Self.number(from["lat"]), let lng = Self.number(from["lng"]) {
                    nav.locationSimulator?.simulateLocation(at: CLLocationCoordinate2D(latitude: lat, longitude: lng))
                }
                navigator.setDestinations(waypoints) { status in
                    guard mine == self.session, self.mapView === map, self.navSession === nav else { call.reject("Navigation was stopped", "error"); return }
                    guard status == .OK else {
                        let reason: String
                        switch status {
                        case .networkError: reason = "network"
                        case .locationUnavailable: reason = "location"
                        case .apiKeyNotAuthorized, .quotaExceeded: reason = "unauthorized"
                        default: reason = "no_route"
                        }
                        navigator.clearDestinations()
                        self.removeView()
                        call.reject("No route: \(status.rawValue)", reason)
                        return
                    }
                    self.applyVoice()
                    navigator.add(self)
                    navigator.timeUpdateThreshold = 10
                    navigator.distanceUpdateThreshold = 25
                    navigator.sendsBackgroundNotifications = true
                    if let provider = nav.roadSnappedLocationProvider {
                        provider.add(self)
                        provider.allowsBackgroundLocationUpdates = true
                        provider.startUpdatingLocation()
                    }
                    navigator.isGuidanceActive = true
                    self.drawRoute()
                    // For testing at a desk: drive the route without moving.
                    if self.simulating, let sim = nav.locationSimulator {
                        sim.speedMultiplier = 2
                        sim.simulateLocationsAlongExistingRoute()
                    }
                    self.sendProgress()
                    call.resolve()
                }
            }
        }
    }

    /** { x, y, width, height, visible } in CSS pixels of the page (points on iOS). */
    @objc func setRect(_ call: CAPPluginCall) {
        let rect = call.jsObjectRepresentation
        DispatchQueue.main.async {
            self.place(rect)
            call.resolve()
        }
    }

    /** { on } — spoken turn-by-turn. Off leaves the screen guiding silently. */
    @objc func setVoice(_ call: CAPPluginCall) {
        voice = call.getBool("on", true)
        DispatchQueue.main.async { self.applyVoice(); call.resolve() }
    }

    /** { mapType: 'roadmap' | 'satellite' | 'hybrid' | 'terrain', traffic } */
    @objc func setMapStyle(_ call: CAPPluginCall) {
        mapType = Self.mapTypeOf(call.getString("mapType"))
        traffic = call.getBool("traffic", true)
        DispatchQueue.main.async { self.applyMap(); call.resolve() }
    }

    /** The rider's own vehicle: { sheet, cols, rows, frames, cellDp } (src/lib/vehicleSprites.js). */
    @objc func setVehicle(_ call: CAPPluginCall) {
        let data = call.jsObjectRepresentation
        DispatchQueue.main.async {
            guard let sh = self.sheet(data) else { call.reject("No image"); return }
            self.selfSheet = sh
            self.selfPose = Int.min
            if let m = self.selfMarker { self.pose(m, sh, self.selfHeadingShown, &self.selfPose) }
            else if self.selfAt != nil { self.moveSelf(nil) }
            call.resolve()
        }
    }

    /**
     * { riders: [{ id, name, lat, lng, heading, stale, captain, colour, icon }],
     *   icons: { id: { sheet, cols, rows, cellDp } } } — everyone else on the trip.
     * `icon` names a sheet sent now or earlier; without one a rider is a coloured dot.
     */
    @objc func setRiders(_ call: CAPPluginCall) {
        let list = call.getArray("riders", JSObject.self) ?? []
        let sent = call.getObject("icons") ?? [:]
        DispatchQueue.main.async {
            for (key, value) in sent {
                if let spec = value as? JSObject, let sh = self.sheet(spec) { self.sheets[key] = sh }
            }
            guard let map = self.mapView else { call.resolve(); return }
            var seen = Set<String>()
            for r in list {
                guard let lat = Self.number(r["lat"]), let lng = Self.number(r["lng"]) else { continue }
                let id = r["id"] as? String ?? ""
                seen.insert(id)
                let at = CLLocationCoordinate2D(latitude: lat, longitude: lng)
                let name = r["name"] as? String ?? "Rider"
                let stale = r["stale"] as? Bool ?? false
                let captain = r["captain"] as? Bool ?? false
                let colour = r["colour"] as? String ?? "#00C08B"
                let key = r["icon"] as? String ?? ""
                let sh = self.sheets[key]

                let rider = self.riders[id] ?? Rider()
                self.riders[id] = rider
                rider.heading = Self.number(r["heading"]) ?? 0

                let wanted = sh != nil ? key : ""
                if rider.vehicle == nil || wanted != rider.sheetKey {
                    rider.vehicle?.map = nil
                    let m = GMSMarker(position: at)
                    m.groundAnchor = CGPoint(x: 0.5, y: 0.5)
                    m.zIndex = 10
                    m.icon = sh?.top ?? self.dotIcon(colour, stale)
                    m.map = map
                    rider.vehicle = m
                    rider.sheetKey = wanted
                    rider.pose = Int.min
                    if let sh = sh { self.pose(m, sh, rider.heading, &rider.pose) }
                } else {
                    rider.vehicle?.position = at
                }
                // A touch see-through, so the road under a rider still reads.
                rider.vehicle?.opacity = stale ? 0.4 : 0.88

                // The name stays upright above the vehicle.
                let look = "\(name)|\(stale)|\(captain)"
                if rider.label == nil || look != rider.labelLook {
                    rider.label?.map = nil
                    let l = GMSMarker(position: at)
                    l.groundAnchor = CGPoint(x: 0.5, y: 1)
                    l.zIndex = 11
                    l.icon = self.labelIcon(name, stale, captain)
                    l.isTappable = false
                    l.map = map
                    rider.label = l
                    rider.labelLook = look
                } else {
                    rider.label?.position = at
                }
            }
            for id in self.riders.keys where !seen.contains(id) {
                self.removeRider(self.riders.removeValue(forKey: id))
            }
            call.resolve()
        }
    }

    /** Back to riding with the vehicle after the rider moved the map. */
    @objc func recenter(_ call: CAPPluginCall) {
        DispatchQueue.main.async {
            self.setFollowing(true)
            if let l = self.lastFix { self.followCamera(l, animated: true) }
            call.resolve()
        }
    }

    /** The whole remaining route on screen. */
    @objc func overview(_ call: CAPPluginCall) {
        DispatchQueue.main.async {
            guard let map = self.mapView, let legs = self.navSession?.navigator?.routeLegs, !legs.isEmpty else { call.resolve(); return }
            var bounds = GMSCoordinateBounds()
            for leg in legs { if let path = leg.path { bounds = bounds.includingPath(path) } }
            if let l = self.lastFix { bounds = bounds.includingCoordinate(l.coordinate) }
            self.setFollowing(false)
            map.animate(with: GMSCameraUpdate.fit(bounds, withPadding: 40))
            call.resolve()
        }
    }

    @objc func stop(_ call: CAPPluginCall) {
        DispatchQueue.main.async {
            self.session += 1
            self.teardown()
            call.resolve()
        }
    }

    /* ------------------------------------------------------------- view */

    private func showView(_ rect: JSObject?) -> GMSMapView? {
        if mapView == nil {
            guard let web = bridge?.webView, let parent = web.superview else { return nil }
            underPage = rect?["overlay"] as? Bool ?? false
            let options = GMSMapViewOptions()
            options.frame = CGRect(x: 0, y: 0, width: 1, height: 1)
            let map = GMSMapView(options: options)
            // The page already keeps clear of the notch and the home bar.
            map.paddingAdjustmentBehavior = .never
            map.delegate = self
            map.settings.compassButton = true
            map.settings.rotateGestures = true
            map.settings.tiltGestures = true
            map.isMyLocationEnabled = false
            map.isBuildingsEnabled = true
            if underPage {
                // Under the page, which turns see-through where the map shows.
                parent.insertSubview(map, belowSubview: web)
                pageBackground = web.backgroundColor
                pageOpaque = web.isOpaque
                web.isOpaque = false
                web.backgroundColor = .clear
                web.scrollView.backgroundColor = .clear
                (web as? TrekovWebView)?.passThroughView = map
            } else {
                parent.addSubview(map)
            }
            mapView = map
            applyMap()
            tick?.invalidate()
            // Ten times a second: the camera turns and tilts on its own during
            // navigation, and every vehicle's frame follows it.
            tick = Timer.scheduledTimer(withTimeInterval: 0.1, repeats: true) { [weak self] _ in self?.onTick() }
        }
        place(rect)
        return mapView
    }

    private func place(_ rect: JSObject?) {
        guard let map = mapView, let rect = rect, let web = bridge?.webView else { return }
        let x = Self.number(rect["x"]) ?? 0, y = Self.number(rect["y"]) ?? 0
        let w = max(1, Self.number(rect["width"]) ?? 0), h = max(1, Self.number(rect["height"]) ?? 0)
        map.frame = CGRect(x: web.frame.minX + x, y: web.frame.minY + y, width: w, height: h)
        map.isHidden = !(rect["visible"] as? Bool ?? true)
        if underPage {
            // Touches on the page's panels stay with the page…
            (web as? TrekovWebView)?.holes = (rect["holes"] as? [JSObject] ?? []).map {
                CGRect(x: Self.number($0["x"]) ?? 0, y: Self.number($0["y"]) ?? 0,
                       width: Self.number($0["width"]) ?? 0, height: Self.number($0["height"]) ?? 0)
            }
            // …and Google keeps its turn card, compass and footer clear of them.
            let insets = rect["insets"] as? JSObject ?? [:]
            let top = Self.number(insets["top"]) ?? 0, bottom = Self.number(insets["bottom"]) ?? 0
            // The vehicle rides in the lower part of the open map, so the road
            // ahead gets the room — as Google Maps does.
            let lower = max(0, (h - top - bottom) * 0.3)
            map.padding = UIEdgeInsets(top: top + lower, left: 0, bottom: bottom, right: 0)
        }
    }

    private func removeView() {
        guard let map = mapView else { return }
        for r in riders.values { removeRider(r) }
        riders.removeAll()
        tick?.invalidate()
        tick = nil
        selfMarker?.map = nil
        selfMarker = nil
        selfPose = Int.min
        headingKnown = false
        selfAt = nil
        lastFix = nil
        routeLines.removeAll()
        map.delegate = nil
        map.removeFromSuperview()
        mapView = nil
        if underPage, let web = bridge?.webView {
            (web as? TrekovWebView)?.passThroughView = nil
            (web as? TrekovWebView)?.holes = []
            web.isOpaque = pageOpaque
            web.backgroundColor = pageBackground
            web.scrollView.backgroundColor = pageBackground
        }
        underPage = false
    }

    private func teardown() {
        if let nav = navSession {
            if let provider = nav.roadSnappedLocationProvider {
                provider.remove(self)
                provider.stopUpdatingLocation()
                provider.allowsBackgroundLocationUpdates = false
            }
            if simulating { nav.locationSimulator?.stopSimulation() }
            if let navigator = nav.navigator {
                navigator.remove(self)
                navigator.isGuidanceActive = false
                navigator.clearDestinations()
            }
            // Released, not just stopped: a session left running keeps the GPS
            // busy after the ride is over (the same lesson as Android).
            nav.isStarted = false
            navSession = nil
        }
        removeView()
        simulating = false
    }

    private func applyVoice() {
        navSession?.navigator?.voiceGuidance = voice ? .alertsAndGuidance : .silent
    }

    private func applyMap() {
        guard let map = mapView else { return }
        map.mapType = mapType
        map.isTrafficEnabled = traffic
    }

    private static func mapTypeOf(_ id: String?) -> GMSMapViewType {
        switch id {
        case "satellite": return .satellite
        case "hybrid": return .hybrid
        case "terrain": return .terrain
        default: return .normal
        }
    }

    private func sendProgress() {
        guard let navigator = navSession?.navigator else { return }
        let seconds = navigator.timeToNextDestination
        let meters = navigator.distanceToNextDestination
        guard seconds.isFinite, meters.isFinite, meters >= 0 else { return }
        notifyListeners("progress", data: [
            "meters": Int(meters.rounded()),
            "seconds": Int(seconds.rounded()),
            "delay": navigator.delayCategoryToNextDestination.rawValue,
        ])
    }

    /* ------------------------------------------------------ route, camera */

    /** Google's route for the rest of the ride, drawn as Google draws it: blue on a darker edge. */
    private func drawRoute() {
        guard let map = mapView, let legs = navSession?.navigator?.routeLegs else { return }
        routeLines.forEach { $0.map = nil }
        routeLines.removeAll()
        for (i, leg) in legs.enumerated() {
            guard let path = leg.path else { continue }
            let edge = GMSPolyline(path: path)
            edge.strokeWidth = 11
            edge.strokeColor = UIColor(red: 0.10, green: 0.31, blue: 0.66, alpha: 1)
            edge.zIndex = 1
            edge.map = map
            let line = GMSPolyline(path: path)
            line.strokeWidth = 7
            line.strokeColor = UIColor(red: 0.26, green: 0.52, blue: 0.96, alpha: 1)
            line.zIndex = 2
            line.map = map
            routeLines += [edge, line]
            // Each stop, and the end of the ride.
            let pin = GMSMarker(position: leg.destinationCoordinate)
            pin.icon = GMSMarker.markerImage(with: i == legs.count - 1
                ? UIColor(red: 1, green: 0.36, blue: 0.48, alpha: 1)
                : UIColor(red: 0, green: 0.75, blue: 0.55, alpha: 1))
            pin.title = leg.destinationWaypoint?.title
            pin.zIndex = 3
            pin.map = map
            routeLines.append(pin)
        }
    }

    /** Which way the route runs from here — the direction to face before the phone has moved. */
    private func routeBearing(from c: CLLocationCoordinate2D) -> Double? {
        guard let path = navSession?.navigator?.routeLegs?.first?.path, path.count() > 1 else { return nil }
        var best = 0, bestD = Double.greatestFiniteMagnitude
        for i in 0..<Int(path.count()) {
            let d = GMSGeometryDistance(c, path.coordinate(at: UInt(i)))
            if d < bestD { bestD = d; best = i }
        }
        var j = best
        while j < Int(path.count()) - 1 && GMSGeometryDistance(path.coordinate(at: UInt(best)), path.coordinate(at: UInt(j))) < 40 { j += 1 }
        return j == best ? nil : GMSGeometryHeading(path.coordinate(at: UInt(best)), path.coordinate(at: UInt(j)))
    }

    private func followCamera(_ l: CLLocation, animated: Bool) {
        guard let map = mapView, following else { return }
        let bearing = headingKnown ? selfHeading : (routeBearing(from: l.coordinate) ?? map.camera.bearing)
        let camera = GMSCameraPosition(target: l.coordinate, zoom: bike ? 17.2 : 16.8, bearing: bearing, viewingAngle: 55)
        if animated {
            CATransaction.begin()
            CATransaction.setAnimationDuration(0.9)
            CATransaction.setAnimationTimingFunction(CAMediaTimingFunction(name: .linear))
            map.animate(to: camera)
            CATransaction.commit()
        } else {
            map.camera = camera
        }
    }

    private func setFollowing(_ on: Bool) {
        guard following != on else { return }
        following = on
        notifyListeners("follow", data: ["on": on])
    }

    /** Google's names for a manoeuvre, in the words Trekov's turn arrows read. */
    private static func maneuverName(_ m: GMSNavigationManeuver) -> String {
        let n = Int(m.rawValue)
        switch n {
        case 1: return "depart"
        case 2: return "arrive"
        case 3: return "arrive-left"
        case 4: return "arrive-right"
        case 6: return "turn-left"
        case 7: return "turn-right"
        case 8: return "keep-left"
        case 9: return "keep-right"
        case 10: return "turn-slight-left"
        case 11: return "turn-slight-right"
        case 12: return "turn-sharp-left"
        case 13: return "turn-sharp-right"
        case 14: return "uturn-right"
        case 15: return "uturn-left"
        case 16: return "merge"
        case 17: return "merge-left"
        case 18: return "merge-right"
        case 19: return "fork-left"
        case 20: return "fork-right"
        case 21...42:
            return "ramp" + ([22, 24, 26, 28, 31, 33, 35, 37, 39, 42].contains(n) ? "-left"
                : [23, 25, 27, 29, 30, 34, 36, 38, 40, 41].contains(n) ? "-right" : "")
        case 43...62: return "roundabout"
        case 63, 64: return "ferry"
        default: return "straight"
        }
    }

    /* ----------------------------------------------------------- vehicles */

    private func onTick() {
        guard let map = mapView else { return }
        let bearing = map.camera.bearing
        // Standing still the phone has no direction, but navigation turns the
        // camera along the route: face that way rather than due north.
        if !headingKnown && lastFix == nil { selfHeading = bearing }
        // Turn the drawn vehicle towards the road a little each tick, the short way round.
        let delta = (((selfHeading - selfHeadingShown).truncatingRemainder(dividingBy: 360)) + 540)
            .truncatingRemainder(dividingBy: 360) - 180
        selfHeadingShown += abs(delta) < 1 ? delta : delta * 0.35
        if let m = selfMarker, let sh = selfSheet { pose(m, sh, selfHeadingShown, &selfPose) }
        for r in riders.values {
            if let m = r.vehicle, let sh = sheets[r.sheetKey] { pose(m, sh, r.heading, &r.pose) }
        }
    }

    /** Glide our vehicle to the new fix over about the time the fix took. */
    private func moveSelf(_ l: CLLocation?) {
        if let l = l, l.course >= 0, l.speed > 0.7 { selfHeading = l.course; headingKnown = true }
        if let l = l {
            lastFix = l
            if !headingKnown, let b = routeBearing(from: l.coordinate) { selfHeading = b }
            followCamera(l, animated: selfMarker != nil)
        }
        guard let map = mapView, let sh = selfSheet else {
            if let l = l { selfAt = l.coordinate }
            return
        }
        guard let to = l?.coordinate ?? selfAt else { return }
        if selfMarker == nil {
            selfHeadingShown = selfHeading
            let m = GMSMarker(position: to)
            m.groundAnchor = CGPoint(x: 0.5, y: 0.5)
            m.zIndex = 20
            m.icon = sh.top
            m.map = map
            selfMarker = m
            selfPose = Int.min
            pose(m, sh, selfHeadingShown, &selfPose)
            selfAt = to
            return
        }
        CATransaction.begin()
        CATransaction.setAnimationDuration(0.9)
        CATransaction.setAnimationTimingFunction(CAMediaTimingFunction(name: .linear))
        selfMarker?.position = to
        CATransaction.commit()
        selfAt = to
    }

    /**
     * Shows a vehicle the way the camera sees it. Tilted: the frame for the
     * heading relative to the camera, standing up. Flat: the top view, lying on
     * the map and turned to the heading. Icons change only when the frame does.
     */
    private func pose(_ m: GMSMarker, _ sh: Sheet, _ heading: Double, _ shown: inout Int) {
        guard let map = mapView else { return }
        let tilted = map.camera.viewingAngle > 12 && !sh.frames.isEmpty
        if tilted {
            let n = sh.frames.count
            let rel = ((heading - map.camera.bearing).truncatingRemainder(dividingBy: 360) + 360)
                .truncatingRemainder(dividingBy: 360)
            let k = Int((rel / (360.0 / Double(n))).rounded()) % n
            if shown != k {
                m.isFlat = false
                m.rotation = 0
                m.icon = sh.frames[k]
                shown = k
            }
        } else {
            if shown != -1 {
                m.isFlat = true
                m.icon = sh.top
                shown = -1
            }
            m.rotation = heading
        }
    }

    /** { sheet: base64 image, cols, rows, frames, cellDp }: frames first, the top view in the cell after them. */
    private func sheet(_ spec: JSObject) -> Sheet? {
        guard let b64 = spec["sheet"] as? String,
              let data = Data(base64Encoded: b64, options: .ignoreUnknownCharacters),
              let raw = UIImage(data: data)?.cgImage else { return nil }
        let cols = Int(Self.number(spec["cols"]) ?? 6), rows = Int(Self.number(spec["rows"]) ?? 7)
        let count = Int(Self.number(spec["frames"]) ?? 36)
        let cw = raw.width / cols, ch = raw.height / rows
        let size = CGFloat(max(8, Self.number(spec["cellDp"]) ?? 64))
        func cell(_ k: Int) -> UIImage? {
            guard let c = raw.cropping(to: CGRect(x: (k % cols) * cw, y: (k / cols) * ch, width: cw, height: ch)) else { return nil }
            let format = UIGraphicsImageRendererFormat.default()
            format.opaque = false
            return UIGraphicsImageRenderer(size: CGSize(width: size, height: size), format: format).image { _ in
                UIImage(cgImage: c).draw(in: CGRect(x: 0, y: 0, width: size, height: size))
            }
        }
        let sh = Sheet()
        sh.frames = (0..<count).compactMap(cell)
        sh.top = cell(count)
        return sh.frames.count == count ? sh : nil
    }

    private func removeRider(_ r: Rider?) {
        r?.vehicle?.map = nil
        r?.label?.map = nil
    }

    /** A rider's name in a small dark pill, with room under it for their vehicle. */
    private func labelIcon(_ name: String, _ stale: Bool, _ captain: Bool) -> UIImage {
        let label = (captain ? "★ " : "") + name
        let font = UIFont.boldSystemFont(ofSize: 10)
        let attrs: [NSAttributedString.Key: Any] = [
            .font: font,
            .foregroundColor: UIColor.white.withAlphaComponent(stale ? 0.67 : 1),
        ]
        let maxText: CGFloat = 110
        let textW = min(ceil((label as NSString).size(withAttributes: attrs).width), maxText)
        let pillH: CGFloat = 15
        let size = CGSize(width: textW + 12, height: pillH + 26)
        let format = UIGraphicsImageRendererFormat.default()
        format.opaque = false
        return UIGraphicsImageRenderer(size: size, format: format).image { _ in
            UIColor(red: 11 / 255, green: 15 / 255, blue: 14 / 255, alpha: stale ? 0.5 : 0.78).setFill()
            UIBezierPath(roundedRect: CGRect(x: 0, y: 0, width: size.width, height: pillH), cornerRadius: pillH / 2).fill()
            let style = NSMutableParagraphStyle()
            style.lineBreakMode = .byTruncatingTail
            var a = attrs
            a[.paragraphStyle] = style
            (label as NSString).draw(in: CGRect(x: 6, y: 1.5, width: textW, height: pillH), withAttributes: a)
        }
    }

    /** A plain dot in the rider's colour, for a rider whose vehicle has no image. */
    private func dotIcon(_ colour: String, _ stale: Bool) -> UIImage {
        let size = CGSize(width: 32, height: 32)
        let fill = stale ? UIColor.gray : (Self.color(colour) ?? UIColor(red: 0, green: 0.75, blue: 0.55, alpha: 1))
        return UIGraphicsImageRenderer(size: size).image { _ in
            UIColor.white.setFill()
            UIBezierPath(ovalIn: CGRect(x: 2, y: 2, width: 28, height: 28)).fill()
            fill.setFill()
            UIBezierPath(ovalIn: CGRect(x: 5, y: 5, width: 22, height: 22)).fill()
        }
    }

    private static func color(_ hex: String) -> UIColor? {
        var s = hex.trimmingCharacters(in: .whitespaces)
        if s.hasPrefix("#") { s.removeFirst() }
        guard s.count == 6, let v = UInt32(s, radix: 16) else { return nil }
        return UIColor(red: CGFloat((v >> 16) & 0xFF) / 255, green: CGFloat((v >> 8) & 0xFF) / 255,
                       blue: CGFloat(v & 0xFF) / 255, alpha: 1)
    }

    private static func number(_ v: Any?) -> Double? {
        if let d = v as? Double { return d }
        if let i = v as? Int { return Double(i) }
        if let n = v as? NSNumber { return n.doubleValue }
        return nil
    }
}

extension TrekovNavPlugin: GMSMapViewDelegate {
    /** Moving the map by hand stops the camera following; the page offers Recentre. */
    public func mapView(_ mapView: GMSMapView, willMove gesture: Bool) {
        if gesture { setFollowing(false) }
    }

    /** Tapping your own vehicle opens the vehicle picker on the page. */
    public func mapView(_ mapView: GMSMapView, didTap marker: GMSMarker) -> Bool {
        if marker === selfMarker {
            notifyListeners("vehicleTap", data: [:])
            return true
        }
        return false
    }
}

extension TrekovNavPlugin: GMSNavigatorListener {
    public func navigator(_ navigator: GMSNavigator, didArriveAt waypoint: GMSNavigationWaypoint) {
        stopsLeft -= 1
        let last = stopsLeft <= 0
        notifyListeners("arrival", data: ["final": last, "title": waypoint.title])
        // A trip goes on to its next stop by itself, as the Google Maps app does.
        if !last {
            navigator.continueToNextDestination { _, _ in navigator.isGuidanceActive = true }
        }
    }

    public func navigatorDidChangeRoute(_ navigator: GMSNavigator) {
        DispatchQueue.main.async { self.drawRoute() }
    }

    /** The next turn, for the page's turn card. */
    public func navigator(_ navigator: GMSNavigator, didUpdate navInfo: GMSNavigationNavInfo) {
        var data: JSObject = [
            "state": navInfo.navState.rawValue,
            "meters": navInfo.distanceToCurrentStepMeters.isFinite ? Int(navInfo.distanceToCurrentStepMeters.rounded()) : -1,
            "finalMeters": navInfo.distanceToFinalDestinationMeters.isFinite ? Int(navInfo.distanceToFinalDestinationMeters.rounded()) : -1,
            "finalSeconds": navInfo.timeToFinalDestinationSeconds.isFinite ? Int(navInfo.timeToFinalDestinationSeconds.rounded()) : -1,
        ]
        if let step = navInfo.currentStep {
            data["instruction"] = step.fullInstructionText
            data["road"] = step.simpleRoadName
            data["maneuver"] = Self.maneuverName(step.maneuver)
        }
        if let next = navInfo.remainingSteps.first {
            data["nextManeuver"] = Self.maneuverName(next.maneuver)
            data["nextRoad"] = next.simpleRoadName
        }
        notifyListeners("step", data: data)
    }

    public func navigator(_ navigator: GMSNavigator, didUpdateRemainingTime time: TimeInterval) {
        sendProgress()
    }

    public func navigator(_ navigator: GMSNavigator, didUpdateRemainingDistance distance: CLLocationDistance) {
        sendProgress()
    }
}

extension TrekovNavPlugin: GMSRoadSnappedLocationProviderListener {
    public func locationProvider(_ locationProvider: GMSRoadSnappedLocationProvider, didUpdate location: CLLocation) {
        var data: JSObject = [
            "lat": location.coordinate.latitude,
            "lng": location.coordinate.longitude,
            "time": Int(location.timestamp.timeIntervalSince1970 * 1000),
        ]
        if location.horizontalAccuracy >= 0 { data["accuracy"] = location.horizontalAccuracy }
        if location.speed >= 0 { data["speed"] = location.speed }
        if location.course >= 0 { data["heading"] = location.course }
        notifyListeners("location", data: data)
        DispatchQueue.main.async { self.moveSelf(location) }
    }
}
