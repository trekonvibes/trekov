import UIKit
import WebKit
import Capacitor

/// Capacitor's web view controller, plus Trekov's own native plugins. The
/// scene delegate makes this the root (SceneDelegate.swift).
class TrekovBridgeViewController: CAPBridgeViewController {
    override open func capacitorDidLoad() {
        bridge?.registerPluginInstance(TrekovNavPlugin())
    }

    override open func webView(with frame: CGRect, configuration: WKWebViewConfiguration) -> WKWebView {
        TrekovWebView(frame: frame, configuration: configuration)
    }
}

/// On the iPhone, Google's navigation map sits under the page for the whole
/// screen and Trekov's panels float over it (Punit, 2026-09-15: "set the UI as
/// per the iPhone full screen"). A touch on the map — anywhere the page has not
/// reported a panel — goes straight through to it.
class TrekovWebView: WKWebView {
    weak var passThroughView: UIView?
    /// The page's panels over the map, in this view's coordinates.
    var holes: [CGRect] = []

    override func hitTest(_ point: CGPoint, with event: UIEvent?) -> UIView? {
        if let under = passThroughView, !under.isHidden, under.superview != nil,
           under.frame.contains(convert(point, to: under.superview)),
           !holes.contains(where: { $0.contains(point) }) {
            return nil
        }
        return super.hitTest(point, with: event)
    }
}
