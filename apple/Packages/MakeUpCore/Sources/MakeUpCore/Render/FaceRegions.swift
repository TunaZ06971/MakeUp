import CoreGraphics
import Foundation

public struct RegionShape: Sendable {
    /// Closed polygons in canonical UV space (eyes and cheeks come in pairs).
    public let polygons: [[CGPoint]]
    /// Feather radius as a fraction of the canonical inter-eye distance.
    public let feather: CGFloat
}

/// Mirror of the web client's `regions.ts`. Both read the same canonical UVs and
/// use the same indices and constants, so a region covers exactly the same
/// anatomy on either platform — the parameters here are the contract.
public enum FaceRegions {
    // MediaPipe Face Mesh indices. Each list walks a closed loop in order so it
    // can be filled directly as a polygon. Every index is < 468, because the
    // canonical model has no iris vertices.
    private static let outerLips = [
        61, 146, 91, 181, 84, 17, 314, 405, 321, 375, 291, 409, 270, 269, 267, 0, 37, 39, 40, 185,
    ]
    private static let innerLips = [
        78, 95, 88, 178, 87, 14, 317, 402, 318, 324, 308, 415, 310, 311, 312, 13, 82, 81, 80, 191,
    ]
    private static let leftEye = [33, 7, 163, 144, 145, 153, 154, 155, 133, 173, 157, 158, 159, 160, 161, 246]
    private static let rightEye = [362, 382, 381, 380, 374, 373, 390, 249, 263, 466, 388, 387, 386, 385, 384, 398]
    private static let leftEyeUpper = [33, 246, 161, 160, 159, 158, 157, 173, 133]
    private static let rightEyeUpper = [263, 466, 388, 387, 386, 385, 384, 398, 362]
    private static let leftBrowLower = [46, 53, 52, 65, 55]
    private static let rightBrowLower = [285, 295, 282, 283, 276]
    private static let leftBrow = [70, 63, 105, 66, 107, 55, 65, 52, 53, 46]
    private static let rightBrow = [300, 293, 334, 296, 336, 285, 295, 282, 283, 276]
    private static let faceOval = [
        10, 338, 297, 332, 284, 251, 389, 356, 454, 323, 361, 288, 397, 365, 379, 378, 400, 377,
        152, 148, 176, 149, 150, 136, 172, 58, 132, 93, 234, 127, 162, 21, 54, 103, 67, 109,
    ]

    // Anchors for the regions the mesh has no outline for.
    private static let leftEyeOuter = 33
    private static let rightEyeOuter = 263
    private static let leftCheekAnchor = 50
    private static let rightCheekAnchor = 280
    private static let noseTip = 4
    private static let noseBridgeTop = 168
    private static let cupidsBowCenter = 0

    /// Scale reference for the heuristic regions. In canonical space this is a
    /// constant, so blush and contour sit in the same anatomical place for
    /// everyone — no per-photo estimation, and nothing to drift between platforms.
    public static let eyeDistance: CGFloat = {
        let left = CanonicalFace.uv(at: leftEyeOuter)
        let right = CanonicalFace.uv(at: rightEyeOuter)
        return hypot(right.x - left.x, right.y - left.y)
    }()

    public static func shape(for region: ApplicableRegion) -> RegionShape? {
        shapes[region]
    }

    /// Fixed for every face and every photo, so this is computed once.
    public static let shapes = makeShapes(pointAt: CanonicalFace.uv(at:))

    public static func makeShapes(pointAt: (Int) -> CGPoint) -> [ApplicableRegion: RegionShape] {
        func pick(_ indices: [Int]) -> [CGPoint] { indices.map(pointAt) }
        let left = pointAt(33), right = pointAt(263)
        let scale = hypot(right.x - left.x, right.y - left.y)
        let up = CGPoint(x: (right.y - left.y) / scale, y: -(right.x - left.x) / scale)
        func eyelidShape(_ upper: [Int], _ browIndices: [Int], lift: CGFloat) -> [CGPoint] {
            let lash = pick(upper)
            var brow = pick(browIndices)
            if hypot(lash[0].x - brow[0].x, lash[0].y - brow[0].y) > hypot(lash[0].x - brow.last!.x, lash[0].y - brow.last!.y) { brow.reverse() }
            let ceiling = lash.enumerated().map { i, p -> CGPoint in
                let f = CGFloat(i) / CGFloat(lash.count - 1) * CGFloat(brow.count - 1)
                let a = brow[Int(f)], b = brow[min(Int(f) + 1, brow.count - 1)]
                let fraction = f - floor(f)
                let q = CGPoint(x: a.x + (b.x - a.x) * fraction, y: a.y + (b.y - a.y) * fraction)
                let amount = lift * pow(sin(CGFloat.pi * CGFloat(i) / CGFloat(lash.count - 1)), 0.5)
                return CGPoint(x: p.x + (q.x - p.x) * amount, y: p.y + (q.y - p.y) * amount)
            }
            return lash + ceiling.reversed()
        }
        func liner(_ indices: [Int], _ direction: CGFloat) -> [CGPoint] {
            let line = pick(indices)
            let edge = line.enumerated().map { i, p in
                let width = scale * 0.012 * sin(CGFloat.pi * CGFloat(i) / CGFloat(line.count - 1))
                return CGPoint(x: p.x + up.x * width * direction, y: p.y + up.y * width * direction)
            }
            return line + edge.reversed()
        }
        let leftCheek = pointAt(leftCheekAnchor)
        let rightCheek = pointAt(rightCheekAnchor)
        let tip = pointAt(noseTip)
        let bridge = pointAt(noseBridgeTop)
        let bow = pointAt(cupidsBowCenter)

        return [
            // Lips minus the mouth opening, so colour never lands on teeth.
            .lips: RegionShape(
                polygons: [pick(outerLips), Array(pick(innerLips).reversed())],
                feather: 0.003
            ),

            .eyelid: RegionShape(
                polygons: [
                    eyelidShape(leftEyeUpper, leftBrowLower, lift: 0.65),
                    eyelidShape(rightEyeUpper, rightBrowLower, lift: 0.65),
                ],
                feather: 0.035
            ),

            // The crease reaches higher toward the brow than the lid does.
            .crease: RegionShape(
                polygons: [
                    eyelidShape(leftEyeUpper, leftBrowLower, lift: 0.95),
                    eyelidShape(rightEyeUpper, rightBrowLower, lift: 0.95),
                ],
                feather: 0.05
            ),

            .eyelidLine: RegionShape(polygons: [liner(leftEyeUpper, 1), liner(rightEyeUpper, 1)], feather: 0.002),
            .waterline: RegionShape(polygons: [liner(Array(leftEye.prefix(9)), -1), liner([263, 249, 390, 373, 374, 380, 381, 382, 362], -1)], feather: 0.002),

            .eyebrows: RegionShape(polygons: [pick(leftBrow), pick(rightBrow)], feather: 0.015),

            // Soft ellipses on the apples of the cheeks, tilted along the cheekbone.
            .cheeks: RegionShape(
                polygons: [
                    ellipse(center: leftCheek, rx: scale * 0.34, ry: scale * 0.24, rotation: -0.25),
                    ellipse(center: rightCheek, rx: scale * 0.34, ry: scale * 0.24, rotation: 0.25),
                ],
                feather: 0.08
            ),

            // Higher and narrower than blush, angled up toward the temples.
            .cheekbones: RegionShape(
                polygons: [
                    ellipse(
                        center: CGPoint(x: leftCheek.x - scale * 0.06, y: leftCheek.y - scale * 0.18),
                        rx: scale * 0.3, ry: scale * 0.1, rotation: -0.32
                    ),
                    ellipse(
                        center: CGPoint(x: rightCheek.x + scale * 0.06, y: rightCheek.y - scale * 0.18),
                        rx: scale * 0.3, ry: scale * 0.1, rotation: 0.32
                    ),
                ],
                feather: 0.06
            ),

            .noseBridge: RegionShape(
                polygons: [
                    ellipse(
                        center: CGPoint(x: (tip.x + bridge.x) / 2, y: (tip.y + bridge.y) / 2),
                        rx: scale * 0.055,
                        ry: hypot(tip.x - bridge.x, tip.y - bridge.y) / 2,
                        rotation: 0
                    )
                ],
                feather: 0.05
            ),

            .cupidsBow: RegionShape(
                polygons: [
                    ellipse(
                        center: CGPoint(x: bow.x, y: bow.y - scale * 0.05),
                        rx: scale * 0.11, ry: scale * 0.045, rotation: 0
                    )
                ],
                feather: 0.06
            ),

            .faceFull: RegionShape(polygons: [pick(faceOval), pick(outerLips), pick(leftEye), pick(rightEye), pick(leftBrow), pick(rightBrow)], feather: 0.015),
        ]
    }

    private static func ellipse(
        center: CGPoint,
        rx: CGFloat,
        ry: CGFloat,
        rotation: CGFloat
    ) -> [CGPoint] {
        let steps = 24
        return (0..<steps).map { step in
            let angle = CGFloat(step) / CGFloat(steps) * 2 * .pi
            let x = cos(angle) * rx
            let y = sin(angle) * ry
            return CGPoint(
                x: center.x + x * cos(rotation) - y * sin(rotation),
                y: center.y + x * sin(rotation) + y * cos(rotation)
            )
        }
    }

}
