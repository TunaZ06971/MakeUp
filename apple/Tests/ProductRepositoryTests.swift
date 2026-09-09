import FirebaseAuth
import Foundation
import Testing

import MakeUpCore

/// Reads the seeded catalog out of the Firestore emulator. Run `npm run seed`
/// in the repo root first; without data the suite reports an empty catalog.
@MainActor
@Suite(
    "Product catalog",
    .enabled(if: FirebaseEmulator.isReachable && Keychain.acceptsWrites)
)
struct ProductRepositoryTests {
    private let repository = ProductRepository()

    init() {
        FirebaseBootstrap.configure()
    }

    /// Security rules only expose the catalog to signed-in users.
    private func signIn() async throws {
        let service = AuthService()
        try await service.signUp(
            email: "catalog-\(UUID().uuidString.prefix(8).lowercased())@example.com",
            password: "test123456",
            displayName: "",
            language: .en
        )
    }

    @Test func fetchesTheSeededCatalog() async throws {
        try await signIn()
        let products = try await repository.fetch()

        #expect(!products.isEmpty, "run `npm run seed` to populate the emulator")
        #expect(products.allSatisfy { $0.isActive })
        #expect(products.allSatisfy { !$0.colors.isEmpty })
        #expect(products.allSatisfy { $0.source == .curatedV1 })
    }

    @Test func filtersByCategory() async throws {
        try await signIn()
        let lipsticks = try await repository.fetch(category: .lipstick)

        #expect(!lipsticks.isEmpty)
        #expect(lipsticks.allSatisfy { $0.category == .lipstick })
        #expect(lipsticks.allSatisfy { $0.applicableRegions.contains(.lips) })
    }

    /// Every hex the seed script accepted must parse into shader-ready numbers.
    @Test func everyColorParsesIntoComponents() async throws {
        try await signIn()
        let products = try await repository.fetch()

        for product in products {
            for color in product.colors {
                let rgb = try #require(color.rgb, "unparseable hex \(color.hex) on \(product.id)")
                #expect((0...1).contains(rgb.red))
                #expect((0...1).contains(rgb.green))
                #expect((0...1).contains(rgb.blue))
            }
        }
    }

    @Test func searchMatchesBothLanguages() async throws {
        try await signIn()
        let products = try await repository.fetch(category: .lipstick)

        #expect(products.contains { $0.matches("dior") })
        #expect(products.contains { $0.matches("迪奥") })
        #expect(products.filter { $0.matches("dior") }.allSatisfy { $0.brand == "Dior" })
    }
}
