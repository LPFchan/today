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

    @ObservationIgnored private let live: Bool
    @ObservationIgnored private var loading = false
    @ObservationIgnored private var lastTry = Date.distantPast
    @ObservationIgnored private var signIn: Task<Void, Never>?

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
    }
}
