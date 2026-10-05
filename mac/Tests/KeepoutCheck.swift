import Foundation

@main struct KeepoutCheck {
    static func main() throws {
        let base: [String: Any] = ["day": "2026-10-06", "keepout": [
            "key": "wake", "name": "wake up", "kind": "fixed", "since": 1000,
            "needs": ["wake", "photo"], "canStart": false, "canDone": true, "doneAfter": 1000
        ]]
        let old = try JSONDecoder().decode(KeepoutReply.self, from: JSONSerialization.data(withJSONObject: base))
        precondition(old.keepout?.have == [])
        var present = base
        var lock = present["keepout"] as! [String: Any]
        lock["have"] = ["wake"]
        present["keepout"] = lock
        let accepted = try JSONDecoder().decode(KeepoutReply.self, from: JSONSerialization.data(withJSONObject: present))
        precondition(accepted.keepout?.have == ["wake"])
        let cached = try JSONDecoder().decode(KeepoutReply.self, from: JSONEncoder().encode(accepted))
        precondition(cached == accepted)
        lock["have"] = "wake"
        present["keepout"] = lock
        do {
            _ = try JSONDecoder().decode(KeepoutReply.self, from: JSONSerialization.data(withJSONObject: present))
            fatalError("invalid proof shape decoded")
        } catch DecodingError.typeMismatch { }
        print("Keepout compatibility and cache round-trip checks passed")
    }
}
