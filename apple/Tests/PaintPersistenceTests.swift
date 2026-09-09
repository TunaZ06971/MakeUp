import CoreGraphics
import Foundation
import MakeUpCore
import Testing

@MainActor @Suite("Paint persistence")
struct PaintPersistenceTests {
    private func pixels(_ image: CGImage?) throws -> Data {
        try #require(image?.dataProvider?.data) as Data
    }
    @Test func cancellationRestoresCommittedCoverage() throws {
        let layer = try #require(PaintLayer())
        layer.replay(Stroke(productId: "p", radius: 0.02, flow: 0.4, points: [.init(u: 0.3, v: 0.4)]))
        let before = try pixels(layer.coverage)
        layer.beginStroke(flow: 0.8)
        layer.extendStroke(from: nil, to: .init(u: 0.5, v: 0.5), radius: 0.1)
        layer.cancelStroke()
        #expect(try pixels(layer.coverage) == before)
    }
    @Test func savedSegmentsDoNotConnectAcrossTheFace() throws {
        let stroke = Stroke(productId: "p", radius: 0.02, flow: 0.4,
            points: [.init(u: 0.3, v: 0.5), .init(u: 0.35, v: 0.5), .init(u: 0.7, v: 0.5, startsSegment: true)])
        let layer = try #require(PaintLayer())
        let data = try JSONEncoder().encode(stroke)
        layer.replay(try JSONDecoder().decode(Stroke.self, from: data))
        let image = try #require(layer.coverage)
        let bytes = try pixels(image)
        #expect(bytes[512 * image.bytesPerRow + 512] == 0)
        let before = bytes
        layer.clear(); layer.replay(stroke)
        #expect(try pixels(layer.coverage) == before)
    }
    @Test func legacyPointsRemainDecodable() throws {
        let data = Data("{\"u\":0.2,\"v\":0.3}".utf8)
        let point = try JSONDecoder().decode(StrokePoint.self, from: data)
        #expect(point.startsSegment == nil)
    }
}
