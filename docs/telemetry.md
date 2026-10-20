# Telemetry

Telemetry is **off by default**. Nothing is sent to any third party unless you
explicitly configure one of the environment variables below at build/run time.

| Component | Variable(s) | What it enables |
|-----------|-------------|-----------------|
| Web app (build time) | `VITE_PUBLIC_POSTHOG_KEY`, `VITE_PUBLIC_POSTHOG_HOST` | Product analytics via PostHog |
| Web app (build time) | `VITE_SENTRY_DSN` | Error reporting via Sentry |
| Relay (`server/index.js`) | `POSTHOG_API_KEY`, `POSTHOG_HOST` | Relay connection metrics via PostHog |

If a variable is unset, the corresponding SDK is never initialised. Query
contents and table data are never part of telemetry events.

To enable it for your own deployment, put the variables in `.env.local` (web app)
or the relay's environment. Point `*_HOST` at a self-hosted PostHog instance if
you prefer.
