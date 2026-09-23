import Foundation

/// One line of someone's plan, in absolute time.
struct Item: Decodable, Hashable {
    let start: Date
    let end: Date
    let name: String

    private enum CodingKeys: String, CodingKey { case start, end, name }

    // The board sends epoch milliseconds.
    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        start = Date(timeIntervalSince1970: try c.decode(Double.self, forKey: .start) / 1000)
        end = Date(timeIntervalSince1970: try c.decode(Double.self, forKey: .end) / 1000)
        name = try c.decode(String.self, forKey: .name)
    }

    init(start: Date, end: Date, name: String) {
        self.start = start
        self.end = end
        self.name = name
    }
}

/// A row of GET /api/board: you, plus everyone who shares their day.
struct Person: Decodable, Identifiable, Hashable {
    let name: String
    let me: Bool
    let visibility: String
    let items: [Item]

    /// Names are unique enough among friends; you are always "me".
    var id: String { me ? Person.meID : name }
    static let meID = "me"
}

struct Board: Decodable {
    let people: [Person]
}

/// Where a moment falls in a plan. Mirrors dayState() in public/schedule.js.
enum Day: Equatable {
    case active(Int)    // inside items[i]
    case waiting(Int)   // before the first item; items[i] is next
    case onBreak(Int)   // between items; items[i] is next
    case finished
    case empty

    init(_ items: [Item], at now: Date) {
        if let i = items.firstIndex(where: { now >= $0.start && now < $0.end }) {
            self = .active(i)
        } else if let i = items.firstIndex(where: { now < $0.start }) {
            self = items.contains(where: { now >= $0.end }) ? .onBreak(i) : .waiting(i)
        } else {
            self = items.isEmpty ? .empty : .finished
        }
    }
}

enum Format {
    /// "23:14", or "1:02:03" past an hour.
    static func countdown(_ interval: TimeInterval) -> String {
        let s = max(0, Int(interval.rounded(.up)))
        let h = s / 3600, m = s % 3600 / 60, sec = s % 60
        return h > 0 ? String(format: "%d:%02d:%02d", h, m, sec) : String(format: "%02d:%02d", m, sec)
    }

    /// "1h 5m", "23 min", or "4m 12s" in the last five minutes, like the board.
    static func left(_ interval: TimeInterval) -> String {
        if interval < 5 * 60 {
            let s = max(0, Int(interval.rounded(.up)))
            return s >= 60 ? "\(s / 60)m \(s % 60)s" : "\(s)s"
        }
        let minutes = max(1, Int((interval / 60).rounded(.up)))
        return minutes >= 60 ? "\(minutes / 60)h \(minutes % 60)m" : "\(minutes) min"
    }

    /// 24-hour, the way plans are written.
    static func clock(_ date: Date) -> String { clockFormatter.string(from: date) }
    private static let clockFormatter: DateFormatter = {
        let f = DateFormatter()
        f.locale = Locale(identifier: "en_US_POSIX")
        f.dateFormat = "HH:mm"
        return f
    }()

    static func range(_ item: Item) -> String { "\(clock(item.start))–\(clock(item.end))" }
}
