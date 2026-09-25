import AppKit

/// What someone's plan says at a given moment, ready to show.
struct Status {
    let day: Day
    /// The running item, or the next one on a break.
    let item: Item?
    let title: String
    /// "23 min left", "in 12 min"
    let left: String?
    /// The menu bar countdown.
    let countdown: String?
    /// How much of the running item is left, 0…1.
    let remaining: Double?
    let next: Item?

    init(_ items: [Item], at now: Date) {
        day = Day(items, at: now)
        switch day {
        case .active(let i):
            let item = items[i]
            self.item = item
            title = item.name
            left = "\(Format.left(item.end.timeIntervalSince(now))) \(L10n.tr("left"))"
            countdown = Format.countdown(item.end.timeIntervalSince(now))
            remaining = item.end.timeIntervalSince(now) / max(1, item.end.timeIntervalSince(item.start))
            next = items.indices.contains(i + 1) ? items[i + 1] : nil
        case .waiting(let i), .onBreak(let i):
            let item = items[i]
            self.item = nil
            title = day == .waiting(i) ? L10n.tr("Not started yet") : L10n.tr("On a break")
            left = "\(L10n.tr("in")) \(Format.left(item.start.timeIntervalSince(now)))"
            countdown = Format.countdown(item.start.timeIntervalSince(now))
            remaining = nil
            next = item
        case .finished:
            (item, title, left, countdown, remaining, next) = (nil, L10n.tr("Done for the day"), nil, nil, nil, nil)
        case .empty:
            (item, title, left, countdown, remaining, next) = (nil, L10n.tr("No plan today"), nil, nil, nil, nil)
        }
    }

    var isActive: Bool { if case .active = day { true } else { false } }
}

/// The menu bar item: a ring that empties as the running item runs out, and
/// the time left. Drawn as one template image so the digits never jiggle and
/// the colors follow the menu bar.
enum StatusIcon {
    static func image(remaining: Double?, countdown: String?, dimmed: Bool = false) -> NSImage {
        let font = NSFont.monospacedDigitSystemFont(ofSize: 13, weight: .medium)
        let text = countdown.map { NSAttributedString(string: $0, attributes: [.font: font, .foregroundColor: NSColor.black]) }
        let ring: CGFloat = 15, gap: CGFloat = 4, height: CGFloat = 18
        let width = ceil(ring + (text.map { gap + $0.size().width } ?? 0))
        let image = NSImage(size: NSSize(width: width, height: height), flipped: false) { _ in
            let box = NSRect(x: 0.75, y: (height - ring) / 2 + 0.75, width: ring - 1.5, height: ring - 1.5)
            let outline = NSBezierPath(ovalIn: box)
            outline.lineWidth = 1.5
            NSColor.black.withAlphaComponent(dimmed ? 0.35 : 0.9).setStroke()
            outline.stroke()
            if let remaining, remaining > 0 {
                // A Time Timer: the wedge of what's left, from twelve o'clock.
                let center = NSPoint(x: box.midX, y: box.midY)
                let wedge = NSBezierPath()
                wedge.move(to: center)
                wedge.appendArc(withCenter: center, radius: box.width / 2 - 2, startAngle: 90, endAngle: 90 - 360 * min(1, remaining), clockwise: true)
                wedge.close()
                NSColor.black.setFill()
                wedge.fill()
            } else if countdown == nil {
                // Nothing running: clock hands.
                let center = NSPoint(x: box.midX, y: box.midY)
                let hands = NSBezierPath()
                hands.move(to: NSPoint(x: center.x, y: center.y + 4))
                hands.line(to: center)
                hands.line(to: NSPoint(x: center.x + 3, y: center.y - 2))
                hands.lineWidth = 1.5
                hands.lineCapStyle = .round
                hands.lineJoinStyle = .round
                hands.stroke()
            }
            if let text {
                let size = text.size()
                text.draw(at: NSPoint(x: ring + gap, y: (height - size.height) / 2 + 0.5))
            }
            return true
        }
        image.isTemplate = true
        return image
    }
}
