import CoreGraphics
import Foundation
import Testing

import MakeUpCore

private final class BundleToken {}

/// Runs against a real photograph. Drop any front-facing JPEG at
/// `apple/Tests/Resources/test-face.jpg` to enable these — the fixture is not
/// committed because face photos are personal data.
@Suite(
    "Face landmark detection",
    .enabled(if: TestFace.isAvailable && VisionSupport.isAvailable)
)
struct FaceLandmarkTests {
    private let detector = FaceLandmarkService()

    @Test func detectsAFaceAndReportsRegions() throws {
        let landmarks = try #require(try detector.detect(in: TestFace.image()))

        #expect(!landmarks.allPoints.isEmpty)
        for region in [FaceRegion.faceContour, .leftEye, .rightEye, .outerLips] {
            #expect(!landmarks.points(region).isEmpty, "missing region \(region)")
        }
    }

    /// The whole point of the conversion in `FaceLandmarkService`: Vision reports
    /// pixels from the bottom left, the rest of the app (and the web client)
    /// expects 0...1 from the top left.
    @Test func normalizesEveryPointIntoTopLeftUnitSpace() throws {
        let landmarks = try #require(try detector.detect(in: TestFace.image()))

        for point in landmarks.allPoints {
            #expect((0...1).contains(point.x), "x out of range: \(point.x)")
            #expect((0...1).contains(point.y), "y out of range: \(point.y)")
        }
    }

    /// Catches a flipped vertical axis, which range checks alone would not:
    /// with the origin at the top left, eyes must sit above the mouth.
    @Test func eyesSitAboveTheMouth() throws {
        let landmarks = try #require(try detector.detect(in: TestFace.image()))

        let eyeY = try #require(averageY(landmarks.points(.leftEye) + landmarks.points(.rightEye)))
        let lipY = try #require(averageY(landmarks.points(.outerLips)))
        #expect(eyeY < lipY, "eyes at \(eyeY) should be above lips at \(lipY)")
    }

    @Test func eyebrowsSitAboveTheEyes() throws {
        let landmarks = try #require(try detector.detect(in: TestFace.image()))

        let browY = try #require(
            averageY(landmarks.points(.leftEyebrow) + landmarks.points(.rightEyebrow))
        )
        let eyeY = try #require(averageY(landmarks.points(.leftEye) + landmarks.points(.rightEye)))
        #expect(browY < eyeY, "brows at \(browY) should be above eyes at \(eyeY)")
    }

    private func averageY(_ points: [CGPoint]) -> CGFloat? {
        guard !points.isEmpty else { return nil }
        return points.reduce(0) { $0 + $1.y } / CGFloat(points.count)
    }
}

enum VisionSupport {
    /// Vision's face landmark model cannot create an inference context in the
    /// iOS Simulator ("Could not create inference context"), so the Apple side
    /// of face detection can only be exercised on macOS or a real device. Probe
    /// instead of hard-coding a simulator check, so these tests start running by
    /// themselves if a future simulator gains support.
    static var isAvailable: Bool {
        guard let blank = blankImage() else { return false }
        do {
            // Finding no face is success here; only a thrown error means Vision
            // could not run at all.
            _ = try FaceLandmarkService().detect(in: blank)
            return true
        } catch {
            return false
        }
    }

    private static func blankImage() -> CGImage? {
        let context = CGContext(
            data: nil,
            width: 64,
            height: 64,
            bitsPerComponent: 8,
            bytesPerRow: 0,
            space: CGColorSpaceCreateDeviceRGB(),
            bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue
        )
        return context?.makeImage()
    }
}

enum TestFace {
    static var url: URL? {
        Bundle(for: BundleToken.self).url(forResource: "test-face", withExtension: "jpg")
    }

    static var isAvailable: Bool { url != nil }

    static func image() throws -> CGImage {
        let url = try #require(url)
        let data = try Data(contentsOf: url)
        return try #require(ImageDecoder.decode(data))
    }
}
