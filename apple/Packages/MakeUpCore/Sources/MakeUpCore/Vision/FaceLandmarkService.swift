import CoreGraphics
import Foundation
import Vision

public enum FaceRegion: String, CaseIterable, Sendable {
    case faceContour, leftEye, rightEye, leftEyebrow, rightEyebrow
    case nose, noseCrest, medianLine, outerLips, innerLips, leftPupil, rightPupil
}

public struct FaceLandmarks: Sendable {
    /// Every detected point, in image-normalized coordinates with the origin at
    /// the top left — matching the web client's MediaPipe output so the region
    /// geometry can stay identical across platforms.
    public let allPoints: [CGPoint]
    public let regions: [FaceRegion: [CGPoint]]
    /// Face bounding box, also top-left normalized.
    public let boundingBox: CGRect
    public let roll: Double
    public let yaw: Double
    public let pitch: Double

    public func points(_ region: FaceRegion) -> [CGPoint] {
        regions[region] ?? []
    }
}

public struct FaceLandmarkService: Sendable {
    public init() {}

    public func detect(in image: CGImage) throws -> FaceLandmarks? {
        let request = VNDetectFaceLandmarksRequest()
        try VNImageRequestHandler(cgImage: image, options: [:]).perform([request])
        guard let face = request.results?.first else { return nil }

        let size = CGSize(width: image.width, height: image.height)
        var regions: [FaceRegion: [CGPoint]] = [:]
        var all: [CGPoint] = []

        if let landmarks = face.landmarks {
            let sources: [(FaceRegion, VNFaceLandmarkRegion2D?)] = [
                (.faceContour, landmarks.faceContour),
                (.leftEye, landmarks.leftEye),
                (.rightEye, landmarks.rightEye),
                (.leftEyebrow, landmarks.leftEyebrow),
                (.rightEyebrow, landmarks.rightEyebrow),
                (.nose, landmarks.nose),
                (.noseCrest, landmarks.noseCrest),
                (.medianLine, landmarks.medianLine),
                (.outerLips, landmarks.outerLips),
                (.innerLips, landmarks.innerLips),
                (.leftPupil, landmarks.leftPupil),
                (.rightPupil, landmarks.rightPupil),
            ]
            for (region, source) in sources {
                guard let source else { continue }
                let points = normalized(source.pointsInImage(imageSize: size), in: size)
                regions[region] = points
                all.append(contentsOf: points)
            }
        }

        return FaceLandmarks(
            allPoints: all,
            regions: regions,
            boundingBox: flipVertically(face.boundingBox),
            roll: face.roll?.doubleValue ?? 0,
            yaw: face.yaw?.doubleValue ?? 0,
            pitch: face.pitch?.doubleValue ?? 0
        )
    }

    /// Vision reports points in image pixels with the origin at the bottom left.
    /// Some OS versions have been seen returning values slightly outside the
    /// image, so clamp defensively rather than trusting the range.
    private func normalized(_ points: [CGPoint], in size: CGSize) -> [CGPoint] {
        points.map { point in
            CGPoint(
                x: min(max(point.x / size.width, 0), 1),
                y: min(max(1 - point.y / size.height, 0), 1)
            )
        }
    }

    private func flipVertically(_ rect: CGRect) -> CGRect {
        CGRect(x: rect.minX, y: 1 - rect.maxY, width: rect.width, height: rect.height)
    }
}
