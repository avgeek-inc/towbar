# Towbar SSO

Private password authentication for Towbar. There is intentionally no signup
route. Successful login returns a short-lived authorization code to the Towbar
web app, which exchanges it for a host-only API session cookie.
