import MakeUpCore
import SwiftUI

struct SignupView: View {
    @Environment(AuthService.self) private var auth
    @AppStorage(LanguagePreference.storageKey) private var languageCode = AppLanguage.systemDefault.rawValue

    @State private var displayName = ""
    @State private var email = ""
    @State private var password = ""
    @State private var errorKey: String?
    @State private var busy = false

    var body: some View {
        AuthCard(title: "auth.signup.title", subtitle: "auth.signup.subtitle") {
            VStack(spacing: 14) {
                LabeledField("auth.displayName", text: $displayName)
                LabeledField("auth.email", text: $email, kind: .email)
                LabeledField("auth.password", text: $password, kind: .password, hint: "auth.passwordHint")

                if let errorKey {
                    ErrorBanner(messageKey: errorKey)
                }

                Button(action: submit) {
                    Text(busy ? "auth.working" : "auth.signup.submit")
                        .frame(maxWidth: .infinity)
                }
                .buttonStyle(.borderedProminent)
                .controlSize(.large)
                .disabled(busy)
            }
        }
    }

    private func submit() {
        errorKey = nil
        busy = true
        Task {
            do {
                try await auth.signUp(
                    email: email,
                    password: password,
                    displayName: displayName.trimmingCharacters(in: .whitespaces),
                    language: LanguagePreference.resolve(languageCode)
                )
            } catch {
                errorKey = AuthService.messageKey(for: error)
                busy = false
            }
        }
    }
}
