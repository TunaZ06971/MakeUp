import CoreGraphics
import Foundation

public struct StrokePoint: Codable, Hashable, Sendable {
    public var u: Double
    public var v: Double
    public var startsSegment: Bool?

    public init(u: Double, v: Double, startsSegment: Bool? = nil) {
        self.u = u
        self.v = v
        self.startsSegment = startsSegment
    }
}

/// A brush stroke, recorded in canonical UV space rather than photo pixels.
///
/// Stored this way a look is a recipe, not a picture: it replays onto a side
/// view, onto a new photo, or onto someone else's face, and still lands on the
/// same lip or the same cheekbone. It is also tiny compared with saving the
/// painted texture, which matters because face photos never leave the device.
public struct Stroke: Codable, Hashable, Sendable {
    public var productId: String
    public var colorIndex: Int
    /// Brush radius in UV units (0...1 across the whole face atlas).
    public var radius: Double
    /// 0...1 opacity the finished stroke contributes.
    public var flow: Double
    public var points: [StrokePoint]

    public init(
        productId: String,
        colorIndex: Int = 0,
        radius: Double,
        flow: Double,
        points: [StrokePoint]
    ) {
        self.productId = productId
        self.colorIndex = colorIndex
        self.radius = radius
        self.flow = flow
        self.points = points
    }
}

/// Accumulates strokes into a UV-space coverage mask the renderer samples.
///
/// Two buffers, because one is not enough to make a brush feel right: committed
/// holds finished strokes, live holds the stroke in progress at full opacity.
/// Stamps along a single stroke therefore never darken each other where they
/// overlap — one pass of the brush reads as one even layer, the way real product
/// does — while the stroke still appears live under the finger.
@MainActor
public final class PaintLayer {
    private let size = RegionMaskBaker.maskSize
    private let committed: CGContext
    private let live: CGContext
    private var flow: Double = 1
    private var cachedImage: CGImage?

    public init?() {
        guard let committed = Self.makeContext(size: RegionMaskBaker.maskSize),
              let live = Self.makeContext(size: RegionMaskBaker.maskSize)
        else { return nil }
        self.committed = committed
        self.live = live
    }

    /// The mask to hand the renderer. Rebuilt only when strokes changed.
    public var coverage: CGImage? {
        if let cachedImage { return cachedImage }
        guard let base = committed.makeImage() else { return nil }
        guard flow > 0, let overlay = live.makeImage(),
              let composed = Self.makeContext(size: size)
        else {
            cachedImage = base
            return base
        }

        let rect = CGRect(x: 0, y: 0, width: size, height: size)
        composed.draw(base, in: rect)
        composed.saveGState()
        composed.setBlendMode(.plusLighter)
        composed.setAlpha(CGFloat(flow))
        composed.draw(overlay, in: rect)
        composed.restoreGState()

        cachedImage = composed.makeImage()
        return cachedImage
    }

    public func clear() {
        let rect = CGRect(x: 0, y: 0, width: size, height: size)
        Self.erase(committed, rect)
        Self.erase(live, rect)
        cachedImage = nil
    }

    public func beginStroke(flow: Double) {
        self.flow = min(max(flow, 0), 1)
        Self.erase(live, CGRect(x: 0, y: 0, width: size, height: size))
        cachedImage = nil
    }

    /// Interpolates between samples so a fast drag stays a continuous line
    /// instead of a row of dots.
    public func extendStroke(from: StrokePoint?, to: StrokePoint, radius: Double) {
        if let from {
            let distance = hypot(to.u - from.u, to.v - from.v)
            let step = max(radius * 0.25, 1.0 / Double(size))
            let count = max(1, Int(ceil(distance / step)))
            for index in 1...count {
                let t = Double(index) / Double(count)
                stamp(
                    StrokePoint(
                        u: from.u + (to.u - from.u) * t,
                        v: from.v + (to.v - from.v) * t
                    ),
                    radius: radius
                )
            }
        } else {
            stamp(to, radius: radius)
        }
        cachedImage = nil
    }

    public func endStroke() {
        if let overlay = live.makeImage() {
            // Additive, not alpha-blended. `setAlpha` + a normal draw is a
            // cross-fade: the live buffer's black background would blend over
            // the finished strokes and darken them a shade with every pass.
            // Adding leaves untouched areas exactly as they were, and lets a
            // second pass of the brush genuinely build up.
            committed.saveGState()
            committed.setBlendMode(.plusLighter)
            committed.setAlpha(CGFloat(flow))
            committed.draw(overlay, in: CGRect(x: 0, y: 0, width: size, height: size))
            committed.restoreGState()
        }
        Self.erase(live, CGRect(x: 0, y: 0, width: size, height: size))
        cachedImage = nil
    }

    public func cancelStroke() {
        Self.erase(live, CGRect(x: 0, y: 0, width: size, height: size)); cachedImage = nil
    }

    /// Replays a whole stroke — used when loading a saved look.
    public func replay(_ stroke: Stroke) {
        beginStroke(flow: stroke.flow)
        var previous: StrokePoint?
        for point in stroke.points {
            extendStroke(from: point.startsSegment == true ? nil : previous, to: point, radius: stroke.radius)
            previous = point
        }
        endStroke()
    }

    private func stamp(_ point: StrokePoint, radius: Double) {
        let scale = CGFloat(size)
        let x = CGFloat(point.u) * scale
        // Core Graphics draws bottom-up; the UV atlas is authored top-down.
        let y = scale - CGFloat(point.v) * scale
        let r = max(CGFloat(radius) * scale, 1)

        // Soft-edged brush: opaque core fading to nothing at the rim.
        guard let gradient = CGGradient(
            colorsSpace: CGColorSpaceCreateDeviceGray(),
            colors: [
                CGColor(gray: 1, alpha: 1),
                CGColor(gray: 0, alpha: 1),
            ] as CFArray,
            locations: [0, 1]
        ) else { return }

        // `.lighten` keeps overlapping stamps within one stroke from compounding.

        live.saveGState()
        live.setBlendMode(.lighten)
        live.drawRadialGradient(
            gradient,
            startCenter: CGPoint(x: x, y: y), startRadius: r * 0.3,
            endCenter: CGPoint(x: x, y: y), endRadius: r,
            options: [.drawsBeforeStartLocation]
        )
        live.restoreGState()
    }

    private static func erase(_ context: CGContext, _ rect: CGRect) {
        context.saveGState()
        context.setBlendMode(.copy)
        context.setFillColor(gray: 0, alpha: 1)
        context.fill(rect)
        context.restoreGState()
    }

    private static func makeContext(size: Int) -> CGContext? {
        let context = CGContext(
            data: nil,
            width: size,
            height: size,
            bitsPerComponent: 8,
            bytesPerRow: size,
            space: CGColorSpaceCreateDeviceGray(),
            bitmapInfo: CGImageAlphaInfo.none.rawValue
        )
        context?.setFillColor(gray: 0, alpha: 1)
        context?.fill(CGRect(x: 0, y: 0, width: size, height: size))
        return context
    }
}
