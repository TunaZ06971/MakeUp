import Foundation

public enum MakeupCategory: String, Codable, CaseIterable, Sendable {
    case lipstick, eyeshadow, blush, foundation, eyeliner, brow, highlighter
}

public enum FinishType: String, Codable, CaseIterable, Sendable {
    case matte, satin, shimmer, glitter, metallic, sheer, dewy
}

public enum ApplicableRegion: String, Codable, CaseIterable, Sendable {
    case lips, eyelid, crease, eyelidLine, waterline, eyebrows
    case cheeks, cheekbones, noseBridge, cupidsBow, faceFull
}

public enum ProductSource: String, Codable, Sendable {
    case curatedV1 = "curated_v1"
    case partnerFeed = "partner_feed"
}

public struct ProductColor: Codable, Hashable, Sendable {
    public var hex: String
    public var label: String?

    public init(hex: String, label: String? = nil) {
        self.hex = hex
        self.label = label
    }
}

public struct Product: Codable, Identifiable, Hashable, Sendable {
    public var id: String
    public var brand: String
    public var brandZh: String?
    public var shadeName: String
    public var shadeNameZh: String?
    public var category: MakeupCategory
    public var colors: [ProductColor]
    public var finish: FinishType
    public var opacity: Double?
    public var applicableRegions: [ApplicableRegion]
    public var textureAsset: String?
    public var source: ProductSource
    public var sourceId: String?
    public var searchKeywords: [String]
    public var isActive: Bool
    public var schemaVersion: Int
    public var createdAt: Date
    public var updatedAt: Date

    public init(
        id: String,
        brand: String,
        brandZh: String? = nil,
        shadeName: String,
        shadeNameZh: String? = nil,
        category: MakeupCategory,
        colors: [ProductColor],
        finish: FinishType,
        opacity: Double? = nil,
        applicableRegions: [ApplicableRegion],
        textureAsset: String? = nil,
        source: ProductSource = .curatedV1,
        sourceId: String? = nil,
        searchKeywords: [String] = [],
        isActive: Bool = true,
        schemaVersion: Int = 1,
        createdAt: Date = .now,
        updatedAt: Date = .now
    ) {
        self.id = id
        self.brand = brand
        self.brandZh = brandZh
        self.shadeName = shadeName
        self.shadeNameZh = shadeNameZh
        self.category = category
        self.colors = colors
        self.finish = finish
        self.opacity = opacity
        self.applicableRegions = applicableRegions
        self.textureAsset = textureAsset
        self.source = source
        self.sourceId = sourceId
        self.searchKeywords = searchKeywords
        self.isActive = isActive
        self.schemaVersion = schemaVersion
        self.createdAt = createdAt
        self.updatedAt = updatedAt
    }
}
