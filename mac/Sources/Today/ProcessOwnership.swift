import Darwin
import Foundation

/// Registration can spawn an agent while the manually opened app is running.
/// The agent waits for that process to exit, then takes over its token store.
enum ProcessOwnership {
    private static var descriptor: Int32 = -1

    static func claim(directory: URL = URL.applicationSupportDirectory.appending(path: "today")) {
        do {
            try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true, attributes: [.posixPermissions: 0o700])
        } catch { exit(1) }
        descriptor = open(directory.appending(path: "process.lock").path, O_CREAT | O_RDWR | O_CLOEXEC, 0o600)
        guard descriptor >= 0 else { exit(1) }
        if flock(descriptor, LOCK_EX | LOCK_NB) == 0 {
            ftruncate(descriptor, 0)
            return
        }
        guard CommandLine.arguments.contains("--agent"), flock(descriptor, LOCK_EX) == 0 else { exit(0) }
        // An orderly quit must stop the waiting agent as well.
        var normal: UInt8 = 0
        if pread(descriptor, &normal, 1, 0) == 1, normal == 1 { exit(0) }
        ftruncate(descriptor, 0)
    }

    static func exitNormally() {
        guard descriptor >= 0 else { return }
        var normal: UInt8 = 1
        _ = pwrite(descriptor, &normal, 1, 0)
    }

    /// An enabled job may be stopped after a normal quit; start its waiter.
    static func startAgent() {
        guard !CommandLine.arguments.contains("--agent") else { return }
        let process = Process()
        process.executableURL = URL(fileURLWithPath: "/bin/launchctl")
        process.arguments = ["kickstart", "gui/\(getuid())/plus.lost.today"]
        process.standardOutput = FileHandle.nullDevice
        process.standardError = FileHandle.nullDevice
        try? process.run()
    }
}
