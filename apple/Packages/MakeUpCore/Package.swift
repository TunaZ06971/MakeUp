// swift-tools-version: 6.0
import PackageDescription

let package = Package(
    name: "MakeUpCore",
    platforms: [.iOS(.v17), .macOS(.v14)],
    products: [
        .library(name: "MakeUpCore", targets: ["MakeUpCore"])
    ],
    dependencies: [
        .package(url: "https://github.com/firebase/firebase-ios-sdk.git", from: "12.0.0")
    ],
    targets: [
        .target(
            name: "MakeUpCore",
            dependencies: [
                .product(name: "FirebaseAuth", package: "firebase-ios-sdk"),
                .product(name: "FirebaseFirestore", package: "firebase-ios-sdk"),
            ],
            resources: [.process("Resources")]
        )
    ]
)
