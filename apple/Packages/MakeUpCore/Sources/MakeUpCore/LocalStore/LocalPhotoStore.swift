import Foundation

/// Face photos are sensitive biometric data, so they stay in the app's own
/// container and are never uploaded. Records are namespaced by uid because one
/// device can be shared by several accounts.
public struct LocalPhotoStore: Sendable {
    public struct StoredPhoto: Identifiable, Hashable, Sendable {
        public let id: String
        public let url: URL
        public let createdAt: Date
    }

    // Computed rather than stored: FileManager is not Sendable.
    private var fileManager: FileManager { .default }

    public init() {}

    private func directory(for ownerUid: String) throws -> URL {
        let base = try fileManager.url(
            for: .applicationSupportDirectory,
            in: .userDomainMask,
            appropriateFor: nil,
            create: true
        )
        var directory = base.appending(path: "FacePhotos/\(ownerUid)", directoryHint: .isDirectory)
        try fileManager.createDirectory(at: directory, withIntermediateDirectories: true)
        var values = URLResourceValues()
        values.isExcludedFromBackup = true
        try directory.setResourceValues(values)
        return directory
    }

    @discardableResult
    public func save(_ data: Data, ownerUid: String) throws -> StoredPhoto {
        let id = UUID().uuidString
        let url = try directory(for: ownerUid).appending(path: "\(id).jpg")
        try data.write(to: url, options: .atomic)
        return StoredPhoto(id: id, url: url, createdAt: .now)
    }

    /// Newest first.
    public func list(ownerUid: String) throws -> [StoredPhoto] {
        let directory = try directory(for: ownerUid)
        let urls = try fileManager.contentsOfDirectory(
            at: directory,
            includingPropertiesForKeys: [.creationDateKey],
            options: [.skipsHiddenFiles]
        )

        return urls
            .filter { $0.pathExtension == "jpg" }
            .map { url in
                let created = (try? url.resourceValues(forKeys: [.creationDateKey]).creationDate)
                return StoredPhoto(
                    id: url.deletingPathExtension().lastPathComponent,
                    url: url,
                    createdAt: created ?? .distantPast
                )
            }
            .sorted { $0.createdAt > $1.createdAt }
    }

    public func delete(_ photo: StoredPhoto) throws {
        try fileManager.removeItem(at: photo.url)
    }

    /// Removes every photo belonging to an account — used when signing out of a
    /// shared device and when deleting an account.
    public func deleteAll(ownerUid: String) throws {
        let directory = try directory(for: ownerUid)
        try fileManager.removeItem(at: directory)
    }
}
