import CoreGraphics
import Foundation

/// Maps a point on a photo to its place in the shared UV space.
///
/// This is what makes a brush stroke portable: the pointer lands somewhere on
/// *this* photo, but the stroke is recorded against the face's own topology.
/// Play the same stroke back on a different photo — a side view, or another
/// person — and it lands on the same anatomy.
///
/// Triangles are bucketed into a coarse grid so a lookup touches a handful of
/// candidates instead of all 852.
public struct UVLookup: Sendable {
    private static let grid = 24

    private let buckets: [[Int]]
    private let landmarks: [CGPoint]

    public init(landmarks: [CGPoint]) {
        self.landmarks = landmarks

        var buckets = Array(repeating: [Int](), count: Self.grid * Self.grid)
        let triangles = CanonicalFace.triangles

        for start in stride(from: 0, to: triangles.count, by: 3) {
            let indices = (Int(triangles[start]), Int(triangles[start + 1]), Int(triangles[start + 2]))
            guard indices.0 < landmarks.count,
                  indices.1 < landmarks.count,
                  indices.2 < landmarks.count else { continue }

            let a = landmarks[indices.0], b = landmarks[indices.1], c = landmarks[indices.2]
            let minX = min(a.x, b.x, c.x), maxX = max(a.x, b.x, c.x)
            let minY = min(a.y, b.y, c.y), maxY = max(a.y, b.y, c.y)

            for gy in Self.cell(minY)...Self.cell(maxY) {
                for gx in Self.cell(minX)...Self.cell(maxX) {
                    buckets[gy * Self.grid + gx].append(start)
                }
            }
        }
        self.buckets = buckets
    }

    /// Returns nil when the point is off the face — nothing to paint there.
    public func uv(atPhotoPoint point: CGPoint) -> CGPoint? {
        guard (0...1).contains(point.x), (0...1).contains(point.y) else { return nil }
        let triangles = CanonicalFace.triangles

        for start in buckets[Self.cell(point.y) * Self.grid + Self.cell(point.x)] {
            let ia = Int(triangles[start]), ib = Int(triangles[start + 1]), ic = Int(triangles[start + 2])
            guard let weights = Self.barycentric(
                point, landmarks[ia], landmarks[ib], landmarks[ic]
            ) else { continue }

            let a = CanonicalFace.uv(at: ia)
            let b = CanonicalFace.uv(at: ib)
            let c = CanonicalFace.uv(at: ic)
            return CGPoint(
                x: weights.0 * a.x + weights.1 * b.x + weights.2 * c.x,
                y: weights.0 * a.y + weights.1 * b.y + weights.2 * c.y
            )
        }
        return nil
    }

    private static func cell(_ value: CGFloat) -> Int {
        min(grid - 1, max(0, Int(value * CGFloat(grid))))
    }

    /// Barycentric weights, or nil when the point falls outside the triangle.
    private static func barycentric(
        _ point: CGPoint, _ a: CGPoint, _ b: CGPoint, _ c: CGPoint
    ) -> (CGFloat, CGFloat, CGFloat)? {
        let v0 = CGPoint(x: b.x - a.x, y: b.y - a.y)
        let v1 = CGPoint(x: c.x - a.x, y: c.y - a.y)
        let denominator = v0.x * v1.y - v1.x * v0.y
        guard abs(denominator) > 1e-12 else { return nil }

        let p = CGPoint(x: point.x - a.x, y: point.y - a.y)
        let v = (p.x * v1.y - v1.x * p.y) / denominator
        let w = (v0.x * p.y - p.x * v0.y) / denominator
        let u = 1 - v - w

        let epsilon: CGFloat = -1e-6
        guard u >= epsilon, v >= epsilon, w >= epsilon else { return nil }
        return (u, v, w)
    }
}
