import MakeUpCore
import SwiftUI

struct StudioView: View {
    @Environment(AuthService.self) private var auth
    @AppStorage(LanguagePreference.storageKey) private var languageCode = AppLanguage.systemDefault.rawValue

    @State private var library = PhotoLibraryModel()
    @State private var session = TryOnSession()
    @State private var looks: [Look] = []
    @State private var lookTitle = ""
    @State private var isSaving = false
    @State private var error = false
    @State private var panel = 0
    @State private var modelMode = true
    @State private var selectedId: String?

    private let lookRepository = LookRepository()
    private let productRepository = ProductRepository()

    private var language: AppLanguage { LanguagePreference.resolve(languageCode) }
    private var uid: String? { auth.user?.uid }

    private var entries: [AppliedEntry] {
        session.auto.values.map {
            AppliedEntry(
                id: $0.region.rawValue, product: $0.product, intensity: $0.intensity,
                paintable: false, isActive: false
            )
        }
        + session.orderedPaint.map {
            AppliedEntry(
                id: $0.product.id, product: $0.product, intensity: $0.intensity,
                paintable: true, isActive: $0.product.id == session.activePaintProductId
            )
        }
    }

    private var brush: TryOnView.BrushTarget? {
        guard session.mode == .paint, let active = session.activePaint else { return nil }
        return TryOnView.BrushTarget(
            productID: active.product.id, layer: active.layer, radius: session.brushRadius, flow: session.brushFlow
        )
    }

    var body: some View {
        content
            .task(id: uid) {
                guard let uid else { return }
                await library.load(ownerUid: uid)
                await reloadLooks()
            }
    }

    /// Desktop windows are wide, so the face sits beside its controls rather than
    /// above them — scrolling past the photo to reach the catalogue makes the two
    /// impossible to judge together. Phones keep the single column.
    private var content: some View {
        #if os(macOS)
        VStack(spacing: 16) {
            header
            HStack(alignment: .top, spacing: 18) {
                facePanel
                VStack(spacing: 14) { controls }
                    .frame(width: 350)
            }
        }
        .padding(18)
        #else
        GeometryReader { geometry in
            VStack(spacing: 10) {
                header
                facePanel.frame(height: max(320, geometry.size.height * 0.56))
                controls
            }
            .padding(12)
        }
        #endif
    }

    @ViewBuilder private var facePanel: some View {
        if modelMode, let uid {
            ScanPanel(uid:uid,layers:session.layers,brush:brush,onStroke:session.commitStroke,onPhotos:{modelMode=false})
        } else {
            VStack(spacing:8) {
            Button("scan.back"){modelMode=true}.buttonStyle(.borderless)
        FacePanel(
            library: library,
            layers: session.layers,
            brush: brush,
            onStroke: session.commitStroke,
            onImport: { data in
                guard let uid else { return }
                Task { await library.add(data, ownerUid: uid) }
            },
            onRemove: { id in
                guard let uid else { return }
                library.remove(id, ownerUid: uid)
            }
        )
            }
        }
    }

    @ViewBuilder
    private var controls: some View {
        modePicker
        Picker("studio.panels", selection: $panel) {
            Text("studio.products").tag(0)
            Text("studio.applied").tag(1)
            Text("studio.looks").tag(2)
        }.pickerStyle(.segmented).labelsHidden()
        if error { Text("errors.looks").font(.footnote).foregroundStyle(.red) }
        ScrollView {
            if session.mode == .paint { brushControls }
            if panel == 0 {
                CatalogPanel(onSelect: { product in selectedId = product.id; session.select(product) }, selectedId: selectedId)
            } else if panel == 1 {
                AppliedList(entries: entries, language: language, onIntensity: session.setIntensity,
                    onRemove: session.remove, onActivate: { session.activePaintProductId = $0 }, onClearAll: session.clearAll)
            } else { looksPanel }
        }
        Text("face.privacy").font(.caption2).foregroundStyle(.secondary)
    }

    private var header: some View {
        VStack(alignment: .leading, spacing: 6) {
            HStack {
                Text("app.name").font(.title2.weight(.semibold))
                Spacer()
                LanguageToggle()
                Button("auth.signOut") { try? auth.signOut() }.buttonStyle(.bordered).fixedSize()
            }
            Text("studio.subtitle").font(.caption).foregroundStyle(.secondary)
        }
    }

    private var modePicker: some View {
        VStack(alignment: .leading, spacing: 6) {
            Picker("", selection: $session.mode) {
                Text("tryOn.modeAuto").tag(TryOnMode.auto)
                Text("tryOn.modePaint").tag(TryOnMode.paint)
            }
            .pickerStyle(.segmented)
            .labelsHidden()
            .frame(maxWidth: .infinity)

            Text(session.mode == .auto ? "tryOn.modeAutoHint" : "tryOn.modePaintHint")
                .font(.footnote)
                .foregroundStyle(.secondary)
        }
    }

    private var brushControls: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack {
                Button("extra.undo", action: session.undoStroke).disabled(!session.canUndo)
                Button("extra.redo", action: session.redoStroke).disabled(!session.canRedo)
            }.font(.caption)
            Text("tryOn.brush")
                .font(.caption.weight(.semibold))
                .textCase(.uppercase)
                .foregroundStyle(.secondary)

            if session.activePaint == nil {
                Text("tryOn.pickBrushProduct").font(.footnote).foregroundStyle(.secondary)
            }

            LabeledContent("tryOn.brushSize") {
                Slider(value: $session.brushRadius, in: 0.008...0.08)
            }
            LabeledContent("tryOn.brushFlow") {
                Slider(value: $session.brushFlow, in: 0.05...1)
            }
        }
        .padding(12)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(.background.secondary, in: RoundedRectangle(cornerRadius: 16))
    }

    private var looksPanel: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text("looks.title")
                .font(.caption.weight(.semibold))
                .textCase(.uppercase)
                .foregroundStyle(.secondary)

            HStack {
                TextField("looks.namePlaceholder", text: $lookTitle).textFieldStyle(.roundedBorder)
                Button("looks.save") { Task { await saveLook() } }
                    .buttonStyle(.borderedProminent)
                    .disabled(entries.isEmpty || isSaving)
            }

            if looks.isEmpty {
                Text("looks.empty").font(.footnote).foregroundStyle(.secondary)
            }

            ForEach(looks) { look in
                HStack {
                    Button(look.title) { Task { await apply(look) } }.buttonStyle(.plain)
                    Spacer()
                    Text("looks.itemCount \(look.applied.count + look.painted.count)")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                    Button {
                        Task { await delete(look) }
                    } label: {
                        Image(systemName: "xmark.circle.fill").foregroundStyle(.secondary)
                    }
                    .buttonStyle(.plain)
                }
                .padding(10)
                .background(Color.secondary.opacity(0.06), in: RoundedRectangle(cornerRadius: 10))
            }
        }
        .padding(12)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(.background.secondary, in: RoundedRectangle(cornerRadius: 16))
    }

    private func reloadLooks() async {
        guard let uid else { return }
        do { looks = try await lookRepository.list(ownerUid: uid); error = false } catch { self.error = true }
    }

    private func saveLook() async {
        guard let uid else { return }
        isSaving = true
        defer { isSaving = false }

        let title = lookTitle.trimmingCharacters(in: .whitespaces)
        let look = session.makeLook(
            ownerUid: uid,
            title: title.isEmpty ? String(localized: "looks.untitled") : title
        )
        do { try await lookRepository.create(look); lookTitle = ""; await reloadLooks() } catch { self.error = true }
    }

    private func apply(_ look: Look) async {
        do {
            let catalog = try await productRepository.fetch()
            let byID = Dictionary(uniqueKeysWithValues: catalog.map { ($0.id, $0) })
            guard (look.applied.map(\.productId) + look.painted.map(\.productId)).allSatisfy({ byID[$0] != nil }) else {
                error = true
                return
            }
            session.apply(look, catalog: byID)
            error = false
        } catch { self.error = true }
    }

    private func delete(_ look: Look) async {
        do { try await lookRepository.delete(id: look.id); await reloadLooks() } catch { self.error = true }
    }
}
