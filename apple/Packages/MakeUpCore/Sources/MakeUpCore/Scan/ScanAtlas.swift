import CoreGraphics
import Foundation
import simd

public enum ScanAtlas {
  private static let linear: [Float] = (0...255).map {
    let v = Float($0) / 255
    return v <= 0.04045 ? v / 12.92 : pow((v + 0.055) / 1.055, 2.4)
  }
  private struct Pixels {
    var width: Int, height: Int
    var data: [UInt8]
    var colour: Bool
    init(_ image: CGImage, colour: Bool = true) throws {
      self.colour = colour
      width = image.width; height = image.height
      guard let context = CGContext(data: nil, width: width, height: height, bitsPerComponent: 8,
                                    bytesPerRow: width * 4, space: CGColorSpace(name: colour ? CGColorSpace.sRGB : CGColorSpace.linearSRGB)!,
                                    bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue) else { throw ScanError.image }
      context.draw(image, in: CGRect(x: 0, y: 0, width: width, height: height))
      data = Array(UnsafeBufferPointer(start: context.data!.assumingMemoryBound(to: UInt8.self), count: width * height * 4))
    }
    func rgb(_ i: Int) -> SIMD3<Float> { colour ? SIMD3(linear[Int(data[i])], linear[Int(data[i + 1])], linear[Int(data[i + 2])]) : SIMD3(Float(data[i]), Float(data[i + 1]), Float(data[i + 2])) / 255 }
    func sample(_ uv: SIMD2<Float>) -> SIMD3<Float>? {
      let x = uv.x * Float(width) - 0.5, y = uv.y * Float(height) - 0.5
      guard x >= 0, y >= 0, x < Float(width - 1), y < Float(height - 1) else { return nil }
      let ix = Int(x), iy = Int(y), dx = x - Float(ix), dy = y - Float(iy), i = (iy * width + ix) * 4
      return (rgb(i) * (1 - dx) + rgb(i + 4) * dx) * (1 - dy)
        + (rgb(i + width * 4) * (1 - dx) + rgb(i + width * 4 + 4) * dx) * dy
    }
  }
  /// Adjacent triangles share the same normalized blend field. Exposure is
  /// estimated from the untouched photographs, including when baking makeup.
  public static func bake(_ scan: FaceScan, images supplied: [CGImage]? = nil, size: Int = 1024, colour: Bool = true) throws -> CGImage {
    guard (16...2048).contains(size), !scan.frames.isEmpty else { throw ScanError.image }
    let originals = try (!colour ? supplied : nil) ?? scan.frames.map { frame -> CGImage in
      guard let image = ScanImage.decode(frame.image) else { throw ScanError.image }; return image
    }
    let calibration = try originals.map { try Pixels($0, colour: colour) }
    let images = try supplied?.map { try Pixels($0, colour: colour) } ?? calibration
    guard images.count == scan.frames.count else { throw ScanError.image }
    let count = scan.uv.count / 2, front = scan.frames.firstIndex(where: { $0.step == "front" }) ?? 0
    var fields = [[Float]](repeating: [Float](repeating: 0, count: count), count: scan.frames.count)
    var counts = [Float](repeating: 0, count: count)
    for t in stride(from: 0, to: scan.triangles.count, by: 3) {
      for k in 0..<3 {
        let v = scan.triangles[t + k]; counts[v] += 1
        for f in scan.frames.indices { fields[f][v] += scan.frames[f].weights[t / 3] }
      }
    }
    for v in 0..<count {
      var sum: Float = 0
      for f in scan.frames.indices {
        let p = scan.frames[f].projection
        let inside = p[v * 2] > 0 && p[v * 2] < 1 && p[v * 2 + 1] > 0 && p[v * 2 + 1] < 1
        fields[f][v] = inside ? pow(fields[f][v] / max(1, counts[v]), 2) * (f == front ? 48 : 1) : 0
        sum += fields[f][v]
      }
      if sum > 1e-12 { for f in scan.frames.indices { fields[f][v] /= sum } }
    }
    var gains = [SIMD3<Float>](repeating: SIMD3(repeating: 1), count: images.count)
    for f in scan.frames.indices where f != front && colour {
      var ratios = [[Float]](repeating: [], count: 3)
      for t in stride(from: 0, to: scan.triangles.count, by: 3) {
        if scan.frames[f].weights[t / 3] < 0.15 || scan.frames[front].weights[t / 3] < 0.15 { continue }
        func center(_ frame: ScanFrame) -> SIMD2<Float> {
          (0..<3).reduce(SIMD2<Float>.zero) { sum, k in
            let v = scan.triangles[t + k]
            return sum + SIMD2(frame.projection[v * 2], frame.projection[v * 2 + 1]) / 3
          }
        }
        guard let a = calibration[front].sample(center(scan.frames[front])),
              let b = calibration[f].sample(center(scan.frames[f])) else { continue }
        for c in 0..<3 where a[c] > 0.025 && b[c] > 0.025 && a[c] < 0.8 && b[c] < 0.8 { ratios[c].append(a[c] / b[c]) }
      }
      for c in 0..<3 where ratios[c].count >= 12 {
        ratios[c].sort(); gains[f][c] = max(0.7, min(1.43, ratios[c][ratios[c].count / 2]))
      }
    }
    var bytes = [UInt8](repeating: 255, count: size * size * 4), observed = [Bool](repeating: false, count: size * size)
    for i in stride(from: 0, to: bytes.count, by: 4) { bytes[i] = colour ? 25 : 0; bytes[i + 1] = colour ? 23 : 255; bytes[i + 2] = colour ? 26 : 0 }
    func encode(_ value: Float) -> UInt8 {
      let v = max(0, min(1, value))
      let srgb = !colour ? v : v <= 0.0031308 ? 12.92 * v : 1.055 * pow(v, 1 / 2.4) - 0.055
      return UInt8(clamping: Int((srgb * 255).rounded()))
    }
    for t in stride(from: 0, to: scan.triangles.count, by: 3) {
      if t % 300 == 0 { try Task.checkCancellation() }
      let ids = Array(scan.triangles[t..<t + 3])
      let points = ids.map { SIMD2(scan.uv[$0 * 2] * Float(size), (1 - scan.uv[$0 * 2 + 1]) * Float(size)) }
      let a = points[0], b = points[1], c = points[2]
      let det = (b.y - c.y) * (a.x - c.x) + (c.x - b.x) * (a.y - c.y)
      if abs(det) < 1e-8 { continue }
      let minX = max(0, Int(floor(min(a.x, b.x, c.x)))), maxX = min(size - 1, Int(ceil(max(a.x, b.x, c.x))))
      let minY = max(0, Int(floor(min(a.y, b.y, c.y)))), maxY = min(size - 1, Int(ceil(max(a.y, b.y, c.y))))
      if minX > maxX || minY > maxY { continue }
      for y in minY...maxY { for x in minX...maxX {
        let p = SIMD2(Float(x) + 0.5, Float(y) + 0.5)
        let u = ((b.y - c.y) * (p.x - c.x) + (c.x - b.x) * (p.y - c.y)) / det
        let v = ((c.y - a.y) * (p.x - c.x) + (a.x - c.x) * (p.y - c.y)) / det
        let w = 1 - u - v
        if min(u, v, w) < -1e-6 { continue }
        var sum = SIMD3<Float>.zero, total: Float = 0
        for f in scan.frames.indices {
          let weight = fields[f][ids[0]] * u + fields[f][ids[1]] * v + fields[f][ids[2]] * w
          if weight < 1e-5 { continue }
          let projection = scan.frames[f].projection
          func uv(_ i: Int) -> SIMD2<Float> { SIMD2(projection[i * 2], projection[i * 2 + 1]) }
          guard let color = images[f].sample(uv(ids[0]) * u + uv(ids[1]) * v + uv(ids[2]) * w) else { continue }
          sum += color * gains[f] * weight; total += weight
        }
        if total < 1e-8 { continue }
        let i = y * size + x, color = sum / total
        bytes[i * 4] = encode(color.x); bytes[i * 4 + 1] = encode(color.y); bytes[i * 4 + 2] = encode(color.z); observed[i] = true
      } }
    }
    for _ in 0..<2 {
      var padding: [(Int, Int)] = []
      for y in 1..<size - 1 { for x in 1..<size - 1 {
        let i = y * size + x
        if !observed[i], let n = [i - 1, i + 1, i - size, i + size].first(where: { observed[$0] }) { padding.append((i, n)) }
      } }
      for (i, n) in padding { for c in 0..<3 { bytes[i * 4 + c] = bytes[n * 4 + c] }; observed[i] = true }
    }
    guard let provider = CGDataProvider(data: Data(bytes) as CFData),
      let image = CGImage(width: size, height: size, bitsPerComponent: 8, bitsPerPixel: 32, bytesPerRow: size * 4,
                          space: CGColorSpace(name: colour ? CGColorSpace.sRGB : CGColorSpace.linearSRGB)!, bitmapInfo: CGBitmapInfo(rawValue: CGImageAlphaInfo.premultipliedLast.rawValue),
                          provider: provider, decode: nil, shouldInterpolate: true, intent: .defaultIntent) else { throw ScanError.image }
    return image
  }
}
