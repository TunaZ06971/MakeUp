import Foundation

/// The fixed face topology every platform shares.
///
/// Because the triangulation and its UV unwrap are identical for every face, a
/// mask or a brush stroke recorded in this UV space lands in the same anatomical
/// place on any photo, at any angle, on any device. That is what lets one look
/// replay across views — and across users, and across platforms: this file and
/// the web client's are generated together from the same source.
///
/// Regenerate with `npm run canonical` at the repo root.
public enum CanonicalFace {
    public static let vertexCount = payload.vertexCount

    /// Flat [u0, v0, u1, v1, …], one pair per landmark index.
    public static let uv: [Float] = payload.uv

    /// Flat triangle indices. Eyes and mouth are left open so paint cannot land
    /// on eyeballs or teeth.
    public static let triangles: [UInt16] = payload.triangles.map(UInt16.init)

    public static func uv(at index: Int) -> CGPoint {
        CGPoint(x: CGFloat(uv[index * 2]), y: CGFloat(uv[index * 2 + 1]))
    }

    private struct Payload: Decodable {
        let vertexCount: Int
        let uv: [Float]
        let triangles: [Int]
    }

    private static let payload: Payload = {
        guard let url = Bundle.module.url(forResource: "canonicalFace", withExtension: "json"),
              let data = try? Data(contentsOf: url),
              let decoded = try? JSONDecoder().decode(Payload.self, from: data)
        else {
            fatalError("canonicalFace.json is missing from MakeUpCore's resources")
        }
        return decoded
    }()
}
