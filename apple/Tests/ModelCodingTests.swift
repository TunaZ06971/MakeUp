import Foundation
import Testing

import MakeUpCore

/// The Swift models must decode exactly what the web client and the seed script
/// write to Firestore, so the wire-level raw values are worth pinning.
@Suite("Model coding")
struct ModelCodingTests {
    @Test func productSourceUsesFirestoreRawValues() {
        #expect(ProductSource.curatedV1.rawValue == "curated_v1")
        #expect(ProductSource.partnerFeed.rawValue == "partner_feed")
    }

    @Test func productRoundTripsThroughJSON() throws {
        let product = Product(
            id: "p1",
            brand: "Test Brand",
            brandZh: "测试品牌",
            shadeName: "Rosewood",
            shadeNameZh: "玫瑰木",
            category: .lipstick,
            colors: [ProductColor(hex: "#B34A5A", label: "core")],
            finish: .matte,
            opacity: nil,
            applicableRegions: [.lips],
            textureAsset: nil,
            source: .curatedV1,
            sourceId: "test-brand-rosewood",
            searchKeywords: ["test brand", "rosewood", "lipstick"],
            isActive: true,
            schemaVersion: 1,
            createdAt: Date(timeIntervalSince1970: 0),
            updatedAt: Date(timeIntervalSince1970: 0)
        )

        let data = try JSONEncoder().encode(product)
        let decoded = try JSONDecoder().decode(Product.self, from: data)
        #expect(decoded == product)
    }
}
