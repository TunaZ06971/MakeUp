import MakeUpCore
import SwiftUI
import UniformTypeIdentifiers

struct ScanPanel: View {
  let uid: String
  let layers: [RenderLayer]
  let brush: TryOnView.BrushTarget?
  let onStroke: ([StrokePoint]) -> Void
  let onPhotos: () -> Void
  var showsPhotoTools = true
  @State private var scan: FaceScan?
  @State private var capturing = false
  @State private var importing = false
  @State private var exporting = false
  @State private var failed = false
  @State private var document: ScanDocument?
  private let store = LocalScanStore()
  var body: some View {
    VStack(alignment: .leading, spacing: 10) {
      HStack {
        Text("scan.model").font(.title3.bold())
        Spacer()
        #if os(iOS)
          Button(scan == nil ? "scan.start" : "scan.rescan") { capturing = true }.buttonStyle(
            .borderedProminent)
        #endif
      }
      if let scan {
        Text(LocalizedStringKey("scan.sources.\(scan.source)")).font(.caption).foregroundStyle(
          .secondary)
        ScanModelView(scan: scan, layers: layers, brush: brush, onStroke: onStroke)
        Text(scan.source == "truedepth-measured" ? "scan.measuredSurfaceNotice" : "scan.surfaceNotice").font(.caption2).foregroundStyle(.secondary)
      } else {
        VStack(spacing: 14) {
          Image(systemName: "faceid").font(.system(size: 64)).foregroundStyle(.tint)
          Text("scan.intro").font(.headline)
          Text("scan.deviceAdvice")
          Text("scan.privacy").font(.footnote).foregroundStyle(.secondary)
        }.multilineTextAlignment(.center).frame(maxWidth: .infinity, maxHeight: .infinity)
      }
      if failed { Text("scan.feedback.buildError").font(.caption).foregroundStyle(.red) }
      ViewThatFits {
        HStack { fileTools }
        VStack(alignment: .leading) { fileTools }
      }.buttonStyle(.borderless).font(.caption)
    }.padding(12).background(.background.secondary, in: RoundedRectangle(cornerRadius: 16))
      .task(id: uid) { do { scan = try store.load(uid: uid) } catch { failed = true } }
      .fileImporter(isPresented: $importing, allowedContentTypes: [.json, .data]) { result in
        do {
          let url = try result.get()
          let scoped = url.startAccessingSecurityScopedResource()
          defer { if scoped { url.stopAccessingSecurityScopedResource() } }
          accept(try FaceScan.decode(Data(contentsOf: url)))
        } catch { failed = true }
      }
      .fileExporter(
        isPresented: $exporting, document: document, contentType: .json,
        defaultFilename: "MakeUp-face"
      ) { result in if case .failure = result { failed = true } }
      #if os(iOS)
        .sheet(isPresented: $capturing) { ARGuidedCaptureView(onComplete: accept) }
      #endif
  }
  @ViewBuilder private var fileTools: some View {
    Button("scan.import") { importing = true }
    if let scan {
      Button("scan.export") {
        do {
          document = ScanDocument(data: try JSONEncoder().encode(scan))
          exporting = true
        } catch { failed = true }
      }
      Button("scan.delete") {
        do {
          try store.delete(uid: uid)
          self.scan = nil
        } catch { failed = true }
      }
    }
    if showsPhotoTools { Button("scan.photos", action: onPhotos) }
  }
  private func accept(_ value: FaceScan) {
    do {
      try store.save(value, uid: uid)
      scan = value
      failed = false
    } catch { failed = true }
  }
}
struct ScanDocument: FileDocument {
  static var readableContentTypes: [UTType] { [.json] }
  var data: Data
  init(data: Data) { self.data = data }
  init(configuration: ReadConfiguration) throws {
    data = configuration.file.regularFileContents ?? Data()
  }
  func fileWrapper(configuration: WriteConfiguration) throws -> FileWrapper {
    FileWrapper(regularFileWithContents: data)
  }
}
