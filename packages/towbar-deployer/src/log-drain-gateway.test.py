import importlib.util
import json
import os
import tempfile
import unittest
from unittest.mock import patch

spec = importlib.util.spec_from_file_location("gateway", os.path.join(os.path.dirname(__file__), "log-drain-gateway.py"))
gateway = importlib.util.module_from_spec(spec)
spec.loader.exec_module(gateway)


class Connection:
    requests = 0
    status = 200
    headers = []
    last_request_headers = {}

    def __init__(self, *args, **kwargs): pass
    def request(self, *args, **kwargs):
        Connection.requests += 1
        Connection.last_request_headers = args[3] if len(args) > 3 else kwargs.get("headers", {})
    def getresponse(self): return self
    def getheaders(self): return Connection.headers
    def read(self, *args): return b"provider-secret-echo" if self.status >= 400 else b""
    def close(self): pass
    will_close = False


class DeliveryTests(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.file = os.path.join(self.directory.name, "status.json")
        self.now = 1800000000
        self.config = {"otlp": {"endpoint": "https://collector.example.com/v1/logs", "revision": "one"}}
        Connection.requests, Connection.status, Connection.headers = 0, 200, []
        Connection.last_request_headers = {}
        self.mock = patch.object(gateway, "VerifiedHTTPSConnection", Connection)
        self.mock.start()
        self.controller = self.new()

    def tearDown(self):
        self.mock.stop()
        self.directory.cleanup()

    def new(self):
        return gateway.DeliveryController(self.config, self.file, clock=lambda: self.now, jitter=lambda low, high: high)

    def send(self):
        return self.controller.forward("otlp", b"batch", {"Authorization": "Bearer only-a-test"})

    def test_auth_stops_immediately_and_survives_restart(self):
        for status in (401, 403):
            self.config["otlp"]["revision"] = str(status)
            self.controller = self.new()
            Connection.status = status
            before = Connection.requests
            self.assertEqual(self.send(), (204, {}, b""))
            self.assertEqual(self.controller.states["otlp"]["status"], "auth_failure")
            incident = self.controller.states["otlp"]["incidentId"]
            for _ in range(5): self.assertEqual(self.send(), (204, {}, b""))
            self.now += 48 * 3600
            self.controller = self.new()
            self.send()
            self.assertEqual(Connection.requests, before + 1)
            self.assertEqual(self.controller.states["otlp"]["incidentId"], incident)
            with open(self.file) as handle:
                self.assertNotIn("only-a-test", handle.read())
        self.config["otlp"]["revision"] = "updated"
        Connection.status = 200
        self.controller = self.new()
        self.assertEqual(self.send()[0], 200)
        self.assertEqual(self.controller.states["otlp"]["status"], "configured")

    def test_delivery_test_receipt_requires_upstream_success(self):
        test_id = "11111111-1111-4111-8111-111111111111"
        headers = {
            "Authorization": "Bearer only-a-test",
            "X-Towbar-Delivery-Test": test_id,
        }
        self.assertEqual(self.controller.forward("otlp", b"batch", headers)[0], 200)
        receipt = os.path.join(self.directory.name, "test-receipt-" + test_id + ".json")
        with open(receipt) as handle:
            self.assertEqual(json.load(handle), {
                "provider": "otlp",
                "revision": "one",
                "testId": test_id,
                "sent": True,
            })
        self.assertNotIn("X-Towbar-Delivery-Test", Connection.last_request_headers)
        os.unlink(receipt)
        Connection.status = 401
        self.config["otlp"]["revision"] = "two"
        self.controller = self.new()
        self.assertEqual(self.controller.forward("otlp", b"batch", headers)[0], 204)
        self.assertFalse(os.path.exists(receipt))

    def test_rate_limit_exponential_backoff_retry_after_and_day_cooldown(self):
        Connection.status = 429
        for delay in (5, 10):
            self.send()
            self.assertEqual(gateway.epoch(self.controller.states["otlp"]["retryAt"]), self.now + delay)
            self.controller = self.new()
            self.assertEqual(self.controller.states["otlp"]["rateLimitCount"], delay // 5)
            attempts = Connection.requests
            self.now += delay - 1
            self.send()
            self.assertEqual(Connection.requests, attempts)
            self.now += 1
        self.send()
        self.assertEqual(Connection.requests, 3)
        state = self.controller.states["otlp"]
        self.assertEqual(state["status"], "rate_limited")
        self.assertEqual(gateway.epoch(state["retryAt"]), self.now + 86400)
        self.assertEqual(self.send()[1], {"Retry-After": "86401"})
        self.controller = self.new()
        self.now += 86399
        self.send()
        self.assertEqual(Connection.requests, 3)
        self.now += 1
        Connection.status = 200
        self.assertEqual(self.send()[0], 200)
        self.assertEqual(self.controller.states["otlp"]["rateLimitCount"], 0)
        self.assertIsNone(self.controller.states["otlp"]["incidentId"])
        Connection.status = 429
        Connection.headers = [("retry-after", "120")]
        self.send()
        self.assertEqual(gateway.epoch(self.controller.states["otlp"]["retryAt"]), self.now + 120)

    def test_http_date_retry_after_and_repeated_cooldown(self):
        Connection.status = 429
        Connection.headers = [("Retry-After", gateway.email.utils.formatdate(self.now + 90, usegmt=True))]
        self.send()
        self.assertEqual(gateway.epoch(self.controller.states["otlp"]["retryAt"]), self.now + 90)
        self.now += 90
        self.send()
        self.now += 90
        self.send()
        before = self.controller.states["otlp"]["incidentId"]
        self.now = gateway.epoch(self.controller.states["otlp"]["retryAt"])
        self.send()
        self.assertNotEqual(self.controller.states["otlp"]["incidentId"], before)
        self.assertEqual(gateway.epoch(self.controller.states["otlp"]["retryAt"]), self.now + 86400)

    def test_transient_errors_are_bounded_and_success_resets(self):
        Connection.status = 503
        for _ in range(30):
            self.send()
            wait = gateway.epoch(self.controller.states["otlp"]["retryAt"]) - self.now
            self.assertLessEqual(wait, 300)
            self.assertGreaterEqual(wait, 5)
            self.now += wait
        self.assertEqual(self.controller.states["otlp"]["failureCount"], 20)
        Connection.status = 200
        self.send()
        self.assertEqual(self.controller.states["otlp"]["failureCount"], 0)
        self.assertIsNone(self.controller.states["otlp"]["retryAt"])

    def test_permanent_payload_error_is_not_retried_and_error_body_is_scrubbed(self):
        Connection.status = 400
        self.assertEqual(self.send(), (400, {}, b""))
        self.assertEqual(self.controller.states["otlp"]["droppedBatches"], 1)

    def test_corrupt_state_and_insecure_url_fail_closed(self):
        with open(self.file, "w") as handle: handle.write("broken")
        self.assertRaises(ValueError, self.new)
        os.unlink(self.file)
        self.config["otlp"]["endpoint"] = "http://collector.example.com"
        self.assertRaises(ValueError, self.new)

    def test_temporary_test_preserves_other_destinations_pause(self):
        self.config["loki"] = {"endpoint": "https://logs.example.com/push", "revision": "one"}
        self.controller = self.new()
        Connection.status = 401
        self.controller.forward("loki", b"batch", {})
        incident = self.controller.states["loki"]["incidentId"]
        del self.config["loki"]
        self.controller = self.new()
        with open(self.file) as handle:
            self.assertEqual(json.load(handle)["loki"]["incidentId"], incident)

    def test_busy_destination_does_not_consume_worker_slots_or_send_twice(self):
        self.controller.locks["otlp"].acquire()
        try:
            self.assertEqual(self.send()[0], 503)
            self.assertEqual(Connection.requests, 0)
        finally: self.controller.locks["otlp"].release()


if __name__ == "__main__": unittest.main()
