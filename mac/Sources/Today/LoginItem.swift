import Foundation
import ServiceManagement

@MainActor
enum LoginItem {
    static let service = SMAppService.agent(plistName: "plus.lost.today.plist")
    static var wanted: Bool { UserDefaults.standard.bool(forKey: "openAtLogin") }

    static func migrate() {
        guard !UserDefaults.standard.bool(forKey: "agentMigrated") else { return }
        if SMAppService.mainApp.status == .enabled {
            UserDefaults.standard.set(true, forKey: "openAtLogin")
            // Keep the old item until the agent is registered or awaiting approval.
            do {
                if service.status != .enabled && service.status != .requiresApproval { try service.register() }
                try SMAppService.mainApp.unregister()
            } catch { return }
        }
        UserDefaults.standard.set(true, forKey: "agentMigrated")
    }

    static func sync(enforcing: Bool) throws {
        if enforcing || wanted {
            if service.status != .enabled && service.status != .requiresApproval { try service.register() }
        } else if service.status == .enabled || service.status == .requiresApproval {
            try service.unregister()
        }
    }

    static func set(_ enabled: Bool, enforcing: Bool) throws {
        guard !enforcing else { return }
        UserDefaults.standard.set(enabled, forKey: "openAtLogin")
        try sync(enforcing: false)
    }
}
