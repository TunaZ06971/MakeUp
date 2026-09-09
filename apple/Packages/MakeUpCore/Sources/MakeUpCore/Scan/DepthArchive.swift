import Foundation
import simd

/// Small, bounded raw-data archive for diagnosing/rebuilding a real scan locally.
/// Float32 sensor payloads retain NaNs (missing depth); JSON numeric arrays cannot.
public struct DepthArchive: Codable, Sendable {
  public struct Record: Codable, Sendable {
    var format = "float32-le"
    var width: Int, height: Int
    var pixels: Data
    var intrinsic: [Float], cameraToHead: [Float], resolution: [Float], center: [Float]
    var undistort: [Float], distort: [Float]
    init(_ sample: MeasuredDepthSample) {
      width = sample.width; height = sample.height
      pixels = sample.meters.withUnsafeBufferPointer { Data(buffer: $0) }
      let c = sample.calibration
      intrinsic = (0..<3).flatMap { i in (0..<3).map { c.intrinsic[i][$0] } }
      cameraToHead = (0..<4).flatMap { i in (0..<4).map { sample.cameraToHead[i][$0] } }
      resolution = [c.resolution.x, c.resolution.y]; center = [c.distortionCenter.x, c.distortionCenter.y]
      undistort = c.distortedToRectified; distort = c.rectifiedToDistorted
    }
    func restore() throws -> MeasuredDepthSample {
      guard format == "float32-le", width > 0, height > 0, width <= 1024, height <= 1024, pixels.count == width * height * 4,
            intrinsic.count == 9, cameraToHead.count == 16, resolution.count == 2, center.count == 2,
            (intrinsic + cameraToHead + resolution + center + undistort + distort).allSatisfy(\.isFinite),
            intrinsic[0] > 0, intrinsic[4] > 0, resolution.allSatisfy({ $0 > 0 }),
            undistort.count <= 1024, distort.count <= 1024 else { throw ScanError.invalid }
      let values = pixels.withUnsafeBytes { bytes in (0..<width * height).map { bytes.loadUnaligned(fromByteOffset: $0 * 4, as: Float.self) } }
      let k = simd_float3x3(columns: (SIMD3(intrinsic[0], intrinsic[1], intrinsic[2]), SIMD3(intrinsic[3], intrinsic[4], intrinsic[5]), SIMD3(intrinsic[6], intrinsic[7], intrinsic[8])))
      let columns = (0..<4).map { i in SIMD4(cameraToHead[i * 4], cameraToHead[i * 4 + 1], cameraToHead[i * 4 + 2], cameraToHead[i * 4 + 3]) }
      let transform = simd_float4x4(columns: (columns[0], columns[1], columns[2], columns[3]))
      guard abs(simd_determinant(transform)) > 0.1 else { throw ScanError.invalid }
      return MeasuredDepthSample(width: width, height: height, meters: values,
        calibration: DepthCalibration(intrinsic: k, resolution: SIMD2(resolution[0], resolution[1]),
          distortionCenter: SIMD2(center[0], center[1]), distortedToRectified: undistort, rectifiedToDistorted: distort), cameraToHead: transform)
    }
  }
  public var schemaVersion = 1
  public var records: [Record]
  public var keyframeCount: Int
  public var faceReference: [Float]
  public init(samples: [MeasuredDepthSample], views: [DepthKeyframe]) {
    records = views.map { Record($0.sample) }; keyframeCount = views.count
    faceReference = views.first?.photo.vertices ?? []
    var bytes = records.reduce(0) { $0 + $1.pixels.count }
    for index in stride(from: 0, to: samples.count, by: max(1, Int(ceil(Double(samples.count) / 24)))) {
      let record = Record(samples[index])
      if records.count >= 36 || bytes + record.pixels.count > 32_000_000 { break }
      records.append(record); bytes += record.pixels.count
    }
  }
  public func restore(photos: [ScanFrame]) throws -> (samples: [MeasuredDepthSample], views: [DepthKeyframe]) {
    guard schemaVersion == 1, records.count <= 36, keyframeCount == photos.count,
          keyframeCount >= 3, keyframeCount <= records.count,
          records.reduce(0, { $0 + $1.pixels.count }) <= 32_000_000 else { throw ScanError.invalid }
    let samples = try records.map { try $0.restore() }
    return (samples, photos.indices.map { DepthKeyframe(sample: samples[$0], photo: photos[$0]) })
  }
}
