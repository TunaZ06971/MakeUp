import Foundation
import simd

/// ARKit camera coordinates use +X right, +Y up and -Z forward in the raw sensor image.
/// Captures in this app rotate that image clockwise into portrait, without mirroring.
public enum ScanProjection {
  public static func portraitDirection(_ raw: SIMD3<Float>) -> SIMD3<Float> {
    SIMD3(raw.y, -raw.x, raw.z)
  }
  public static func portraitPoint(
    _ camera: SIMD3<Float>, intrinsics: simd_float3x3, resolution: SIMD2<Float>
  ) -> SIMD2<Float> {
    let depth = -camera.z
    guard depth > 0, resolution.x > 0, resolution.y > 0 else { return SIMD2(repeating: .nan) }
    let u = (intrinsics[0, 0] * camera.x / depth + intrinsics[2, 0]) / resolution.x
    let v = (intrinsics[1, 1] * -camera.y / depth + intrinsics[2, 1]) / resolution.y
    return SIMD2(1 - v, u)
  }
}
