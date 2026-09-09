import Foundation
import simd

/// Lens-corrected, measured depth. The lookup directions follow the reference
/// implementation in AVCameraCalibrationData.h, not the ambiguous property names.
public struct DepthCalibration: Sendable {
  public var intrinsic: simd_float3x3
  public var resolution: SIMD2<Float>
  public var distortionCenter: SIMD2<Float>
  public var distortedToRectified: [Float]
  public var rectifiedToDistorted: [Float]
  public init(intrinsic: simd_float3x3, resolution: SIMD2<Float>, distortionCenter: SIMD2<Float>,
              distortedToRectified: [Float] = [], rectifiedToDistorted: [Float] = []) {
    self.intrinsic = intrinsic; self.resolution = resolution; self.distortionCenter = distortionCenter
    self.distortedToRectified = distortedToRectified; self.rectifiedToDistorted = rectifiedToDistorted
  }
  public func map(_ point: SIMD2<Float>, table: [Float]) -> SIMD2<Float> {
    guard table.count >= 2 else { return point }
    let delta = point - distortionCenter
    let corner = simd_max(distortionCenter, resolution - distortionCenter)
    let position = min(Float(table.count - 1), simd_length(delta) / max(1, simd_length(corner)) * Float(table.count - 1))
    let i = min(table.count - 2, Int(position)), f = position - Float(i)
    return distortionCenter + delta * (1 + table[i] * (1 - f) + table[i + 1] * f)
  }
}

public struct MeasuredDepthSample: Sendable {
  public var width: Int, height: Int
  public var meters: [Float]
  public var calibration: DepthCalibration
  public var cameraToHead: simd_float4x4
  public var headToCamera: simd_float4x4
  public init(width: Int, height: Int, meters: [Float], calibration: DepthCalibration, cameraToHead: simd_float4x4) {
    self.width = width; self.height = height; self.meters = meters; self.calibration = calibration
    self.cameraToHead = cameraToHead; self.headToCamera = simd_inverse(cameraToHead)
  }
  public func point(x: Int, y: Int) -> SIMD3<Float>? {
    guard width > 0, height > 0, meters.count == width * height else { return nil }
    let d = meters[y * width + x]
    guard d.isFinite, d > 0.15, d < 1.0 else { return nil }
    let raw = SIMD2((Float(x) + 0.5) / Float(width), (Float(y) + 0.5) / Float(height)) * calibration.resolution
    let p = calibration.map(raw, table: calibration.distortedToRectified)
    let k = calibration.intrinsic
    let camera = SIMD4((p.x - k[2].x) / k[0].x * d, -(p.y - k[2].y) / k[1].y * d, -d, 1)
    let head = cameraToHead * camera
    return SIMD3(head.x, head.y, head.z)
  }
  /// Normalized raw sensor coordinates. The display photo is rotated separately.
  public func project(_ head: SIMD3<Float>) -> (uv: SIMD2<Float>, z: Float)? {
    let c = headToCamera * SIMD4(head, 1), k = calibration.intrinsic
    guard c.z < -0.01 else { return nil }
    let ideal = SIMD2(k[0].x * c.x / -c.z + k[2].x, k[1].y * -c.y / -c.z + k[2].y)
    let raw = calibration.map(ideal, table: calibration.rectifiedToDistorted) / calibration.resolution
    guard raw.x.isFinite, raw.y.isFinite else { return nil }
    return (raw, -c.z)
  }
  public func observedDepth(at uv: SIMD2<Float>) -> Float? {
    guard uv.x >= 0, uv.x < 1, uv.y >= 0, uv.y < 1, meters.count == width * height else { return nil }
    let x = min(width - 1, Int(uv.x * Float(width))), y = min(height - 1, Int(uv.y * Float(height)))
    let d = meters[y * width + x]
    return d.isFinite && d > 0.15 && d < 1.0 ? d : nil
  }
}

public struct DepthKeyframe: Sendable {
  public var sample: MeasuredDepthSample
  public var photo: ScanFrame
  public init(sample: MeasuredDepthSample, photo: ScanFrame) { self.sample = sample; self.photo = photo }
}

public enum DepthSurface {
  /// A bounded visible-head range surface. This is not watertight head completion,
  /// strand hair reconstruction, or recovery of an unobserved ear/back of head.
  public static func build(samples: [MeasuredDepthSample], views: [DepthKeyframe],
                           faceVertices: [Float], completedSteps: [String], resolution: Int = 224) throws -> FaceScan {
    guard samples.count >= 6, views.count >= 3, faceVertices.count >= 9,
          (32...256).contains(resolution) else { throw ScanError.insufficientDepth }
    let face = stride(from: 0, to: faceVertices.count, by: 3).map { SIMD3(faceVertices[$0], faceVertices[$0 + 1], faceVertices[$0 + 2]) }
    let low = face.reduce(SIMD3<Float>(repeating: .infinity), simd_min)
    let high = face.reduce(SIMD3<Float>(repeating: -.infinity), simd_max)
    let centerZ = (low.z + high.z) * 0.5 - 0.065
    let minY = low.y - 0.012, maxY = high.y + 0.115
    let maxX = max(abs(low.x), abs(high.x)) + 0.045
    let angle: Float = 1.75, count = resolution * resolution
    var bins = [[Float]](repeating: [], count: count)
    for sample in samples {
      try Task.checkCancellation()
      for y in 0..<sample.height { for x in 0..<sample.width {
        guard let p = sample.point(x: x, y: y), abs(p.x) <= maxX, p.y >= minY, p.y <= maxY else { continue }
        let theta = atan2(p.x, p.z - centerZ), radius = hypot(p.x, p.z - centerZ)
        guard abs(theta) < angle, radius > 0.008, radius < 0.18 else { continue }
        let u = Int((theta + angle) / (2 * angle) * Float(resolution - 1))
        let v = Int((p.y - minY) / (maxY - minY) * Float(resolution - 1))
        // Bounded reservoir; do not let one long hold dominate memory or fusion.
        if bins[v * resolution + u].count < 96 { bins[v * resolution + u].append(radius) }
      } }
    }
    var radii = [Float](repeating: .nan, count: count)
    for i in bins.indices where bins[i].count >= 3 {
      bins[i].sort()
      let median = bins[i][bins[i].count / 2]
      let inliers = bins[i].filter { abs($0 - median) < 0.004 }
      if inliers.count >= 3 { radii[i] = inliers.reduce(0, +) / Float(inliers.count) }
    }
    // Fill single sensor holes only when all four immediate observations agree.
    let measured = radii
    for y in 1..<resolution - 1 { for x in 1..<resolution - 1 {
      let i = y * resolution + x
      if measured[i].isFinite { continue }
      let neighbors = [measured[i - 1], measured[i + 1], measured[i - resolution], measured[i + resolution]]
      if neighbors.allSatisfy(\.isFinite), neighbors.max()! - neighbors.min()! < 0.004 {
        radii[i] = neighbors.reduce(0, +) / 4
      }
    } }
    var positions = [SIMD3<Float>](repeating: .zero, count: count)
    for y in 0..<resolution { for x in 0..<resolution {
      let i = y * resolution + x, theta = Float(x) / Float(resolution - 1) * 2 * angle - angle
      positions[i] = SIMD3(sin(theta) * radii[i], minY + Float(y) / Float(resolution - 1) * (maxY - minY), centerZ + cos(theta) * radii[i])
    } }
    var gridTriangles: [Int] = []
    func append(_ a: Int, _ b: Int, _ c: Int) {
      guard [a, b, c].allSatisfy({ radii[$0].isFinite }),
            simd_distance(positions[a], positions[b]) < 0.009,
            simd_distance(positions[b], positions[c]) < 0.009,
            simd_distance(positions[c], positions[a]) < 0.009 else { return }
      gridTriangles += [a, b, c]
    }
    for y in 0..<resolution - 1 { for x in 0..<resolution - 1 {
      let a = y * resolution + x, b = a + 1, c = a + resolution, d = c + 1
      append(a, b, c); append(b, d, c)
    } }
    let used = Set(gridTriangles).sorted()
    guard used.count >= 1200 else { throw ScanError.insufficientDepth }
    var remap = [Int](repeating: -1, count: count)
    for (i, original) in used.enumerated() { remap[original] = i }
    let vertices = used.flatMap { [positions[$0].x, positions[$0].y, positions[$0].z] }
    let uv = used.flatMap { [Float($0 % resolution) / Float(resolution - 1), Float($0 / resolution) / Float(resolution - 1)] }
    let triangles = gridTriangles.map { remap[$0] }
    var frames: [ScanFrame] = []
    for view in views {
      let projections = used.map { view.sample.project(positions[$0]) }
      let visible = projections.map { p -> Bool in
        guard let p, let observed = view.sample.observedDepth(at: p.uv) else { return false }
        return abs(observed - p.z) < 0.008
      }
      var weights: [Float] = []
      for t in stride(from: 0, to: triangles.count, by: 3) {
        let a = triangles[t], b = triangles[t + 1], c = triangles[t + 2]
        guard visible[a], visible[b], visible[c] else { weights.append(0); continue }
        let normal = simd_normalize(simd_cross(positions[used[b]] - positions[used[a]], positions[used[c]] - positions[used[a]]))
        let cameraNormal = view.sample.headToCamera * SIMD4(normal, 0)
        weights.append(pow(max(0, min(1, cameraNormal.z)), 4))
      }
      let portrait = projections.flatMap { p -> [Float] in
        guard let p else { return [-1, -1] }
        return [1 - p.uv.y, p.uv.x]
      }
      frames.append(ScanFrame(step: view.photo.step, image: view.photo.image, projection: portrait,
                              weights: weights, vertices: vertices, landmarks: view.photo.landmarks))
    }
    return FaceScan(source: "truedepth-measured", units: "meters", vertices: vertices, uv: uv,
                    triangles: triangles, frames: frames, expressions: [:], texture: "", completedSteps: completedSteps)
  }
}
