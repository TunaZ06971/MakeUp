import MakeUpCore
import SwiftUI

struct CatalogPanel: View {
    let onSelect: (Product) -> Void
    var selectedId: String? = nil
    @AppStorage(LanguagePreference.storageKey) private var languageCode = AppLanguage.systemDefault.rawValue

    @State private var category: MakeupCategory?
    @State private var term = ""
    @State private var products: [Product] = []
    @State private var isLoading = true
    @State private var failed = false

    private let repository = ProductRepository()

    private var language: AppLanguage { LanguagePreference.resolve(languageCode) }
    private var visible: [Product] { products.filter { $0.matches(term) } }

    var body: some View {
        VStack(alignment: .leading, spacing: 16) {
            HStack {
                Text("catalog.title")
                    .font(.caption.weight(.semibold))
                    .textCase(.uppercase)
                    .foregroundStyle(.secondary)
                Spacer()
                TextField("catalog.searchPlaceholder", text: $term)
                    .textFieldStyle(.roundedBorder)
                    .frame(maxWidth: 220)
                    .autocorrectionDisabled()
            }

            categoryChips

            if isLoading {
                Text("catalog.loading").font(.footnote).foregroundStyle(.secondary)
            } else if failed {
                Text("catalog.error").font(.footnote).foregroundStyle(Color.accentColor)
            } else if visible.isEmpty {
                Text("catalog.empty").font(.footnote).foregroundStyle(.secondary)
            } else {
                LazyVGrid(
                    columns: [GridItem(.adaptive(minimum: 190), spacing: 10)],
                    spacing: 10
                ) {
                    ForEach(visible) { product in
                        ProductCell(
                            product: product,
                            language: language,
                            isSelected: product.id == selectedId
                        ) {
                            onSelect(product)
                        }
                    }
                }
            }
        }
        .padding(10)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(.background.secondary, in: RoundedRectangle(cornerRadius: 16))
        .task(id: category) { await load() }
    }

    private var categoryChips: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: 8) {
                chip(title: "catalog.all", isOn: category == nil) { category = nil }
                ForEach(MakeupCategory.allCases, id: \.rawValue) { value in
                    chip(title: value.labelKey, isOn: category == value) { category = value }
                }
            }
            .padding(.vertical, 1)
        }
    }

    private func chip(
        title: LocalizedStringKey,
        isOn: Bool,
        action: @escaping () -> Void
    ) -> some View {
        Button(action: action) {
            Text(title)
                .font(.footnote)
                .padding(.horizontal, 14)
                .padding(.vertical, 6)
                .background(
                    isOn ? Color.accentColor.opacity(0.16) : Color.secondary.opacity(0.10),
                    in: Capsule()
                )
                .foregroundStyle(isOn ? Color.accentColor : Color.secondary)
        }
        .buttonStyle(.plain)
    }

    private func load() async {
        isLoading = true
        failed = false
        do {
            products = try await repository.fetch(category: category)
        } catch {
            products = []
            failed = true
        }
        isLoading = false
    }
}

private struct ProductCell: View {
    let product: Product
    let language: AppLanguage
    let isSelected: Bool
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            HStack(spacing: 12) {
                swatch
                VStack(alignment: .leading, spacing: 1) {
                    Text(product.brandName(for: language))
                        .font(.caption2)
                        .foregroundStyle(.secondary)
                    Text(product.shadeDisplayName(for: language))
                        .font(.subheadline.weight(.medium))
                        .lineLimit(1)
                    Text(product.finish.labelKey)
                        .font(.caption2)
                        .foregroundStyle(.secondary)
                }
                Spacer(minLength: 0)
            }
            .padding(10)
            .background(
                isSelected ? Color.accentColor.opacity(0.14) : Color.secondary.opacity(0.06),
                in: RoundedRectangle(cornerRadius: 12)
            )
            .overlay(
                RoundedRectangle(cornerRadius: 12)
                    .strokeBorder(isSelected ? Color.accentColor : .clear)
            )
        }
        .buttonStyle(.plain)
    }

    /// Palettes and ombré products carry more than one tone; show them all.
    private var swatch: some View {
        let colors = product.colors.compactMap { color -> Color? in
            guard let rgb = color.rgb else { return nil }
            return Color(red: rgb.red, green: rgb.green, blue: rgb.blue)
        }
        return Circle()
            .fill(
                colors.count > 1
                    ? AnyShapeStyle(LinearGradient(colors: colors, startPoint: .topLeading, endPoint: .bottomTrailing))
                    : AnyShapeStyle(colors.first ?? .gray)
            )
            .overlay(Circle().strokeBorder(.black.opacity(0.12)))
            .frame(width: 34, height: 34)
    }
}

extension MakeupCategory {
    var labelKey: LocalizedStringKey {
        switch self {
        case .lipstick: "category.lipstick"
        case .eyeshadow: "category.eyeshadow"
        case .blush: "category.blush"
        case .foundation: "category.foundation"
        case .eyeliner: "category.eyeliner"
        case .brow: "category.brow"
        case .highlighter: "category.highlighter"
        }
    }
}

extension FinishType {
    var labelKey: LocalizedStringKey {
        switch self {
        case .matte: "finish.matte"
        case .satin: "finish.satin"
        case .shimmer: "finish.shimmer"
        case .glitter: "finish.glitter"
        case .metallic: "finish.metallic"
        case .sheer: "finish.sheer"
        case .dewy: "finish.dewy"
        }
    }
}
