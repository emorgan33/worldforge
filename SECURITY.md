# Security Policy

## Reporting a vulnerability

Please **do not** open a public issue for security vulnerabilities. Instead,
use the repository's **Security** tab to submit a private report ("Report a
vulnerability"). Include:

- A description of the issue and its impact.
- Steps to reproduce, or a proof-of-concept.
- The affected version or commit, and your deployment setup.

We will acknowledge reports as soon as possible, investigate, and keep you
informed of the resolution. Please give us a reasonable amount of time to
release a fix before any public disclosure.

## Scope and deployment notes

WorldForge is a self-hosted application. Operators are responsible for their
own deployment security. In particular:

- **Authentication is local** (email + password, salted scrypt hashes). There is
  no built-in SSO, MFA, or email delivery.
- **Set `WORLDFORGE_ORIGIN` correctly.** It drives same-origin/CSRF checks on
  mutation requests; a mismatch is rejected with 403.
- **Protect at-rest data.** The SQLite database (`prisma/*.db`) and uploaded
  images (`data/assets/`) contain campaign content, including GM-only secrets.
  Store them on a volume with appropriate filesystem permissions and back them
  up.
- **Terminate TLS** in front of the app (reverse proxy or platform) and serve it
  over HTTPS in production.
- **Keep dependencies current.** Dependabot/renovate-style updates are welcome.

## Supported versions

Security fixes land on the `main` branch. There are no long-term support
branches at this time.
