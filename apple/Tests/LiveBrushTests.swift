import CoreGraphics
import Foundation
import MakeUpCore
import Testing
@testable import MakeUp

@MainActor @Suite("Live brush display")
struct LiveBrushTests {
    @Test func uncommittedBrushIsVisibleAndCancellationRestoresIt() throws {
        let paint = try #require(PaintLayer())
        let blank = try #require(paint.coverage)
        var layer = RenderLayer(coverage: blank, color: .init(0.8, 0.1, 0.2), intensity: 0.75, cacheKey: nil)
        layer.paintID = "lipstick"
        let coordinator = TryOnView.Coordinator()
        coordinator.layers = [layer]
        coordinator.brush = .init(productID: "lipstick", layer: paint, radius: 0.02, flow: 0.5)
        paint.beginStroke(flow: 0.5)
        paint.extendStroke(from: nil, to: .init(u: 0.5, v: 0.5), radius: 0.04)
        let old = try #require(blank.dataProvider?.data) as Data
        let live = try #require(coordinator.liveLayers.first?.coverage.dataProvider?.data) as Data
        #expect(live != old)
        coordinator.cancelStroke()
        let cancelled = try #require(coordinator.liveLayers.first?.coverage.dataProvider?.data) as Data
        #expect(cancelled == old)
    }
}
