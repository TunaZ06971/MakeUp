import FirebaseFirestore
import Foundation

/// A saved look is a recipe, never a picture.
///
/// Region applications and brush strokes are both recorded against the shared
/// face topology, so a look reproduces on any photo, any angle, and any device —
/// and nothing here identifies the face it was made on, which is what allows it
/// to sync while the photos stay local.
public struct SavedApplication: Codable, Hashable, Sendable {
    public var productId: String
    public var colorIndex: Int
    public var region: ApplicableRegion
    public var intensity: Double

    public init(productId: String, colorIndex: Int = 0, region: ApplicableRegion, intensity: Double) {
        self.productId = productId
        self.colorIndex = colorIndex
        self.region = region
        self.intensity = intensity
    }
}

public struct SavedPaint: Codable, Hashable, Sendable {
    public var productId: String
    public var colorIndex: Int
    public var intensity: Double
    public var strokes: [Stroke]

    public init(productId: String, colorIndex: Int = 0, intensity: Double, strokes: [Stroke]) {
        self.productId = productId
        self.colorIndex = colorIndex
        self.intensity = intensity
        self.strokes = strokes
    }
}

public struct Look: Codable, Identifiable, Hashable, Sendable {
    public var id: String
    public var ownerUid: String
    public var title: String
    public var applied: [SavedApplication]
    public var painted: [SavedPaint]

    public init(
        id: String = "",
        ownerUid: String,
        title: String,
        applied: [SavedApplication],
        painted: [SavedPaint]
    ) {
        self.id = id
        self.ownerUid = ownerUid
        self.title = title
        self.applied = applied
        self.painted = painted
    }
}

public struct LookRepository: Sendable {
    private var collection: CollectionReference { Firestore.firestore().collection("looks") }

    public init() {}

    public func list(ownerUid: String) async throws -> [Look] {
        let snapshot = try await collection
            .whereField("ownerUid", isEqualTo: ownerUid)
            .order(by: "updatedAt", descending: true)
            .getDocuments()

        let decoder = Firestore.Decoder()
        return try snapshot.documents.map { document in
            var data = document.data()
            data["id"] = document.documentID
            return try decoder.decode(Look.self, from: data)
        }
    }

    @discardableResult
    public func create(_ look: Look) async throws -> String {
        var payload = try Firestore.Encoder().encode(look)
        payload.removeValue(forKey: "id")
        payload["createdAt"] = FieldValue.serverTimestamp()
        payload["updatedAt"] = FieldValue.serverTimestamp()
        return try await collection.addDocument(data: payload).documentID
    }

    public func delete(id: String) async throws {
        try await collection.document(id).delete()
    }
}
