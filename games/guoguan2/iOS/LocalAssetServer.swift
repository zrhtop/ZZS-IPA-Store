import Foundation
import Network

/// Serves only the app's immutable Web directory over IPv4 loopback.
final class LocalAssetServer {
    private let root: URL
    private let queue = DispatchQueue(label: "jp.zrh.guoguan2.assets", qos: .userInitiated)
    private var listener: NWListener?
    private var connections: [ObjectIdentifier: NWConnection] = [:]

    init(root: URL) {
        self.root = root.resolvingSymlinksInPath().standardizedFileURL
    }

    deinit {
        listener?.cancel()
        connections.values.forEach { $0.cancel() }
    }

    func start(completion: @escaping (Result<URL, Error>) -> Void) {
        queue.async { [self] in
            do {
                let parameters = NWParameters.tcp
                parameters.requiredLocalEndpoint = .hostPort(host: .ipv4(.loopback), port: .any)
                let listener = try NWListener(using: parameters)
                var reported = false
                listener.stateUpdateHandler = { [weak listener] state in
                    switch state {
                    case .ready:
                        guard !reported, let port = listener?.port,
                              let url = URL(string: "http://127.0.0.1:\(port.rawValue)/index.html") else { return }
                        reported = true
                        DispatchQueue.main.async { completion(.success(url)) }
                    case .failed(let error):
                        guard !reported else { return }
                        reported = true
                        DispatchQueue.main.async { completion(.failure(error)) }
                    default:
                        break
                    }
                }
                listener.newConnectionHandler = { [weak self] connection in
                    self?.accept(connection)
                }
                self.listener = listener
                listener.start(queue: queue)
            } catch {
                DispatchQueue.main.async { completion(.failure(error)) }
            }
        }
    }

    private func accept(_ connection: NWConnection) {
        let id = ObjectIdentifier(connection)
        connections[id] = connection
        connection.stateUpdateHandler = { [weak self, weak connection] state in
            switch state {
            case .failed, .cancelled:
                self?.connections.removeValue(forKey: id)
                connection?.cancel()
            default:
                break
            }
        }
        connection.start(queue: queue)
        receiveHeader(connection, buffer: Data())
    }

    private func receiveHeader(_ connection: NWConnection, buffer: Data) {
        connection.receive(minimumIncompleteLength: 1, maximumLength: 16384) { [weak self] data, _, done, error in
            guard let self = self else { connection.cancel(); return }
            var buffer = buffer
            if let data = data { buffer.append(data) }
            if buffer.range(of: Data("\r\n\r\n".utf8)) != nil {
                self.respond(connection, request: buffer)
            } else if error != nil || done || buffer.count > 16384 {
                self.send(connection, status: "400 Bad Request", body: Data())
            } else {
                self.receiveHeader(connection, buffer: buffer)
            }
        }
    }

    private func respond(_ connection: NWConnection, request: Data) {
        guard let header = String(data: request, encoding: .utf8),
              let line = header.components(separatedBy: "\r\n").first else {
            send(connection, status: "400 Bad Request", body: Data()); return
        }
        let fields = line.split(separator: " ")
        guard fields.count == 3 else {
            send(connection, status: "400 Bad Request", body: Data()); return
        }
        let method = String(fields[0])
        guard method == "GET" || method == "HEAD" else {
            send(connection, status: "405 Method Not Allowed", body: Data()); return
        }
        let target = String(fields[1])
        let encodedPath = target.components(separatedBy: "?").first ?? ""
        guard encodedPath.hasPrefix("/"), let path = encodedPath.removingPercentEncoding,
              !path.contains("\0"), !path.contains("\\") else {
            send(connection, status: "400 Bad Request", body: Data()); return
        }
        let components = path.split(separator: "/", omittingEmptySubsequences: true)
        guard !components.contains(".."), !components.contains(".") else {
            send(connection, status: "403 Forbidden", body: Data()); return
        }
        let relative = components.isEmpty ? "index.html" : components.joined(separator: "/")
        let file = root.appendingPathComponent(relative).resolvingSymlinksInPath().standardizedFileURL
        guard file.path.hasPrefix(root.path + "/"),
              let values = try? file.resourceValues(forKeys: [.isRegularFileKey]),
              values.isRegularFile == true,
              let data = try? Data(contentsOf: file, options: .mappedIfSafe) else {
            send(connection, status: "404 Not Found", body: Data()); return
        }
        send(connection, status: "200 OK", mime: mimeType(file.pathExtension),
             body: data, headOnly: method == "HEAD")
    }

    private func send(_ connection: NWConnection, status: String,
                      mime: String = "text/plain; charset=utf-8", body: Data, headOnly: Bool = false) {
        let header = "HTTP/1.1 \(status)\r\nContent-Type: \(mime)\r\nContent-Length: \(body.count)\r\nCache-Control: no-cache\r\nX-Content-Type-Options: nosniff\r\nConnection: close\r\n\r\n"
        var response = Data(header.utf8)
        if !headOnly { response.append(body) }
        connection.send(content: response, completion: .contentProcessed { [weak self, weak connection] _ in
            guard let connection = connection else { return }
            self?.connections.removeValue(forKey: ObjectIdentifier(connection))
            connection.cancel()
        })
    }

    private func mimeType(_ ext: String) -> String {
        switch ext.lowercased() {
        case "html": return "text/html; charset=utf-8"
        case "js", "mjs": return "text/javascript; charset=utf-8"
        case "css": return "text/css; charset=utf-8"
        case "wasm": return "application/wasm"
        case "swf": return "application/x-shockwave-flash"
        case "json", "map": return "application/json; charset=utf-8"
        case "png": return "image/png"
        case "jpg", "jpeg": return "image/jpeg"
        case "webp": return "image/webp"
        case "svg": return "image/svg+xml"
        case "mp3": return "audio/mpeg"
        case "ogg": return "audio/ogg"
        case "wav": return "audio/wav"
        case "woff": return "font/woff"
        case "woff2": return "font/woff2"
        default: return "application/octet-stream"
        }
    }
}
