import CoreGraphics
import MakeUpCore
import MetalKit
import SwiftUI

/// Hosts the Metal renderer and turns drags into brush strokes.
///
/// The pointer position is converted to canonical UV before anything is drawn,
/// so a stroke is recorded against the face's topology rather than this photo's
/// pixels — which is what lets it replay on another angle or another face.
struct TryOnView: PlatformViewRepresentable {
    let image: CGImage
    var contours: [FaceRegion: [CGPoint]] = [:]
    let landmarks: [CGPoint]?
    let layers: [RenderLayer]
    let brush: BrushTarget?
    let onStroke: ([StrokePoint]) -> Void
    var onPan: (CGSize) -> Void = { _ in }
    var onZoom: (CGFloat) -> Void = { _ in }

    struct BrushTarget {
        let productID: String
        let layer: PaintLayer
        let radius: Double
        let flow: Double
    }

    @MainActor
    final class Coordinator: NSObject, MTKViewDelegate {
        var renderer: MakeupRenderer?
        var layers: [RenderLayer] = []
        var brush: BrushTarget?
        var lookup: UVLookup?
        var onStroke: ([StrokePoint]) -> Void = { _ in }
        /// Identity check so the photo and mesh are only rebuilt when they change.
        var currentImage: CGImage?
        var onPan: (CGSize) -> Void = { _ in }
        var onZoom: (CGFloat) -> Void = { _ in }
        var isPainting: Bool { brush != nil }

        private var previous: StrokePoint?
        private var points: [StrokePoint] = []

        nonisolated func mtkView(_ view: MTKView, drawableSizeWillChange size: CGSize) {}

        // The view draws only in response to setNeedsDisplay, which is delivered
        // on the main thread.
        nonisolated func draw(in view: MTKView) {
            MainActor.assumeIsolated {
                guard let drawable = view.currentDrawable else { return }
                renderer?.render(layers: liveLayers, to: drawable)
            }
        }

        /// CGImage is a snapshot. Refresh only the active brush's coverage on
        /// each display, including before SwiftUI receives the committed stroke.
        var liveLayers: [RenderLayer] {
            guard let brush, let coverage = brush.layer.coverage else { return layers }
            return layers.map { layer in
                guard layer.paintID == brush.productID else { return layer }
                var live = layer
                live.coverage = coverage
                return live
            }
        }

        func beginStroke(at point: CGPoint) {
            guard let brush else { return }
            brush.layer.beginStroke(flow: brush.flow)
            previous = nil
            points = []
            extend(to: point)
        }

        func extend(to point: CGPoint) {
            guard let brush, let uv = lookup?.uv(atPhotoPoint: point) else {
                // Off the face: break the stroke so it does not leap across the photo.
                previous = nil
                return
            }
            let next = StrokePoint(u: Double(uv.x), v: Double(uv.y), startsSegment: previous == nil)
            brush.layer.extendStroke(from: previous, to: next, radius: brush.radius)
            previous = next
            points.append(next)
        }

        func cancelStroke() {
            brush?.layer.cancelStroke(); previous = nil; points = []
        }

        func endStroke() {
            guard let brush else { return }
            brush.layer.endStroke()
            let finished = points
            points = []
            previous = nil
            if !finished.isEmpty { onStroke(finished) }
        }
    }

    func makeCoordinator() -> Coordinator {
        let coordinator = Coordinator()
        coordinator.renderer = MakeupRenderer()
        return coordinator
    }

    func makePlatformView(context: Context) -> StrokeCapturingMTKView {
        let view = StrokeCapturingMTKView()
        view.device = MTLCreateSystemDefaultDevice()
        view.delegate = context.coordinator
        view.coordinator = context.coordinator
        view.framebufferOnly = false
        view.autoResizeDrawable = false
        view.isPaused = true
        view.configureGestures()
        view.enableSetNeedsDisplay = true
        return view
    }

    func updatePlatformView(_ view: StrokeCapturingMTKView, context: Context) {
        let coordinator = context.coordinator
        coordinator.onStroke = onStroke
        coordinator.onPan = onPan; coordinator.onZoom = onZoom
        if coordinator.currentImage !== image || coordinator.brush?.layer !== brush?.layer {
            coordinator.cancelStroke()
        }
        coordinator.brush = brush

        if coordinator.currentImage !== image {
            coordinator.currentImage = image
            coordinator.lookup = landmarks.map(UVLookup.init(landmarks:))
            coordinator.renderer?.setPhoto(image, landmarks: landmarks, contours: contours)
            view.drawableSize = CGSize(width: image.width, height: image.height)
        }

        coordinator.layers = layers
        view.setNeedsDisplayCompat()
    }
}
