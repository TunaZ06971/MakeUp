import CoreGraphics
import Foundation
import ImageIO
import UniformTypeIdentifiers

public struct ScanPoint: Codable, Sendable {
  public var x: Float, y: Float, z: Float
  public init(x: Float, y: Float, z: Float = 0) {
    self.x = x
    self.y = y
    self.z = z
  }
}
public struct ScanFrame: Codable, Sendable {
  public var step: String
  public var image: String
  public var projection: [Float]
  public var weights: [Float]
  public var vertices: [Float]
  public var landmarks: [ScanPoint]?
  public init(
    step: String, image: String, projection: [Float], weights: [Float], vertices: [Float],
    landmarks: [ScanPoint]? = nil
  ) {
    self.step = step
    self.image = image
    self.projection = projection
    self.weights = weights
    self.vertices = vertices
    self.landmarks = landmarks
  }
}
public struct FaceScan: Codable, Sendable, Identifiable {
  public var schemaVersion = 1
  public var id = UUID().uuidString
  public var createdAt = ISO8601DateFormatter().string(from: .now)
  public var source: String
  public var units: String
  public var vertices: [Float]
  public var uv: [Float]
  public var triangles: [Int]
  public var frames: [ScanFrame]
  public var expressions: [String: [Float]]
  public var texture: String
  public var completedSteps: [String]
  public var depthArchive: DepthArchive? = nil
  public init(
    source: String, units: String, vertices: [Float], uv: [Float], triangles: [Int],
    frames: [ScanFrame], expressions: [String: [Float]], texture: String, completedSteps: [String]
  ) {
    self.source = source
    self.units = units
    self.vertices = vertices
    self.uv = uv
    self.triangles = triangles
    self.frames = frames
    self.expressions = expressions
    self.texture = texture
    self.completedSteps = completedSteps
  }
  public func validate() throws {
    let count = vertices.count / 3
    guard schemaVersion == 1, ["mediapipe-rgb", "arkit-truedepth", "arkit-rgb", "truedepth-measured"].contains(source),
      ["relative", "meters"].contains(units),
      id.count <= 100,
      ISO8601DateFormatter().date(from: createdAt) != nil
        || ISO8601DateFormatter.fractional.date(from: createdAt) != nil,
      count >= 3, count <= (source == "truedepth-measured" ? 65536 : 10000), vertices.count % 3 == 0,
      vertices.allSatisfy({ $0.isFinite && abs($0) < 100 }),
      uv.count == count * 2, uv.allSatisfy({ $0.isFinite && (0...1).contains($0) }),
      !triangles.isEmpty, triangles.count <= (source == "truedepth-measured" ? 400000 : 180000), triangles.count % 3 == 0,
      triangles.allSatisfy({ (0..<count).contains($0) }),
      (3...12).contains(frames.count), ScanImage.data(texture) != nil
    else { throw ScanError.invalid }
    for frame in frames {
      guard frame.projection.count == count * 2, frame.projection.allSatisfy(\.isFinite),
        frame.vertices.count == vertices.count, frame.vertices.allSatisfy(\.isFinite),
        frame.weights.count == triangles.count / 3,
        frame.weights.allSatisfy({ $0.isFinite && (0...1).contains($0) }),
        ScanImage.data(frame.image) != nil
      else { throw ScanError.invalid }
      if let landmarks = frame.landmarks {
        guard (468...478).contains(landmarks.count),
          landmarks.allSatisfy({ $0.x.isFinite && $0.y.isFinite && $0.z.isFinite })
        else { throw ScanError.invalid }
      }
    }
    for shape in expressions.values {
      guard shape.count == vertices.count, shape.allSatisfy(\.isFinite) else {
        throw ScanError.invalid
      }
    }
  }
  public static func decode(_ data: Data) throws -> FaceScan {
    guard data.count < 100_000_000 else { throw ScanError.invalid }
    let scan = try JSONDecoder().decode(Self.self, from: data)
    try scan.validate()
    return scan
  }
  public static func fuse(_ frames: [ScanFrame]) -> [Float] {
    guard let first = frames.first else { return [] }
    return first.vertices.indices.map { i in
      let values = frames.map { $0.vertices[i] }.sorted()
      return values[values.count / 2]
    }
  }
}
extension ISO8601DateFormatter {
  fileprivate static var fractional: ISO8601DateFormatter {
    let f = ISO8601DateFormatter()
    f.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
    return f
  }
}
public enum ScanError: Error { case invalid, image, unsupported, insufficientDepth }
public enum ScanImage {
  public static func data(_ url: String) -> Data? {
    guard url.count < 12_000_000,
      url.hasPrefix("data:image/jpeg;base64,") || url.hasPrefix("data:image/png;base64,"),
      let comma = url.firstIndex(of: ",")
    else { return nil }
    return Data(base64Encoded: String(url[url.index(after: comma)...]))
  }
  public static func decode(_ url: String) -> CGImage? {
    data(url).flatMap { ImageDecoder.decode($0, maxPixelSize: 4096) }
  }
  public static func encode(_ image: CGImage, png: Bool = false) -> String? {
    let data = NSMutableData()
    guard
      let destination = CGImageDestinationCreateWithData(
        data, (png ? UTType.png : UTType.jpeg).identifier as CFString, 1, nil)
    else { return nil }
    CGImageDestinationAddImage(
      destination, image, [kCGImageDestinationLossyCompressionQuality: 0.92] as CFDictionary)
    guard CGImageDestinationFinalize(destination) else { return nil }
    return "data:image/\(png ? "png" : "jpeg");base64," + (data as Data).base64EncodedString()
  }
}
public struct LocalScanStore: Sendable {
  public init() {}
  private func url(_ uid: String) throws -> URL {
    let base = try FileManager.default.url(
      for: .applicationSupportDirectory, in: .userDomainMask, appropriateFor: nil, create: true)
    var directory = base.appending(path: "FaceScans/\(uid)", directoryHint: .isDirectory)
    try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
    var values = URLResourceValues()
    values.isExcludedFromBackup = true
    try directory.setResourceValues(values)
    return directory.appending(path: "face.makeupscan")
  }
  public func load(uid: String) throws -> FaceScan? {
    let path = try url(uid)
    guard FileManager.default.fileExists(atPath: path.path) else { return nil }
    return try FaceScan.decode(Data(contentsOf: path))
  }
  public func save(_ scan: FaceScan, uid: String) throws {
    try scan.validate()
    let data = try JSONEncoder().encode(scan)
    #if os(iOS)
      try data.write(to: url(uid), options: [.atomic, .completeFileProtectionUnlessOpen])
    #else
      try data.write(to: url(uid), options: .atomic)
    #endif
  }
  public func delete(uid: String) throws {
    let path = try url(uid)
    if FileManager.default.fileExists(atPath: path.path) {
      try FileManager.default.removeItem(at: path)
    }
  }
}
