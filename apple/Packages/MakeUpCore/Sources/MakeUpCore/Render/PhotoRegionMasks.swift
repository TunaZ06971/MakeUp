import Accelerate
import CoreGraphics
import Foundation

/// Automatic regions follow the detected contours at photo resolution.
/// Hand-painted masks remain in the shared UV atlas for multi-view replay.
final class PhotoRegionMasks {
    private let width: Int, height: Int
    private let shapes: [ApplicableRegion: RegionShape]
    private let eyeDistance: CGFloat
    private var cache: [ApplicableRegion: CGImage] = [:]

    init(width: Int, height: Int, landmarks: [CGPoint], contours: [FaceRegion: [CGPoint]] = [:]) {
        self.width = width; self.height = height
        func point(_ i: Int) -> CGPoint {
            CGPoint(x: landmarks[i].x * CGFloat(width), y: landmarks[i].y * CGFloat(height))
        }
        var resolved = FaceRegions.makeShapes(pointAt: point)
        func pixels(_ region: FaceRegion) -> [CGPoint] {
            (contours[region] ?? []).map { CGPoint(x: $0.x * CGFloat(width), y: $0.y * CGFloat(height)) }
        }
        let outer = pixels(.outerLips), inner = pixels(.innerLips)
        if outer.count >= 3 {
            resolved[.lips] = RegionShape(polygons: [outer] + (inner.count >= 3 ? [inner] : []), feather: 0.003)
        }
        let leftBrow = pixels(.leftEyebrow), rightBrow = pixels(.rightEyebrow)
        if leftBrow.count >= 3 && rightBrow.count >= 3 {
            resolved[.eyebrows] = RegionShape(polygons: [leftBrow, rightBrow], feather: 0.015)
        }
        shapes = resolved
        eyeDistance = hypot(point(33).x - point(263).x, point(33).y - point(263).y)
    }

    func mask(for region: ApplicableRegion) -> CGImage? {
        if let cached = cache[region] { return cached }
        guard let shape = shapes[region], let context = CGContext(
            data: nil, width: width, height: height, bitsPerComponent: 8, bytesPerRow: width,
            space: CGColorSpaceCreateDeviceGray(), bitmapInfo: CGImageAlphaInfo.none.rawValue
        ) else { return nil }
        context.setFillColor(gray: 0, alpha: 1)
        context.fill(CGRect(x: 0, y: 0, width: width, height: height))
        let path = CGMutablePath()
        for polygon in shape.polygons {
            let points = polygon.map { CGPoint(x: $0.x, y: CGFloat(height) - $0.y) }
            if region == .lips {
                path.move(to: points[0])
                for i in points.indices {
                    let p0 = points[(i + points.count - 1) % points.count], p1 = points[i]
                    let p2 = points[(i + 1) % points.count], p3 = points[(i + 2) % points.count]
                    path.addCurve(to: p2,
                        control1: CGPoint(x: p1.x + (p2.x - p0.x) / 6, y: p1.y + (p2.y - p0.y) / 6),
                        control2: CGPoint(x: p2.x - (p3.x - p1.x) / 6, y: p2.y - (p3.y - p1.y) / 6))
                }
            } else { path.addLines(between: points) }
            path.closeSubpath()
        }
        context.addPath(path); context.setFillColor(gray: 1, alpha: 1)
        context.fillPath(using: .evenOdd)
        guard let raw = context.makeImage(), var source = try? vImage_Buffer(cgImage: raw),
              var destination = try? vImage_Buffer(width: width, height: height, bitsPerPixel: 8)
        else { return nil }
        defer { source.free(); destination.free() }
        // Three box passes approximate the CSS Gaussian used on Web.
        let radius = max(0.5, shape.feather * eyeDistance)
        var kernel = UInt32(max(1, round(radius * 2)))
        if kernel % 2 == 0 { kernel += 1 }
        for _ in 0..<3 {
            guard vImageBoxConvolve_Planar8(&source, &destination, nil, 0, 0, kernel, kernel, 0, vImage_Flags(kvImageEdgeExtend)) == kvImageNoError else { return nil }
            swap(&source, &destination)
        }
        if [.lips, .eyelidLine, .waterline, .faceFull].contains(region), let data = context.data {
            let original = data.assumingMemoryBound(to: UInt8.self)
            let blurred = source.data.assumingMemoryBound(to: UInt8.self)
            for y in 0..<height {
                for x in 0..<width {
                    let i = y * source.rowBytes + x
                    blurred[i] = UInt8(Int(blurred[i]) * Int(original[y * context.bytesPerRow + x]) / 255)
                }
            }
        }
        guard let output = CGContext(data: source.data, width: width, height: height,
            bitsPerComponent: 8, bytesPerRow: source.rowBytes,
            space: CGColorSpaceCreateDeviceGray(), bitmapInfo: CGImageAlphaInfo.none.rawValue)?.makeImage()
        else { return nil }
        cache[region] = output
        return output
    }

    static func means(image: CGImage, landmarks: [CGPoint], contours: [FaceRegion: [CGPoint]] = [:]) -> [ApplicableRegion: Float] {
        let width = 256, height = max(1, Int((256.0 * Double(image.height) / Double(image.width)).rounded()))
        guard let context = CGContext(data: nil, width: width, height: height, bitsPerComponent: 8,
            bytesPerRow: width * 4, space: CGColorSpace(name: CGColorSpace.sRGB)!,
            bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue | CGBitmapInfo.byteOrder32Big.rawValue)
        else { return [:] }
        context.draw(image, in: CGRect(x: 0, y: 0, width: width, height: height))
        guard let data = context.data else { return [:] }
        let pixels = data.assumingMemoryBound(to: UInt8.self)
        let masks = PhotoRegionMasks(width: width, height: height, landmarks: landmarks, contours: contours)
        func linear(_ byte: UInt8) -> Float {
            let c = Float(byte) / 255
            return c <= 0.04045 ? c / 12.92 : pow((c + 0.055) / 1.055, 2.4)
        }
        var result: [ApplicableRegion: Float] = [:]
        for region in ApplicableRegion.allCases {
            guard let image = masks.mask(for: region), var buffer = try? vImage_Buffer(cgImage: image) else { continue }
            defer { buffer.free() }
            let mask = buffer.data.assumingMemoryBound(to: UInt8.self)
            var sum: Float = 0, weight: Float = 0
            for y in 0..<height {
                for x in 0..<width {
                    let i = y * context.bytesPerRow + x * 4
                    let w = Float(mask[y * buffer.rowBytes + x]) / 255
                    sum += (0.2126 * linear(pixels[i]) + 0.7152 * linear(pixels[i + 1]) + 0.0722 * linear(pixels[i + 2])) * w
                    weight += w
                }
            }
            result[region] = weight > 0 ? max(0.015, sum / weight) : 0.2
        }
        return result
    }
}
