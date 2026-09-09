import CoreGraphics
import Foundation
import Testing

import MakeUpCore

/// The fitter is the one place where Apple's face data and the shared mesh have
/// to be reconciled, so it gets checked against a real photograph rather than
/// synthetic input.
@Suite(
    "Canonical mesh fitting",
    .enabled(if: TestFace.isAvailable && VisionSupport.isAvailable)
)
struct FaceMeshFitterTests {
    private func fittedMesh() throws -> [CGPoint] {
        let landmarks = try #require(try FaceLandmarkService().detect(in: TestFace.image()))
        return try #require(landmarks.meshPoints, "fitting produced no mesh")
    }

    @Test func producesOnePointPerCanonicalVertex() throws {
        #expect(try fittedMesh().count == CanonicalFace.vertexCount)
    }

    /// The mesh is drawn in the photo's normalized space; a vertex outside it
    /// would stretch a triangle across the image.
    @Test func staysWithinThePhoto() throws {
        for point in try fittedMesh() {
            #expect((-0.1...1.1).contains(point.x), "x escaped the photo: \(point.x)")
            #expect((-0.1...1.1).contains(point.y), "y escaped the photo: \(point.y)")
        }
    }

    /// Catches a flipped or transposed fit, which range checks alone would not.
    @Test func keepsAnatomyInOrder() throws {
        let mesh = try fittedMesh()
        // Canonical indices: upper lip centre, eye centres, chin.
        let lip = mesh[0]
        let leftEye = mesh[159]
        let rightEye = mesh[386]
        let chin = mesh[152]

        #expect(leftEye.y < lip.y, "left eye should sit above the mouth")
        #expect(rightEye.y < lip.y, "right eye should sit above the mouth")
        #expect(lip.y < chin.y, "the mouth should sit above the chin")
        #expect(leftEye.x < rightEye.x, "the eyes should not be swapped")
    }

    /// The whole point of anchoring on Vision's contours: where it reports a
    /// lip, the fitted mesh must agree.
    @Test func lipVerticesLandOnTheDetectedLips() throws {
        let landmarks = try #require(try FaceLandmarkService().detect(in: TestFace.image()))
        let mesh = try #require(landmarks.meshPoints)

        let detected = landmarks.points(.outerLips)
        #expect(!detected.isEmpty)

        // Every canonical outer-lip vertex should have a detected lip point nearby.
        let outerLipIndices = [61, 291, 0, 17]
        for index in outerLipIndices {
            let vertex = mesh[index]
            let closest = detected
                .map { hypot($0.x - vertex.x, $0.y - vertex.y) }
                .min() ?? .greatestFiniteMagnitude
            #expect(closest < 0.05, "canonical vertex \(index) is \(closest) from any detected lip point")
        }
    }
}
