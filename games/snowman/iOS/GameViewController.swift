import UIKit
import WebKit

final class GameViewController: UIViewController, WKNavigationDelegate, WKScriptMessageHandler {
    private var webView: WKWebView!
    private var assetServer: LocalAssetServer?
    private var localURL: URL?
    private var active = true
    private let smokeMode = ProcessInfo.processInfo.arguments.contains("--snowman-smoke-test")
    private var smokeStarted = false
    private var smokeFinished = false

    override var supportedInterfaceOrientations: UIInterfaceOrientationMask { .landscape }
    override var preferredInterfaceOrientationForPresentation: UIInterfaceOrientation { .landscapeRight }
    override var prefersStatusBarHidden: Bool { true }
    override var prefersHomeIndicatorAutoHidden: Bool { true }

    override func viewDidLoad() {
        super.viewDidLoad()
        view.backgroundColor = .black
        let configuration = WKWebViewConfiguration()
        configuration.allowsInlineMediaPlayback = true
        configuration.mediaTypesRequiringUserActionForPlayback = []
        configuration.allowsPictureInPictureMediaPlayback = false
        configuration.userContentController.add(WeakScriptHandler(self), name: "snowman")
        webView = WKWebView(frame: .zero, configuration: configuration)
        webView.navigationDelegate = self
        webView.isOpaque = false
        webView.backgroundColor = .black
        webView.scrollView.backgroundColor = .black
        webView.scrollView.isScrollEnabled = false
        webView.scrollView.bounces = false
        webView.scrollView.pinchGestureRecognizer?.isEnabled = false
        webView.isMultipleTouchEnabled = true
        webView.scrollView.isMultipleTouchEnabled = true
        webView.scrollView.contentInsetAdjustmentBehavior = .never
        webView.allowsBackForwardNavigationGestures = false
        webView.translatesAutoresizingMaskIntoConstraints = false
        view.addSubview(webView)
        NSLayoutConstraint.activate([
            webView.leadingAnchor.constraint(equalTo: view.leadingAnchor),
            webView.trailingAnchor.constraint(equalTo: view.trailingAnchor),
            webView.topAnchor.constraint(equalTo: view.topAnchor),
            webView.bottomAnchor.constraint(equalTo: view.bottomAnchor)
        ])
        if smokeMode,
           let documents = FileManager.default.urls(for: .documentDirectory, in: .userDomainMask).first {
            try? FileManager.default.removeItem(at: documents.appendingPathComponent("snowman-smoke-result.json"))
        }
        startGame()
    }

    private func startGame() {
        guard let root = Bundle.main.url(forResource: "Web", withExtension: nil),
              FileManager.default.fileExists(atPath: root.appendingPathComponent("index.html").path) else {
            fail("安装包内缺少 Web/index.html"); return
        }
        let server = LocalAssetServer(root: root)
        assetServer = server
        server.start { [weak self] result in
            guard let self = self else { return }
            switch result {
            case .success(let url):
                self.localURL = url
                self.webView.load(URLRequest(url: url))
            case .failure(let error):
                self.fail("本地游戏服务启动失败：\(error.localizedDescription)")
            }
        }
    }

    func setActive(_ active: Bool) {
        self.active = active
        UIApplication.shared.isIdleTimerDisabled = active
        guard isViewLoaded else { return }
        webView.evaluateJavaScript("window.SnowmanHost?.setActive(\(active ? "true" : "false"));", completionHandler: nil)
    }

    func webView(_ webView: WKWebView, decidePolicyFor navigationAction: WKNavigationAction,
                 decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
        guard let url = navigationAction.request.url else { decisionHandler(.cancel); return }
        if url.absoluteString == "about:blank" {
            decisionHandler(.allow); return
        }
        let allowed = url.scheme == "http" && url.host == "127.0.0.1" && url.port == localURL?.port
        decisionHandler(allowed ? .allow : .cancel)
    }

    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
        setActive(active)
        guard smokeMode, !smokeStarted else { return }
        smokeStarted = true
        let script = """
        (() => {
          const send = result => window.webkit.messageHandlers.snowman.postMessage({type: 'smoke-result', result});
          Promise.resolve().then(() => {
            if (!window.SnowmanHost || typeof window.SnowmanHost.runSmokeTest !== 'function') {
              throw new Error('SnowmanHost.runSmokeTest is unavailable');
            }
            return Promise.race([
              window.SnowmanHost.runSmokeTest(),
              new Promise((_, reject) => setTimeout(() => reject(new Error('Web smoke test exceeded 90 seconds')), 90000))
            ]);
          }).then(send, error => send({success: false, error: String(error), diagnostics: window.SnowmanHost?.getDiagnostics?.() ?? null}));
        })();
        """
        webView.evaluateJavaScript(script) { [weak self] _, error in
            if let error = error { self?.writeSmokeResult(["success": false, "error": error.localizedDescription]) }
        }
        DispatchQueue.main.asyncAfter(deadline: .now() + 100) { [weak self] in
            guard let self = self, !self.smokeFinished else { return }
            self.writeSmokeResult(["success": false, "error": "Native smoke test exceeded 100 seconds"])
        }
    }

    func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage) {
        guard smokeMode, message.frameInfo.isMainFrame,
              let body = message.body as? [String: Any], body["type"] as? String == "smoke-result",
              let result = body["result"] as? [String: Any] else { return }
        writeSmokeResult(result)
    }

    private func writeSmokeResult(_ result: [String: Any]) {
        guard !smokeFinished else { return }
        smokeFinished = true
        do {
            let documents = try FileManager.default.url(for: .documentDirectory, in: .userDomainMask,
                                                       appropriateFor: nil, create: true)
            let data = try JSONSerialization.data(withJSONObject: result, options: [.prettyPrinted, .sortedKeys])
            try data.write(to: documents.appendingPathComponent("snowman-smoke-result.json"), options: .atomic)
            NSLog("Snowman smoke result written: %@", result["success"] as? Bool == true ? "passed" : "failed")
        } catch {
            NSLog("Snowman smoke result could not be written: %@", error.localizedDescription)
        }
    }

    func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) {
        fail(error.localizedDescription)
    }

    func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: Error) {
        fail(error.localizedDescription)
    }

    func webViewWebContentProcessDidTerminate(_ webView: WKWebView) {
        if smokeMode {
            writeSmokeResult(["success": false, "error": "Web content process terminated"])
        } else {
            webView.reload()
        }
    }

    private func fail(_ message: String) {
        if smokeMode { writeSmokeResult(["success": false, "error": message]); return }
        let alert = UIAlertController(title: "游戏加载失败", message: message, preferredStyle: .alert)
        alert.addAction(UIAlertAction(title: "重试", style: .default) { [weak self] _ in
            self?.assetServer = nil
            self?.startGame()
        })
        present(alert, animated: true)
    }
}

private final class WeakScriptHandler: NSObject, WKScriptMessageHandler {
    weak var target: WKScriptMessageHandler?
    init(_ target: WKScriptMessageHandler) { self.target = target }
    func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage) {
        target?.userContentController(userContentController, didReceive: message)
    }
}
