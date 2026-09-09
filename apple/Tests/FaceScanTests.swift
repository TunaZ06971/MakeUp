import CoreGraphics
import Foundation
import MakeUpCore
import Testing
import simd

@Suite("Guided face scan")
struct FaceScanTests {
  @Test func onlyTheOptionalProfileCanBeSkippedAndIsRecordedAsMissing() {
    var guide = ScanProtocol(side: "left")
    let cannotSkipFront = guide.skipProfile()
    #expect(!cannotSkipFront)
    var time = 0.0
    for yaw in [0.0, 0.5] { for _ in 0..<9 {
      time += 100
      _ = guide.update(observation(time, yaw: yaw))
    } }
    #expect(guide.step == "leftProfile")
    let skipped = guide.skipProfile()
    #expect(skipped)
    #expect(guide.step == "up")
    #expect(guide.skippedSteps == ["leftProfile"])
    let cannotSkipUp = guide.skipProfile()
    #expect(!cannotSkipUp)
  }
  private func observation(
    _ time: Double, yaw: Double = 0, pitch: Double = 0, blink: Double = 0, mouth: Double = 0,
    count: Int = 1
  ) -> ScanObservation {
    .init(
      time: time, yaw: yaw, pitch: pitch, roll: 0, blink: blink, mouth: mouth, faceSize: 0.5,
      brightness: 0.5, sharpness: 100, faceCount: count, centered: true, tracking: true)
  }
  @Test func requiresAnglesAndExpressionRelease() {
    var guide = ScanProtocol()
    var time = 0.0
    var accepted: [String] = []
    var expressions: [String] = []
    func hold(
      yaw: Double = 0, pitch: Double = 0, blink: Double = 0, mouth: Double = 0, count: Int = 1,
      frames: Int = 9
    ) {
      for _ in 0..<frames {
        time += 100
        let action = guide.update(
          observation(time, yaw: yaw, pitch: pitch, blink: blink, mouth: mouth, count: count))
        if let step = action.accepted { accepted.append(step) }
        if let expression = action.expression { expressions.append(expression) }
      }
    }
    hold()
    #expect(guide.step == "left")
    hold(frames: 20)
    #expect(guide.step == "left")
    hold(yaw: 0.5, frames: 4)
    hold(yaw: 0.5, count: 2)
    hold(yaw: 0.5, frames: 4)
    #expect(guide.step == "left")
    hold(yaw: 0.5)
    hold(yaw: -0.5)
    hold(pitch: 0.3)
    hold(pitch: -0.3)
    hold(blink: 0.8)
    #expect(guide.step == "blink")
    hold()
    hold(mouth: 0.8)
    #expect(guide.step == "mouth")
    hold()
    hold()
    #expect(accepted == ScanProtocol.steps)
    #expect(expressions == ["blink", "mouth"])
    #expect(guide.complete)
  }
  @Test func aLongTrackingGapDoesNotCountAsHolding() {
    var guide = ScanProtocol()
    for time in stride(from: 100.0, through: 500.0, by: 100) { _ = guide.update(observation(time)) }
    _ = guide.update(observation(2000))
    #expect(guide.index == 0)
    #expect(guide.progress == 0)
  }
  @Test func rawCameraCoordinatesRotateIntoPortrait() {
    let k = simd_float3x3(columns: (SIMD3(100, 0, 0), SIMD3(0, 100, 0), SIMD3(100, 50, 1)))
    let center = ScanProjection.portraitPoint(
      SIMD3(0, 0, -1), intrinsics: k, resolution: SIMD2(200, 100))
    #expect(simd_distance(center, SIMD2(0.5, 0.5)) < 0.0001)
    let upper = ScanProjection.portraitPoint(
      SIMD3(0, 0.2, -1), intrinsics: k, resolution: SIMD2(200, 100))
    #expect(upper.x > center.x)
    #expect(upper.y == center.y)
    #expect(ScanProjection.portraitDirection(SIMD3(0, 1, 0)) == SIMD3(1, 0, 0))
    #expect(
      !ScanProjection.portraitPoint(SIMD3(0, 0, 1), intrinsics: k, resolution: SIMD2(200, 100)).x
        .isFinite)
  }
  private func sample() throws -> FaceScan {
    let ctx = try #require(
      CGContext(
        data: nil, width: 32, height: 32, bitsPerComponent: 8, bytesPerRow: 128,
        space: CGColorSpace(name: CGColorSpace.sRGB)!,
        bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue))
    let colors: [CGColor] = [
      CGColor(red: 1, green: 0, blue: 0, alpha: 1), CGColor(red: 0, green: 1, blue: 0, alpha: 1),
      CGColor(red: 0, green: 0, blue: 1, alpha: 1), CGColor(gray: 1, alpha: 1),
    ]
    for i in 0..<4 {
      ctx.setFillColor(colors[i])
      ctx.fill(CGRect(x: (i % 2) * 16, y: i < 2 ? 16 : 0, width: 16, height: 16))
    }
    let image = try #require(ctx.makeImage())
    let encoded = try #require(ScanImage.encode(image, png: true))
    let vertices: [Float] = [-1, 1, 0, 1, 1, 0, 1, -1, 0, -1, -1, 0]
    let frame = ScanFrame(
      step: "front", image: encoded, projection: [0.01, 0.01, 0.99, 0.01, 0.99, 0.99, 0.01, 0.99],
      weights: [1, 1], vertices: vertices)
    return FaceScan(
      source: "mediapipe-rgb", units: "relative", vertices: vertices,
      uv: [0.01, 0.99, 0.99, 0.99, 0.99, 0.01, 0.01, 0.01], triangles: [0, 1, 2, 0, 2, 3],
      frames: [frame, frame, frame], expressions: [:], texture: encoded, completedSteps: [])
  }
  @Test func atlasPreservesUpDownAndLeftRight() throws {
    let scan = try sample()
    let image = try ScanAtlas.bake(scan, size: 32)
    let bytes = try #require(image.dataProvider?.data) as Data
    func rgb(_ x: Int, _ y: Int) -> [UInt8] {
      let i = y * image.bytesPerRow + x * 4
      return Array(bytes[i..<i + 3])
    }
    let red = rgb(8, 8)
    let green = rgb(24, 8)
    let blue = rgb(8, 24)
    let white = rgb(24, 24)
    #expect(red[0] > 200 && red[1] < 70 && red[2] < 70)
    #expect(green[1] > 200 && green[0] < 70 && green[2] < 70)
    #expect(blue[2] > 200 && blue[0] < 70 && blue[1] < 70)
    #expect(white.allSatisfy { $0 > 200 })
  }
  @Test func boundedInterchangeRejectsRemoteImagesAndInvalidIndices() throws {
    var scan = try sample()
    try scan.validate()
    let decoded = try FaceScan.decode(JSONEncoder().encode(scan))
    #expect(decoded.vertices == scan.vertices)
    scan.frames[0].image = "https://example.com/private.jpg"
    #expect(throws: ScanError.self) { try scan.validate() }
    scan = try sample()
    scan.triangles[0] = 99999
    #expect(throws: ScanError.self) { try scan.validate() }
  }
  @Test func neutralFusionRejectsAnOutlierThroughMedian() throws {
    let scan = try sample()
    var frames = scan.frames
    frames[0].vertices[0] = -1
    frames[1].vertices[0] = -0.9
    frames[2].vertices[0] = 8
    #expect(abs(FaceScan.fuse(frames)[0] + 0.9) < 0.0001)
  }
}
