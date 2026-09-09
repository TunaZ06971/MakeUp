import CoreGraphics
import Foundation
import Metal
import MetalKit
import simd

public struct RenderLayer: Sendable {
    /// Coverage in canonical UV space: a region fill, or the user's brush strokes.
    public var coverage: CGImage
    /// sRGB components in 0...1.
    public let color: SIMD3<Float>
    public let intensity: Float
    /// Stable name for texture caching. Region masks never change and are worth
    /// caching; a paint layer produces a fresh image per stroke, so it passes nil
    /// and is uploaded each time rather than risking a stale hit.
    public let cacheKey: String?
    public let finish: FinishType
    public let opacity: Float
    public let region: ApplicableRegion?
    public let automatic: Bool
    public var paintID: String?
    public var surfaceMode = false

    public init(coverage: CGImage, color: SIMD3<Float>, intensity: Float, cacheKey: String?, finish: FinishType = .matte, opacity: Float = 0.98, region: ApplicableRegion? = nil, automatic: Bool? = nil) {
        self.coverage = coverage
        self.color = color
        self.intensity = intensity
        self.cacheKey = cacheKey
        self.finish = finish; self.opacity = opacity
        self.region = region ?? cacheKey.flatMap(ApplicableRegion.init(rawValue:))
        self.automatic = automatic ?? (cacheKey != nil)
    }
}

/// Draws the photo, then paints each makeup layer onto it through the face mesh.
///
/// Two passes per layer: the backdrop is copied forward first, because the mesh
/// covers only the face and would otherwise leave the rest of the photo blank.
/// The blend shader then reads that backdrop — real pigment maths needs the
/// pixels underneath, which fixed-function blending cannot provide.
@MainActor
public final class MakeupRenderer {
    private struct MeshVertex {
        var position: SIMD2<Float>
        var uv: SIMD2<Float>
    }

    private struct BlendUniforms {
        var colorIntensity: SIMD4<Float>
        var material: SIMD4<Float>
        var settings: SIMD4<Float>
        var light: SIMD4<Float>
        var surface: SIMD4<Float>
    }

    private let device: MTLDevice
    private let queue: MTLCommandQueue
    private let copyPipeline: MTLRenderPipelineState
    private let meshPipeline: MTLRenderPipelineState
    private let detailPipeline: MTLRenderPipelineState
    private let automaticPipeline: MTLRenderPipelineState

    private var photoMasks: PhotoRegionMasks?
    private var means: [ApplicableRegion: Float] = [:]
    private var detailTexture: MTLTexture?
    private var photoTexture: MTLTexture?
    private var targets: [MTLTexture] = []
    private var vertexBuffer: MTLBuffer?
    private var indexBuffer: MTLBuffer?
    private var indexCount = 0
    private var coverageCache: [String: MTLTexture] = [:]

    public init?() {
        guard let device = MTLCreateSystemDefaultDevice(),
              let queue = device.makeCommandQueue(),
              let library = try? device.makeDefaultLibrary(bundle: .module)
        else { return nil }

        func pipeline(vertex: String, fragment: String) -> MTLRenderPipelineState? {
            let descriptor = MTLRenderPipelineDescriptor()
            descriptor.vertexFunction = library.makeFunction(name: vertex)
            descriptor.fragmentFunction = library.makeFunction(name: fragment)
            descriptor.colorAttachments[0].pixelFormat = .bgra8Unorm
            return try? device.makeRenderPipelineState(descriptor: descriptor)
        }

        guard let copy = pipeline(vertex: "quad_vertex", fragment: "copy_fragment"),
              let mesh = pipeline(vertex: "mesh_vertex", fragment: "makeup_fragment"),
              let detail = pipeline(vertex: "quad_vertex", fragment: "detail_fragment"),
              let automatic = pipeline(vertex: "quad_vertex", fragment: "makeup_fragment")
        else { return nil }

        self.device = device
        self.queue = queue
        self.copyPipeline = copy
        self.meshPipeline = mesh
        self.detailPipeline = detail
        self.automaticPipeline = automatic
    }

    public var size: CGSize {
        guard let photoTexture else { return .zero }
        return CGSize(width: photoTexture.width, height: photoTexture.height)
    }

    /// Passing nil landmarks renders the photo untouched — nothing to paint on.
    public func setPhoto(_ image: CGImage, landmarks: [CGPoint]?, contours: [FaceRegion: [CGPoint]] = [:]) {
        coverageCache.removeAll()
        photoTexture = makeTexture(from: image)

        targets = (0..<2).compactMap { _ in makeTarget(width: image.width, height: image.height) }
        buildMesh(landmarks: landmarks)
        photoMasks = landmarks.map { PhotoRegionMasks(width: image.width, height: image.height, landmarks: $0, contours: contours) }
        means = landmarks.map { PhotoRegionMasks.means(image: image, landmarks: $0, contours: contours) } ?? [:]
        detailTexture = makeTarget(width: image.width, height: image.height)
        if let source = photoTexture, let detailTexture, let commands = queue.makeCommandBuffer(),
           let pass = makePass(target: detailTexture, clear: true),
           let encoder = commands.makeRenderCommandEncoder(descriptor: pass) {
            var eyePixels = CGFloat(image.width) * 0.25
            if let landmarks {
                let dx = (landmarks[33].x - landmarks[263].x) * CGFloat(image.width)
                let dy = (landmarks[33].y - landmarks[263].y) * CGFloat(image.height)
                eyePixels = hypot(dx, dy)
            }
            var radius = Float(max(0.35, eyePixels / 400))
            encoder.setRenderPipelineState(detailPipeline)
            encoder.setFragmentTexture(source, index: 0)
            encoder.setFragmentBytes(&radius, length: MemoryLayout<Float>.stride, index: 0)
            encoder.drawPrimitives(type: .triangle, vertexStart: 0, vertexCount: 3)
            encoder.endEncoding(); commands.commit()
        }
    }

    private func buildMesh(landmarks: [CGPoint]?) {
        guard let landmarks, landmarks.count >= CanonicalFace.vertexCount else {
            vertexBuffer = nil
            indexBuffer = nil
            indexCount = 0
            return
        }

        var vertices: [MeshVertex] = []
        vertices.reserveCapacity(CanonicalFace.vertexCount)
        for index in 0..<CanonicalFace.vertexCount {
            let landmark = landmarks[index]
            // Landmarks are 0...1 from the top left; the shader draws in clip space.
            vertices.append(
                MeshVertex(
                    position: SIMD2(Float(landmark.x) * 2 - 1, 1 - Float(landmark.y) * 2),
                    uv: SIMD2(CanonicalFace.uv[index * 2], CanonicalFace.uv[index * 2 + 1])
                )
            )
        }

        let indices = CanonicalFace.triangles
        vertexBuffer = device.makeBuffer(
            bytes: vertices, length: MemoryLayout<MeshVertex>.stride * vertices.count
        )
        indexBuffer = device.makeBuffer(
            bytes: indices, length: MemoryLayout<UInt16>.stride * indices.count
        )
        indexCount = indices.count
    }

    /// Renders into `drawable`, returning false when there is nothing to show yet.
    @discardableResult
    public func render(layers: [RenderLayer], to drawable: CAMetalDrawable) -> Bool {
        guard render(layers: layers, to: drawable.texture, present: drawable) else { return false }
        return true
    }

    /// Renders off screen and reads the pixels back, so tests can assert on what
    /// actually reaches the display rather than on the geometry that feeds it.
    public func renderForInspection(layers: [RenderLayer]) -> RenderedFrame? {
        guard let photoTexture else { return nil }
        let width = photoTexture.width
        let height = photoTexture.height

        let descriptor = MTLTextureDescriptor.texture2DDescriptor(
            pixelFormat: .bgra8Unorm, width: width, height: height, mipmapped: false
        )
        descriptor.usage = [.renderTarget, .shaderRead]
        #if os(macOS)
        descriptor.storageMode = .managed
        #else
        descriptor.storageMode = .shared
        #endif
        guard let output = device.makeTexture(descriptor: descriptor),
              render(layers: layers, to: output, present: nil)
        else { return nil }

        var pixels = [UInt8](repeating: 0, count: width * height * 4)
        pixels.withUnsafeMutableBytes { buffer in
            output.getBytes(
                buffer.baseAddress!,
                bytesPerRow: width * 4,
                from: MTLRegionMake2D(0, 0, width, height),
                mipmapLevel: 0
            )
        }
        return RenderedFrame(width: width, height: height, bgra: pixels)
    }

    @discardableResult
    private func render(
        layers: [RenderLayer],
        to output: MTLTexture,
        present drawable: CAMetalDrawable?
    ) -> Bool {
        guard let photoTexture, targets.count == 2,
              let commands = queue.makeCommandBuffer() else { return false }

        let active = indexCount > 0 ? layers.filter { $0.intensity > 0 } : []

        if active.isEmpty {
            copy(photoTexture, into: output, with: commands)
        } else {
            // Normalise the photo into a render target first, so every pass
            // downstream reads and writes textures that share one orientation.
            copy(photoTexture, into: targets[0], with: commands)
            var read = 0

            for layer in active {
                let write = 1 - read
                // Carry the backdrop forward, then overdraw just the face.
                copy(targets[read], into: targets[write], with: commands)
                drawMesh(layer: layer, backdrop: targets[read], into: targets[write], with: commands)
                read = write
            }
            copy(targets[read], into: output, with: commands)
        }

        #if os(macOS)
        if drawable == nil, let blit = commands.makeBlitCommandEncoder() {
            // Managed textures need an explicit sync before the CPU can read them.
            blit.synchronize(resource: output)
            blit.endEncoding()
        }
        #endif

        if let drawable { commands.present(drawable) }
        commands.commit()
        if drawable == nil { commands.waitUntilCompleted() }
        return true
    }

    private func copy(_ source: MTLTexture, into target: MTLTexture, with commands: MTLCommandBuffer) {
        guard let pass = makePass(target: target, clear: true),
              let encoder = commands.makeRenderCommandEncoder(descriptor: pass) else { return }
        encoder.setRenderPipelineState(copyPipeline)
        encoder.setFragmentTexture(source, index: 0)
        encoder.drawPrimitives(type: .triangle, vertexStart: 0, vertexCount: 3)
        encoder.endEncoding()
    }

    private func drawMesh(
        layer: RenderLayer,
        backdrop: MTLTexture,
        into target: MTLTexture,
        with commands: MTLCommandBuffer
    ) {
        guard let vertexBuffer, let indexBuffer,
              let coverage = coverageTexture(for: layer),
              // Load, not clear: the copied backdrop has to survive under the mesh.
              let pass = makePass(target: target, clear: false),
              let encoder = commands.makeRenderCommandEncoder(descriptor: pass) else { return }

        let material = MaterialParameters.parameters(for: layer.finish)
        var uniforms = BlendUniforms(
            colorIntensity: SIMD4(layer.color.x, layer.color.y, layer.color.z, layer.intensity),
            material: SIMD4(layer.surfaceMode ? 0 : material.gloss, material.roughness, material.detail, material.coverage),
            settings: SIMD4(layer.opacity, means[layer.region ?? .lips] ?? 0.2, layer.surfaceMode ? 0 : material.sparkle, layer.automatic ? 1 : 0),
            light: SIMD4(1, 1, 1, 0),
            surface: SIMD4(layer.surfaceMode ? 1 : 0, 0, 0, 0)
        )
        encoder.setRenderPipelineState(layer.automatic ? automaticPipeline : meshPipeline)
        // Cull back faces so a folded triangle cannot paint over its neighbours,
        // matching three.js's FrontSide default. The canonical winding is
        // counter-clockwise once the mesh reaches clip space, which is the
        // opposite of Metal's default — leaving that unset culls the entire face.
        encoder.setFrontFacing(.counterClockwise)
        encoder.setCullMode(layer.automatic ? .none : .back)
        encoder.setVertexBuffer(vertexBuffer, offset: 0, index: 0)
        encoder.setFragmentTexture(backdrop, index: 0)
        encoder.setFragmentTexture(coverage, index: 1)
        encoder.setFragmentTexture(detailTexture, index: 2)
        encoder.setFragmentBytes(&uniforms, length: MemoryLayout<BlendUniforms>.stride, index: 0)
        if layer.automatic { encoder.drawPrimitives(type: .triangle, vertexStart: 0, vertexCount: 3) }
        else { encoder.drawIndexedPrimitives(
            type: .triangle,
            indexCount: indexCount,
            indexType: .uint16,
            indexBuffer: indexBuffer,
            indexBufferOffset: 0
        ) }
        encoder.endEncoding()
    }

    private func makePass(target: MTLTexture, clear: Bool) -> MTLRenderPassDescriptor? {
        let pass = MTLRenderPassDescriptor()
        pass.colorAttachments[0].texture = target
        pass.colorAttachments[0].loadAction = clear ? .clear : .load
        pass.colorAttachments[0].storeAction = .store
        pass.colorAttachments[0].clearColor = MTLClearColor(red: 0, green: 0, blue: 0, alpha: 1)
        return pass
    }

    private func makeTarget(width: Int, height: Int) -> MTLTexture? {
        let descriptor = MTLTextureDescriptor.texture2DDescriptor(
            pixelFormat: .bgra8Unorm, width: width, height: height, mipmapped: false
        )
        descriptor.usage = [.renderTarget, .shaderRead]
        descriptor.storageMode = .private
        return device.makeTexture(descriptor: descriptor)
    }

    private func coverageTexture(for layer: RenderLayer) -> MTLTexture? {
        if let key = layer.cacheKey, let cached = coverageCache[key] { return cached }
        let image = layer.automatic ? layer.region.flatMap { photoMasks?.mask(for: $0) } ?? layer.coverage : layer.coverage
        guard let texture = makeTexture(from: image) else { return nil }
        if let key = layer.cacheKey { coverageCache[key] = texture }
        return texture
    }

    /// Redraws into a known layout before upload.
    ///
    /// `MTKTextureLoader` reads a CGImage's pixels but ignores its byte-order
    /// flag. A JPEG decodes to `byteOrder32Little` (BGRA), which the loader
    /// uploads verbatim as `.rgba8Unorm` — red and blue silently trade places,
    /// and skin turns cyan. Drawing into a context whose layout we chose
    /// ourselves removes the guesswork: the bytes are BGRA because we asked for
    /// BGRA, and the texture is declared to match.
    private func makeTexture(from image: CGImage) -> MTLTexture? {
        let width = image.width
        let height = image.height
        let bytesPerRow = width * 4

        guard let context = CGContext(
            data: nil,
            width: width,
            height: height,
            bitsPerComponent: 8,
            bytesPerRow: bytesPerRow,
            space: CGColorSpace(name: CGColorSpace.sRGB)!,
            bitmapInfo: CGImageAlphaInfo.premultipliedFirst.rawValue
                | CGBitmapInfo.byteOrder32Little.rawValue
        ) else { return nil }

        context.draw(image, in: CGRect(x: 0, y: 0, width: width, height: height))
        guard let pixels = context.data else { return nil }

        let descriptor = MTLTextureDescriptor.texture2DDescriptor(
            pixelFormat: .bgra8Unorm, width: width, height: height, mipmapped: false
        )
        descriptor.usage = .shaderRead
        guard let texture = device.makeTexture(descriptor: descriptor) else { return nil }

        texture.replace(
            region: MTLRegionMake2D(0, 0, width, height),
            mipmapLevel: 0,
            withBytes: pixels,
            bytesPerRow: bytesPerRow
        )
        return texture
    }
}

/// A rendered frame the tests can inspect, in the drawable's own BGRA order.
public struct RenderedFrame: Sendable {
    public let width: Int
    public let height: Int
    public let bgra: [UInt8]

    public struct Pixel: Sendable {
        public let red: Double
        public let green: Double
        public let blue: Double
    }

    /// Samples at normalized coordinates, origin top left.
    public func pixel(atX x: Double, y: Double) -> Pixel {
        let column = min(max(Int(x * Double(width)), 0), width - 1)
        let row = min(max(Int(y * Double(height)), 0), height - 1)
        let offset = (row * width + column) * 4
        return Pixel(
            red: Double(bgra[offset + 2]) / 255,
            green: Double(bgra[offset + 1]) / 255,
            blue: Double(bgra[offset]) / 255
        )
    }

    /// Mean colour over a normalized rect — steadier than a single pixel when a
    /// mask edge or a skin blemish could sit under the sample point.
    public func average(x: ClosedRange<Double>, y: ClosedRange<Double>) -> Pixel {
        var red = 0.0, green = 0.0, blue = 0.0, count = 0.0
        let columns = Int(x.lowerBound * Double(width))...Int(x.upperBound * Double(width))
        let rows = Int(y.lowerBound * Double(height))...Int(y.upperBound * Double(height))

        for row in rows where row >= 0 && row < height {
            for column in columns where column >= 0 && column < width {
                let offset = (row * width + column) * 4
                red += Double(bgra[offset + 2])
                green += Double(bgra[offset + 1])
                blue += Double(bgra[offset])
                count += 1
            }
        }
        guard count > 0 else { return Pixel(red: 0, green: 0, blue: 0) }
        return Pixel(red: red / count / 255, green: green / count / 255, blue: blue / count / 255)
    }
}
