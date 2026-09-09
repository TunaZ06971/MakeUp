import CoreGraphics
import MakeUpCore
import SwiftUI

struct FacePanel: View {
    @Bindable var library: PhotoLibraryModel
    let layers: [RenderLayer]
    let brush: TryOnView.BrushTarget?
    let onStroke: ([StrokePoint]) -> Void
    let onImport: (Data) -> Void
    let onRemove: (String) -> Void

    #if os(iOS)
    private let spacing: CGFloat = 8
    private let thumbnailSize: CGFloat = 44
    #else
    private let spacing: CGFloat = 16
    private let thumbnailSize: CGFloat = 64
    #endif

    var body: some View {
        VStack(alignment: .leading, spacing: spacing) {
            HStack {
                Text("face.title")
                    .font(.caption.weight(.semibold))
                    .textCase(.uppercase)
                    .foregroundStyle(.secondary)
                Spacer()
                FacePhotoPicker(onPick: onImport) {
                    Text(library.views.isEmpty ? "face.import" : "face.addView")
                }
                .buttonStyle(.borderedProminent)
            }

            if library.hasError { Text("errors.photos").font(.footnote).foregroundStyle(.red) }
            if library.isLoading {
                Text("face.status.detecting").font(.footnote).foregroundStyle(.secondary)
            } else if library.views.isEmpty {
                emptyState
            }

            if let active = library.active {
                PhotoViewport(
                    image: active.image,
                    contours: active.contours,
                    landmarks: active.landmarks,
                    layers: layers,
                    brush: brush,
                    onStroke: onStroke
                )
                .clipShape(RoundedRectangle(cornerRadius: 12))

                if active.status != .detected {
                    Text(active.status == .noFace ? "face.status.noFace" : "face.status.failed")
                        .font(.footnote)
                        .foregroundStyle(.secondary)
                }
            }

            if !library.views.isEmpty {
                viewStrip
            }

            #if os(macOS)
            if library.views.count == 1 {
                Text("face.multiViewHint").font(.footnote).foregroundStyle(.secondary)
            }
            #endif
        }
        .padding(spacing)
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
        .background(.background.secondary, in: RoundedRectangle(cornerRadius: 16))
    }

    private var emptyState: some View {
        VStack(spacing: 10) {
            Text("face.empty").multilineTextAlignment(.center)
            Text("face.privacy").font(.footnote).foregroundStyle(.secondary)
        }
        .frame(maxWidth: .infinity)
        .padding(36)
        .frame(maxHeight: .infinity)
        .overlay(
            RoundedRectangle(cornerRadius: 12)
                .strokeBorder(.separator, style: StrokeStyle(lineWidth: 1, dash: [5]))
        )
    }

    private var viewStrip: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: 8) {
                ForEach(library.views) { view in
                    Button {
                        library.activeId = view.id
                    } label: {
                        Image(decorative: view.image, scale: 1)
                            .resizable()
                            .aspectRatio(contentMode: .fill)
                            .frame(width: thumbnailSize, height: thumbnailSize)
                            .clipShape(RoundedRectangle(cornerRadius: 8))
                            .overlay(
                                RoundedRectangle(cornerRadius: 8).strokeBorder(
                                    view.id == library.activeId ? Color.accentColor : .clear,
                                    lineWidth: 2
                                )
                            )
                    }
                    .buttonStyle(.plain)
                    .contextMenu {
                        Button("face.removeView", role: .destructive) { onRemove(view.id) }
                    }
                }
            }
            .padding(.vertical, 2)
        }
        .frame(height: thumbnailSize + 4)
    }
}
