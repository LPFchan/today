import AppKit
import Observation

/// Everything the menu bar and the panel show.
@MainActor @Observable
final class Model {
    enum Session: Equatable { case signedOut, signingIn, signedIn }

    var session: Session = TokenStore.load() == nil ? .signedOut : .signedIn
    var people: [Person] = []
    var updated: Date?
    var problem: String?
    /// Ticks every second; views read it so the timers move.
    var now = Date()
    /// Whose timer sits in the menu bar: `Person.meID` or a friend's name.
    var selection = UserDefaults.standard.string(forKey: "person") ?? Person.meID {
        didSet { UserDefaults.standard.set(selection, forKey: "person") }
    }
    /// Post a notification when anyone's next item starts.
    var notify = UserDefaults.standard.object(forKey: "notify") as? Bool ?? true {
        didSet {
            UserDefaults.standard.set(notify, forKey: "notify")
            if notify { Alerts.ask() }
        }
    }

    @ObservationIgnored private let live: Bool
    /// When each person's running item started, as of the last tick; nil
    /// until a board has loaded, so launching doesn't announce what's
    /// already running.
    @ObservationIgnored private var started: [String: Date]?
    @ObservationIgnored private var loading = false
    @ObservationIgnored private var lastTry = Date.distantPast
    @ObservationIgnored private var signIn: Task<Void, Never>?
    /// The app delegate walks you back through signing in.
    @ObservationIgnored var onSignOut: () -> Void = {}

    /// `live: false` makes a model that never ticks or fetches, for snapshots.
    init(live: Bool = true) {
        self.live = live
        guard live else { return }
        let tick = Timer(timeInterval: 1, repeats: true) { [weak self] _ in
            MainActor.assumeIsolated { self?.tick() }
        }
        RunLoop.main.add(tick, forMode: .common)
        NSWorkspace.shared.notificationCenter.addObserver(forName: NSWorkspace.didWakeNotification, object: nil, queue: .main) { [weak self] _ in
            MainActor.assumeIsolated { self?.refresh() }
        }
        refresh()
    }

    /// The selected person, or you when they've stopped sharing.
    var person: Person? {
        people.first { $0.id == selection } ?? people.first { $0.me }
    }

    private func tick() {
        now = Date()
        // Plans change rarely; the timers run locally in between.
        if session == .signedIn, now.timeIntervalSince(lastTry) >= 60 { refresh() }
        // You are always on a loaded board, so an empty one means none yet.
        if session == .signedIn, !people.isEmpty { announce() } else { started = nil }
    }

    private func announce() {
        var running: [String: Date] = [:]
        for person in people {
            guard case .active(let i) = Day(person.items, at: now) else { continue }
            let item = person.items[i]
            running[person.id] = item.start
            // A friend's fresh plan can reach us up to a minute late; anything
            // older than that was missed (asleep, say) and stays quiet.
            if notify, let started, started[person.id] != item.start, now.timeIntervalSince(item.start) < 120 {
                Alerts.started(item, by: person)
            }
        }
        started = running
    }

    func refresh() {
        guard live, session == .signedIn, !loading else { return }
        loading = true
        lastTry = Date()
        Task {
            defer { loading = false }
            do {
                people = try await Account.board().people
                updated = Date()
                problem = nil
            } catch Account.Failure.signedOut {
                session = .signedOut
                people = []
                problem = Account.Failure.signedOut.localizedDescription
            } catch {
                // Keep showing the last board; the timers are still right.
                problem = error.localizedDescription
            }
        }
    }

    func startSignIn() {
        signIn?.cancel()
        session = .signingIn
        problem = nil
        signIn = Task {
            do {
                _ = try await Account.signIn()
                session = .signedIn
                refresh()
                NSApp.activate()
            } catch is CancellationError {
                if session == .signingIn { session = .signedOut }
            } catch {
                session = .signedOut
                problem = error.localizedDescription
            }
        }
    }

    func cancelSignIn() {
        signIn?.cancel()
        signIn = nil
        session = .signedOut
    }

    func signOut() {
        session = .signedOut
        people = []
        updated = nil
        problem = nil
        Task { await Account.signOut() }
        onSignOut()
    }
}
