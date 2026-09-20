"""Local, bounded HTTP delivery control for Vector. No application logs are stored here."""
import datetime
import email.utils
import http.client
import http.server
import ipaddress
import json
import os
import random
import ssl
import socket
import sys
import threading
import time
import urllib.parse
import uuid

MAX_BATCH_BYTES = 4 * 1024 * 1024
MAX_RESPONSE_BYTES = 64 * 1024
COOLDOWN_SECONDS = 24 * 60 * 60
MAX_FAILURES = 20
HOP_HEADERS = {"host", "connection", "keep-alive", "proxy-authenticate", "proxy-authorization", "te", "trailer", "transfer-encoding", "upgrade", "content-length", "x-towbar-delivery-test"}


class VerifiedHTTPSConnection(http.client.HTTPSConnection):
    """HTTPS connection whose actual socket lookup cannot reach special networks."""

    def connect(self):
        addresses = socket.getaddrinfo(self.host, self.port, type=socket.SOCK_STREAM)
        if not addresses:
            raise OSError("Destination could not be resolved")
        candidates = []
        for family, socket_type, protocol, _, address in addresses:
            ip = ipaddress.ip_address(address[0])
            if not ip.is_global:
                raise OSError("Destination resolved to a non-public address")
            candidates.append((family, socket_type, protocol, address))
        error = None
        for family, socket_type, protocol, address in candidates:
            connection = None
            try:
                connection = socket.socket(family, socket_type, protocol)
                connection.settimeout(self.timeout)
                if self.source_address:
                    connection.bind(self.source_address)
                connection.connect(address)
                self.sock = self._context.wrap_socket(
                    connection,
                    server_hostname=self.host,
                )
                return
            except OSError as cause:
                error = cause
                if connection:
                    connection.close()
        raise error or OSError("Destination connection failed")


def iso(value):
    return datetime.datetime.fromtimestamp(value, datetime.timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z")


def epoch(value):
    return datetime.datetime.fromisoformat(value.replace("Z", "+00:00")).timestamp() if value else 0


class DeliveryController:
    def __init__(self, configuration, state_path, clock=time.time, jitter=random.uniform):
        self.clock, self.jitter, self.state_path = clock, jitter, state_path
        self.configuration = configuration
        self.locks = {provider: threading.Lock() for provider in configuration}
        self.persistence_lock = threading.Lock()
        self.connections = {}
        self.states = {}
        self.dirty = False
        saved = {}
        if os.path.exists(state_path):
            with open(state_path) as handle:
                saved = json.load(handle)
            if not isinstance(saved, dict):
                raise ValueError("Invalid delivery state")
        self.states = dict(saved)
        for provider, config in configuration.items():
            url = urllib.parse.urlsplit(config["endpoint"])
            if url.scheme != "https" or not url.hostname or url.username or url.password or url.query or url.fragment:
                raise ValueError("An HTTPS destination is required")
            previous = saved.get(provider, config.get("health"))
            if previous and previous["revision"] == config["revision"]:
                # A malformed state must never silently clear an authentication stop.
                if previous["status"] not in ("configured", "retrying", "auth_failure", "rate_limited"):
                    raise ValueError("Invalid delivery status")
                epoch(previous.get("retryAt"))
                self.states[provider] = previous
            else:
                self.states[provider] = {
                    "provider": provider, "revision": config["revision"], "status": "configured",
                    "rateLimitCount": 0, "failureCount": 0, "lastHttpStatus": None,
                    "retryAt": None, "changedAt": iso(clock()), "lastSuccessAt": None,
                    "incidentId": None, "acceptedBatches": 0, "droppedBatches": 0,
                }
        self.dirty = True
        self.persist()

    def persist(self):
        with self.persistence_lock:
            if not self.dirty:
                return
            self.dirty = False
            data = json.dumps(self.states, separators=(",", ":"))
            temporary = self.state_path + ".tmp"
            with open(temporary, "w") as handle:
                os.chmod(temporary, 0o600)
                handle.write(data)
                handle.flush()
                os.fsync(handle.fileno())
            os.replace(temporary, self.state_path)

    def close_connection(self, provider):
        connection = self.connections.pop(provider, None)
        if connection:
            connection.close()

    def record_test_receipt(self, provider, test_id):
        if not test_id:
            return
        try:
            canonical = str(uuid.UUID(test_id))
        except (ValueError, AttributeError):
            return
        if canonical != test_id:
            return
        receipt = {
            "provider": provider,
            "revision": self.configuration[provider]["revision"],
            "testId": canonical,
            "sent": True,
        }
        path = os.path.join(os.path.dirname(self.state_path), "test-receipt-" + canonical + ".json")
        temporary = path + ".tmp"
        try:
            with open(temporary, "w") as handle:
                os.chmod(temporary, 0o600)
                json.dump(receipt, handle, separators=(",", ":"))
                handle.flush()
                os.fsync(handle.fileno())
            os.replace(temporary, path)
        except OSError:
            try:
                os.unlink(temporary)
            except OSError:
                pass

    def forward(self, provider, body, headers):
        if provider not in self.configuration:
            return 404, {}, b""
        lock = self.locks[provider]
        if not lock.acquire(blocking=False):
            return 503, {"Retry-After": "5"}, b""
        try:
            state = self.states[provider]
            now = self.clock()
            if state["status"] == "auth_failure":
                # Authentication cannot recover without a credential revision.
                # Acknowledge the batch so Vector does not spin on data that this
                # destination is intentionally refusing. The durable health state
                # keeps forwarding stopped until the configuration changes.
                state["droppedBatches"] = min(9007199254740991, state["droppedBatches"] + 1)
                self.states[provider] = state
                self.dirty = True
                return 204, {}, b""
            wait = epoch(state["retryAt"]) - now
            if wait > 0:
                return 503, {"Retry-After": str(max(1, int(wait + 1)))}, b""
            status, reply_headers, response = 503, {}, b""
            test_id = headers.get("X-Towbar-Delivery-Test")
            try:
                config = self.configuration[provider]
                url = urllib.parse.urlsplit(config["endpoint"])
                connection = self.connections.get(provider)
                if not connection:
                    tls = ssl.create_default_context(cadata=config.get("caCertificate") or None)
                    connection = VerifiedHTTPSConnection(url.hostname, url.port or 443, context=tls, timeout=30)
                    self.connections[provider] = connection
                outgoing = {key: value for key, value in headers.items() if key.lower() not in HOP_HEADERS}
                outgoing["Content-Length"] = str(len(body))
                connection.request("POST", url.path or "/", body, outgoing)
                result = connection.getresponse()
                status = result.status
                reply_headers = {key: value for key, value in result.getheaders() if key.lower() in ("content-type", "retry-after")}
                response = result.read(MAX_RESPONSE_BYTES + 1)
                if len(response) > MAX_RESPONSE_BYTES:
                    self.close_connection(provider)
                    response = b""
                if result.will_close:
                    self.close_connection(provider)
            except (OSError, ValueError, http.client.HTTPException):
                self.close_connection(provider)
                status, reply_headers, response = 503, {}, b""
            self.record(provider, status, reply_headers, now)
            current = self.states[provider]
            if current["status"] == "auth_failure":
                # Do not make Vector retry a batch after the provider has proven
                # that the configured credential is invalid.
                current["droppedBatches"] = min(9007199254740991, current["droppedBatches"] + 1)
                self.states[provider] = current
                self.dirty = True
                self.persist()
                return 204, {}, b""
            if current["status"] == "rate_limited":
                wait = max(1, int(epoch(current["retryAt"]) - now + 1))
                return 503, {"Retry-After": str(wait)}, b""
            # Prevent provider error bodies (which can echo credentials) reaching logs or the UI.
            if 200 <= status < 300:
                self.record_test_receipt(provider, test_id)
                return status, reply_headers, response
            if 400 <= status < 500 and status not in (401, 403, 408, 425, 429):
                return status, {}, b""
            return 503, {}, b""
        finally:
            lock.release()

    def record(self, provider, status, headers, now):
        state = dict(self.states[provider])
        before = state["status"]
        state["lastHttpStatus"] = status
        if 200 <= status < 300:
            state.update(status="configured", retryAt=None, failureCount=0, rateLimitCount=0,
                         lastSuccessAt=iso(now), incidentId=None,
                         acceptedBatches=min(9007199254740991, state["acceptedBatches"] + 1))
        else:
            failures = min(MAX_FAILURES, state["failureCount"] + 1)
            state["failureCount"] = failures
            retry_after = 0
            value = next((value for key, value in headers.items() if key.lower() == "retry-after"), "")
            try:
                retry_after = max(0, int(value))
            except (TypeError, ValueError):
                try:
                    retry_after = max(0, email.utils.parsedate_to_datetime(value).timestamp() - now)
                except (TypeError, ValueError, OverflowError):
                    pass
            delay = max(self.jitter(5, min(300, 5 * (2 ** (failures - 1)))), min(7 * COOLDOWN_SECONDS, retry_after))
            state.update(status="retrying", retryAt=iso(now + delay))
            if status in (401, 403):
                state.update(status="auth_failure", retryAt=None, incidentId=str(uuid.uuid4()))
            elif status == 429:
                state["rateLimitCount"] = min(3, state["rateLimitCount"] + 1)
                if state["rateLimitCount"] >= 3:
                    state.update(status="rate_limited", retryAt=iso(now + max(COOLDOWN_SECONDS, min(7 * COOLDOWN_SECONDS, retry_after))), incidentId=str(uuid.uuid4()))
            elif 400 <= status < 500 and status not in (408, 425):
                # Bad payloads cannot be fixed by retrying the same batch.
                state["droppedBatches"] = min(9007199254740991, state["droppedBatches"] + 1)
            if before == "rate_limited" and state["status"] == "retrying":
                state.update(status="rate_limited", retryAt=iso(now + COOLDOWN_SECONDS))
        if state["status"] != before or state["status"] in ("auth_failure", "rate_limited"):
            state["changedAt"] = iso(now)
        self.states[provider] = state
        self.dirty = True
        # Persist every retry transition, not only terminal stops. Otherwise a
        # gateway restart could forget an earlier 429, retry immediately, and
        # postpone the three-strike cooldown indefinitely. Successful steady-
        # state batches stay in memory so the hot delivery path does not fsync
        # once per batch; recovery back to configured is persisted once.
        if state["status"] != "configured" or before != state["status"]:
            self.persist()


class Server(http.server.ThreadingHTTPServer):
    daemon_threads = True
    request_queue_size = 16

    def __init__(self, address, controller):
        self.controller = controller
        self.slots = threading.BoundedSemaphore(12)
        super().__init__(address, Handler)

    def process_request(self, request, address):
        if not self.slots.acquire(blocking=False):
            self.shutdown_request(request)
            return
        try:
            super().process_request(request, address)
        except Exception:
            self.slots.release()
            raise

    def process_request_thread(self, request, address):
        try:
            super().process_request_thread(request, address)
        finally:
            self.slots.release()

    def handle_error(self, request, address):
        pass  # Request details and credentials must never enter terminal logs.


class Handler(http.server.BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"

    def log_message(self, *args):
        pass

    def setup(self):
        super().setup()
        self.connection.settimeout(35)

    def reply(self, status, headers=None, body=b""):
        self.send_response(status)
        for key, value in (headers or {}).items():
            self.send_header(key, value)
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_POST(self):
        provider = self.path.split("/", 2)[1]
        if provider not in self.server.controller.configuration or self.headers.get("Transfer-Encoding"):
            self.close_connection = True
            return self.reply(400)
        try:
            length = int(self.headers.get("Content-Length", "-1"))
        except ValueError:
            length = -1
        if length < 0 or length > MAX_BATCH_BYTES:
            self.close_connection = True
            return self.reply(413)
        body = self.rfile.read(length)
        if len(body) != length:
            self.close_connection = True
            return self.reply(400)
        status, headers, response = self.server.controller.forward(provider, body, self.headers)
        self.reply(status, headers, response)


def main():
    with open(sys.argv[1]) as handle:
        configuration = json.load(handle)
    controller = DeliveryController(configuration, sys.argv[2])

    def persist_loop():
        while True:
            time.sleep(1)
            try:
                controller.persist()
            except OSError:
                os._exit(1)  # Fail closed if cooldown/authentication state cannot be persisted.

    threading.Thread(target=persist_loop, daemon=True).start()
    Server(("127.0.0.1", 8787), controller).serve_forever()


if __name__ == "__main__":
    main()
