import Foundation

public enum AppLanguage: String, Codable, CaseIterable, Sendable {
    case zh, en

    public var localeIdentifier: String {
        switch self {
        case .zh: "zh-Hans"
        case .en: "en"
        }
    }

    public static var systemDefault: AppLanguage {
        Locale.preferredLanguages.first?.hasPrefix("zh") == true ? .zh : .en
    }
}

public struct UserProfile: Codable, Identifiable, Hashable, Sendable {
    public var id: String { uid }
    public var uid: String
    public var email: String
    public var displayName: String
    public var preferredLanguage: AppLanguage
    public var createdAt: Date
    public var updatedAt: Date

    public init(
        uid: String,
        email: String,
        displayName: String,
        preferredLanguage: AppLanguage,
        createdAt: Date = .now,
        updatedAt: Date = .now
    ) {
        self.uid = uid
        self.email = email
        self.displayName = displayName
        self.preferredLanguage = preferredLanguage
        self.createdAt = createdAt
        self.updatedAt = updatedAt
    }
}
