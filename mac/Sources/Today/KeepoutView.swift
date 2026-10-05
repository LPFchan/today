import SwiftUI

/// What covers the main screen while a keepout item holds the lock: the item,
/// what lifts it, a countdown when time is what lifts it, and Done.
struct KeepoutView: View {
    let lock: Keepout
    let next: Item?
    let now: Date
    let busy: Bool
    let problem: String?
    let done: () -> Void
    /// The notch's height on screens that have one.
    var topInset: CGFloat = 0

    var body: some View {
        ZStack {
            Self.background.ignoresSafeArea()
            VStack(spacing: 0) {
                Label("today", systemImage: "clock")
                    .font(.system(size: 14, weight: .semibold))
                    .foregroundStyle(Self.meta)
                    .padding(.top, 28 + topInset)
                Spacer()
                VStack(spacing: 0) {
                    Text(lock.name)
                        .font(.system(size: 44, weight: .bold))
                        .foregroundStyle(Self.text)
                        .multilineTextAlignment(.center)
                    (Text(L10n.tr("Keepout now")).foregroundStyle(Self.label).fontWeight(.semibold)
                        + Text(" · ").foregroundStyle(Self.muted)
                        + Text(unlocks).foregroundStyle(Self.muted))
                        .font(.system(size: 17))
                        .multilineTextAlignment(.center)
                        .padding(.top, 14)
                    if let left = countdown {
                        clock(left).padding(.top, 40)
                    }
                    if !lock.needs.isEmpty {
                        Button(action: done) {
                            Text(L10n.tr("Done"))
                                .font(.system(size: 19, weight: .semibold))
                                .foregroundStyle(canDone ? .white : Self.muted)
                                .padding(.horizontal, 44)
                                .padding(.vertical, 16)
                                .background(canDone ? accent : Self.disabled, in: .rect(cornerRadius: 14))
                        }
                        .buttonStyle(.plain)
                        .disabled(!canDone)
                        .keyboardShortcut(.defaultAction)
                        .padding(.top, 44)
                    }
                    if let problem {
                        Text(problem)
                            .font(.system(size: 13))
                            .foregroundStyle(Self.muted)
                            .padding(.top, 14)
                    }
                }
                .padding(.horizontal, 40)
                Spacer()
                if let next {
                    Text(String(format: L10n.tr("Next · %@ %@"), Self.time.string(from: next.start), next.name))
                        .font(.system(size: 14))
                        .foregroundStyle(Self.meta)
                        .lineLimit(1)
                        .padding(.bottom, 34)
                }
            }
            .padding(.horizontal, 24)
        }
        .environment(\.colorScheme, .dark)
    }

    // The countdown reaching zero is enough; the server checks again on Done.
    private var canDone: Bool { !lock.needs.isEmpty && !busy && now >= lock.doneAfter }

    /// Time left on a lock that time lifts (sleep), or on a minimum lock.
    private var countdown: TimeInterval? {
        if let until = lock.until, until > now { return until.timeIntervalSince(now) }
        if !lock.needs.isEmpty, lock.doneAfter > now { return lock.doneAfter.timeIntervalSince(now) }
        return nil
    }

    /// "완료를 눌러 해제하기" / "Unlock by marking it done.", or when time lifts it.
    private var unlocks: String {
        let needs = lock.remainingNeeds
        if needs.isEmpty {
            guard let until = lock.until else { return "" }
            return String(format: L10n.tr("Unlocks at %@"), Self.time.string(from: until))
        }
        if Self.korean {
            let phrases = needs.enumerated().map { index, need in
                let forms = Self.koForms[need] ?? ("", "")
                return index == needs.count - 1 ? forms.last : forms.then
            }
            return phrases.joined(separator: " ") + " 해제하기"
        }
        let phrases = needs.map { Self.enPhrases[$0] ?? $0 }
        let list = phrases.count < 2
            ? phrases.joined()
            : phrases.dropLast().joined(separator: ", ") + " and " + phrases.last!
        return "Unlock by \(list)."
    }

    private func clock(_ left: TimeInterval) -> some View {
        let total = Int(left.rounded(.up))
        let parts = total >= 3600
            ? [total / 3600, total / 60 % 60, total % 60].enumerated().map { $0 == 0 ? "\($1)" : String(format: "%02d", $1) }
            : [total / 60, total % 60].enumerated().map { $0 == 0 ? "\($1)" : String(format: "%02d", $1) }
        let colon = Text(":").foregroundStyle(Self.colon)
        let text = parts.dropFirst().reduce(Text(parts[0])) { $0 + colon + Text($1) }
        return text
            .font(.system(size: 120, weight: .bold).monospacedDigit())
            .foregroundStyle(Self.text)
            .tracking(-4)
    }

    /* ---------- copy and colors ---------- */

    // The web app's dark palette.
    private static let background = Color(red: 0.051, green: 0.055, blue: 0.063)
    private static let text = Color(red: 0.910, green: 0.918, blue: 0.929)
    private static let muted = Color(red: 0.686, green: 0.710, blue: 0.741)
    private static let meta = Color(red: 0.490, green: 0.518, blue: 0.553)
    private static let label = Color(red: 0.576, green: 0.651, blue: 1.0)
    private static let colon = Color(red: 0.333, green: 0.357, blue: 0.388)
    private static let disabled = Color(red: 0.165, green: 0.176, blue: 0.200)

    private static let korean = Locale.preferredLanguages.first?.hasPrefix("ko") == true

    /// Korean joins conditions as "…하고 …해 해제하기".
    private static let koForms: [String: (then: String, last: String)] = [
        "done": ("완료를 누르고", "완료를 눌러"),
        "wake": ("일어났다고 알리고", "일어났다고 알려"),
        "photo": ("밥 사진을 보내고", "밥 사진을 보내"),
        "away": ("밖에 나갔다 오고", "밖에 나갔다 와서"),
    ]

    private static let enPhrases: [String: String] = [
        "done": "marking it done",
        "wake": "confirming you’re up",
        "photo": "sending a meal photo",
        "away": "heading out for a while",
    ]

    private static let time: DateFormatter = {
        let formatter = DateFormatter()
        formatter.dateFormat = "HH:mm"
        return formatter
    }()
}
