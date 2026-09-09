import FirebaseFirestore
import Foundation

public struct UserRepository: Sendable {
    private var collection: CollectionReference { Firestore.firestore().collection("users") }

    public init() {}

    public func ensureProfile(
        uid: String,
        email: String,
        displayName: String,
        language: AppLanguage
    ) async throws {
        let document = collection.document(uid)
        guard try await !document.getDocument().exists else { return }

        try await document.setData([
            "uid": uid,
            "email": email,
            "displayName": displayName.isEmpty
                ? String(email.prefix(while: { $0 != "@" }))
                : displayName,
            "preferredLanguage": language.rawValue,
            "createdAt": FieldValue.serverTimestamp(),
            "updatedAt": FieldValue.serverTimestamp(),
        ])
    }
}
