# Security Model

WorldForge is self-hosted. The application enforces authentication,
authorization, publication filtering, and same-origin writes; the operator is
responsible for host security, TLS, storage permissions, backups, dependency
updates, and controlling access to the application port.

## Accounts and passwords

- Authentication is local email and password. There is no built-in SSO, MFA,
  open registration, or email delivery.
- Passwords must contain 12–128 characters and are stored as salted scrypt
  hashes (`N=131072`, `r=8`, `p=1`).
- Account setup and recovery use random one-time tokens stored as hashes. Links
  expire after 24 hours; issuing or consuming recovery invalidates older
  credentials as documented by the account flow.
- Setup tokens appear after `#` in the URL so browsers do not send them in the
  HTTP request. They are still credentials and must be shared privately.

## Sessions and login protection

Sessions use random 256-bit tokens stored as hashes. The cookie is HttpOnly,
SameSite=Lax, scoped to `/`, and marked Secure when the public origin is HTTPS.
Sessions expire after seven days. Logout revokes the server record; disabling
or recovering an account revokes relevant credentials.

Login throttling allows eight attempts per email and client source, and thirty
attempts per source, during each 15-minute window. In public HTTPS deployments,
`WORLDFORGE_TRUSTED_PROXY=1` requires a private reverse proxy to overwrite
`X-WorldForge-Client-IP` with one valid client address. WorldForge ignores
`X-Forwarded-For` for throttling. Never expose the internal application port to
untrusted clients in trusted-proxy mode.

## Write-request protection

Mutation requests require an `Origin` that exactly matches
`WORLDFORGE_ORIGIN`. A mismatch returns 403. Set the origin to the canonical
browser-visible HTTPS URL and terminate TLS at the reverse proxy. WorldForge
sets CSP, clickjacking, MIME-sniffing, and referrer headers; HSTS is enabled for
an HTTPS origin.

Same-origin checks do not replace authorization. Author routes resolve the
signed-in account and owning world or resource on the server. A client-supplied
world ID cannot grant access to another owner's records.

## Reader and sharing boundaries

Anonymous publication requires a public world plus an article that is both
**Published** and **Public**. Public pages use a separate filtered projection;
they do not reuse author API payloads. GM-note subtrees, campaign secrets,
private references, inactive structured fields, and private variables are
excluded.

Player access requires active campaign membership and a current resource
policy. Sharing an article does not automatically share embedded images or
statblocks. Revocation is checked on subsequent requests, but data already
downloaded, copied, screenshotted, or cached outside WorldForge cannot be
recalled.

Owner-issued player preview capabilities are scoped to one world and expire
after 15 minutes. Invitation links are email-bound, one-use capabilities that
expire after seven days. Treat invitation and preview URLs as credentials.

## Data at rest and backups

The SQLite database and asset directory contain private campaign material,
password/session hashes, invitations, and GM-only content. Restrict filesystem
access, encrypt disks or backup media where appropriate, and protect backups as
carefully as the live installation. Browser recovery drafts and previously
downloaded files remain on client devices after server logout.

## Reporting vulnerabilities

Do not open a public issue. Use the repository's **Security → Report a
vulnerability** flow and include the affected version, deployment setup,
impact, and reproduction steps. Security fixes currently land on `main`; there
are no long-term-support branches.

**Source owner:** `wiki/Security-Model.md`; adapted from `SECURITY.md`,
`docs/publishing-and-permissions.md`, `docs/player-accounts.md`, and current auth
code.
**Verified against:** WorldForge commit `fdff259` (October 31, 2026).
