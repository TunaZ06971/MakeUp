import MetalKit
import SwiftUI

#if os(iOS)
import UIKit

/// One SwiftUI wrapper for both platforms: UIViewRepresentable and
/// NSViewRepresentable have the same shape but different method names.
protocol PlatformViewRepresentable: UIViewRepresentable {
    associatedtype PlatformView: MTKView
    func makePlatformView(context: Context) -> PlatformView
    func updatePlatformView(_ view: PlatformView, context: Context)
}

extension PlatformViewRepresentable {
    func makeUIView(context: Context) -> PlatformView { makePlatformView(context: context) }
    func updateUIView(_ view: PlatformView, context: Context) {
        updatePlatformView(view, context: context)
    }
}

extension MTKView {
    func setNeedsDisplayCompat() { setNeedsDisplay() }
}

/// Touch handling lives on the view because SwiftUI gestures cannot report the
/// continuous, high-rate samples a brush needs.
final class StrokeCapturingMTKView: MTKView, UIGestureRecognizerDelegate {
    weak var coordinator: TryOnView.Coordinator?
    func configureGestures() {
        isMultipleTouchEnabled = true
        let pinch = UIPinchGestureRecognizer(target: self, action: #selector(pinch(_:)))
        pinch.delegate = self; addGestureRecognizer(pinch)
        let pan = UIPanGestureRecognizer(target: self, action: #selector(twoFingerPan(_:)))
        pan.minimumNumberOfTouches = 2; pan.delegate = self; addGestureRecognizer(pan)
    }
    func gestureRecognizer(_ gestureRecognizer: UIGestureRecognizer, shouldRecognizeSimultaneouslyWith otherGestureRecognizer: UIGestureRecognizer) -> Bool { true }
    @objc private func pinch(_ gesture: UIPinchGestureRecognizer) {
        coordinator?.cancelStroke()
        if gesture.state == .changed { coordinator?.onZoom(gesture.scale); gesture.scale = 1 }
    }
    @objc private func twoFingerPan(_ gesture: UIPanGestureRecognizer) {
        coordinator?.cancelStroke()
        if gesture.state == .changed {
            let delta = gesture.translation(in: window)
            coordinator?.onPan(CGSize(width: delta.x, height: delta.y))
            gesture.setTranslation(.zero, in: window)
        }
    }
    override func touchesBegan(_ touches: Set<UITouch>, with event: UIEvent?) {
        guard event?.allTouches?.count == 1, let touch = touches.first else { coordinator?.cancelStroke(); return }
        if coordinator?.isPainting == true { coordinator?.beginStroke(at: normalised(touch.location(in: self))) }
        setNeedsDisplay()
    }
    override func touchesMoved(_ touches: Set<UITouch>, with event: UIEvent?) {
        guard event?.allTouches?.count == 1, let touch = touches.first else { return }
        if coordinator?.isPainting == true {
            for sample in event?.coalescedTouches(for: touch) ?? [touch] { coordinator?.extend(to: normalised(sample.location(in: self))) }
        } else {
            let current = touch.location(in: window), previous = touch.previousLocation(in: window)
            coordinator?.onPan(CGSize(width: current.x - previous.x, height: current.y - previous.y))
        }
        setNeedsDisplay()
    }
    override func touchesEnded(_ touches: Set<UITouch>, with event: UIEvent?) { coordinator?.endStroke(); setNeedsDisplay() }
    override func touchesCancelled(_ touches: Set<UITouch>, with event: UIEvent?) { coordinator?.cancelStroke(); setNeedsDisplay() }
    private func normalised(_ point: CGPoint) -> CGPoint { CGPoint(x: point.x / bounds.width, y: point.y / bounds.height) }
}

#else
import AppKit

protocol PlatformViewRepresentable: NSViewRepresentable {
    associatedtype PlatformView: MTKView
    func makePlatformView(context: Context) -> PlatformView
    func updatePlatformView(_ view: PlatformView, context: Context)
}

extension PlatformViewRepresentable {
    func makeNSView(context: Context) -> PlatformView { makePlatformView(context: context) }
    func updateNSView(_ view: PlatformView, context: Context) {
        updatePlatformView(view, context: context)
    }
}

extension MTKView {
    func setNeedsDisplayCompat() { needsDisplay = true }
}

final class StrokeCapturingMTKView: MTKView {
    weak var coordinator: TryOnView.Coordinator?
    private var moving = false
    private var previousWindowPoint: CGPoint = .zero
    func configureGestures() {}
    override func mouseDown(with event: NSEvent) {
        moving = coordinator?.isPainting != true || event.modifierFlags.contains(.option)
        previousWindowPoint = event.locationInWindow
        if !moving { coordinator?.beginStroke(at: normalised(event)) }
        needsDisplay = true
    }
    override func mouseDragged(with event: NSEvent) {
        if moving {
            let p = event.locationInWindow
            coordinator?.onPan(CGSize(width: p.x - previousWindowPoint.x, height: previousWindowPoint.y - p.y))
            previousWindowPoint = p
        } else { coordinator?.extend(to: normalised(event)) }
        needsDisplay = true
    }
    override func mouseUp(with event: NSEvent) { coordinator?.endStroke(); needsDisplay = true }
    override func magnify(with event: NSEvent) { coordinator?.onZoom(1 + event.magnification) }
    override func scrollWheel(with event: NSEvent) { coordinator?.onZoom(exp(event.scrollingDeltaY * 0.012)) }
    private func normalised(_ event: NSEvent) -> CGPoint {
        let point = convert(event.locationInWindow, from: nil)
        return CGPoint(x: point.x / bounds.width, y: 1 - point.y / bounds.height)
    }
}
#endif
