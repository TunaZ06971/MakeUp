import MakeUpCore
import SwiftUI

struct LoginView: View {
    @Environment(AuthService.self) private var auth
    @AppStorage(LanguagePreference.storageKey) private var languageCode = AppLanguage.systemDefault.rawValue

    @State private var email = ""
    @State private var password = ""
    @State private var errorKey: String?
    @State private var busy = false

    var body: some View {
        AuthCard(title: "auth.login.title", subtitle: "app.tagline") {
            VStack(spacing: 14) {
                LabeledField("auth.email", text: $email, kind: .email)
                LabeledField("auth.password", text: $password, kind: .password)

                if let errorKey {
                    ErrorBanner(messageKey: errorKey)
                }

                Button(action: submit) {
                    Text(busy ? "auth.working" : "auth.login.submit")
                        .frame(maxWidth: .infinity)
                }
                .buttonStyle(.borderedProminent)
                .controlSize(.large)
                .disabled(busy)

                NavigationLink("auth.login.forgot") { ResetPasswordView() }
                    .font(.footnote)

                HStack(spacing: 4) {
                    Text("auth.login.noAccount")
                        .foregroundStyle(.secondary)
                    NavigationLink("auth.login.signupLink") { SignupView() }
                }
                .font(.footnote)
                .padding(.top, 4)
            }
        }
    }

    private func submit() {
        errorKey = nil
        busy = true
        Task {
            do {
                try await auth.signIn(
                    email: email,
                    password: password,
                    language: LanguagePreference.resolve(languageCode)
                )
            } catch {
                errorKey = AuthService.messageKey(for: error)
                busy = false
            }
        }
    }
}
