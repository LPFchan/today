import Foundation

struct Keepout: Decodable, Equatable {
    let key: String
    let name: String
    let kind: String
    let since: Date
    let until: Date?
    let needs: [String]
    let have: [String]
    let canStart: Bool
    let canDone: Bool
    let doneAfter: Date

    private enum CodingKeys: String, CodingKey {
        case key, name, kind, since, until, needs, have, canStart, canDone, doneAfter
    }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        key = try c.decode(String.self, forKey: .key)
        name = try c.decode(String.self, forKey: .name)
        kind = try c.decode(String.self, forKey: .kind)
        since = Date(timeIntervalSince1970: try c.decode(Double.self, forKey: .since) / 1000)
        until = try c.decodeIfPresent(Double.self, forKey: .until).map { Date(timeIntervalSince1970: $0 / 1000) }
        needs = try c.decode([String].self, forKey: .needs)
        have = try c.decodeIfPresent([String].self, forKey: .have) ?? []
        canStart = try c.decode(Bool.self, forKey: .canStart)
        canDone = try c.decode(Bool.self, forKey: .canDone)
        doneAfter = Date(timeIntervalSince1970: try c.decode(Double.self, forKey: .doneAfter) / 1000)
    }
}

extension Keepout: Encodable {
    func encode(to encoder: Encoder) throws {
        var c = encoder.container(keyedBy: CodingKeys.self)
        try c.encode(key, forKey: .key)
        try c.encode(name, forKey: .name)
        try c.encode(kind, forKey: .kind)
        try c.encode(since.timeIntervalSince1970 * 1000, forKey: .since)
        try c.encodeIfPresent(until.map { $0.timeIntervalSince1970 * 1000 }, forKey: .until)
        try c.encode(needs, forKey: .needs)
        try c.encode(have, forKey: .have)
        try c.encode(canStart, forKey: .canStart)
        try c.encode(canDone, forKey: .canDone)
        try c.encode(doneAfter.timeIntervalSince1970 * 1000, forKey: .doneAfter)
    }
}

struct KeepoutReply: Codable, Equatable {
    let day: String?
    let keepout: Keepout?
}

enum KeepoutStore {
    private static var file: URL {
        URL.applicationSupportDirectory.appending(path: "today/keepout.json")
    }

    static func load() -> KeepoutReply? {
        guard let data = try? Data(contentsOf: file) else { return nil }
        return try? JSONDecoder().decode(KeepoutReply.self, from: data)
    }

    static func save(_ reply: KeepoutReply) throws {
        guard reply.keepout != nil else { clear(); return }
        try FileManager.default.createDirectory(at: file.deletingLastPathComponent(), withIntermediateDirectories: true, attributes: [.posixPermissions: 0o700])
        try JSONEncoder().encode(reply).write(to: file, options: [.atomic])
        try FileManager.default.setAttributes([.posixPermissions: 0o600], ofItemAtPath: file.path)
    }

    static func clear() { try? FileManager.default.removeItem(at: file) }
}
