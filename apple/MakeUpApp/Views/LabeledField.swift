import SwiftUI

struct LabeledField: View {
    enum Kind { case email, password, plain }

    let label: LocalizedStringKey
    @Binding var text: String
    let kind: Kind
    var hint: LocalizedStringKey?

    init(
        _ label: LocalizedStringKey,
        text: Binding<String>,
        kind: Kind = .plain,
        hint: LocalizedStringKey? = nil
    ) {
        self.label = label
        self._text = text
        self.kind = kind
        self.hint = hint
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            Text(label)
                .font(.footnote.weight(.medium))
                .foregroundStyle(.secondary)

            field
                .textFieldStyle(.roundedBorder)
                .autocorrectionDisabled()
                #if os(iOS)
                .textInputAutocapitalization(.never)
                .keyboardType(kind == .email ? .emailAddress : .default)
                #endif

            if let hint {
                Text(hint)
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }
        }
    }

    @ViewBuilder
    private var field: some View {
        switch kind {
        case .password:
            SecureField("", text: $text).textContentType(.password)
        case .email:
            TextField("", text: $text).textContentType(.username)
        case .plain:
            TextField("", text: $text)
        }
    }
}
