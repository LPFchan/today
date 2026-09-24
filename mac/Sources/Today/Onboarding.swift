import AppKit
import SwiftUI

/// First-launch wizard: what Today does, signing in, whose timer to show,
/// and where to find it afterwards.
@Observable
final class Onboarding {
    enum Step: Int, CaseIterable { case welcome, signIn, person, done }

    var step = Step.welcome
    var openAtLogin = true
    var notify = true
    @ObservationIgnored var onFinish: () -> Void = {}
}

final class OnboardingWindow: NSWindow, NSWindowDelegate {
    private let onboarding: Onboarding

    init(_ onboarding: Onboarding, model: Model) {
        self.onboarding = onboarding
        super.init(contentRect: .zero, styleMask: [.titled, .closable, .fullSizeContentView], backing: .buffered, defer: false)
        titlebarAppearsTransparent = true
        titleVisibility = .hidden
        isMovableByWindowBackground = true
        isReleasedWhenClosed = false
        delegate = self
        contentView = NSHostingView(rootView: OnboardingView(onboarding: onboarding, model: model))
        center()
    }

    // Closing it early counts as done; the menu bar item can still sign in.
    func windowWillClose(_ notification: Notification) { onboarding.onFinish() }
}

struct OnboardingView: View {
    @Bindable var onboarding: Onboarding
    let model: Model

    var body: some View {
        VStack(spacing: 0) {
            Group {
                switch onboarding.step {
                case .welcome: WelcomeStep()
                case .signIn: SignInStep(model: model)
                case .person: PersonStep(model: model)
                case .done: DoneStep(onboarding: onboarding)
                }
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .top)
            .padding(.top, 52)
            .transition(.asymmetric(insertion: .move(edge: .trailing).combined(with: .opacity),
                                    removal: .move(edge: .leading).combined(with: .opacity)))
            .id(onboarding.step)

            primaryButton
            HStack(spacing: 8) {
                ForEach(Onboarding.Step.allCases, id: \.self) { step in
                    Circle().fill(step == onboarding.step ? accent : .secondary.opacity(0.3)).frame(width: 7, height: 7)
                }
            }
            .padding(.top, 18)
            .padding(.bottom, 26)
        }
        .frame(width: 640, height: 600)
        .background {
            LinearGradient(colors: [accent.opacity(0.22), accent.opacity(0.04)], startPoint: .top, endPoint: .bottom)
                .background(.background)
                .ignoresSafeArea()
        }
        .animation(.spring(duration: 0.45), value: onboarding.step)
        // Signing in finishes in the browser; move on when it lands.
        .onChange(of: model.session) { _, session in
            if session == .signedIn, onboarding.step == .signIn { next() }
        }
    }

    @ViewBuilder private var primaryButton: some View {
        switch onboarding.step {
        case .welcome:
            PrimaryButton("Get Started") { next() }
        case .signIn:
            switch model.session {
            case .signedIn: PrimaryButton("Continue") { next() }
            case .signingIn: PrimaryButton("Waiting for your browser…") {}.disabled(true)
            case .signedOut: PrimaryButton("Sign In with lost.plus") { model.startSignIn() }
            }
        case .person:
            PrimaryButton("Continue") { next() }
                .disabled(model.people.isEmpty)
        case .done:
            PrimaryButton("Done") { onboarding.onFinish() }
        }
    }

    private func next() {
        onboarding.step = Onboarding.Step(rawValue: onboarding.step.rawValue + 1) ?? .done
    }
}

private struct PrimaryButton: View {
    let title: String
    let action: () -> Void
    @Environment(\.isEnabled) private var enabled
    init(_ title: String, action: @escaping () -> Void) { self.title = title; self.action = action }

    var body: some View {
        Button(action: action) {
            Text(title)
                .font(.system(size: 17, weight: .semibold))
                .foregroundStyle(.white)
                .frame(width: 300, height: 48)
                .background(accent.opacity(enabled ? 1 : 0.45), in: .rect(cornerRadius: 12))
        }
        .buttonStyle(.plain)
        .keyboardShortcut(.defaultAction)
    }
}

private struct Header: View {
    let title: String
    let subtitle: String

    var body: some View {
        VStack(spacing: 10) {
            Text(title).font(.system(size: 30, weight: .bold))
            Text(subtitle)
                .font(.system(size: 16))
                .foregroundStyle(.secondary)
                .multilineTextAlignment(.center)
                .frame(maxWidth: 460)
                .fixedSize(horizontal: false, vertical: true)
        }
    }
}

/* ---------- welcome ---------- */

private struct WelcomeStep: View {
    var body: some View {
        VStack(spacing: 26) {
            Image(nsImage: NSApp.applicationIconImage).resizable().frame(width: 84, height: 84)
            Header(title: "Welcome to Today", subtitle: "Your plan’s timer, right in the menu bar.")
            VStack(spacing: 14) {
                TimerPreview()
                Note("Or a friend’s, when they share their day.")
            }
        }
    }
}

/// A slice of menu bar with the real status item counting down, over the
/// card the panel shows.
private struct TimerPreview: View {
    @State private var started = Date()
    private static let item = (name: "Deep work", length: 90.0 * 60, elapsed: 66.0 * 60 + 46)

    var body: some View {
        TimelineView(.periodic(from: .now, by: 1)) { context in
            let elapsed = Self.item.elapsed + context.date.timeIntervalSince(started)
            let left = max(0, Self.item.length - elapsed)
            VStack(spacing: 0) {
                HStack(spacing: 14) {
                    Spacer()
                    Image(nsImage: StatusIcon.image(remaining: left / Self.item.length, countdown: Format.countdown(left)))
                        .renderingMode(.template)
                        .padding(.horizontal, 7)
                        .padding(.vertical, 2)
                        .background(.white.opacity(0.16), in: .rect(cornerRadius: 5))
                    Image(systemName: "wifi")
                    Image(systemName: "battery.75percent")
                    // The item started at 09:00.
                    Text(String(format: "Wed %d:%02d", 9 + Int(elapsed) / 3600, Int(elapsed) % 3600 / 60)).monospacedDigit()
                }
                .font(.system(size: 13, weight: .medium))
                .foregroundStyle(.white)
                .padding(.horizontal, 14)
                .frame(height: 30)
                .background(.white.opacity(0.07))

                VStack(alignment: .leading, spacing: 8) {
                    HStack(alignment: .firstTextBaseline) {
                        Text(Self.item.name).font(.system(size: 20, weight: .semibold))
                        Spacer()
                        Text("\(Format.left(left)) left").font(.system(size: 15)).monospacedDigit().foregroundStyle(.secondary)
                    }
                    GeometryReader { geo in
                        ZStack(alignment: .leading) {
                            Capsule().fill(.white.opacity(0.14))
                            Capsule().fill(accent).frame(width: geo.size.width * elapsed / Self.item.length)
                        }
                    }
                    .frame(height: 8)
                    Text("09:00–10:30 · Next 10:30 Email").font(.system(size: 13)).foregroundStyle(.secondary)
                }
                .padding(.horizontal, 20)
                .padding(.vertical, 16)
            }
            .frame(width: 440)
            .background(Color(white: 0.06), in: .rect(cornerRadius: 16))
            .clipShape(.rect(cornerRadius: 16))
            .environment(\.colorScheme, .dark)
        }
    }
}

private struct Note: View {
    let text: String
    init(_ text: String) { self.text = text }

    var body: some View {
        Text(text)
            .font(.system(size: 13, weight: .medium))
            .foregroundStyle(.secondary)
            .multilineTextAlignment(.center)
            .fixedSize()
    }
}

/* ---------- sign in ---------- */

private struct SignInStep: View {
    let model: Model

    var body: some View {
        VStack(spacing: 26) {
            Symbol("person.crop.circle.badge.checkmark")
            Header(title: "Sign in to lost.plus",
                   subtitle: "Today reads your plan, and the plans friends share, from your lost.plus account. It can’t change anything.")
            Group {
                switch model.session {
                case .signedIn:
                    Label("Signed in", systemImage: "checkmark.circle.fill").foregroundStyle(accent)
                case .signingIn:
                    VStack(spacing: 10) {
                        HStack(spacing: 8) {
                            ProgressView().controlSize(.small)
                            Text("Finish signing in in your browser.").foregroundStyle(.secondary)
                        }
                        Button("Cancel") { model.cancelSignIn() }.buttonStyle(.link)
                    }
                case .signedOut:
                    Text(model.problem ?? "Your browser opens to sign in.")
                        .foregroundStyle(model.problem == nil ? Color.secondary : Color.red)
                }
            }
            .font(.system(size: 14, weight: .medium))
            .multilineTextAlignment(.center)
            .frame(maxWidth: 420)
        }
    }
}

/* ---------- whose timer ---------- */

private struct PersonStep: View {
    @Bindable var model: Model

    var body: some View {
        VStack(spacing: 22) {
            Symbol("person.2.fill")
            Header(title: "Whose timer?",
                   subtitle: "Pick whose timer sits in your menu bar. You can switch any time from the menu.")
            if model.people.isEmpty {
                ProgressView().controlSize(.small)
            } else {
                ScrollView {
                    VStack(spacing: 6) {
                        ForEach(model.people) { person in
                            PersonRow(person: person, now: model.now, selected: person.id == model.person?.id) {
                                model.selection = person.id
                            }
                        }
                    }
                }
                .scrollBounceBehavior(.basedOnSize)
                .frame(width: 420, height: 176)
                Note(model.people.count > 1
                     ? "Friends show up here while they share their day publicly."
                     : "Nobody else is sharing yet. Friends show up here when they do.")
            }
        }
    }
}

private struct PersonRow: View {
    let person: Person
    let now: Date
    let selected: Bool
    let action: () -> Void

    var body: some View {
        let status = Status(person.items, at: now)
        Button(action: action) {
            HStack(spacing: 12) {
                Text(person.name.first.map { String($0).uppercased() } ?? "?")
                    .font(.system(size: 14, weight: .semibold))
                    .frame(width: 32, height: 32)
                    .background(accent.opacity(0.14), in: .circle)
                    .foregroundStyle(accent)
                VStack(alignment: .leading, spacing: 2) {
                    Text(person.me ? "You" : person.name).font(.system(size: 14, weight: .semibold))
                    Text([status.title, status.left].compactMap { $0 }.joined(separator: " · "))
                        .font(.system(size: 12))
                        .foregroundStyle(.secondary)
                        .lineLimit(1)
                }
                Spacer()
                Image(systemName: selected ? "checkmark.circle.fill" : "circle")
                    .font(.system(size: 18))
                    .foregroundStyle(selected ? accent : .secondary.opacity(0.5))
            }
            .padding(.horizontal, 14)
            .padding(.vertical, 9)
            .background(.background.opacity(selected ? 0.9 : 0.5), in: .rect(cornerRadius: 10))
            .overlay(RoundedRectangle(cornerRadius: 10).strokeBorder(selected ? accent : .clear, lineWidth: 1.5))
            .contentShape(.rect)
        }
        .buttonStyle(.plain)
    }
}

/* ---------- done ---------- */

private struct DoneStep: View {
    @Bindable var onboarding: Onboarding

    var body: some View {
        VStack(spacing: 26) {
            Symbol("checkmark.seal.fill")
            Header(title: "You’re all set",
                   subtitle: "The ring empties as the current item runs out; the time next to it is what’s left.")
            HStack(spacing: 10) {
                Image(nsImage: StatusIcon.image(remaining: 0.3, countdown: "23:14"))
                    .renderingMode(.template)
                    .padding(.horizontal, 10)
                    .padding(.vertical, 5)
                    .background(.secondary.opacity(0.15), in: .rect(cornerRadius: 6))
                Text("Today lives in the menu bar. Click it to see the rest of the day or switch people.")
                    .font(.system(size: 14))
                    .foregroundStyle(.secondary)
                    .fixedSize(horizontal: false, vertical: true)
            }
            .frame(maxWidth: 440)
            VStack(alignment: .leading, spacing: 12) {
                Toggle("Notify me when anyone’s next item starts", isOn: $onboarding.notify)
                Toggle("Open Today when I log in", isOn: $onboarding.openAtLogin)
            }
            .toggleStyle(.switch)
            .tint(accent)
            .font(.system(size: 14, weight: .medium))
        }
    }
}

private struct Symbol: View {
    let name: String
    init(_ name: String) { self.name = name }

    var body: some View {
        Image(systemName: name)
            .font(.system(size: 44, weight: .medium))
            .foregroundStyle(accent)
            .frame(width: 84, height: 84)
    }
}
