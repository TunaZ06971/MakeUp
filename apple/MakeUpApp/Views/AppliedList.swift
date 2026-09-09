import MakeUpCore
import SwiftUI

struct AppliedEntry: Identifiable {
    let id: String
    let product: Product
    let intensity: Double
    /// Paint entries can be made the active brush target.
    let paintable: Bool
    let isActive: Bool
}

struct AppliedList: View {
    let entries: [AppliedEntry]
    let language: AppLanguage
    let onIntensity: (String, Double) -> Void
    let onRemove: (String) -> Void
    let onActivate: (String) -> Void
    let onClearAll: () -> Void

    var body: some View {
        if !entries.isEmpty {
            VStack(alignment: .leading, spacing: 12) {
                HStack {
                    Text("tryOn.applied")
                        .font(.caption.weight(.semibold))
                        .textCase(.uppercase)
                        .foregroundStyle(.secondary)
                    Spacer()
                    Button("tryOn.clearAll", action: onClearAll)
                        .buttonStyle(.bordered)
                }

                ForEach(entries) { entry in
                    HStack(spacing: 12) {
                        Button {
                            if entry.paintable { onActivate(entry.id) }
                        } label: {
                            HStack(spacing: 8) {
                                swatch(entry.product)
                                Text(entry.product.shadeDisplayName(for: language))
                                    .font(.subheadline)
                                    .lineLimit(1)
                            }
                        }
                        .buttonStyle(.plain)
                        .disabled(!entry.paintable)

                        Slider(
                            value: Binding(
                                get: { entry.intensity },
                                set: { onIntensity(entry.id, $0) }
                            ),
                            in: 0...1
                        )
                        .frame(maxWidth: 160)

                        Text("\(Int(entry.intensity * 100))%")
                            .font(.caption.monospacedDigit())
                            .foregroundStyle(.secondary)

                        Button {
                            onRemove(entry.id)
                        } label: {
                            Image(systemName: "xmark.circle.fill").foregroundStyle(.secondary)
                        }
                        .buttonStyle(.plain)
                    }
                    .padding(10)
                    .background(
                        entry.isActive ? Color.accentColor.opacity(0.14) : Color.secondary.opacity(0.06),
                        in: RoundedRectangle(cornerRadius: 10)
                    )
                }
            }
            .padding(20)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(.background.secondary, in: RoundedRectangle(cornerRadius: 16))
        }
    }

    private func swatch(_ product: Product) -> some View {
        let rgb = product.colors.first?.rgb
        return Circle()
            .fill(rgb.map { Color(red: $0.red, green: $0.green, blue: $0.blue) } ?? .gray)
            .frame(width: 22, height: 22)
    }
}
