import SwiftUI
import WebKit
import AVFoundation

@main
struct AURAApp: App {
    var body: some Scene {
        WindowGroup {
            Hülle()
                .ignoresSafeArea()
                .preferredColorScheme(.dark)
                .persistentSystemOverlays(.hidden)
        }
    }
}

/// Trägt die Weboberfläche von AURA. Der frühere Python-Server ist ersatzlos
/// weg — alles läuft in dieser WebView, gespeichert wird auf dem Gerät.
struct Hülle: UIViewRepresentable {

    func makeUIView(context: Context) -> WKWebView {
        // Mikrofon ohne Nachfrage freigeben, sonst kommt Gemini Live nicht an den Ton.
        let einstellungen = WKWebViewConfiguration()
        einstellungen.allowsInlineMediaPlayback = true
        einstellungen.mediaTypesRequiringUserActionForPlayback = []
        einstellungen.defaultWebpagePreferences.allowsContentJavaScript = true

        let ansicht = WKWebView(frame: .zero, configuration: einstellungen)
        ansicht.uiDelegate = context.coordinator
        ansicht.navigationDelegate = context.coordinator
        ansicht.isOpaque = false
        ansicht.backgroundColor = .black
        ansicht.scrollView.backgroundColor = .black
        ansicht.scrollView.bounces = false
        ansicht.scrollView.contentInsetAdjustmentBehavior = .never

        tonVorbereiten()

        if let start = Bundle.main.url(forResource: "index", withExtension: "html",
                                       subdirectory: "Web")
            ?? Bundle.main.url(forResource: "index", withExtension: "html") {
            ansicht.loadFileURL(start, allowingReadAccessTo: start.deletingLastPathComponent())
        }
        return ansicht
    }

    func updateUIView(_ ansicht: WKWebView, context: Context) {}
    func makeCoordinator() -> Bote { Bote() }

    private func tonVorbereiten() {
        let sitzung = AVAudioSession.sharedInstance()
        try? sitzung.setCategory(.playAndRecord, mode: .default,
                                 options: [.defaultToSpeaker, .allowBluetooth])
        try? sitzung.setActive(true)
        AVAudioApplication.requestRecordPermission { _ in }
    }

    final class Bote: NSObject, WKUIDelegate, WKNavigationDelegate {

        /// iOS fragt sonst bei jedem Start erneut nach dem Mikrofon.
        func webView(_ ansicht: WKWebView,
                     requestMediaCapturePermissionFor quelle: WKSecurityOrigin,
                     initiatedByFrame rahmen: WKFrameInfo,
                     type: WKMediaCaptureType,
                     decisionHandler entscheide: @escaping (WKPermissionDecision) -> Void) {
            entscheide(.grant)
        }

        /// maps:// und ähnliche Schemata gehören ans System, nicht in die WebView.
        func webView(_ ansicht: WKWebView,
                     decidePolicyFor aktion: WKNavigationAction,
                     decisionHandler entscheide: @escaping (WKNavigationActionPolicy) -> Void) {
            if let url = aktion.request.url,
               let schema = url.scheme?.lowercased(),
               !["file", "about", "http", "https"].contains(schema) {
                UIApplication.shared.open(url)
                entscheide(.cancel)
                return
            }
            entscheide(.allow)
        }

        func webView(_ ansicht: WKWebView, didFail navigation: WKNavigation!, withError fehler: Error) {
            print("[AURA] Ladefehler: \(fehler.localizedDescription)")
        }
    }
}
