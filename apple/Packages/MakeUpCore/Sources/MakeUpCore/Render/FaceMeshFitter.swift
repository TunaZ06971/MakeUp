import CoreGraphics
import Foundation

/// Places the shared canonical mesh onto a face that Vision detected.
///
/// Vision reports about 76 landmarks in its own topology; the mesh the renderer
/// and the UV atlas are built on has 468 in MediaPipe's. There is no index-level
/// correspondence between them, so this fits rather than maps: matching contours
/// (lips to lips, eye to eye) are resampled to a common point count to give a set
/// of anchors, and every remaining canonical vertex is carried along by smoothly
/// interpolating those anchors' displacements.
///
/// The result is approximate away from the anchors — cheeks and forehead are
/// interpolated, not measured — but it is exact where makeup actually lands,
/// because those are precisely the contours Vision reports.
public enum FaceMeshFitter {
    /// Canonical loops paired with the Vision region that outlines the same
    /// anatomy. Order matters: both are traversed as curves and resampled.
    private static let correspondences: [(FaceRegion, [Int])] = [
        (.outerLips, [61, 146, 91, 181, 84, 17, 314, 405, 321, 375, 291, 409, 270, 269, 267, 0, 37, 39, 40, 185]),
        (.innerLips, [78, 95, 88, 178, 87, 14, 317, 402, 318, 324, 308, 415, 310, 311, 312, 13, 82, 81, 80, 191]),
        (.leftEye, [33, 7, 163, 144, 145, 153, 154, 155, 133, 173, 157, 158, 159, 160, 161, 246]),
        (.rightEye, [362, 382, 381, 380, 374, 373, 390, 249, 263, 466, 388, 387, 386, 385, 384, 398]),
        (.leftEyebrow, [46, 53, 52, 65, 55, 107, 66, 105, 63, 70]),
        (.rightEyebrow, [276, 283, 282, 295, 285, 336, 296, 334, 293, 300]),
        (.noseCrest, [168, 6, 197, 195, 5, 4]),
        (.faceContour, [
            234, 93, 132, 58, 172, 136, 150, 149, 176, 148, 152,
            377, 400, 378, 379, 365, 397, 288, 361, 323, 454,
        ]),
    ]

    /// The canonical atlas measures v upwards while a photo measures y downwards.
    /// Flipping first puts both spaces in the same handedness, which a similarity
    /// transform can then align — a rotation cannot express a reflection.
    private static func canonicalPoint(at index: Int) -> CGPoint {
        let uv = CanonicalFace.uv(at: index)
        return CGPoint(x: uv.x, y: 1 - uv.y)
    }

    /// Returns one photo-space point per canonical vertex, or nil when Vision
    /// gave too little to anchor the fit.
    ///
    /// Three stages, and the order is what makes it robust:
    ///
    /// 1. Region *centroids* give a first similarity transform. Centroids do not
    ///    depend on the order Vision happens to walk a contour, so this stage
    ///    cannot be thrown off by one.
    /// 2. With the faces roughly superimposed, each contour is paired by trying
    ///    every rotation and both directions and keeping the closest match.
    ///    Hand-writing the traversal order for eight regions and getting all of
    ///    them right is not realistic — Vision walks the face contour right to
    ///    left while the canonical list runs left to right, and that single
    ///    mismatch alone pairs each cheek with the opposite one and folds the
    ///    whole mesh.
    /// 3. The similarity is refit on the full correspondence set, and only the
    ///    small leftover error is interpolated.
    public static func fit(_ landmarks: FaceLandmarks) -> [CGPoint]? {
        var contours: [(canonical: [CGPoint], detected: [CGPoint])] = []

        for (region, canonicalIndices) in correspondences {
            let detected = landmarks.points(region)
            guard detected.count >= 3, canonicalIndices.count >= 3 else { continue }
            let canonical = resample(canonicalIndices.map { canonicalPoint(at: $0) }, to: detected.count)
            contours.append((canonical, detected))
        }

        // Lips and both eyes at minimum; without them the fit has nothing to
        // anchor the parts that matter.
        guard contours.count >= 3 else { return nil }

        let coarse = Similarity(
            from: contours.map { centroid($0.canonical) },
            to: contours.map { centroid($0.detected) }
        )
        guard let coarse else { return nil }

        var sources: [CGPoint] = []
        var targets: [CGPoint] = []
        for contour in contours {
            let aligned = align(contour.canonical, to: contour.detected, under: coarse)
            sources.append(contentsOf: aligned)
            targets.append(contentsOf: contour.detected)
        }

        guard let transform = Similarity(from: sources, to: targets) else { return nil }

        // Residual each anchor still carries after the global fit.
        let anchors = sources.map(transform.apply)
        let residuals = zip(anchors, targets).map { CGPoint(x: $1.x - $0.x, y: $1.y - $0.y) }

        return (0..<CanonicalFace.vertexCount).map { index in
            let base = transform.apply(canonicalPoint(at: index))
            let correction = interpolate(at: base, anchors: anchors, residuals: residuals)
            return CGPoint(x: base.x + correction.x, y: base.y + correction.y)
        }
    }

    /// Picks the rotation and direction of a canonical contour that best matches
    /// how Vision walked the same anatomy.
    private static func align(
        _ canonical: [CGPoint],
        to detected: [CGPoint],
        under transform: Similarity
    ) -> [CGPoint] {
        let projected = canonical.map(transform.apply)
        let count = projected.count

        var best = projected
        var bestCost = CGFloat.greatestFiniteMagnitude

        for reversed in [false, true] {
            let ordered = reversed ? Array(projected.reversed()) : projected
            let orderedSource = reversed ? Array(canonical.reversed()) : canonical

            for offset in 0..<count {
                var cost: CGFloat = 0
                for index in 0..<count {
                    let candidate = ordered[(index + offset) % count]
                    let target = detected[index]
                    cost += pow(candidate.x - target.x, 2) + pow(candidate.y - target.y, 2)
                    if cost >= bestCost { break }
                }
                if cost < bestCost {
                    bestCost = cost
                    best = (0..<count).map { orderedSource[($0 + offset) % count] }
                }
            }
        }
        return best
    }

    private static func centroid(_ points: [CGPoint]) -> CGPoint {
        let count = CGFloat(points.count)
        return CGPoint(
            x: points.reduce(0) { $0 + $1.x } / count,
            y: points.reduce(0) { $0 + $1.y } / count
        )
    }

    /// Least-squares rotation, uniform scale and translation between two point sets.
    private struct Similarity {
        let a: CGFloat  // scale·cosθ
        let b: CGFloat  // scale·sinθ
        let sourceCentre: CGPoint
        let targetCentre: CGPoint

        init?(from sources: [CGPoint], to targets: [CGPoint]) {
            guard sources.count == targets.count, sources.count >= 2 else { return nil }
            let count = CGFloat(sources.count)

            let sourceCentre = CGPoint(
                x: sources.reduce(0) { $0 + $1.x } / count,
                y: sources.reduce(0) { $0 + $1.y } / count
            )
            let targetCentre = CGPoint(
                x: targets.reduce(0) { $0 + $1.x } / count,
                y: targets.reduce(0) { $0 + $1.y } / count
            )

            var dot: CGFloat = 0
            var cross: CGFloat = 0
            var norm: CGFloat = 0
            for (source, target) in zip(sources, targets) {
                let sx = source.x - sourceCentre.x, sy = source.y - sourceCentre.y
                let tx = target.x - targetCentre.x, ty = target.y - targetCentre.y
                dot += sx * tx + sy * ty
                cross += sx * ty - sy * tx
                norm += sx * sx + sy * sy
            }
            guard norm > 1e-12 else { return nil }

            self.a = dot / norm
            self.b = cross / norm
            self.sourceCentre = sourceCentre
            self.targetCentre = targetCentre
        }

        func apply(_ point: CGPoint) -> CGPoint {
            let x = point.x - sourceCentre.x
            let y = point.y - sourceCentre.y
            return CGPoint(
                x: targetCentre.x + a * x - b * y,
                y: targetCentre.y + b * x + a * y
            )
        }
    }

    /// Resamples a curve to a fixed number of points by arc length, so two
    /// contours of different densities line up along their length.
    private static func resample(_ points: [CGPoint], to count: Int) -> [CGPoint] {
        guard count > 1, points.count > 1 else { return points }

        var lengths: [CGFloat] = [0]
        for index in 1..<points.count {
            let step = hypot(
                points[index].x - points[index - 1].x,
                points[index].y - points[index - 1].y
            )
            lengths.append(lengths[index - 1] + step)
        }
        guard let total = lengths.last, total > 0 else { return points }

        return (0..<count).map { step in
            let target = total * CGFloat(step) / CGFloat(count - 1)
            var segment = 1
            while segment < lengths.count - 1 && lengths[segment] < target { segment += 1 }

            let span = lengths[segment] - lengths[segment - 1]
            let t = span > 0 ? (target - lengths[segment - 1]) / span : 0
            let a = points[segment - 1]
            let b = points[segment]
            return CGPoint(x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t)
        }
    }

    /// Shepard interpolation of the residuals left by the global fit.
    ///
    /// These are small local corrections, so squared-distance weighting blends
    /// several anchors smoothly. A sharper exponent would degenerate into
    /// nearest-neighbour lookup and step discontinuously between anchors, which
    /// is what folds triangles where the anchors crowd — along the lips.
    /// Roughly 1.5% of the photo's width. Small enough that a contour still
    /// pulls its own vertices, large enough that no single anchor can dominate
    /// its immediate neighbourhood — unbounded weights are what let one anchor
    /// drag a vertex past its neighbours and invert the triangle between them.
    private static let smoothing: CGFloat = 0.015 * 0.015

    private static func interpolate(
        at point: CGPoint,
        anchors: [CGPoint],
        residuals: [CGPoint]
    ) -> CGPoint {
        var weightSum: CGFloat = 0
        var accumulated = CGPoint.zero

        for (index, anchor) in anchors.enumerated() {
            let distanceSquared = pow(point.x - anchor.x, 2) + pow(point.y - anchor.y, 2)
            let weight = 1 / (distanceSquared + smoothing)
            weightSum += weight
            accumulated.x += residuals[index].x * weight
            accumulated.y += residuals[index].y * weight
        }

        guard weightSum > 0 else { return .zero }
        return CGPoint(x: accumulated.x / weightSum, y: accumulated.y / weightSum)
    }
}

extension FaceLandmarks {
    /// One photo-space point per canonical mesh vertex, ready for the renderer.
    public var meshPoints: [CGPoint]? {
        FaceMeshFitter.fit(self)
    }
}
