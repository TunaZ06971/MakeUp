import MakeUpCore
import SwiftUI
#if os(macOS)
import AppKit
#endif

@main
struct MakeUpApp: App {
    @AppStorage(LanguagePreference.storageKey) private var languageCode = AppLanguage.systemDefault.rawValue
    @State private var auth: AuthService

    init() {
        FirebaseBootstrap.configure()
        _auth = State(initialValue: AuthService())
    }

    var body: some Scene {
        WindowGroup {
            RootView()
                .environment(auth)
                .environment(\.locale, Locale(identifier: LanguagePreference.resolve(languageCode).localeIdentifier))
        }
        #if os(macOS)
        // Landscape by default: the studio puts the face beside its controls, so
        // a tall window would waste the width and squeeze the photo.
        .defaultSize(width: NSScreen.main?.visibleFrame.width ?? 1600, height: NSScreen.main?.visibleFrame.height ?? 1000)
        .windowResizability(.contentMinSize)
        #endif
    }
}

enum LanguagePreference {
    static let storageKey = "makeup.language"

    static func resolve(_ rawValue: String) -> AppLanguage {
        AppLanguage(rawValue: rawValue) ?? .systemDefault
    }
}
