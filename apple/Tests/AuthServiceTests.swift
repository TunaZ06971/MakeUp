import FirebaseAuth
import FirebaseFirestore
import Foundation
import Security
import Testing

import MakeUpCore

/// Exercises the real auth stack against the Firebase Emulator Suite.
/// Start it first with `npm run emulators` in the repo root.
///
/// Skipped when the keychain is unavailable, which is the case for macOS builds
/// signed ad-hoc — see the signing section of the README.
@MainActor
@Suite(
    "Auth against the Firebase emulator",
    .enabled(if: FirebaseEmulator.isReachable && Keychain.acceptsWrites)
)
struct AuthServiceTests {
    init() {
        FirebaseBootstrap.configure()
    }

    @Test func signUpCreatesProfileAndSignOutClearsSession() async throws {
        let service = AuthService()
        let email = "test-\(UUID().uuidString.prefix(8).lowercased())@example.com"

        try await service.signUp(
            email: email,
            password: "test123456",
            displayName: "小美",
            language: .zh
        )

        let uid = try #require(Auth.auth().currentUser?.uid)
        #expect(Auth.auth().currentUser?.email == email)

        let profile = try await Firestore.firestore().collection("users").document(uid).getDocument()
        #expect(profile.exists)
        #expect(profile.get("displayName") as? String == "小美")
        #expect(profile.get("preferredLanguage") as? String == "zh")
        #expect(profile.get("email") as? String == email)

        try service.signOut()
        #expect(Auth.auth().currentUser == nil)
    }

    @Test func signInWithAWrongPasswordReportsBadCredentials() async throws {
        let service = AuthService()
        let email = "test-\(UUID().uuidString.prefix(8).lowercased())@example.com"
        try await service.signUp(email: email, password: "test123456", displayName: "", language: .en)
        try service.signOut()

        await #expect(throws: (any Error).self) {
            try await service.signIn(email: email, password: "wrong-password", language: .en)
        }
    }

    @Test func signUpFallsBackToTheEmailPrefixWhenNoDisplayNameIsGiven() async throws {
        let service = AuthService()
        let localPart = "test-\(UUID().uuidString.prefix(8).lowercased())"
        try await service.signUp(
            email: "\(localPart)@example.com",
            password: "test123456",
            displayName: "",
            language: .en
        )

        let uid = try #require(Auth.auth().currentUser?.uid)
        let profile = try await Firestore.firestore().collection("users").document(uid).getDocument()
        #expect(profile.get("displayName") as? String == localPart)

        try service.signOut()
    }
}

enum Keychain {
    /// Firebase Auth persists its session in the data-protection keychain, which
    /// needs a `keychain-access-groups` entitlement — and that entitlement needs
    /// a provisioning profile, so an ad-hoc signed build gets
    /// `errSecMissingEntitlement` instead. Probe rather than assume, so these
    /// tests start running by themselves once a development team is configured.
    static var acceptsWrites: Bool {
        let item: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: "com.makeup.keychain-probe",
            kSecAttrAccount as String: "probe",
            kSecValueData as String: Data("probe".utf8),
            kSecUseDataProtectionKeychain as String: true,
        ]
        SecItemDelete(item as CFDictionary)
        let status = SecItemAdd(item as CFDictionary, nil)
        SecItemDelete(item as CFDictionary)
        return status == errSecSuccess
    }
}

enum FirebaseEmulator {
    /// Synchronous probe so it can gate a `@Suite` trait.
    static var isReachable: Bool {
        var reachable = false
        let done = DispatchSemaphore(value: 0)
        var request = URLRequest(url: URL(string: "http://127.0.0.1:9099/")!)
        request.timeoutInterval = 2
        URLSession.shared.dataTask(with: request) { _, response, _ in
            reachable = response != nil
            done.signal()
        }.resume()
        _ = done.wait(timeout: .now() + 5)
        return reachable
    }
}
