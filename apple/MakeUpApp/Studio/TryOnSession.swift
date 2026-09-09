import Foundation
import MakeUpCore
import Observation
import simd

enum TryOnMode: String, CaseIterable {
    case auto, paint
}

/// Makeup is layered the way it is actually applied: base first, then cheeks,
/// then eyes, then lips. Rendering in this order is what lets blush read as
/// sitting on top of foundation rather than beside it.
private let regionOrder: [ApplicableRegion] = [
    .faceFull, .cheeks, .cheekbones, .noseBridge, .cupidsBow,
    .eyelid, .crease, .eyelidLine, .waterline, .eyebrows, .lips,
]

let defaultIntensity = 0.75
let defaultBrush = (radius: 0.045, flow: 0.5)

@MainActor
@Observable
final class TryOnSession {
    struct AutoApplication: Identifiable {
        let region: ApplicableRegion
        var product: Product
        var intensity: Double
        var id: String { region.rawValue }
    }

    struct PaintApplication: Identifiable {
        var product: Product
        var intensity: Double
        let layer: PaintLayer
        var strokes: [Stroke]
        var id: String { product.id }
    }

    var mode: TryOnMode = .auto
    var brushRadius = defaultBrush.radius
    var brushFlow = defaultBrush.flow
    private(set) var auto: [ApplicableRegion: AutoApplication] = [:]
    private(set) var painted: [String: PaintApplication] = [:]
    var activePaintProductId: String?
    private var paintOrder: [String] = []
    private var redo: [String: [Stroke]] = [:]
    var orderedPaint: [PaintApplication] { paintOrder.compactMap { painted[$0] } }
    var canUndo: Bool { !(activePaint?.strokes.isEmpty ?? true) }
    var canRedo: Bool { activePaintProductId.map { !(redo[$0]?.isEmpty ?? true) } ?? false }
    func undoStroke() {
        guard let id = activePaintProductId, var entry = painted[id], let last = entry.strokes.popLast() else { return }
        redo[id, default: []].append(last)
        entry.layer.clear(); for stroke in entry.strokes { entry.layer.replay(stroke) }
        painted[id] = entry
    }
    func redoStroke() {
        guard let id = activePaintProductId, let stroke = redo[id]?.popLast(), var entry = painted[id] else { return }
        entry.layer.replay(stroke); entry.strokes.append(stroke); painted[id] = entry
    }

    var activePaint: PaintApplication? {
        activePaintProductId.flatMap { painted[$0] }
    }

    func select(_ product: Product) {
        switch mode {
        case .auto:
            guard let region = product.applicableRegions.first else { return }
            let intensity = auto[region]?.intensity ?? defaultIntensity
            auto[region] = AutoApplication(region: region, product: product, intensity: intensity)
        case .paint:
            if painted[product.id] == nil, let layer = PaintLayer() {
                paintOrder.append(product.id)
                painted[product.id] = PaintApplication(
                    product: product, intensity: defaultIntensity, layer: layer, strokes: []
                )
            }
            activePaintProductId = product.id
        }
    }

    func setIntensity(_ key: String, _ value: Double) {
        if let region = ApplicableRegion(rawValue: key), auto[region] != nil {
            auto[region]?.intensity = value
        }
        if painted[key] != nil {
            painted[key]?.intensity = value
        }
    }

    func remove(_ key: String) {
        if let region = ApplicableRegion(rawValue: key) {
            auto.removeValue(forKey: region)
        }
        painted[key]?.layer.clear()
        painted.removeValue(forKey: key)
        paintOrder.removeAll { $0 == key }; redo.removeValue(forKey: key)
        if activePaintProductId == key { activePaintProductId = nil }
    }

    func clearAll() {
        for entry in painted.values { entry.layer.clear() }
        auto.removeAll()
        painted.removeAll(); paintOrder.removeAll(); redo.removeAll()
        activePaintProductId = nil
    }

    /// Records a finished stroke so the look stays reproducible.
    func commitStroke(_ points: [StrokePoint]) {
        guard let productId = activePaintProductId, painted[productId] != nil else { return }
        redo.removeValue(forKey: productId)
        painted[productId]?.strokes.append(
            Stroke(productId: productId, radius: brushRadius, flow: brushFlow, points: points)
        )
    }

    var layers: [RenderLayer] {
        var result: [(order: Int, layer: RenderLayer)] = []

        for (region, entry) in auto {
            guard let mask = RegionMaskBaker.mask(for: region),
                  let rgb = entry.product.colors.first?.rgb else { continue }
            result.append((
                regionOrder.firstIndex(of: region) ?? regionOrder.count,
                RenderLayer(
                    coverage: mask,
                    color: SIMD3(Float(rgb.red), Float(rgb.green), Float(rgb.blue)),
                    intensity: Float(entry.intensity),
                    cacheKey: region.rawValue,
                    finish: entry.product.finish,
                    opacity: entry.product.opacity.map(Float.init) ?? MaterialParameters.opacity(for: entry.product.category),
                    region: region
                )
            ))
        }

        for (index, entry) in orderedPaint.enumerated() {
            guard let coverage = entry.layer.coverage,
                  let rgb = entry.product.colors.first?.rgb else { continue }
            var renderLayer = RenderLayer(
                coverage: coverage,
                color: SIMD3(Float(rgb.red), Float(rgb.green), Float(rgb.blue)),
                intensity: Float(entry.intensity), cacheKey: nil,
                finish: entry.product.finish,
                opacity: entry.product.opacity.map(Float.init) ?? MaterialParameters.opacity(for: entry.product.category),
                region: entry.product.applicableRegions.first, automatic: false
            )
            renderLayer.paintID = entry.product.id
            result.append((
                // Hand-painted product goes on top of the automatic pass.
                regionOrder.count + index,
                renderLayer
            ))
        }

        return result.sorted { $0.order < $1.order }.map(\.layer)
    }

    func makeLook(ownerUid: String, title: String) -> Look {
        Look(
            ownerUid: ownerUid,
            title: title,
            applied: auto.values.map {
                SavedApplication(productId: $0.product.id, region: $0.region, intensity: $0.intensity)
            },
            painted: orderedPaint.map {
                SavedPaint(productId: $0.product.id, intensity: $0.intensity, strokes: $0.strokes)
            }
        )
    }

    /// Replaying a saved look needs the products themselves, which live in
    /// Firestore rather than in the look, so they are matched by id.
    func apply(_ look: Look, catalog: [String: Product]) {
        clearAll()

        for entry in look.applied {
            guard let product = catalog[entry.productId] else { continue }
            auto[entry.region] = AutoApplication(
                region: entry.region, product: product, intensity: entry.intensity
            )
        }

        for entry in look.painted {
            guard let product = catalog[entry.productId], let layer = PaintLayer() else { continue }
            for stroke in entry.strokes { layer.replay(stroke) }
            paintOrder.append(product.id)
            painted[product.id] = PaintApplication(
                product: product, intensity: entry.intensity, layer: layer, strokes: entry.strokes
            )
        }
    }
}
