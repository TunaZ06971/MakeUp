import FirebaseFirestore
import Foundation

public struct ProductRepository: Sendable {
    private var collection: CollectionReference { Firestore.firestore().collection("products") }

    public init() {}

    /// Passing no category returns the whole active catalog.
    public func fetch(category: MakeupCategory? = nil) async throws -> [Product] {
        var query: Query = collection.whereField("isActive", isEqualTo: true)
        if let category {
            query = query.whereField("category", isEqualTo: category.rawValue)
        }

        let snapshot = try await query.order(by: "createdAt", descending: true).getDocuments()
        let decoder = Firestore.Decoder()

        return try snapshot.documents.map { document in
            // The document id is not stored as a field, so inject it the same
            // way the web client does before decoding.
            var data = document.data()
            data["id"] = document.documentID
            return try decoder.decode(Product.self, from: data)
        }
    }
}

extension Product {
    /// Localized display name, falling back to the source language.
    public func brandName(for language: AppLanguage) -> String {
        language == .zh ? (brandZh ?? brand) : brand
    }

    public func shadeDisplayName(for language: AppLanguage) -> String {
        language == .zh ? (shadeNameZh ?? shadeName) : shadeName
    }

    /// Client-side filter over an already-loaded page — the catalog is small.
    public func matches(_ term: String) -> Bool {
        let needle = term.trimmingCharacters(in: .whitespaces).lowercased()
        guard !needle.isEmpty else { return true }
        return searchKeywords.contains { $0.contains(needle) }
    }
}
