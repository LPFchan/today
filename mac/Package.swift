// swift-tools-version:6.0
import PackageDescription

let package = Package(
    name: "Today",
    defaultLocalization: "en",
    platforms: [.macOS(.v15)],
    dependencies: [
        .package(url: "https://github.com/sparkle-project/Sparkle", exact: "2.10.0"),
    ],
    targets: [
        .executableTarget(
            name: "Today",
            dependencies: [.product(name: "Sparkle", package: "Sparkle")],
            path: "Sources/Today",
            resources: [.process("Resources")],
            // Sparkle.framework is copied into Contents/Frameworks by scripts/build-app.sh.
            linkerSettings: [.unsafeFlags(["-Xlinker", "-rpath", "-Xlinker", "@executable_path/../Frameworks"])]
        )
    ],
    swiftLanguageModes: [.v5]
)
