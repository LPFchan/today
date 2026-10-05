import AppKit
import AVFoundation
import AudioToolbox
import CoreAudio

/// Owns playback and the temporary changes to the system output volume.
@MainActor
final class WakeAlarm {
    private(set) var ringing = false
    private var player: AVAudioPlayer?
    private var fallback: NSSound?
    private var ramp: Timer?
    private var started: TimeInterval = 0
    private var output: OutputVolume?

    /// Radial ships with macOS. A local copy covers a future macOS moving it.
    private static let system = URL(filePath: "/System/Library/PrivateFrameworks/ToneLibrary.framework/Versions/A/Resources/Ringtones/Radial-EncoreInfinitum.m4r")
    private static var copy: URL {
        URL.applicationSupportDirectory.appending(path: "today/Radial-EncoreInfinitum.m4r")
    }

    func setRinging(_ needed: Bool) {
        guard needed != ringing else { return }
        ringing = needed
        if needed { start() } else { stop() }
    }

    private func start() {
        started = ProcessInfo.processInfo.systemUptime
        updateVolume()
        if !(playFile(Self.system) || playFile(Self.copy)) {
            fallback = NSSound(named: "Glass")
            fallback?.loops = true
            fallback?.play()
        }
        let timer = Timer(timeInterval: 1, repeats: true) { [weak self] _ in
            MainActor.assumeIsolated { self?.updateVolume() }
        }
        ramp = timer
        RunLoop.main.add(timer, forMode: .common)
    }

    private func playFile(_ file: URL) -> Bool {
        guard let sound = try? AVAudioPlayer(contentsOf: file), sound.prepareToPlay() else { return false }
        return play(sound)
    }

    /// Keep our own copy of the system tone, refreshed whenever it's readable.
    static func keepCopy() {
        guard FileManager.default.isReadableFile(atPath: system.path) else { return }
        try? FileManager.default.createDirectory(at: copy.deletingLastPathComponent(), withIntermediateDirectories: true)
        try? FileManager.default.removeItem(at: copy)
        try? FileManager.default.copyItem(at: system, to: copy)
    }

    @discardableResult
    private func play(_ sound: AVAudioPlayer) -> Bool {
        sound.numberOfLoops = -1
        guard sound.play() else { return false }
        player = sound
        fallback?.stop()
        fallback = nil
        return true
    }

    private func updateVolume() {
        guard ringing else { return }
        let device = OutputVolume.defaultDevice()
        if output?.device != device {
            output?.restore()
            output = device.flatMap { OutputVolume(device: $0) }
        }
        let progress = min(max((ProcessInfo.processInfo.systemUptime - started) / 5, 0), 1)
        output?.set(volume: Float32(0.2 + 0.3 * progress))
    }

    private func stop() {
        ramp?.invalidate()
        ramp = nil
        player?.stop()
        player = nil
        fallback?.stop()
        fallback = nil
        output?.restore()
        output = nil
    }
}

/// Remember the actual device we changed, even if the output route later changes.
private struct OutputVolume {
    let device: AudioObjectID
    let volume: Float32?
    let mute: UInt32?

    init(device: AudioObjectID) {
        self.device = device
        volume = Self.read(device, selector: kAudioHardwareServiceDeviceProperty_VirtualMainVolume, initial: Float32(0))
        mute = Self.read(device, selector: kAudioDevicePropertyMute, initial: UInt32(0))
    }

    static func defaultDevice() -> AudioObjectID? {
        let device: AudioObjectID? = read(AudioObjectID(kAudioObjectSystemObject), selector: kAudioHardwarePropertyDefaultOutputDevice, scope: kAudioObjectPropertyScopeGlobal, initial: AudioObjectID(0))
        return device == kAudioObjectUnknown ? nil : device
    }

    func set(volume level: Float32) {
        // Never change a property whose previous value we couldn't read.
        if volume != nil { Self.write(device, selector: kAudioHardwareServiceDeviceProperty_VirtualMainVolume, value: level) }
        if mute != nil { Self.write(device, selector: kAudioDevicePropertyMute, value: UInt32(0)) }
    }

    func restore() {
        if let volume { Self.write(device, selector: kAudioHardwareServiceDeviceProperty_VirtualMainVolume, value: volume) }
        if let mute { Self.write(device, selector: kAudioDevicePropertyMute, value: mute) }
    }

    private static func address(_ selector: AudioObjectPropertySelector, scope: AudioObjectPropertyScope) -> AudioObjectPropertyAddress {
        AudioObjectPropertyAddress(mSelector: selector, mScope: scope, mElement: kAudioObjectPropertyElementMain)
    }

    private static func read<T>(_ device: AudioObjectID, selector: AudioObjectPropertySelector, scope: AudioObjectPropertyScope = kAudioObjectPropertyScopeOutput, initial: T) -> T? {
        var property = address(selector, scope: scope)
        var value = initial
        var size = UInt32(MemoryLayout<T>.size)
        let status = withUnsafeMutablePointer(to: &value) {
            AudioObjectGetPropertyData(device, &property, 0, nil, &size, $0)
        }
        return status == noErr ? value : nil
    }

    private static func write<T>(_ device: AudioObjectID, selector: AudioObjectPropertySelector, value: T) {
        var property = address(selector, scope: kAudioObjectPropertyScopeOutput)
        var settable: DarwinBoolean = false
        guard AudioObjectIsPropertySettable(device, &property, &settable) == noErr, settable.boolValue else { return }
        var value = value
        _ = withUnsafePointer(to: &value) {
            AudioObjectSetPropertyData(device, &property, 0, nil, UInt32(MemoryLayout<T>.size), $0)
        }
    }
}
