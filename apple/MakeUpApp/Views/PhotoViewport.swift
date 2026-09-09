import CoreGraphics
import ImageIO
import MakeUpCore
import SwiftUI
import UniformTypeIdentifiers

/// The Metal surface keeps the photo's pixel dimensions while its view is zoomed.
/// Pointer locations are measured in that transformed view, so strokes stay aligned.
struct PhotoViewport: View {
    let image: CGImage
    var contours: [FaceRegion: [CGPoint]] = [:]
    let landmarks: [CGPoint]?
    let layers: [RenderLayer]
    let brush: TryOnView.BrushTarget?
    let onStroke: ([StrokePoint]) -> Void
    @State private var scale: CGFloat = 1
    @State private var offset: CGSize = .zero
    @State private var move = false
    @State private var original = false
    @State private var export: PhotoDocument?
    @State private var exporting = false
    @State private var failed = false

    var body: some View {
        VStack(spacing: 0) {
            ViewThatFits(in: .horizontal) {
                HStack { zoomTools; Spacer(); compareTools }
                VStack { zoomTools; compareTools }
            }
            .padding(8)
            .buttonStyle(.borderless)
            .font(.caption)
            Divider()
            GeometryReader { geometry in
                let fit = min(geometry.size.width / CGFloat(image.width), geometry.size.height / CGFloat(image.height))
                let size = CGSize(width: CGFloat(image.width) * fit, height: CGFloat(image.height) * fit)
                ZStack {
                    Color.gray.opacity(0.13)
                    TryOnView(image: image, contours: contours, landmarks: landmarks, layers: original ? [] : layers,
                        brush: move || original ? nil : brush, onStroke: onStroke,
                        onPan: { delta in
                            offset = bounded(CGSize(width: offset.width + delta.width, height: offset.height + delta.height), size: size, viewport: geometry.size)
                        }, onZoom: { factor in
                            let next = min(8, max(1, scale * factor))
                            let ratio = next / scale
                            scale = next
                            offset = bounded(CGSize(width: offset.width * ratio, height: offset.height * ratio), size: size, viewport: geometry.size)
                        })
                        .frame(width: size.width * scale, height: size.height * scale)
                        .position(x: geometry.size.width / 2 + offset.width, y: geometry.size.height / 2 + offset.height)
                    VStack {
                        HStack { Text(original ? "viewport.original" : "viewport.makeup").font(.caption2).padding(6).background(.ultraThinMaterial, in: Capsule()); Spacer() }
                        Spacer()
                        Text(brush != nil && !move ? "viewport.paintHint" : "viewport.moveHint")
                            .font(.caption2).padding(7).background(.ultraThinMaterial, in: Capsule())
                    }
                    .padding(12).allowsHitTesting(false)
                }
                .frame(width: geometry.size.width, height: geometry.size.height)
                .clipped()
                .onChange(of: scale) { _, _ in offset = bounded(offset, size: size, viewport: geometry.size) }
                .onChange(of: geometry.size) { _, _ in offset = bounded(offset, size: size, viewport: geometry.size) }
            }
        }
        .clipShape(RoundedRectangle(cornerRadius: 12))
        .onChange(of: ObjectIdentifier(image)) { _, _ in scale = 1; offset = .zero; original = false }
        .fileExporter(isPresented: $exporting, document: export, contentType: .png, defaultFilename: "MakeUp") { result in
            if case .failure = result { failed = true }
        }
        .alert("viewport.exportError", isPresented: $failed) { Button("OK", role: .cancel) {} }
    }

    private var zoomTools: some View {
        HStack(spacing: 12) {
            Button { scale = max(1, scale / 1.4) } label: { Image(systemName: "minus.magnifyingglass") }.accessibilityLabel("viewport.zoomOut")
            Text("\(Int(scale * 100))%").monospacedDigit().frame(width: 40)
            Button { scale = min(8, scale * 1.4) } label: { Image(systemName: "plus.magnifyingglass") }.accessibilityLabel("viewport.zoomIn")
            Button("viewport.fit") { scale = 1; offset = .zero }
            Toggle("viewport.move", isOn: $move).toggleStyle(.button)
        }
    }
    private var compareTools: some View {
        HStack(spacing: 12) {
            Button(original ? "viewport.showMakeup" : "viewport.showOriginal") { original.toggle() }
            Button("viewport.export") { exportImage() }
        }
    }
    private func bounded(_ value: CGSize, size: CGSize, viewport: CGSize) -> CGSize {
        let x = max(0, (size.width * scale - viewport.width) / 2)
        let y = max(0, (size.height * scale - viewport.height) / 2)
        return CGSize(width: min(x, max(-x, value.width)), height: min(y, max(-y, value.height)))
    }
    private func exportImage() {
        guard let renderer = MakeupRenderer() else { failed = true; return }
        renderer.setPhoto(image, landmarks: landmarks, contours: contours)
        guard let frame = renderer.renderForInspection(layers: original ? [] : layers), let data = frame.pngData() else { failed = true; return }
        export = PhotoDocument(data: data); exporting = true
    }
}

struct PhotoDocument: FileDocument {
    static var readableContentTypes: [UTType] { [.png] }
    var data: Data
    init(data: Data) { self.data = data }
    init(configuration: ReadConfiguration) throws { data = configuration.file.regularFileContents ?? Data() }
    func fileWrapper(configuration: WriteConfiguration) throws -> FileWrapper { FileWrapper(regularFileWithContents: data) }
}
