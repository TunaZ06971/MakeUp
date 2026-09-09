import FirebaseAuth
import FirebaseCore
import FirebaseFirestore
import Foundation

/// Configures Firebase for the app. Without a `GoogleService-Info.plist` in the
/// main bundle it targets the local Firebase Emulator Suite, which accepts any
/// project id prefixed with "demo-" and needs no cloud project.
@MainActor
public enum FirebaseBootstrap {
    public private(set) static var usingEmulator = false

    public static var isConfigured: Bool { FirebaseApp.app() != nil }

    public static func configure() {
        guard FirebaseApp.app() == nil else { return }

        if let path = Bundle.main.path(forResource: "GoogleService-Info", ofType: "plist"),
           let options = FirebaseOptions(contentsOfFile: path) {
            FirebaseApp.configure(options: options)
            return
        }

        usingEmulator = true
        let options = FirebaseOptions(
            googleAppID: "1:000000000000:ios:0000000000000000",
            gcmSenderID: "000000000000"
        )
        options.apiKey = "demo-api-key"
        options.projectID = "demo-makeup"
        FirebaseApp.configure(options: options)

        Auth.auth().useEmulator(withHost: "127.0.0.1", port: 9099)

        // `useEmulator` alone leaves the client speaking TLS to a plaintext
        // emulator, so turn SSL off explicitly.
        let firestore = Firestore.firestore()
        firestore.useEmulator(withHost: "127.0.0.1", port: 8080)
        let settings = firestore.settings
        settings.isSSLEnabled = false
        settings.cacheSettings = MemoryCacheSettings()
        firestore.settings = settings
    }
}
