import SwiftUI

/// Shared chrome for the sign-in / sign-up / reset screens.
struct AuthCard<Content: View>: View {
    let title: LocalizedStringKey
    let subtitle: LocalizedStringKey
    @ViewBuilder var content: Content

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            HStack {
                Text("app.name")
                    .font(.title3.weight(.semibold))
                Spacer()
                LanguageToggle()
            }
            .padding(.bottom, 28)

            VStack(alignment: .leading, spacing: 18) {
                VStack(alignment: .leading, spacing: 6) {
                    Text(title)
                        .font(.title2.weight(.semibold))
                    Text(subtitle)
                        .font(.subheadline)
                        .foregroundStyle(.secondary)
                }
                content
            }
            .padding(24)
            .background(.background.secondary, in: RoundedRectangle(cornerRadius: 16))

            Spacer(minLength: 0)
        }
        .frame(maxWidth: 400)
        .padding(24)
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .top)
    }
}

struct ErrorBanner: View {
    let messageKey: String

    var body: some View {
        Text(LocalizedStringKey(messageKey))
            .font(.footnote)
            .foregroundStyle(Color.accentColor)
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(10)
            .background(Color.accentColor.opacity(0.12), in: RoundedRectangle(cornerRadius: 10))
    }
}
