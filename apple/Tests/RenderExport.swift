import CoreGraphics
import Foundation
import ImageIO
import Testing
import UniformTypeIdentifiers
import simd

import MakeUpCore

private final class ExportBundleToken {}

/// Writes rendered frames to disk so they can be looked at.
///
/// Not an assertion — a way to actually see the output, which is the step whose
/// absence let a cyan face and shattered lipstick ship. Enabled only when
/// MAKEUP_EXPORT_DIR is set, so ordinary test runs stay silent.
@MainActor
@Suite("Render export", .enabled(if: ProcessInfo.processInfo.environment["MAKEUP_EXPORT_DIR"] != nil))
struct RenderExport {
    @Test func writeFrames() throws {
        // The host app is sandboxed, so frames go to its own container and the
        // path is printed for whoever needs to collect them.
        let directory = FileManager.default.temporaryDirectory
            .appending(path: "makeup-render", directoryHint: .isDirectory)
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        print("RENDER_EXPORT_DIR=\(directory.path)")
        let bundle = Bundle(for: ExportBundleToken.self)

        for name in ["subject", "test-face"] {
            guard let url = bundle.url(forResource: name, withExtension: "jpg"),
                  let data = try? Data(contentsOf: url),
                  let image = ImageDecoder.decode(data),
                  let landmarks = try FaceLandmarkService().detect(in: image),
                  let mesh = landmarks.meshPoints,
                  let renderer = MakeupRenderer()
            else { continue }

            renderer.setPhoto(image, landmarks: mesh, contours: landmarks.regions)
            let diagnostic: [String: Any] = ["mesh": mesh.map { [$0.x, $0.y] }, "contours": Dictionary(uniqueKeysWithValues: landmarks.regions.map { ($0.key.rawValue, $0.value.map { [$0.x, $0.y] }) })]
            try JSONSerialization.data(withJSONObject: diagnostic).write(to: directory.appending(path: "\(name)-landmarks.json"))

            func layer(_ region: ApplicableRegion, _ hex: String, _ intensity: Float, finish: FinishType = .matte, opacity: Float = 0.98) -> RenderLayer? {
                guard let mask = RegionMaskBaker.mask(for: region),
                      let rgb = ProductColor(hex: hex).rgb else { return nil }
                return RenderLayer(
                    coverage: mask,
                    color: SIMD3(Float(rgb.red), Float(rgb.green), Float(rgb.blue)),
                    intensity: intensity,
                    cacheKey: region.rawValue, finish: finish, opacity: opacity
                )
            }

            let looks: [(String, [RenderLayer])] = [
                ("bare", []),
                ("lipstick", [layer(.lips, "#B4243A", 0.9)].compactMap { $0 }),
                ("dewy", [layer(.lips, "#B4243A", 0.9, finish: .dewy)].compactMap { $0 }),
                ("full", [
                    layer(.lips, "#B4796C", 0.8),
                    layer(.cheeks, "#E59B8C", 0.5, finish: .satin, opacity: 0.28),
                    layer(.eyelid, "#8E4436", 0.45, opacity: 0.65),
                ].compactMap { $0 }),
            ]

            for (label, layers) in looks {
                guard let frame = renderer.renderForInspection(layers: layers) else { continue }
                let target = directory.appending(path: "\(name)-\(label).png")
                if write(frame, to: target) {
                    print("RENDER_EXPORT_FILE=\(target.path)")
                } else {
                    print("RENDER_EXPORT_FAILED=\(target.path)")
                }
            }
        }
    }

    @discardableResult
    private func write(_ frame: RenderedFrame, to url: URL) -> Bool {
        // The frame is BGRA; PNG wants it declared as such rather than reordered.
        guard let provider = CGDataProvider(data: Data(frame.bgra) as CFData),
              let image = CGImage(
                  width: frame.width,
                  height: frame.height,
                  bitsPerComponent: 8,
                  bitsPerPixel: 32,
                  bytesPerRow: frame.width * 4,
                  space: CGColorSpace(name: CGColorSpace.sRGB)!,
                  bitmapInfo: CGBitmapInfo(
                      rawValue: CGImageAlphaInfo.noneSkipFirst.rawValue
                          | CGBitmapInfo.byteOrder32Little.rawValue
                  ),
                  provider: provider,
                  decode: nil,
                  shouldInterpolate: false,
                  intent: .defaultIntent
              ),
              let destination = CGImageDestinationCreateWithURL(
                  url as CFURL, UTType.png.identifier as CFString, 1, nil
              )
        else { return false }

        CGImageDestinationAddImage(destination, image, nil)
        return CGImageDestinationFinalize(destination)
    }
}
