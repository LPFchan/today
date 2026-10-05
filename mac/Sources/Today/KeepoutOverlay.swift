import AppKit
import Observation
import SwiftUI

@MainActor
final class KeepoutOverlay {
    private let model: Model
    private var windows: [CoverWindow] = []
    private var observers: [NSObjectProtocol] = []
    var endingSession = false
    var onUnlock: () -> Void = {}
    var shown: Bool { !windows.isEmpty }

    init(model: Model) {
        self.model = model
        let center = NotificationCenter.default
        observers.append(center.addObserver(forName: NSApplication.didChangeScreenParametersNotification, object: nil, queue: .main) { [weak self] _ in
            MainActor.assumeIsolated { self?.rebuild() }
        })
        observers.append(center.addObserver(forName: NSApplication.didResignActiveNotification, object: nil, queue: .main) { [weak self] _ in
            // Activate after the resignation finishes, rather than inside it.
            Task { @MainActor [weak self] in self?.front() }
        })
        observe()
    }

    private func observe() {
        withObservationTracking {
            if model.keepout != nil {
                if !shown { rebuild() }
            } else {
                let wasShown = shown
                dismiss()
                if wasShown { onUnlock() }
            }
        } onChange: { [weak self] in
            Task { @MainActor [weak self] in self?.observe() }
        }
    }

    private func rebuild() {
        for window in windows { window.dismiss() }
        windows = []
        guard model.keepout != nil else { return }
        NSApp.presentationOptions = [.hideDock, .hideMenuBar, .disableProcessSwitching, .disableForceQuit, .disableHideApplication, .disableAppleMenu]
        let main = NSScreen.main ?? NSScreen.screens.first
        for screen in NSScreen.screens {
            let window = CoverWindow(contentRect: screen.frame, styleMask: [.borderless], backing: .buffered, defer: false)
            window.interactive = screen == main
            window.isReleasedWhenClosed = false
            window.isOpaque = true
            window.backgroundColor = NSColor(white: 0.06, alpha: 1)
            window.level = NSWindow.Level(rawValue: Int(CGShieldingWindowLevel()))
            window.collectionBehavior = [.canJoinAllSpaces, .stationary, .fullScreenAuxiliary, .ignoresCycle]
            window.hidesOnDeactivate = false
            window.setFrame(screen.frame, display: true)
            if window.interactive {
                window.contentView = NSHostingView(rootView: CoverContent(model: model))
            }
            windows.append(window)
        }
        front()
    }

    private func front() {
        guard model.keepout != nil, shown, !endingSession else { return }
        for window in windows { window.orderFrontRegardless() }
        NSApp.activate()
        windows.first { $0.interactive }?.makeKeyAndOrderFront(nil)
    }

    private func dismiss() {
        for window in windows { window.dismiss() }
        windows = []
        NSApp.presentationOptions = []
    }
}

private struct CoverContent: View {
    let model: Model

    var body: some View {
        if let lock = model.keepout {
            KeepoutView(lock: lock, next: model.next, now: model.now, busy: model.finishing, problem: model.finishProblem, done: model.finish)
                .frame(maxWidth: .infinity, maxHeight: .infinity)
                .background(Color(white: 0.06))
                .environment(\.colorScheme, .dark)
        }
    }
}

private final class CoverWindow: NSWindow {
    var interactive = false
    override var canBecomeKey: Bool { interactive }
    override var canBecomeMain: Bool { interactive }
    override func performClose(_ sender: Any?) {}
    override func close() {}
    func dismiss() { super.close() }
}
