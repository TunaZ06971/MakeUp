import CoreGraphics
import Foundation

/// Region masks live in canonical UV space, so they are identical for every face
/// and every photo — baked once for the whole session rather than per photo.
public enum RegionMaskBaker {
    /// Matches the web client. 2048² would cost 16 MB per GPU upload and become
    /// the bottleneck while a brush is moving.
    public static let maskSize = 1024

    private static let cache = Cache()

    public static func mask(for region: ApplicableRegion) -> CGImage? {
        cache.mask(for: region)
    }

    private final class Cache: @unchecked Sendable {
        private var storage: [ApplicableRegion: CGImage] = [:]
        private let lock = NSLock()

        func mask(for region: ApplicableRegion) -> CGImage? {
            lock.lock()
            defer { lock.unlock() }
            if let cached = storage[region] { return cached }
            guard let shape = FaceRegions.shape(for: region), let baked = bake(shape) else {
                return nil
            }
            storage[region] = baked
            return baked
        }
    }

    /// Fills the polygons and feathers the edge.
    ///
    /// The even-odd rule matters: lips are an outer loop plus a reversed inner
    /// loop, so colour never lands on teeth.
    private static func bake(_ shape: RegionShape) -> CGImage? {
        let size = maskSize
        guard let context = CGContext(
            data: nil,
            width: size,
            height: size,
            bitsPerComponent: 8,
            bytesPerRow: size,
            space: CGColorSpaceCreateDeviceGray(),
            bitmapInfo: CGImageAlphaInfo.none.rawValue
        ) else { return nil }

        context.setFillColor(gray: 0, alpha: 1)
        context.fill(CGRect(x: 0, y: 0, width: size, height: size))

        let path = CGMutablePath()
        for polygon in shape.polygons where polygon.count >= 3 {
            // Core Graphics draws bottom-up; the UV atlas is authored top-down,
            // so flip here rather than at sample time.
            let scaled = polygon.map {
                CGPoint(x: $0.x * CGFloat(size), y: CGFloat(size) - $0.y * CGFloat(size))
            }
            path.addLines(between: scaled)
            path.closeSubpath()
        }

        context.setFillColor(gray: 1, alpha: 1)
        context.addPath(path)
        context.fillPath(using: .evenOdd)

        guard var image = context.makeImage() else { return nil }
        let blur = shape.feather * FaceRegions.eyeDistance * CGFloat(size)
        if blur > 0.5, let blurred = MaskBlur.apply(to: image, radius: blur, size: size) {
            image = blurred
        }
        return MaskBlur.normalisePeak(image, size: size) ?? image
    }
}
