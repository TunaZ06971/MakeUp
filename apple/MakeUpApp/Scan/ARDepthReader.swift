#if os(iOS)
import ARKit
import AVFoundation
import MakeUpCore

enum ARDepthReader {
  static func read(_ frame: ARFrame, face: ARFaceAnchor) -> MeasuredDepthSample? {
    guard let depth = frame.capturedDepthData,
          abs(frame.capturedDepthDataTimestamp - frame.timestamp) < 0.04,
          let calibration = depth.cameraCalibrationData else { return nil }
    let converted = depth.converting(toDepthDataType: kCVPixelFormatType_DepthFloat32)
    let map = converted.depthDataMap
    let width = CVPixelBufferGetWidth(map), height = CVPixelBufferGetHeight(map)
    guard width > 0, height > 0, width * height <= 1_000_000 else { return nil }
    guard CVPixelBufferLockBaseAddress(map, .readOnly) == kCVReturnSuccess else { return nil }
    defer { CVPixelBufferUnlockBaseAddress(map, .readOnly) }
    guard let address = CVPixelBufferGetBaseAddress(map) else { return nil }
    let stride = CVPixelBufferGetBytesPerRow(map) / MemoryLayout<Float>.stride
    let pointer = address.assumingMemoryBound(to: Float.self)
    var meters = [Float](repeating: 0, count: width * height)
    for y in 0..<height { for x in 0..<width { meters[y * width + x] = pointer[y * stride + x] } }
    func floats(_ data: Data?) -> [Float] {
      guard let data, data.count % 4 == 0 else { return [] }
      return data.withUnsafeBytes { bytes in
        (0..<data.count / 4).map { bytes.loadUnaligned(fromByteOffset: $0 * 4, as: Float.self) }
      }
    }
    let dimensions = calibration.intrinsicMatrixReferenceDimensions
    let k = calibration.intrinsicMatrix
    guard dimensions.width > 0, dimensions.height > 0, k[0].x > 0, k[1].y > 0 else { return nil }
    let sample = MeasuredDepthSample(width: width, height: height, meters: meters,
      calibration: DepthCalibration(intrinsic: k, resolution: SIMD2(Float(dimensions.width), Float(dimensions.height)),
        distortionCenter: SIMD2(Float(calibration.lensDistortionCenter.x), Float(calibration.lensDistortionCenter.y)),
        distortedToRectified: floats(calibration.inverseLensDistortionLookupTable),
        rectifiedToDistorted: floats(calibration.lensDistortionLookupTable)),
      cameraToHead: simd_inverse(face.transform) * frame.camera.transform)
    // Reject a misregistered depth/calibration pair instead of building a displaced head.
    var residuals: [Float] = []
    for i in Swift.stride(from: 0, to: face.geometry.vertices.count, by: 16) {
      guard let p = sample.project(face.geometry.vertices[i]), let observed = sample.observedDepth(at: p.uv) else { continue }
      residuals.append(abs(observed - p.z))
    }
    residuals.sort()
    guard residuals.count >= 20, residuals[residuals.count / 2] < 0.025 else { return nil }
    return sample
  }
}
#endif
