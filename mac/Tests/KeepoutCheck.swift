import Foundation

@main struct KeepoutCheck {
    static func main() throws {
        let base: [String: Any] = ["day": "2026-10-06", "keepout": [
            "key": "wake", "name": "wake up", "kind": "fixed", "since": 1000,
            "needs": ["wake", "photo"], "canStart": false, "canDone": true, "doneAfter": 1000
        ]]
        let old = try JSONDecoder().decode(KeepoutReply.self, from: JSONSerialization.data(withJSONObject: base))
        precondition(old.keepout?.have == [])
        precondition(old.keepout?.remainingNeeds == ["wake", "photo"])
        var present = base
        var lock = present["keepout"] as! [String: Any]
        lock["have"] = ["wake"]
        present["keepout"] = lock
        let accepted = try JSONDecoder().decode(KeepoutReply.self, from: JSONSerialization.data(withJSONObject: present))
        precondition(accepted.keepout?.have == ["wake"])
        precondition(accepted.keepout?.remainingNeeds == ["photo"])
        let cached = try JSONDecoder().decode(KeepoutReply.self, from: JSONEncoder().encode(accepted))
        precondition(cached == accepted)
        precondition(accepted.keepout?.snoozedUntil == nil)
        lock["snoozedUntil"] = 61000
        present["keepout"] = lock
        let snoozed = try JSONDecoder().decode(KeepoutReply.self, from: JSONSerialization.data(withJSONObject: present))
        precondition(snoozed.keepout?.snoozedUntil == Date(timeIntervalSince1970: 61))
        let snoozedCache = try JSONDecoder().decode(KeepoutReply.self, from: JSONEncoder().encode(snoozed))
        precondition(snoozedCache == snoozed)
        lock["snoozedUntil"] = nil
        lock["needs"] = ["wake", "done"]
        lock["have"] = ["wake", "done"]
        present["keepout"] = lock
        let button = try JSONDecoder().decode(KeepoutReply.self, from: JSONSerialization.data(withJSONObject: present))
        precondition(button.keepout?.remainingNeeds == ["done"])
        lock["have"] = "wake"
        present["keepout"] = lock
        do {
            _ = try JSONDecoder().decode(KeepoutReply.self, from: JSONSerialization.data(withJSONObject: present))
            fatalError("invalid proof shape decoded")
        } catch DecodingError.typeMismatch { }
        print("Keepout compatibility and cache round-trip checks passed")
    }
}
