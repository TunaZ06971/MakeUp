import CoreGraphics
import Foundation

public enum SurfaceCoating {
  /// Red: coat strength; green: roughness. Actual source texture carries skin detail.
  public static func bake(_ scan: FaceScan, layers: [RenderLayer]) throws -> CGImage {
    let size = 512
    var rgba = [UInt8](repeating: 0, count: size * size * 4)
    for i in stride(from: 0, to: rgba.count, by: 4) { rgba[i + 1] = 255; rgba[i + 3] = 255 }
    for layer in layers {
      try Task.checkCancellation()
      guard let context = CGContext(data: nil, width: size, height: size, bitsPerComponent: 8, bytesPerRow: size,
        space: CGColorSpaceCreateDeviceGray(), bitmapInfo: CGImageAlphaInfo.none.rawValue) else { throw ScanError.image }
      context.draw(layer.coverage, in: CGRect(x: 0, y: 0, width: size, height: size))
      let mask = context.data!.assumingMemoryBound(to: UInt8.self), material = MaterialParameters.parameters(for: layer.finish)
      for pixel in 0..<size * size {
        let alpha = Float(mask[pixel]) / 255 * layer.intensity * layer.opacity, i = pixel * 4
        rgba[i] = UInt8(clamping: Int(Float(rgba[i]) * (1 - alpha) + min(1, material.gloss * 1.6) * alpha * 255))
        rgba[i + 1] = UInt8(clamping: Int(Float(rgba[i + 1]) * (1 - alpha) + material.roughness * alpha * 255))
      }
    }
    guard let provider = CGDataProvider(data: Data(rgba) as CFData),
          let image = CGImage(width: size, height: size, bitsPerComponent: 8, bitsPerPixel: 32, bytesPerRow: size * 4,
            space: CGColorSpace(name: CGColorSpace.linearSRGB)!, bitmapInfo: CGBitmapInfo(rawValue: CGImageAlphaInfo.premultipliedLast.rawValue),
            provider: provider, decode: nil, shouldInterpolate: true, intent: .defaultIntent) else { throw ScanError.image }
    var materialScan = scan
    materialScan.frames = scan.frames.map { frame in
      let lookup = frame.landmarks.map { UVLookup(landmarks: $0.map { CGPoint(x: Double($0.x), y: Double($0.y)) }) }
      var copy = frame
      copy.projection = stride(from: 0, to: frame.projection.count, by: 2).flatMap { i -> [Float] in
        guard let uv = lookup?.uv(atPhotoPoint: CGPoint(x: Double(frame.projection[i]), y: Double(frame.projection[i + 1]))) else { return [-1, -1] }
        return [Float(uv.x), Float(uv.y)]
      }
      return copy
    }
    return try ScanAtlas.bake(materialScan, images: Array(repeating: image, count: scan.frames.count), size: 512, colour: false)
  }
}
