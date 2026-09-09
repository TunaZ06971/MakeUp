import CoreGraphics
import Foundation
import MakeUpCore
import Observation

@MainActor
@Observable
final class PhotoLibraryModel {
    struct FaceView: Identifiable, Sendable {
        let id: String
        let image: CGImage
        let landmarks: [CGPoint]?
        let status: Status
        var contours: [FaceRegion: [CGPoint]] = [:]
        enum Status: Sendable { case detected, noFace, failed }
    }
    private(set) var views: [FaceView] = []
    private(set) var isLoading = true
    private(set) var hasError = false
    var activeId: String?
    private var owner: String?
    private let photos = LocalPhotoStore()
    var active: FaceView? { views.first { $0.id == activeId } }

    func load(ownerUid: String) async {
        owner = ownerUid; views = []; activeId = nil; isLoading = true; hasError = false
        defer { if owner == ownerUid { isLoading = false } }
        do {
            let records = try photos.list(ownerUid: ownerUid).reversed()
            var loaded: [FaceView] = []
            for record in records {
                let data = try Data(contentsOf: record.url)
                let view = await Task.detached(priority: .userInitiated) { Self.analyse(data, id: record.id) }.value
                guard !Task.isCancelled, owner == ownerUid else { return }
                if let view { loaded.append(view) } else { hasError = true }
            }
            views = loaded; activeId = loaded.first?.id
        } catch { hasError = true }
    }
    func add(_ data: Data, ownerUid: String) async {
        guard !isLoading else { return }
        isLoading = true; hasError = false
        defer { isLoading = false }
        let id = UUID().uuidString
        guard let analysed = await Task.detached(priority: .userInitiated, operation: { Self.analyse(data, id: id) }).value else { hasError = true; return }
        guard !Task.isCancelled, owner == ownerUid else { return }
        do {
            let saved = try photos.save(data, ownerUid: ownerUid)
            let view = FaceView(id: saved.id, image: analysed.image, landmarks: analysed.landmarks, status: analysed.status, contours: analysed.contours)
            views.append(view); activeId = view.id
        } catch { hasError = true }
    }
    func remove(_ id: String, ownerUid: String) {
        do {
            if let stored = try photos.list(ownerUid: ownerUid).first(where: { $0.id == id }) { try photos.delete(stored) }
            views.removeAll { $0.id == id }
            if activeId == id { activeId = views.first?.id }
        } catch { hasError = true }
    }
    nonisolated private static func analyse(_ data: Data, id: String) -> FaceView? {
        guard let image = ImageDecoder.decode(data) else { return nil }
        do {
            guard let detected = try FaceLandmarkService().detect(in: image), let mesh = detected.meshPoints else {
                return FaceView(id: id, image: image, landmarks: nil, status: .noFace)
            }
            return FaceView(id: id, image: image, landmarks: mesh, status: .detected, contours: detected.regions)
        } catch { return FaceView(id: id, image: image, landmarks: nil, status: .failed) }
    }
}
