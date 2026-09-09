import CoreGraphics
import Foundation
import Testing
import simd

import MakeUpCore

/// Assertions on the pixels that actually reach the screen.
///
/// Every other test in this suite checks geometry — landmark positions, UV
/// round-trips, mesh validity — and all of them passed while the app rendered a
/// cyan face and shattered lipstick. Geometry being right says nothing about
/// what the shader finally wrote. These tests close that gap: each one is
/// written to fail on a specific defect that shipped.
@MainActor
@Suite("Rendered output", .enabled(if: TestFace.isAvailable && VisionSupport.isAvailable))
struct RenderRegressionTests {
    /// MAC Ruby Woo — a saturated blue-red, easy to distinguish from skin.
    private let lipstick = SIMD3<Float>(0.620, 0.106, 0.196)

    /// Sample regions are derived from the detected face, never hard-coded.
    /// Guessing coordinates makes a test that passes or fails on which photo it
    /// was pointed at rather than on whether the render is correct.
    private struct Subject {
        let renderer: MakeupRenderer
        let landmarks: FaceLandmarks

        /// A patch inside the lips, inset so a soft mask edge cannot reach it.
        var lips: (x: ClosedRange<Double>, y: ClosedRange<Double>) {
            // Centre rectangles include teeth on an open mouth. Sample the lip
            // tissue between the measured inner and outer lower contours.
            let outer = landmarks.points(.outerLips)
            let inner = landmarks.points(.innerLips)
            let bottom = outer.map(\.y).max() ?? 0.6
            let innerBottom = inner.map(\.y).max() ?? bottom - 0.01
            let left = outer.map(\.x).min() ?? 0.4, right = outer.map(\.x).max() ?? 0.6
            let middle = (left + right) / 2, halfWidth = (right - left) * 0.16
            let thickness = max(0.0001, bottom - innerBottom)
            return ((middle - halfWidth)...(middle + halfWidth), (innerBottom + thickness * 0.3)...(innerBottom + thickness * 0.65))
        }

        /// Forehead: above the brows, between them, well clear of any product.
        var forehead: (x: ClosedRange<Double>, y: ClosedRange<Double>) {
            let brows = landmarks.points(.leftEyebrow) + landmarks.points(.rightEyebrow)
            let top = brows.map(\.y).min() ?? 0.2
            let centre = brows.map(\.x).reduce(0, +) / Double(max(brows.count, 1))
            return ((centre - 0.03)...(centre + 0.03), (top - 0.06)...(top - 0.02))
        }

        /// Cheek: beside the nose, below the eyes.
        var cheek: (x: ClosedRange<Double>, y: ClosedRange<Double>) {
            let eye = landmarks.points(.leftEye)
            let lips = landmarks.points(.outerLips)
            let x = eye.map(\.x).reduce(0, +) / Double(max(eye.count, 1))
            let top = eye.map(\.y).max() ?? 0.3
            let bottom = lips.map(\.y).min() ?? 0.5
            let mid = (top + bottom) / 2
            return ((x - 0.02)...(x + 0.02), (mid - 0.02)...(mid + 0.02))
        }

        private func inset(
            _ points: [CGPoint],
            by fraction: Double
        ) -> (x: ClosedRange<Double>, y: ClosedRange<Double>) {
            let xs = points.map(\.x), ys = points.map(\.y)
            let minX = xs.min() ?? 0, maxX = xs.max() ?? 1
            let minY = ys.min() ?? 0, maxY = ys.max() ?? 1
            let padX = (maxX - minX) * fraction, padY = (maxY - minY) * fraction
            return ((minX + padX)...(maxX - padX), (minY + padY)...(maxY - padY))
        }
    }

    private func makeSubject() throws -> Subject {
        let renderer = try #require(MakeupRenderer(), "no Metal device")
        let image = try TestFace.image()
        let landmarks = try #require(try FaceLandmarkService().detect(in: image))
        renderer.setPhoto(image, landmarks: try #require(landmarks.meshPoints), contours: landmarks.regions)
        return Subject(renderer: renderer, landmarks: landmarks)
    }

    private func lipLayer(intensity: Float) throws -> RenderLayer {
        RenderLayer(
            coverage: try #require(RegionMaskBaker.mask(for: .lips)),
            color: lipstick,
            intensity: intensity,
            cacheKey: "lips"
        )
    }

    /// Catches the red/blue channel swap that turned every face cyan: skin is
    /// always red-dominant, whatever the person's complexion or the lighting.
    @Test func skinStaysRedDominant() throws {
        let subject = try makeSubject()
        let frame = try #require(subject.renderer.renderForInspection(layers: []))

        for region in [subject.forehead, subject.cheek] {
            let skin = frame.average(x: region.x, y: region.y)
            #expect(
                skin.red > skin.blue,
                "skin is not red-dominant: \(skin) — the channels may be swapped"
            )
            #expect(skin.red >= skin.green, "skin is unexpectedly green: \(skin)")
        }
    }

    /// The strongest statement of the same thing: the untouched render must be
    /// the photograph, pixel for pixel.
    @Test func anUntouchedRenderMatchesTheSourcePhoto() throws {
        let subject = try makeSubject()
        let image = try TestFace.image()
        let frame = try #require(subject.renderer.renderForInspection(layers: []))

        let width = image.width, height = image.height
        var raw = [UInt8](repeating: 0, count: width * height * 4)
        raw.withUnsafeMutableBytes { buffer in
            let context = CGContext(
                data: buffer.baseAddress, width: width, height: height,
                bitsPerComponent: 8, bytesPerRow: width * 4,
                space: CGColorSpace(name: CGColorSpace.sRGB)!,
                bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue
            )
            context?.draw(image, in: CGRect(x: 0, y: 0, width: width, height: height))
        }

        for (x, y) in [(0.3, 0.3), (0.5, 0.2), (0.5, 0.5), (0.7, 0.4)] {
            let column = Int(x * Double(width)), row = Int(y * Double(height))
            let offset = (row * width + column) * 4
            let pixel = frame.pixel(atX: x, y: y)
            #expect(abs(pixel.red - Double(raw[offset]) / 255) < 0.02, "red differs at (\(x),\(y))")
            #expect(abs(pixel.green - Double(raw[offset + 1]) / 255) < 0.02, "green differs")
            #expect(abs(pixel.blue - Double(raw[offset + 2]) / 255) < 0.02, "blue differs")
        }
    }

    /// The photo must survive an empty layer list untouched.
    @Test func noMakeupLeavesThePhotoAlone() throws {
        let subject = try makeSubject()
        let bare = try #require(subject.renderer.renderForInspection(layers: []))
        let zeroIntensity = try #require(
            subject.renderer.renderForInspection(layers: [try lipLayer(intensity: 0)])
        )

        let a = bare.average(x: subject.lips.x, y: subject.lips.y)
        let b = zeroIntensity.average(x: subject.lips.x, y: subject.lips.y)
        #expect(abs(a.red - b.red) < 0.02)
        #expect(abs(a.green - b.green) < 0.02)
        #expect(abs(a.blue - b.blue) < 0.02)
    }

    /// Lipstick has to actually change the lips, and toward its own hue.
    @Test func lipstickShiftsTheLipsTowardItsColour() throws {
        let subject = try makeSubject()
        let bare = try #require(subject.renderer.renderForInspection(layers: []))
        let painted = try #require(
            subject.renderer.renderForInspection(layers: [try lipLayer(intensity: 1)])
        )

        let before = bare.average(x: subject.lips.x, y: subject.lips.y)
        let after = painted.average(x: subject.lips.x, y: subject.lips.y)

        let redOverGreenBefore = before.red - before.green
        let redOverGreenAfter = after.red - after.green
        #expect(
            redOverGreenAfter > redOverGreenBefore + 0.03,
            "lips did not move toward the product: \(before) → \(after)"
        )
    }

    /// Catches a mask that leaks — the forehead must not pick up lip colour.
    @Test func lipstickStaysOffTheForehead() throws {
        let subject = try makeSubject()
        let bare = try #require(subject.renderer.renderForInspection(layers: []))
        let painted = try #require(
            subject.renderer.renderForInspection(layers: [try lipLayer(intensity: 1)])
        )

        let before = bare.average(x: subject.forehead.x, y: subject.forehead.y)
        let after = painted.average(x: subject.forehead.x, y: subject.forehead.y)
        #expect(abs(after.red - before.red) < 0.03, "lip colour reached the forehead")
        #expect(abs(after.blue - before.blue) < 0.03)
    }

    @Test func dewyAndMatteProduceDifferentPixels() throws {
        let subject = try makeSubject()
        let mask = try #require(RegionMaskBaker.mask(for: .lips))
        let matte = RenderLayer(coverage: mask, color: lipstick, intensity: 0.9, cacheKey: "lips", finish: .matte)
        let dewy = RenderLayer(coverage: mask, color: lipstick, intensity: 0.9, cacheKey: "lips", finish: .dewy)
        let a = try #require(subject.renderer.renderForInspection(layers: [matte]))
        let b = try #require(subject.renderer.renderForInspection(layers: [dewy]))
        var changed = 0
        for i in stride(from: 0, to: a.bgra.count, by: 4) {
            if abs(Int(a.bgra[i]) - Int(b.bgra[i])) + abs(Int(a.bgra[i + 1]) - Int(b.bgra[i + 1])) > 10 { changed += 1 }
        }
        #expect(changed > 100, "Finishes did not change the final raster")
    }

    @Test func zeroIntensityIsExactlyTheOriginalEverywhere() throws {
        let subject = try makeSubject()
        let a = try #require(subject.renderer.renderForInspection(layers: []))
        let b = try #require(subject.renderer.renderForInspection(layers: [try lipLayer(intensity: 0)]))
        #expect(a.bgra == b.bgra)
    }

    @Test func automaticLipstickReachesTheMeasuredLowerLip() throws {
        let subject = try makeSubject()
        let points = subject.landmarks.points(.outerLips)
        let low = try #require(points.max { $0.y < $1.y })
        let top = try #require(points.map(\.y).min())
        let y = low.y - (low.y - top) * 0.13
        let a = try #require(subject.renderer.renderForInspection(layers: []))
        let b = try #require(subject.renderer.renderForInspection(layers: [try lipLayer(intensity: 0.9)]))
        let before = a.pixel(atX: low.x, y: y), after = b.pixel(atX: low.x, y: y)
        #expect(after.red - after.green > before.red - before.green + 0.04,
                "The lower lip was lost by the fitted mesh")
    }

    /// Catches the collapsed mesh behind the shattered lipstick: when vertices
    /// pile onto the same anchors, whole runs of triangles lose their area and
    /// their winding flips.
    @Test func fittedMeshHasNoDegenerateTriangles() throws {
        let landmarks = try #require(try FaceLandmarkService().detect(in: TestFace.image()))
        let mesh = try #require(landmarks.meshPoints)
        let triangles = CanonicalFace.triangles

        var degenerate = 0
        var negative = 0
        var total = 0

        for start in stride(from: 0, to: triangles.count, by: 3) {
            let a = mesh[Int(triangles[start])]
            let b = mesh[Int(triangles[start + 1])]
            let c = mesh[Int(triangles[start + 2])]
            // Signed area: sign carries the winding, magnitude the degeneracy.
            let area = ((b.x - a.x) * (c.y - a.y) - (c.x - a.x) * (b.y - a.y)) / 2
            total += 1
            if abs(area) < 1e-9 { degenerate += 1 }
            if area < 0 { negative += 1 }
        }

        #expect(degenerate == 0, "\(degenerate)/\(total) triangles collapsed to zero area")
        // A consistent winding means every triangle shares one sign; a fitter
        // that folds the mesh produces a mix.
        let flipped = min(negative, total - negative)
        #expect(
            Double(flipped) / Double(total) < 0.01,
            "\(flipped)/\(total) triangles are wound against the rest — the mesh is folded"
        )
    }
}
