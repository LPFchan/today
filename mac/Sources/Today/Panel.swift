import AppKit
import ServiceManagement
import Sparkle
import SwiftUI

/// marie's blue, the web app's accent.
let accent = Color(red: 0.184, green: 0.333, blue: 0.910)

/// The menu bar item's label.
struct MenuBarLabel: View {
    let model: Model

    var body: some View {
        let image: NSImage = {
            guard model.session == .signedIn, let person = model.person else {
                return StatusIcon.image(remaining: nil, countdown: nil, dimmed: model.session != .signedIn)
            }
            let status = Status(person.items, at: model.now)
            return StatusIcon.image(remaining: status.remaining, countdown: status.countdown, dimmed: !status.isActive)
        }()
        Image(nsImage: image).accessibilityLabel("Today")
    }
}

/// The window under the menu bar item, laid out like a menu.
struct Panel: View {
    let model: Model
    let updater: SPUStandardUpdaterController

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            switch model.session {
            case .signedIn:
                if model.people.count > 1 {
                    PeopleTabs(model: model)
                    Divider().padding(.horizontal, 14).padding(.vertical, 8)
                }
                if let person = model.person {
                    PersonCard(person: person, model: model)
                } else {
                    Placeholder(text: model.problem ?? "Loading…")
                }
            case .signedOut, .signingIn:
                SignInCard(model: model)
            }
            Divider().padding(.horizontal, 14).padding(.vertical, 6)
            MenuRows(model: model, updater: updater)
        }
        .padding(.vertical, 10)
        .frame(width: 330)
        .onAppear { model.refresh() }
    }
}

/* ---------- people ---------- */

private struct PeopleTabs: View {
    @Bindable var model: Model

    var body: some View {
        LazyVGrid(columns: Array(repeating: GridItem(.flexible(), spacing: 4), count: 4), spacing: 6) {
            ForEach(model.people) { person in
                let selected = person.id == model.person?.id
                let active = Status(person.items, at: model.now).isActive
                Button { model.selection = person.id } label: {
                    VStack(spacing: 3) {
                        Avatar(name: person.name, selected: selected)
                        Text(person.me ? "You" : person.name)
                            .font(.system(size: 11, weight: selected ? .semibold : .regular))
                            .lineLimit(1)
                            .truncationMode(.tail)
                        // Busy right now?
                        Capsule()
                            .fill(active ? (selected ? Color.white.opacity(0.85) : accent) : .secondary.opacity(0.25))
                            .frame(width: 34, height: 2.5)
                    }
                    .foregroundStyle(selected ? .white : .primary)
                    .padding(.vertical, 6)
                    .frame(maxWidth: .infinity)
                    .background(selected ? accent : .clear, in: .rect(cornerRadius: 9))
                    .contentShape(.rect)
                }
                .buttonStyle(.plain)
                .help(person.me ? "Your timer" : "\(person.name)’s timer")
            }
        }
        .padding(.horizontal, 10)
    }
}

private struct Avatar: View {
    let name: String
    let selected: Bool

    var body: some View {
        Text(name.first.map { String($0).uppercased() } ?? "?")
            .font(.system(size: 12, weight: .semibold))
            .frame(width: 24, height: 24)
            .background(selected ? Color.white.opacity(0.22) : accent.opacity(0.14), in: .circle)
            .foregroundStyle(selected ? .white : accent)
    }
}

/* ---------- one person's day ---------- */

private struct PersonCard: View {
    let person: Person
    let model: Model

    var body: some View {
        let now = model.now
        let status = Status(person.items, at: now)
        VStack(alignment: .leading, spacing: 12) {
            VStack(alignment: .leading, spacing: 2) {
                HStack(alignment: .firstTextBaseline) {
                    Text(person.me ? "You" : person.name).font(.system(size: 15, weight: .semibold))
                    Spacer()
                    if person.me {
                        Text(person.visibility == "public" ? "Shared" : "Only you")
                            .font(.system(size: 11))
                            .foregroundStyle(.secondary)
                    }
                }
                Text(updatedText(now))
                    .font(.system(size: 11))
                    .foregroundStyle(model.problem == nil ? .secondary : Color.orange)
                    .lineLimit(2)
            }

            Divider()

            VStack(alignment: .leading, spacing: 6) {
                HStack(alignment: .firstTextBaseline, spacing: 8) {
                    Text(status.title)
                        .font(.system(size: 15, weight: .semibold))
                        .foregroundStyle(status.isActive ? .primary : .secondary)
                        .lineLimit(2)
                    Spacer(minLength: 4)
                    if let left = status.left {
                        Text(left)
                            .font(.system(size: 12))
                            .monospacedDigit()
                            .foregroundStyle(.secondary)
                            .fixedSize()
                    }
                }
                if let item = status.item, let remaining = status.remaining {
                    Bar(fraction: 1 - remaining)
                    Caption(text: Format.range(item) + (status.next.map { " · Next \(Format.clock($0.start)) \($0.name)" } ?? ""))
                } else if let next = status.next {
                    Caption(text: "Next · \(Format.clock(next.start)) \(next.name)")
                }
            }

            if let first = person.items.first, let last = person.items.last {
                VStack(alignment: .leading, spacing: 6) {
                    HStack(alignment: .firstTextBaseline) {
                        Text("Today").font(.system(size: 13, weight: .semibold))
                        Spacer()
                        Text("\(person.items.filter { now >= $0.end }.count) of \(person.items.count) done")
                            .font(.system(size: 11))
                            .foregroundStyle(.secondary)
                    }
                    DayBar(items: person.items, now: now)
                    Caption(text: "\(Format.clock(first.start))–\(Format.clock(last.end))")
                }
                Upcoming(items: person.items, now: now)
            }
        }
        .padding(.horizontal, 16)
    }

    private func updatedText(_ now: Date) -> String {
        if let problem = model.problem { return problem }
        guard let updated = model.updated else { return "Updating…" }
        let seconds = now.timeIntervalSince(updated)
        return seconds < 60 ? "Updated just now" : "Updated \(Int(seconds / 60)) min ago"
    }
}

/// The rest of the day, after what's running now.
private struct Upcoming: View {
    let items: [Item]
    let now: Date

    var body: some View {
        let rest = items.filter { $0.start > now }.prefix(4)
        if !rest.isEmpty {
            VStack(alignment: .leading, spacing: 4) {
                ForEach(Array(rest), id: \.self) { item in
                    HStack(alignment: .firstTextBaseline, spacing: 10) {
                        Text(Format.clock(item.start))
                            .font(.system(size: 12).monospacedDigit())
                            .foregroundStyle(.secondary)
                        Text(item.name).font(.system(size: 12)).lineLimit(1)
                    }
                }
                let more = items.filter { $0.start > now }.count - rest.count
                if more > 0 { Caption(text: "+\(more) more") }
            }
        }
    }
}

/// A rounded progress bar, filled up to `fraction`.
private struct Bar: View {
    let fraction: Double

    var body: some View {
        GeometryReader { geo in
            ZStack(alignment: .leading) {
                Capsule().fill(.secondary.opacity(0.18))
                Capsule().fill(accent).frame(width: max(6, geo.size.width * min(1, max(0, fraction))))
            }
        }
        .frame(height: 7)
    }
}

/// The whole day as one bar: a segment per item, filled up to now, with a
/// mark at now.
private struct DayBar: View {
    let items: [Item]
    let now: Date

    var body: some View {
        Canvas { context, size in
            guard let first = items.first?.start, let last = items.last?.end, last > first else { return }
            let span = last.timeIntervalSince(first)
            func x(_ date: Date) -> CGFloat { size.width * min(1, max(0, date.timeIntervalSince(first) / span)) }
            let bar: CGFloat = 7, top = (size.height - bar) / 2
            var past = context
            past.clip(to: Path(CGRect(x: 0, y: 0, width: x(now), height: size.height)))
            for item in items {
                let rect = CGRect(x: x(item.start), y: top, width: max(2, x(item.end) - x(item.start) - 1.5), height: bar)
                let segment = Path(roundedRect: rect, cornerRadius: bar / 2)
                context.fill(segment, with: .color(.secondary.opacity(0.18)))
                past.fill(segment, with: .color(accent))
            }
            if now > first, now < last {
                let mark = CGRect(x: x(now) - 1, y: 0, width: 2, height: size.height)
                context.fill(Path(roundedRect: mark, cornerRadius: 1), with: .color(.primary))
            }
        }
        .frame(height: 13)
    }
}

private struct Caption: View {
    let text: String

    var body: some View {
        Text(text)
            .font(.system(size: 11))
            .foregroundStyle(.secondary)
            .lineLimit(1)
            .truncationMode(.tail)
    }
}

private struct Placeholder: View {
    let text: String

    var body: some View {
        Text(text)
            .font(.system(size: 13))
            .foregroundStyle(.secondary)
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(.horizontal, 16)
            .padding(.vertical, 8)
    }
}

/* ---------- signed out ---------- */

private struct SignInCard: View {
    let model: Model

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            Text("Sign in to see your timer").font(.system(size: 15, weight: .semibold))
            Text(model.session == .signingIn
                 ? "Finish signing in in your browser."
                 : (model.problem ?? "Today reads your plan, and the plans friends share, from your lost.plus account."))
                .font(.system(size: 12))
                .foregroundStyle(.secondary)
                .fixedSize(horizontal: false, vertical: true)
            if model.session == .signingIn {
                HStack(spacing: 8) {
                    ProgressView().controlSize(.small)
                    Button("Cancel") { model.cancelSignIn() }
                }
            } else {
                Button("Sign In…") { model.startSignIn() }
                    .buttonStyle(.borderedProminent)
                    .tint(accent)
            }
        }
        .padding(.horizontal, 16)
    }
}

/* ---------- menu rows ---------- */

private struct MenuRows: View {
    let model: Model
    let updater: SPUStandardUpdaterController
    @State private var openAtLogin = SMAppService.mainApp.status == .enabled

    var body: some View {
        VStack(spacing: 0) {
            Row(title: "Open today.lost.plus", shortcut: "O") {
                close()
                NSWorkspace.shared.open(Account.base)
            }
            .keyboardShortcut("o")
            Row(title: "Check for Updates…") {
                close()
                NSApp.activate()
                updater.checkForUpdates(nil)
            }
            separator
            Row(title: "Notify When Items Start", checked: model.notify) { model.notify.toggle() }
            Row(title: "Open at Login", checked: openAtLogin) {
                let service = SMAppService.mainApp
                do {
                    if service.status == .enabled { try service.unregister() } else { try service.register() }
                } catch {
                    // Usually switched off in System Settings; send them there.
                    SMAppService.openSystemSettingsLoginItems()
                }
                openAtLogin = service.status == .enabled
            }
            separator
            if model.session == .signedIn {
                Row(title: "Sign Out") {
                    close()
                    model.signOut()
                }
            }
            Row(title: "Quit Today", shortcut: "Q") { NSApp.terminate(nil) }
                .keyboardShortcut("q")
        }
        .padding(.horizontal, 6)
    }

    private var separator: some View { Divider().padding(.horizontal, 8).padding(.vertical, 5) }

    private func close() { NSApp.keyWindow?.close() }
}

/// A button that looks and highlights like a menu item.
private struct Row: View {
    let title: String
    var checked: Bool? = nil
    var shortcut: String? = nil
    let action: () -> Void
    @State private var hover = false

    var body: some View {
        Button(action: action) {
            HStack(spacing: 6) {
                Image(systemName: "checkmark")
                    .font(.system(size: 11, weight: .semibold))
                    .opacity(checked == true ? 1 : 0)
                    .frame(width: 12)
                Text(title).font(.system(size: 13))
                Spacer()
                if let shortcut {
                    Text("⌘\(shortcut)")
                        .font(.system(size: 12))
                        .foregroundStyle(hover ? .white.opacity(0.8) : .secondary)
                }
            }
            .foregroundStyle(hover ? .white : .primary)
            .padding(.horizontal, 8)
            .frame(height: 24)
            .background(hover ? Color(nsColor: .selectedContentBackgroundColor) : .clear, in: .rect(cornerRadius: 5))
            .contentShape(.rect)
        }
        .buttonStyle(.plain)
        .onHover { hover = $0 }
    }
}
