import MakeUpCore
import SwiftUI

struct LanguageToggle: View {
    @AppStorage(LanguagePreference.storageKey) private var languageCode = AppLanguage.systemDefault.rawValue

    var body: some View {
        Picker("language.label", selection: $languageCode) {
            ForEach(AppLanguage.allCases, id: \.rawValue) { language in
                Text(language.labelKey).tag(language.rawValue)
            }
        }
        .pickerStyle(.segmented)
        .labelsHidden()
        .fixedSize()
    }
}

private extension AppLanguage {
    /// Spelled out rather than interpolated: interpolating into a
    /// `LocalizedStringKey` produces the key "language.%@", which matches nothing.
    var labelKey: LocalizedStringKey {
        switch self {
        case .zh: "language.zh"
        case .en: "language.en"
        }
    }
}
