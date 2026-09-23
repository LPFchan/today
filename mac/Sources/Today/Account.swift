import AppKit
import CryptoKit
import Foundation
import Network

/// Signing in to lost.plus and reading the board.
///
/// The app is an OAuth client of the auth hub, like the watch, but it can
/// open a browser itself, so it needs no pairing mailbox: it registers a
/// client, sends the browser to the hub's consent page, and catches the code
/// on a loopback port (RFC 8252). The token is bound to today.lost.plus with
/// scope `today`; the gateway checks it on /api/board.
enum Account {
    static let base = URL(string: "https://today.lost.plus")!
    static let hub = URL(string: "https://auth.lost.plus")!
    static let resource = "https://today.lost.plus/mcp"
    static let scope = "today"
    // The hub matches loopback redirects on host and path, not port.
    static let redirect = "http://127.0.0.1/callback"

    enum Failure: LocalizedError {
        case offline, declined, signedOut, server(Int)
        var errorDescription: String? {
            switch self {
            case .offline: "Couldn’t reach lost.plus. Try again in a moment."
            case .declined: "Sign-in was cancelled."
            case .signedOut: "You’ve been signed out."
            case .server(let status): "lost.plus answered \(status)."
            }
        }
    }

    struct Tokens: Codable {
        var access: String
        var refresh: String
        var expires: Date
        var clientID: String
    }

    /* ---------- sign in ---------- */

    /// Runs the whole browser sign-in. Throws `CancellationError` if the task is cancelled.
    static func signIn() async throws -> Tokens {
        let callback = try await LoopbackServer.start()
        defer { callback.stop() }
        let redirectURI = "http://127.0.0.1:\(callback.port)/callback"

        let clientID = try await register()
        let verifier = randomBase64URL(48)
        let challenge = base64URL(Data(SHA256.hash(data: Data(verifier.utf8))))
        let state = randomBase64URL(16)
        var authorize = URLComponents(url: hub.appending(path: "oauth/authorize"), resolvingAgainstBaseURL: false)!
        authorize.queryItems = [
            .init(name: "response_type", value: "code"),
            .init(name: "client_id", value: clientID),
            .init(name: "redirect_uri", value: redirectURI),
            .init(name: "code_challenge", value: challenge),
            .init(name: "code_challenge_method", value: "S256"),
            .init(name: "state", value: state),
            .init(name: "resource", value: resource),
            .init(name: "scope", value: scope),
        ]
        let url = authorize.url!
        await MainActor.run { _ = NSWorkspace.shared.open(url) }

        let query = try await callback.wait()
        guard query["state"] == state, let code = query["code"] else { throw Failure.declined }
        let tokens = try await tokenRequest([
            "grant_type": "authorization_code",
            "code": code,
            "redirect_uri": redirectURI,
            "client_id": clientID,
            "code_verifier": verifier,
            "resource": resource,
        ], clientID: clientID)
        try TokenStore.save(tokens)
        return tokens
    }

    /// A fresh public client per sign-in; the hub drops ones never used.
    private static func register() async throws -> String {
        var request = URLRequest(url: hub.appending(path: "oauth/register"))
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.httpBody = try JSONSerialization.data(withJSONObject: [
            "client_name": "Today for Mac",
            "redirect_uris": [redirect],
            "grant_types": ["authorization_code", "refresh_token"],
            "response_types": ["code"],
            "token_endpoint_auth_method": "none",
        ])
        let (data, status) = try await send(request)
        guard status == 201,
              let body = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
              let id = body["client_id"] as? String
        else { throw Failure.server(status) }
        return id
    }

    /// Revokes the refresh token at the hub (best effort) and forgets it.
    static func signOut() async {
        if let tokens = TokenStore.load() {
            var request = formRequest(hub.appending(path: "oauth/revoke"), ["token": tokens.refresh, "client_id": tokens.clientID])
            request.timeoutInterval = 5
            _ = try? await send(request)
        }
        TokenStore.clear()
    }

    /* ---------- tokens ---------- */

    private static func tokenRequest(_ form: [String: String], clientID: String) async throws -> Tokens {
        let (data, status) = try await send(formRequest(hub.appending(path: "oauth/token"), form))
        if status == 400 || status == 401 { throw Failure.signedOut }
        guard status == 200,
              let body = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
              let access = body["access_token"] as? String,
              let refresh = body["refresh_token"] as? String
        else { throw Failure.server(status) }
        let lifetime = body["expires_in"] as? Double ?? 3600
        return Tokens(access: access, refresh: refresh, expires: Date().addingTimeInterval(lifetime), clientID: clientID)
    }

    /// Refresh tokens rotate: the new pair is saved before anything uses it.
    private static func refreshed(_ tokens: Tokens) async throws -> Tokens {
        do {
            let next = try await tokenRequest([
                "grant_type": "refresh_token",
                "refresh_token": tokens.refresh,
                "client_id": tokens.clientID,
                "resource": resource,
            ], clientID: tokens.clientID)
            try TokenStore.save(next)
            return next
        } catch Failure.signedOut {
            TokenStore.clear()
            throw Failure.signedOut
        }
    }

    /* ---------- the board ---------- */

    /// GET /api/board, refreshing the access token when it is old or refused.
    /// Callers must not overlap calls: a refresh spends the refresh token.
    static func board() async throws -> Board {
        guard var tokens = TokenStore.load() else { throw Failure.signedOut }
        if tokens.expires < Date().addingTimeInterval(60) { tokens = try await refreshed(tokens) }
        var (data, status) = try await get("api/board", token: tokens.access)
        if status == 401 {
            tokens = try await refreshed(tokens)
            (data, status) = try await get("api/board", token: tokens.access)
        }
        if status == 401 {
            TokenStore.clear()
            throw Failure.signedOut
        }
        guard status == 200 else { throw Failure.server(status) }
        return try JSONDecoder().decode(Board.self, from: data)
    }

    private static func get(_ path: String, token: String) async throws -> (Data, Int) {
        var request = URLRequest(url: base.appending(path: path))
        request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        request.setValue("application/json", forHTTPHeaderField: "Accept")
        return try await send(request)
    }

    /* ---------- HTTP ---------- */

    private static let session: URLSession = {
        let config = URLSessionConfiguration.ephemeral
        config.timeoutIntervalForRequest = 15
        return URLSession(configuration: config)
    }()

    private static func send(_ request: URLRequest) async throws -> (Data, Int) {
        do {
            let (data, response) = try await session.data(for: request)
            return (data, (response as? HTTPURLResponse)?.statusCode ?? 0)
        } catch is CancellationError {
            throw CancellationError()
        } catch {
            throw Failure.offline
        }
    }

    private static func formRequest(_ url: URL, _ form: [String: String]) -> URLRequest {
        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.setValue("application/x-www-form-urlencoded", forHTTPHeaderField: "Content-Type")
        var allowed = CharacterSet.alphanumerics
        allowed.insert(charactersIn: "-._~")
        request.httpBody = form
            .map { "\($0.key)=\($0.value.addingPercentEncoding(withAllowedCharacters: allowed)!)" }
            .joined(separator: "&")
            .data(using: .utf8)
        return request
    }

    private static func randomBase64URL(_ bytes: Int) -> String {
        base64URL(Data((0..<bytes).map { _ in UInt8.random(in: .min ... .max) }))
    }

    private static func base64URL(_ data: Data) -> String {
        data.base64EncodedString()
            .replacingOccurrences(of: "+", with: "-")
            .replacingOccurrences(of: "/", with: "_")
            .replacingOccurrences(of: "=", with: "")
    }
}

/// Tokens live in Application Support, readable by this user only. Keychain
/// items are tied to the code signature, and a self-signed or ad-hoc build
/// would be asked for a password after every update.
enum TokenStore {
    private static var file: URL {
        URL.applicationSupportDirectory.appending(path: "today/tokens.json")
    }

    static func load() -> Account.Tokens? {
        guard let data = try? Data(contentsOf: file) else { return nil }
        return try? JSONDecoder().decode(Account.Tokens.self, from: data)
    }

    static func save(_ tokens: Account.Tokens) throws {
        let dir = file.deletingLastPathComponent()
        try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true, attributes: [.posixPermissions: 0o700])
        try JSONEncoder().encode(tokens).write(to: file, options: [.atomic])
        try FileManager.default.setAttributes([.posixPermissions: 0o600], ofItemAtPath: file.path)
    }

    static func clear() { try? FileManager.default.removeItem(at: file) }
}

/// A one-shot HTTP listener on 127.0.0.1 that waits for the hub to redirect
/// the browser back with `?code=…&state=…`. All its state lives on `queue`.
final class LoopbackServer: @unchecked Sendable {
    private let listener: NWListener
    private let queue = DispatchQueue(label: "plus.lost.today.loopback")
    private var ready: CheckedContinuation<UInt16, Error>?
    private var continuation: CheckedContinuation<[String: String], Error>?
    private var result: Result<[String: String], Error>?
    private(set) var port: UInt16 = 0

    private init(listener: NWListener) { self.listener = listener }

    static func start() async throws -> LoopbackServer {
        let parameters = NWParameters.tcp
        parameters.requiredLocalEndpoint = .hostPort(host: .ipv4(.loopback), port: .any)
        let server = LoopbackServer(listener: try NWListener(using: parameters))
        server.port = try await withCheckedThrowingContinuation { ready in
            server.queue.async { server.listen(ready) }
        }
        return server
    }

    private func listen(_ ready: CheckedContinuation<UInt16, Error>) {
        self.ready = ready
        listener.stateUpdateHandler = { [weak self] state in
            guard let self else { return }
            switch state {
            case .ready: self.ready?.resume(returning: self.listener.port?.rawValue ?? 0)
            case .failed(let error): self.ready?.resume(throwing: error)
            default: return
            }
            self.ready = nil
        }
        listener.newConnectionHandler = { [weak self] in self?.handle($0) }
        listener.start(queue: queue)
    }

    /// The callback's query items. Throws `CancellationError` if the task is cancelled.
    func wait() async throws -> [String: String] {
        try await withTaskCancellationHandler {
            try await withCheckedThrowingContinuation { continuation in
                queue.async {
                    if let result = self.result { continuation.resume(with: result) } else { self.continuation = continuation }
                }
            }
        } onCancel: {
            queue.async { self.finish(.failure(CancellationError())) }
        }
    }

    func stop() { listener.cancel() }

    private func finish(_ result: Result<[String: String], Error>) {
        guard self.result == nil else { return }
        self.result = result
        continuation?.resume(with: result)
        continuation = nil
    }

    private func handle(_ connection: NWConnection) {
        connection.start(queue: queue)
        connection.receive(minimumIncompleteLength: 1, maximumLength: 16384) { [weak self] data, _, _, _ in
            guard let self else { return connection.cancel() }
            let head = data.flatMap { String(data: $0, encoding: .utf8) } ?? ""
            let target = head.split(separator: " ", maxSplits: 2).dropFirst().first.map(String.init) ?? ""
            let url = URLComponents(string: "http://127.0.0.1\(target)")
            guard url?.path == "/callback", self.result == nil else {
                return self.respond(connection, status: "404 Not Found", body: nil)
            }
            var query: [String: String] = [:]
            for item in url?.queryItems ?? [] { query[item.name] = item.value ?? "" }
            let ok = query["code"] != nil
            self.respond(connection, status: "200 OK", body: ok
                ? ("Signed in", "Today is in your menu bar now. You can close this tab.")
                : ("Not signed in", "Nothing was shared. You can close this tab and try again from the menu bar."))
            self.finish(.success(query))
        }
    }

    private func respond(_ connection: NWConnection, status: String, body: (String, String)?) {
        var html = ""
        if let (title, text) = body {
            html = """
            <!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
            <meta name="color-scheme" content="light dark"><title>\(title) · Today</title><style>
            :root{--bg:#f7f7f5;--text:#1a1a1a;--muted:#555c64;--accent:#2f55e8}
            @media (prefers-color-scheme:dark){:root{--bg:#151619;--text:#e8eaed;--muted:#afb5bd;--accent:#93a6ff}}
            body{margin:0;min-height:100vh;display:grid;place-items:center;background:var(--bg);color:var(--text);
            font:15px/1.55 -apple-system,BlinkMacSystemFont,"Apple SD Gothic Neo",sans-serif}
            main{max-width:22rem;padding:24px}h1{margin:0 0 6px;font-size:20px;font-weight:650}p{margin:0;color:var(--muted)}
            b{display:block;margin-bottom:18px;color:var(--accent);font-size:13px;font-weight:600}
            </style></head><body><main><b>Today</b><h1>\(title)</h1><p>\(text)</p></main></body></html>
            """
        }
        let bytes = Data(html.utf8)
        let head = "HTTP/1.1 \(status)\r\nContent-Type: text/html; charset=utf-8\r\nContent-Length: \(bytes.count)\r\n" +
            "Cache-Control: no-store\r\nReferrer-Policy: no-referrer\r\nConnection: close\r\n\r\n"
        connection.send(content: Data(head.utf8) + bytes, completion: .contentProcessed { _ in connection.cancel() })
    }
}
