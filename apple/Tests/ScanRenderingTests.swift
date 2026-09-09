import CoreGraphics
import Foundation
import MakeUpCore
import Metal
import SceneKit
import Testing

@testable import MakeUp

private final class ScanFixtureBundle: NSObject {}

@MainActor @Suite("3D surface rendering")
struct ScanRenderingTests {
  @Test func coatingIsLimitedToMakeupAndUsesFinishRoughness() throws {
    guard let input = Bundle(for: ScanFixtureBundle.self).url(forResource: "scan-fixture", withExtension: "json") else { return }
    let scan = try FaceScan.decode(Data(contentsOf: input))
    let mask = try #require(RegionMaskBaker.mask(for: .lips))
    func coating(_ finish: FinishType) throws -> Data {
      let layer = RenderLayer(coverage: mask, color: SIMD3(0.7, 0.1, 0.2), intensity: 0.65,
        cacheKey: "lips", finish: finish, opacity: 0.92, region: .lips)
      let result = try SurfaceCoating.bake(scan, layers: [layer])
      return try #require(result.dataProvider?.data) as Data
    }
    let matte = try coating(.matte), dewy = try coating(.dewy)
    let pixels = stride(from: 0, to: dewy.count, by: 4)
    let coated = pixels.filter { dewy[$0] > 8 }
    #expect(coated.count > 100)
    #expect(coated.count < dewy.count / 4 / 5)
    #expect(coated.allSatisfy { dewy[$0] > matte[$0] })
    #expect(coated.contains { dewy[$0 + 1] < matte[$0 + 1] })
    let scene = ScanScene(); scene.load(scan)
    let material = try #require(scene.face.geometry?.firstMaterial)
    #expect(material.lightingModel == .physicallyBased)
    #expect(material.emission.contents != nil)
    #expect(scene.face.geometry?.sources(for: .normal).first != nil)
  }
  @Test func webCapturePackageRendersAndRotatesInNativeScene() throws {
    guard
      let input = Bundle(for: ScanFixtureBundle.self).url(
        forResource: "scan-fixture", withExtension: "json")
    else { return }
    let scan = try FaceScan.decode(Data(contentsOf: input))
    #expect(scan.vertices.count == 1404)
    let scene = ScanScene()
    scene.load(scan)
    let renderer = SCNRenderer(device: MTLCreateSystemDefaultDevice(), options: nil)
    renderer.scene = scene.scene
    renderer.pointOfView = scene.camera
    func snapshot() throws -> CGImage {
      let image = renderer.snapshot(
        atTime: 0, with: CGSize(width: 640, height: 640), antialiasingMode: .multisampling4X)
      #if os(macOS)
        return try #require(image.cgImage(forProposedRect: nil, context: nil, hints: nil))
      #else
        return try #require(image.cgImage)
      #endif
    }
    let front = try snapshot()
    scene.orient(-0.8)
    let side = try snapshot()
    let a = try #require(front.dataProvider?.data) as Data
    let b = try #require(side.dataProvider?.data) as Data
    #expect(a != b)
    let output = FileManager.default.temporaryDirectory.appending(
      path: "makeup-render", directoryHint: .isDirectory)
    try FileManager.default.createDirectory(at: output, withIntermediateDirectories: true)
    for (name, image) in [("scan-front", front), ("scan-left", side)] {
      let encoded = try #require(ScanImage.encode(image, png: true))
      let data = try #require(ScanImage.data(encoded))
      try data.write(to: output.appending(path: "\(name).png"))
    }
    scene.orient(0)
    for (index, color) in [
      (10, CGColor(red: 1, green: 0, blue: 0, alpha: 1)),
      (152, CGColor(red: 0, green: 0, blue: 1, alpha: 1)),
    ] {
      let sphere = SCNSphere(radius: 0.08)
      sphere.firstMaterial?.diffuse.contents = color
      sphere.firstMaterial?.lightingModel = .constant
      let node = SCNNode(geometry: sphere)
      node.simdPosition =
        SIMD3(
          scan.vertices[index * 3], scan.vertices[index * 3 + 1], scan.vertices[index * 3 + 2] + 0.2
        ) + scene.face.simdPosition
      scene.scene.rootNode.addChildNode(node)
    }
    let markers = try snapshot()
    let markerURL = try #require(ScanImage.encode(markers, png: true))
    let markerData = try #require(ScanImage.data(markerURL))
    try markerData.write(to: output.appending(path: "scan-orientation-markers.png"))
    // Native rebaking of the Web package verifies projection/UV interchange as well.
    let atlas = try ScanAtlas.bake(scan)
    let encoded = try #require(ScanImage.encode(atlas, png: true))
    try #require(ScanImage.data(encoded)).write(to: output.appending(path: "scan-atlas.png"))
  }
}
