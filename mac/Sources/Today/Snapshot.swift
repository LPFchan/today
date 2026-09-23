#if DEBUG
import AppKit
import Sparkle
import SwiftUI

/// `Today --snapshot DIR` (debug builds) draws the onboarding steps, the
/// panel and the menu bar item to PNGs with made-up plans, then quits. CI runs
/// it so the UI can be looked at without a Mac.
@MainActor
enum Snapshot {
    static func run(to dir: URL) {
        _ = NSApplication.shared
        try? FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        let now = Date()
        func at(_ minutes: Double) -> Date { now.addingTimeInterval(minutes * 60) }
        let model = Model(live: false)
        model.session = .signedIn
        model.updated = now
        model.people = [
            Person(name: "yeowool", me: true, visibility: "public", items: [
                Item(start: at(-150), end: at(-60), name: "Email"),
                Item(start: at(-60), end: at(23.2), name: "Deep work on the Mac app"),
                Item(start: at(23.2), end: at(83.2), name: "Lunch"),
                Item(start: at(83.2), end: at(143.2), name: "Guitar"),
                Item(start: at(160), end: at(220), name: "Groceries"),
                Item(start: at(220), end: at(300), name: "Mix the demo"),
                Item(start: at(300), end: at(360), name: "Dinner"),
            ]),
            Person(name: "marie", me: false, visibility: "public", items: [
                Item(start: at(-30), end: at(-5), name: "Coffee"),
                Item(start: at(12), end: at(100), name: "Studio"),
            ]),
            Person(name: "Jun", me: false, visibility: "public", items: [
                Item(start: at(-200), end: at(-20), name: "Work"),
            ]),
        ]
        let updater = SPUStandardUpdaterController(startingUpdater: false, updaterDelegate: nil, userDriverDelegate: nil)

        for (index, step) in Onboarding.Step.allCases.enumerated() {
            let onboarding = Onboarding()
            onboarding.step = step
            save(OnboardingView(onboarding: onboarding, model: model), dark: true, to: dir.appending(path: "onboarding-\(index + 1).png"))
        }
        let panel = Panel(model: model, updater: updater).background(Color(nsColor: .windowBackgroundColor))
        save(panel, dark: true, to: dir.appending(path: "panel-dark.png"))
        save(panel, dark: false, to: dir.appending(path: "panel-light.png"))
        model.selection = "marie"
        save(panel, dark: true, to: dir.appending(path: "panel-friend.png"))
        model.session = .signedOut
        save(panel, dark: true, to: dir.appending(path: "panel-signed-out.png"))

        let status = Status(model.people[0].items, at: now)
        let icon = Image(nsImage: StatusIcon.image(remaining: status.remaining, countdown: status.countdown))
            .renderingMode(.template)
            .padding(8)
        save(icon.foregroundStyle(.white).background(Color(white: 0.15)), dark: true, to: dir.appending(path: "menubar-dark.png"))
        save(icon.foregroundStyle(.black).background(Color(white: 0.92)), dark: false, to: dir.appending(path: "menubar-light.png"))
    }

    /// Hosts the view in an offscreen window so AppKit-backed controls draw too.
    private static func save(_ view: some View, dark: Bool, to url: URL) {
        let host = NSHostingView(rootView: view)
        host.frame.size = host.fittingSize
        let window = NSWindow(contentRect: host.frame, styleMask: [.borderless], backing: .buffered, defer: false)
        window.appearance = NSAppearance(named: dark ? .darkAqua : .aqua)
        window.contentView = host
        host.layoutSubtreeIfNeeded()
        RunLoop.main.run(until: Date().addingTimeInterval(0.3))
        guard let rep = host.bitmapImageRepForCachingDisplay(in: host.bounds) else { return }
        host.cacheDisplay(in: host.bounds, to: rep)
        try? rep.representation(using: .png, properties: [:])?.write(to: url)
        print(url.path)
    }
}
#endif
