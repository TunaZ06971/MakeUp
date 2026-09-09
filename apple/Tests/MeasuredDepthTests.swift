import CoreGraphics
import Foundation
import MakeUpCore
import Testing
import simd

@Suite("Measured depth reconstruction")
struct MeasuredDepthTests {
  private func sphere() -> MeasuredDepthSample {
    let size = 128, focal: Float = 240, center = Float(size) / 2, radius: Float = 0.085
    let k = simd_float3x3(columns: (SIMD3(focal, 0, 0), SIMD3(0, focal, 0), SIMD3(center, center, 1)))
    var matrix = matrix_identity_float4x4; matrix.columns.3 = SIMD4(0, 0, 0.4, 1)
    var depth = [Float](repeating: .nan, count: size * size)
    // Ray/sphere intersections are independent ground truth, not the reconstruction equations.
    for y in 0..<size { for x in 0..<size {
      let ray = SIMD3((Float(x) + 0.5 - center) / focal, -(Float(y) + 0.5 - center) / focal, -1)
      let origin = SIMD3<Float>(0, 0, 0.4)
      let a = simd_dot(ray, ray), b = 2 * simd_dot(origin, ray), c = simd_dot(origin, origin) - radius * radius
      let discriminant = b * b - 4 * a * c
      if discriminant >= 0 { depth[y * size + x] = (-b - sqrt(discriminant)) / (2 * a) }
    } }
    return MeasuredDepthSample(width: size, height: size, meters: depth,
      calibration: DepthCalibration(intrinsic: k, resolution: SIMD2(Float(size), Float(size)), distortionCenter: SIMD2(center, center)), cameraToHead: matrix)
  }
  @Test func measuredPointsReprojectAndMissingSensorPixelsStayMissing() throws {
    let sample = sphere(), p = try #require(sample.point(x: 64, y: 64))
    let projected = try #require(sample.project(p))
    #expect(simd_distance(projected.uv, SIMD2(64.5 / 128, 64.5 / 128)) < 0.00001)
    #expect(abs(simd_length(p) - 0.085) < 0.00001)
    #expect(sample.point(x: 0, y: 0) == nil)
  }
  @Test func radialCalibrationUsesTheProvidedDirections() {
    let calibration = DepthCalibration(intrinsic: matrix_identity_float3x3, resolution: SIMD2(100, 100),
      distortionCenter: SIMD2(50, 50), distortedToRectified: [-0.1, -0.1], rectifiedToDistorted: [0.1, 0.1])
    #expect(calibration.map(SIMD2(80, 50), table: calibration.distortedToRectified).x == 77)
    #expect(calibration.map(SIMD2(80, 50), table: calibration.rectifiedToDistorted).x == 83)
  }
  @Test func fusionKeepsMeasuredShapeAndExtendsBeyondTheFaceTemplateWithoutInventingABack() throws {
    let sample = sphere()
    let context = try #require(CGContext(data: nil, width: 16, height: 16, bitsPerComponent: 8, bytesPerRow: 64,
      space: CGColorSpace(name: CGColorSpace.sRGB)!, bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue))
    context.setFillColor(CGColor(gray: 0.5, alpha: 1)); context.fill(CGRect(x: 0, y: 0, width: 16, height: 16))
    let cgImage = try #require(context.makeImage())
    let image = try #require(ScanImage.encode(cgImage, png: true))
    let reference: [Float] = [-0.06, -0.065, 0.045, 0.06, 0.065, 0.075, 0, 0, 0.085]
    let views = ["front", "left", "finish"].map { step in DepthKeyframe(sample: sample,
      photo: ScanFrame(step: step, image: image, projection: [], weights: [], vertices: reference)) }
    let samples = [MeasuredDepthSample](repeating: sample, count: 12)
    var scan = try DepthSurface.build(samples: samples, views: views, faceVertices: reference, completedSteps: [], resolution: 128)
    scan.texture = image
    try scan.validate()
    let vertices = stride(from: 0, to: scan.vertices.count, by: 3).map { SIMD3(scan.vertices[$0], scan.vertices[$0 + 1], scan.vertices[$0 + 2]) }
    let errors = vertices.map { abs(simd_length($0) - 0.085) }.sorted()
    #expect(errors[errors.count / 2] < 0.003)
    #expect(vertices.map(\.y).max()! > 0.075)
    #expect(vertices.allSatisfy { $0.z > -0.005 })
    #expect(scan.source == "truedepth-measured")
    #expect(scan.expressions.isEmpty)
    let archive = DepthArchive(samples: samples, views: views)
    let restored = try JSONDecoder().decode(DepthArchive.self, from: JSONEncoder().encode(archive)).restore(photos: views.map(\.photo))
    #expect(restored.samples[0].meters[0].isNaN)
    #expect(restored.samples[0].meters[64 * 128 + 64] == sample.meters[64 * 128 + 64])
    #expect(restored.views.count == 3)
    let empty = MeasuredDepthSample(width: 128, height: 128, meters: [Float](repeating: .nan, count: 128 * 128), calibration: sample.calibration, cameraToHead: sample.cameraToHead)
    #expect(throws: ScanError.self) { try DepthSurface.build(samples: Array(repeating: empty, count: 6), views: views, faceVertices: reference, completedSteps: []) }
  }
}
