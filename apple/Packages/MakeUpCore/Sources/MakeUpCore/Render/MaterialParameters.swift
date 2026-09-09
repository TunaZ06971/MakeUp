import Foundation

public struct MaterialParameters: Codable, Sendable {
    public let gloss: Float
    public let roughness: Float
    public let detail: Float
    public let coverage: Float
    public let sparkle: Float

    private static let presets: [String: MaterialParameters] = {
        guard let url = Bundle.module.url(forResource: "materials", withExtension: "json"),
              let data = try? Data(contentsOf: url),
              let result = try? JSONDecoder().decode([String: MaterialParameters].self, from: data)
        else { preconditionFailure("Missing shared material parameters") }
        return result
    }()
    public static func parameters(for finish: FinishType) -> MaterialParameters {
        presets[finish.rawValue]!
    }
    public static func opacity(for category: MakeupCategory) -> Float {
        switch category {
        case .lipstick: 0.98
        case .foundation: 0.40
        case .blush: 0.28
        case .eyeshadow: 0.65
        case .eyeliner: 0.99
        case .brow: 0.78
        case .highlighter: 0.22
        }
    }
}
