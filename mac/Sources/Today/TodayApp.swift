import AppKit
import ServiceManagement
import Sparkle
import SwiftUI
import UserNotifications

@main
struct TodayApp: App {
    @NSApplicationDelegateAdaptor(AppDelegate.self) private var app

    init() {
        #if DEBUG
        if let flag = CommandLine.arguments.firstIndex(of: "--snapshot"), flag + 1 < CommandLine.arguments.count {
            Snapshot.run(to: URL(fileURLWithPath: CommandLine.arguments[flag + 1]))
            exit(0)
        }
        #endif
    }

    var body: some Scene {
        MenuBarExtra {
            Panel(model: app.model, updater: app.updater)
        } label: {
            MenuBarLabel(model: app.model)
        }
        .menuBarExtraStyle(.window)
    }
}

@MainActor
final class AppDelegate: NSObject, NSApplicationDelegate, UNUserNotificationCenterDelegate, SPUUpdaterDelegate {
    let model = Model()
    private(set) lazy var updater = SPUStandardUpdaterController(startingUpdater: liveUpdates, updaterDelegate: self, userDriverDelegate: nil)
    private var onboardingWindow: OnboardingWindow?
    private var overlay: KeepoutOverlay?
    private var powerOffObserver: NSObjectProtocol?
    private var deferredUpdate: (() -> Void)?

    private var liveUpdates: Bool {
        #if DEBUG
        !model.fakeKeepout
        #else
        true
        #endif
    }

    func applicationDidFinishLaunching(_ notification: Notification) {
        powerOffObserver = NSWorkspace.shared.notificationCenter.addObserver(forName: NSWorkspace.willPowerOffNotification, object: nil, queue: .main) { [weak self] _ in
            MainActor.assumeIsolated { self?.overlay?.endingSession = true }
        }
        let overlay = KeepoutOverlay(model: model)
        self.overlay = overlay
        overlay.onUnlock = { [weak self] in
            guard let self, let install = self.deferredUpdate else { return }
            self.deferredUpdate = nil
            install()
        }
        #if DEBUG
        if model.fakeKeepout { return }
        #endif
        // Look for an update on every launch, on top of Sparkle's daily check.
        updater.updater.checkForUpdatesInBackground()
        Alerts.center?.delegate = self
        model.onboard = { [weak self] in self?.showOnboarding() }
        // `open Today.app --args --rehearse-first-launch` replays what a new user sees.
        // Signed out counts as new too: signing in only happens in the wizard.
        if CommandLine.arguments.contains("--rehearse-first-launch") || !UserDefaults.standard.bool(forKey: "onboarded") || model.session == .signedOut {
            showOnboarding()
        } else if model.notify {
            Alerts.ask()
        }
    }

    func applicationWillTerminate(_ notification: Notification) {
        model.stopWakeAlarm()
        ProcessOwnership.exitNormally()
    }

    func applicationShouldTerminate(_ sender: NSApplication) -> NSApplication.TerminateReply {
        if overlay?.endingSession == true { return .terminateNow }
        return model.keepout != nil ? .terminateCancel : .terminateNow
    }

    func updater(_ updater: SPUUpdater, shouldPostponeRelaunchForUpdate item: SUAppcastItem, untilInvokingBlock installHandler: @escaping () -> Void) -> Bool {
        guard model.keepout != nil else { return false }
        deferredUpdate = installHandler
        return true
    }

    // Show banners even while the panel is open and Today is the active app.
    nonisolated func userNotificationCenter(_ center: UNUserNotificationCenter, willPresent notification: UNNotification) async -> UNNotificationPresentationOptions {
        [.banner, .sound]
    }

    private func showOnboarding() {
        if let window = onboardingWindow {
            window.makeKeyAndOrderFront(nil)
            NSApp.activate()
            return
        }
        let onboarding = Onboarding()
        onboarding.notify = model.notify
        // A second run starts from how things are now.
        if UserDefaults.standard.bool(forKey: "onboarded") {
            onboarding.openAtLogin = model.openAtLogin
        }
        if model.session == .signedIn { model.refresh() }
        let window = OnboardingWindow(onboarding, model: model)
        onboarding.onFinish = { [weak self, weak onboarding] in
            guard let self, let onboarding else { return }
            self.finishOnboarding(openAtLogin: onboarding.openAtLogin, notify: onboarding.notify)
        }
        onboardingWindow = window
        window.makeKeyAndOrderFront(nil)
        NSApp.activate()
    }

    private func finishOnboarding(openAtLogin: Bool, notify: Bool) {
        guard let window = onboardingWindow else { return }
        onboardingWindow = nil
        UserDefaults.standard.set(true, forKey: "onboarded")
        model.setOpenAtLogin(openAtLogin)
        window.close()
        // Set after the wizard closes so macOS's permission prompt doesn't cover it.
        model.notify = notify
    }
}
