import FirebaseAuth
import Foundation
import Observation

@MainActor
@Observable
public final class AuthService {
    public private(set) var user: User?
    public private(set) var isReady = false

    private let users = UserRepository()

    public init() {
        Auth.auth().addStateDidChangeListener { [weak self] _, user in
            self?.user = user
            self?.isReady = true
        }
    }

    public func signUp(
        email: String,
        password: String,
        displayName: String,
        language: AppLanguage
    ) async throws {
        let result = try await Auth.auth().createUser(withEmail: email, password: password)
        if !displayName.isEmpty {
            let request = result.user.createProfileChangeRequest()
            request.displayName = displayName
            try await request.commitChanges()
        }
        try await users.ensureProfile(
            uid: result.user.uid,
            email: email,
            displayName: displayName,
            language: language
        )
    }

    public func signIn(email: String, password: String, language: AppLanguage) async throws {
        let result = try await Auth.auth().signIn(withEmail: email, password: password)
        try await users.ensureProfile(
            uid: result.user.uid,
            email: result.user.email ?? email,
            displayName: result.user.displayName ?? "",
            language: language
        )
    }

    public func signOut() throws {
        try Auth.auth().signOut()
    }

    public func sendPasswordReset(to email: String) async throws {
        try await Auth.auth().sendPasswordReset(withEmail: email)
    }

    /// Localized-string key describing `error`, shared with the web client's
    /// message set so both platforms word failures the same way.
    public static func messageKey(for error: Error) -> String {
        guard let code = AuthErrorCode(rawValue: (error as NSError).code) else {
            return "auth.error.generic"
        }
        return switch code {
        case .invalidEmail: "auth.error.invalidEmail"
        case .weakPassword: "auth.error.weakPassword"
        case .emailAlreadyInUse: "auth.error.emailInUse"
        case .wrongPassword, .userNotFound, .invalidCredential: "auth.error.invalidCredential"
        case .tooManyRequests: "auth.error.tooManyRequests"
        case .networkError: "auth.error.network"
        default: "auth.error.generic"
        }
    }
}
