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
final class AppDelegate: NSObject, NSApplicationDelegate, UNUserNotificationCenterDelegate {
    let model = Model()
    private(set) lazy var updater = SPUStandardUpdaterController(startingUpdater: true, updaterDelegate: nil, userDriverDelegate: nil)
    private var onboardingWindow: OnboardingWindow?

    func applicationDidFinishLaunching(_ notification: Notification) {
        // Look for an update on every launch, on top of Sparkle's daily check.
        updater.updater.checkForUpdatesInBackground()
        Alerts.center?.delegate = self
        // `open Today.app --args --rehearse-first-launch` replays what a new user sees.
        if CommandLine.arguments.contains("--rehearse-first-launch") || !UserDefaults.standard.bool(forKey: "onboarded") {
            showOnboarding()
        } else if model.notify {
            Alerts.ask()
        }
    }

    // Show banners even while the panel is open and Today is the active app.
    nonisolated func userNotificationCenter(_ center: UNUserNotificationCenter, willPresent notification: UNNotification) async -> UNNotificationPresentationOptions {
        [.banner, .sound]
    }

    private func showOnboarding() {
        let onboarding = Onboarding()
        if model.session == .signedIn { model.refresh() }
        let window = OnboardingWindow(onboarding, model: model)
        onboarding.onFinish = { [weak self, weak onboarding] in
            guard let self, let onboarding else { return }
            self.finishOnboarding(openAtLogin: onboarding.openAtLogin)
        }
        onboardingWindow = window
        window.makeKeyAndOrderFront(nil)
        NSApp.activate()
    }

    private func finishOnboarding(openAtLogin: Bool) {
        guard let window = onboardingWindow else { return }
        onboardingWindow = nil
        UserDefaults.standard.set(true, forKey: "onboarded")
        if openAtLogin, SMAppService.mainApp.status != .enabled { try? SMAppService.mainApp.register() }
        window.close()
        // Asked here rather than at launch so the prompt doesn't cover the wizard.
        if model.notify { Alerts.ask() }
    }
}
