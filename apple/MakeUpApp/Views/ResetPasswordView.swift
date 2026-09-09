import MakeUpCore
import SwiftUI

struct ResetPasswordView: View {
    @Environment(AuthService.self) private var auth

    @State private var email = ""
    @State private var sent = false
    @State private var errorKey: String?
    @State private var busy = false

    var body: some View {
        AuthCard(title: "auth.reset.title", subtitle: "auth.reset.subtitle") {
            if sent {
                Text("auth.reset.sent \(email)")
                    .font(.subheadline)
            } else {
                VStack(spacing: 14) {
                    LabeledField("auth.email", text: $email, kind: .email)

                    if let errorKey {
                        ErrorBanner(messageKey: errorKey)
                    }

                    Button(action: submit) {
                        Text(busy ? "auth.working" : "auth.reset.submit")
                            .frame(maxWidth: .infinity)
                    }
                    .buttonStyle(.borderedProminent)
                    .controlSize(.large)
                    .disabled(busy)
                }
            }
        }
    }

    private func submit() {
        errorKey = nil
        busy = true
        Task {
            do {
                try await auth.sendPasswordReset(to: email)
                sent = true
            } catch {
                errorKey = AuthService.messageKey(for: error)
            }
            busy = false
        }
    }
}
