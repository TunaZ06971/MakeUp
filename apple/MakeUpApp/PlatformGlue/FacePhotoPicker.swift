import SwiftUI

#if os(iOS)
import PhotosUI
#endif

/// The only place the two Apple platforms genuinely differ in this feature:
/// iOS picks from the photo library, macOS picks a file from disk.
struct FacePhotoPicker<Label: View>: View {
    let onPick: (Data) -> Void
    @ViewBuilder var label: Label

    #if os(iOS)
    @State private var selection: PhotosPickerItem?

    var body: some View {
        PhotosPicker(selection: $selection, matching: .images, photoLibrary: .shared()) {
            label
        }
        .onChange(of: selection) { _, item in
            guard let item else { return }
            Task {
                if let data = try? await item.loadTransferable(type: Data.self) {
                    onPick(data)
                }
                selection = nil
            }
        }
    }
    #else
    @State private var isImporting = false

    var body: some View {
        Button { isImporting = true } label: { label }
            .fileImporter(isPresented: $isImporting, allowedContentTypes: [.image]) { result in
                guard case .success(let url) = result else { return }
                // The sandbox hands back a security-scoped URL.
                let scoped = url.startAccessingSecurityScopedResource()
                defer { if scoped { url.stopAccessingSecurityScopedResource() } }
                if let data = try? Data(contentsOf: url) {
                    onPick(data)
                }
            }
    }
    #endif
}
