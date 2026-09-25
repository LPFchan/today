import Foundation
import UserNotifications

/// Banners for when someone's next item starts. Debug builds run outside an
/// app bundle have no notification center, so they stay quiet.
enum Alerts {
    static var center: UNUserNotificationCenter? {
        Bundle.main.bundleIdentifier == nil ? nil : .current()
    }

    /// Shows macOS's permission prompt the first time; a no-op after that.
    static func ask() {
        center?.requestAuthorization(options: [.alert, .sound]) { _, _ in }
    }

    static func started(_ item: Item, by person: Person) {
        guard let center else { return }
        let content = UNMutableNotificationContent()
        content.title = person.me ? item.name : person.name
        content.body = person.me
            ? String(format: L10n.tr("Until %@"), Format.clock(item.end))
            : String(format: L10n.tr("%@ until %@"), item.name, Format.clock(item.end))
        content.sound = .default
        center.add(UNNotificationRequest(identifier: "\(person.id) \(item.start.timeIntervalSince1970)", content: content, trigger: nil))
    }
}
