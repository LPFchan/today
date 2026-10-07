import AppKit
import Observation
import ServiceManagement

/// Everything the menu bar and the panel show.
@MainActor @Observable
final class Model {
    enum Session: Equatable { case signedOut, signingIn, signedIn }

    var session: Session = TokenStore.load() == nil ? .signedOut : .signedIn {
        didSet { syncWakeAlarm() }
    }
    var keepout: Keepout? {
        didSet { syncWakeAlarm() }
    }
    var keepoutDay: String?
    var finishing = false
    var finishProblem: String?
    private(set) var enforcing = false
    private(set) var openAtLogin = false
    private(set) var loginApproval = false
    var people: [Person] = []
    var updated: Date?
    var problem: String?
    /// Ticks every second; views read it so the timers move.
    var now = Date() {
        didSet { syncWakeAlarm() }
    }
    /// Whose timer sits in the menu bar: `Person.meID` or a friend's name.
    var selection = UserDefaults.standard.string(forKey: "person") ?? Person.meID {
        didSet {
            UserDefaults.standard.set(selection, forKey: "person")
            if !panelOpen { menuBarSelection = selection }
        }
    }
    /// `selection`, held still while the panel is open: the menu bar item
    /// changes width with the timer, and the panel slides along with it.
    private(set) var menuBarSelection = UserDefaults.standard.string(forKey: "person") ?? Person.meID
    var panelOpen = false {
        didSet { if !panelOpen { menuBarSelection = selection } }
    }
    /// Post a notification when anyone's next item starts.
    var notify = UserDefaults.standard.object(forKey: "notify") as? Bool ?? true {
        didSet {
            UserDefaults.standard.set(notify, forKey: "notify")
            if notify { Alerts.ask() }
        }
    }

    @ObservationIgnored private let live: Bool
    @ObservationIgnored private var wakeAlarm: WakeAlarm?
    /// When each person's running item started, as of the last tick; nil
    /// until a board has loaded, so launching doesn't announce what's
    /// already running.
    @ObservationIgnored private var started: [String: Date]?
    @ObservationIgnored private var loading = false
    @ObservationIgnored private var lastTry = Date.distantPast
    @ObservationIgnored private var signIn: Task<Void, Never>?
    @ObservationIgnored private var keepoutTask: Task<Void, Never>?
    @ObservationIgnored private var lastKeepoutTry = Date.distantPast
    @ObservationIgnored private var expiredKeepoutUntil: Date?
    @ObservationIgnored private var expiredKeepoutFailureSince: Date?
    @ObservationIgnored private var generation = 0
    @ObservationIgnored private var savedKeepout: KeepoutReply?
    @ObservationIgnored private var lastLoginTry = Date.distantPast
    @ObservationIgnored private var signingOut: Task<Void, Never>?
    #if DEBUG
    @ObservationIgnored private(set) var fakeKeepout = false
    #endif
    /// Opens the onboarding window, where signing in happens; the app
    /// delegate fills it in.
    @ObservationIgnored var onboard: () -> Void = {}

    /// `live: false` makes a model that never ticks or fetches, for snapshots.
    init(live: Bool = true) {
        self.live = live && !CommandLine.arguments.contains("--snapshot")
            && ProcessInfo.processInfo.environment["XCODE_RUNNING_FOR_PREVIEWS"] != "1"
        guard self.live else { return }
        wakeAlarm = WakeAlarm()
        WakeAlarm.keepCopy()
        #if DEBUG
        let wakeFlag = CommandLine.arguments.firstIndex(of: "--fake-wake")
        if let flag = wakeFlag ?? CommandLine.arguments.firstIndex(of: "--fake-keepout"),
           flag + 1 < CommandLine.arguments.count,
           let seconds = Double(CommandLine.arguments[flag + 1]), seconds.isFinite, seconds > 0 {
            fakeKeepout = true
            session = .signedIn
            let body: [String: Any] = [
                "key": "fake", "name": L10n.tr("Today"), "kind": "fixed",
                "since": now.timeIntervalSince1970 * 1000,
                "until": now.addingTimeInterval(seconds).timeIntervalSince1970 * 1000,
                "needs": wakeFlag == nil ? ["done"] : ["wake"], "canStart": false, "canDone": true,
                "doneAfter": now.timeIntervalSince1970 * 1000,
            ]
            if let data = try? JSONSerialization.data(withJSONObject: body) {
                keepout = try? JSONDecoder().decode(Keepout.self, from: data)
            }
        }
        #endif
        if !preview {
            ProcessOwnership.claim()
            // Complete a sign-out interrupted by termination or an in-flight request.
            if UserDefaults.standard.bool(forKey: "signingOut") {
                TokenStore.clear()
                KeepoutStore.clear()
                UserDefaults.standard.set(false, forKey: "enforcing")
                UserDefaults.standard.set(false, forKey: "signingOut")
            }
            session = TokenStore.load() == nil ? .signedOut : .signedIn
            now = Date()
            enforcing = UserDefaults.standard.bool(forKey: "enforcing")
            // Restore the cover before polling, including after an offline relaunch.
            if session == .signedIn, let reply = KeepoutStore.load(), let lock = reply.keepout {
                savedKeepout = reply
                keepout = lock
                keepoutDay = reply.day
                enforcing = true
                UserDefaults.standard.set(true, forKey: "enforcing")
            } else if session == .signedOut {
                // No credentials means nothing to enforce, however we got here.
                KeepoutStore.clear()
                enforcing = false
                UserDefaults.standard.set(false, forKey: "enforcing")
            }
            LoginItem.migrate()
            syncLoginItem()
            if LoginItem.service.status == .enabled { ProcessOwnership.startAgent() }
        }
        syncWakeAlarm()
        let tick = Timer(timeInterval: 1, repeats: true) { [weak self] _ in
            MainActor.assumeIsolated { self?.tick() }
        }
        RunLoop.main.add(tick, forMode: .common)
        NSWorkspace.shared.notificationCenter.addObserver(forName: NSWorkspace.didWakeNotification, object: nil, queue: .main) { [weak self] _ in
            MainActor.assumeIsolated { self?.refresh(); self?.refreshKeepout() }
        }
        refreshKeepout()
        refresh()
    }

    /// The selected person, or you when they've stopped sharing.
    var person: Person? { person(selection) }

    /// Whose timer the menu bar shows right now.
    var menuBarPerson: Person? { person(menuBarSelection) }

    private func person(_ id: String) -> Person? {
        people.first { $0.id == id } ?? people.first { $0.me }
    }

    private var preview: Bool {
        #if DEBUG
        fakeKeepout
        #else
        false
        #endif
    }

    var next: Item? { people.first { $0.me }?.items.first { $0.start > now } }

    private func syncWakeAlarm() {
        guard live else { return }
        wakeAlarm?.setRinging(session == .signedIn && keepout?.needs.contains("wake") == true
            && keepout?.have.contains("wake") != true && !(keepout?.snoozedUntil.map { $0 > now } ?? false))
    }

    /// Restore system audio before a normal termination, logout or restart.
    func stopWakeAlarm() { wakeAlarm?.setRinging(false) }

    private func tick() {
        now = Date()
        if preview {
            if let until = keepout?.until, until <= now { clearKeepout() }
            return
        }
        if let until = keepout?.until, until <= now {
            // Hold the cover while checking for a successor, even after relaunch.
            if expiredKeepoutUntil != until {
                expiredKeepoutUntil = until
                lastKeepoutTry = .distantPast
            }
            if let since = expiredKeepoutFailureSince, now.timeIntervalSince(since) >= 60 {
                clearKeepout()
            }
        }
        if now.timeIntervalSince(lastLoginTry) >= 15 { syncLoginItem() }
        let keepoutInterval: TimeInterval = expiredKeepoutUntil == nil && wakeAlarm?.ringing != true ? 15 : 3
        if now.timeIntervalSince(lastKeepoutTry) >= keepoutInterval { refreshKeepout() }
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
        guard live, !preview, session == .signedIn, !loading else { return }
        loading = true
        lastTry = Date()
        let current = generation
        Task {
            defer { loading = false }
            do {
                let board = try await Account.board()
                guard current == generation else { return }
                people = board.people
                updated = Date()
                problem = nil
            } catch Account.Failure.signedOut {
                guard current == generation else { return }
                authenticationExpired()
            } catch {
                guard current == generation else { return }
                // Keep showing the last board; the timers are still right.
                problem = error.localizedDescription
            }
        }
    }

    func refreshKeepout() {
        guard live, !preview, session == .signedIn, keepoutTask == nil, !finishing else { return }
        let current = generation
        keepoutTask = Task {
            defer { keepoutTask = nil }
            await fetchKeepout(generation: current)
        }
    }

    private func fetchKeepout(generation current: Int) async {
        let attempted = Date()
        lastKeepoutTry = attempted
        do {
            let reply = try await Account.keepout()
            guard current == generation else { return }
            finishProblem = nil
            expiredKeepoutFailureSince = nil
            if keepout?.key != reply.keepout?.key || keepout?.until != reply.keepout?.until {
                expiredKeepoutUntil = nil
            }
            keepout = reply.keepout
            keepoutDay = reply.day
            if keepout != nil, !enforcing {
                enforcing = true
                UserDefaults.standard.set(true, forKey: "enforcing")
                syncLoginItem()
            }
            if savedKeepout != reply || reply.keepout == nil {
                do {
                    try KeepoutStore.save(reply)
                    savedKeepout = reply
                } catch {
                    finishProblem = error.localizedDescription
                }
            }
        } catch Account.Failure.signedOut {
            guard current == generation else { return }
            authenticationExpired()
        } catch {
            guard current == generation else { return }
            finishProblem = error.localizedDescription
            if let until = keepout?.until, until <= Date(), expiredKeepoutFailureSince == nil {
                // Count failed attempts after expiry; old cached locks get a fresh minute.
                expiredKeepoutFailureSince = max(until, attempted)
            }
        }
    }

    func finish() {
        guard let lock = keepout, !finishing else { return }
        if preview { clearKeepout(); return }
        guard let day = keepoutDay else { return }
        finishing = true
        finishProblem = nil
        let current = generation
        Task {
            defer { if current == generation { finishing = false } }
            // Drain an older GET before Done so its reply cannot restore the lock.
            await keepoutTask?.value
            guard current == generation, keepout?.key == lock.key, keepoutDay == day else { return }
            var failure: String?
            do {
                try await Account.finish(day: day, key: lock.key)
            } catch Account.Failure.signedOut {
                guard current == generation else { return }
                authenticationExpired()
                return
            } catch Account.Failure.conflict(let error) {
                switch error {
                case "too_soon": failure = L10n.tr("Not yet")
                case "not_due", "locked": failure = L10n.tr("Refreshing…")
                default: failure = error
                }
            } catch {
                failure = error.localizedDescription
            }
            guard current == generation else { return }
            await fetchKeepout(generation: current)
            if current == generation, keepout != nil, let failure { finishProblem = failure }
        }
    }

    /// Quiet the wake alarm for a while; the lock stays until the wake proof.
    func snooze(minutes: Int) {
        guard keepout != nil, !finishing, !preview else { return }
        finishing = true
        finishProblem = nil
        let current = generation
        Task {
            defer { if current == generation { finishing = false } }
            await keepoutTask?.value
            guard current == generation else { return }
            var failure: String?
            do {
                try await Account.snooze(minutes: minutes)
            } catch Account.Failure.signedOut {
                guard current == generation else { return }
                authenticationExpired()
                return
            } catch {
                failure = error.localizedDescription
            }
            guard current == generation else { return }
            await fetchKeepout(generation: current)
            if current == generation, keepout != nil, let failure { finishProblem = failure }
        }
    }

    private func authenticationExpired() {
        // Ignore outstanding replies from the rejected session.
        generation += 1
        finishing = false
        clearKeepout()
        session = .signedOut
        // Like signing out: the login item stops being forced on.
        enforcing = false
        if live, !preview {
            UserDefaults.standard.set(false, forKey: "enforcing")
            syncLoginItem()
        }
        people = []
        updated = nil
        problem = Account.Failure.signedOut.localizedDescription
        onboard()
    }

    private func clearKeepout() {
        keepout = nil
        expiredKeepoutUntil = nil
        expiredKeepoutFailureSince = nil
        savedKeepout = nil
        keepoutDay = nil
        finishProblem = nil
        if live, !preview { KeepoutStore.clear() }
    }

    func syncLoginItem() {
        guard live, !preview, !UserDefaults.standard.bool(forKey: "signingOut") else { return }
        lastLoginTry = Date()
        do { try LoginItem.sync(enforcing: enforcing) } catch { problem = error.localizedDescription }
        openAtLogin = enforcing || LoginItem.wanted || LoginItem.service.status == .enabled
        loginApproval = LoginItem.service.status == .requiresApproval
    }

    func setOpenAtLogin(_ enabled: Bool) {
        guard live, !preview else { return }
        do { try LoginItem.set(enabled, enforcing: enforcing) } catch {
            problem = error.localizedDescription
            SMAppService.openSystemSettingsLoginItems()
        }
        syncLoginItem()
    }

    func startSignIn() {
        signIn?.cancel()
        generation += 1
        let current = generation
        session = .signingIn
        problem = nil
        signIn = Task {
            do {
                await signingOut?.value
                try Task.checkCancellation()
                _ = try await Account.signIn()
                guard current == generation else { return }
                session = .signedIn
                refreshKeepout()
                refresh()
                NSApp.activate()
            } catch is CancellationError {
                if current == generation, session == .signingIn { session = .signedOut }
            } catch {
                guard current == generation else { return }
                session = .signedOut
                problem = error.localizedDescription
            }
        }
    }

    func cancelSignIn() {
        generation += 1
        signIn?.cancel()
        signIn = nil
        session = .signedOut
    }

    func signOut() {
        generation += 1
        signIn?.cancel()
        session = .signedOut
        finishing = false
        clearKeepout()
        enforcing = false
        if live, !preview {
            UserDefaults.standard.set(true, forKey: "signingOut")
            UserDefaults.standard.set(false, forKey: "enforcing")
        }
        people = []
        updated = nil
        problem = nil
        if live, !preview {
            signingOut = Task {
                await Account.signOut()
                syncLoginItem()
            }
        }
        onboard()
    }
}
