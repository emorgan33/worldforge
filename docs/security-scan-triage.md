# Image scan triage — 2026-11-24

Recorded scans of locally built images. A fresh scan of commit `193a003`
produced exactly the same package findings as the earlier `23bd697` image,
confirming that the P2/P3 code changes introduce no new package inventory.
`worldforge.deskt.theworkpc.com` still serves the `23bd697`-image built before
this scan; apply the same dispositions to both.

- Scanner: Trivy `0.76.2` (pinned in CI and documented in
  [container-security.md](container-security.md)).
- Vendor evidence: `scripts/verify-vendor-patches.sh` verified 13
  vendor/backport dispositions for `amd64`.
- Commands: `scripts/verify-vendor-patches.sh` then `scripts/scan-image.sh`.
- Raw reports and vendor evidence were kept outside the repository under
  `/tmp/user/1000/opencode/p3-scan/` (23bd697) and
  `/tmp/user/1000/opencode/p3-scan-193a003/` (fresh, report SHA-256 prefix
  `89de9202ac70c7c2`); do not commit reports containing host or package
  metadata.

## Counts

| Severity | Total | Scanner-listed fix | No fix listed |
| --- | ---: | ---: | ---: |
| HIGH | 55 | 0 | 55 |
| MEDIUM | 86 | 2 | 84 |
| LOW | 81 | 0 | 81 |
| UNKNOWN | 18 | 0 | 18 |

The release gate blocks HIGH/CRITICAL findings only when a fixed version is
listed and the package is not covered by verified vendor backports. This scan has
no fixable HIGH/CRITICAL findings, so the gate passes with a visible warning for
the unfixed ones.

## Dispositions

- **55 unfixed HIGH** are Debian packages (util-linux/mount family, OpenSSL,
  SQLite, ncurses, PAM, systemd libraries, Perl, login) with no distribution fix
  at scan time. Vendor backports already cover the SQLite/sqlite3 findings that
  dhi.io published. WorldForge runs as UID 10001 with all capabilities dropped
  and `no-new-privileges`; the container port is loopback-only behind the TLS
  proxy. No WorldForge request path is known to reach these packages with
  attacker-controlled input, but that is an exposure assessment, not proof of
  safety. Rebuild when Debian/dhi.io publish fixes; the weekly CI scan records
  changes.
- **2 fixable MEDIUM** are Node.js inventory entries `glob 10.5.0` and
  `minimatch 9.0.9` (CVE-2026-118773, CVE-2026-118764). They are dependency/CLI
  tooling, not part of the Next.js request path, and MEDIUM does not block the
  release policy. Track them in the next dependency refresh rather than forcing a
  major tooling upgrade inside this hardening pass.
- **UNKNOWN/LOW/MEDIUM with no fix** are retained in the report and reviewed
  with the next base-image rebuild; they are not treated as approved exceptions.

## Follow-up

1. Re-run the scan after the next image build and compare counts.
2. Upgrade the affected Node tooling when a compatible `glob`/`minimatch`
   upgrade is available.
3. Re-evaluate vendor backports when dhi.io publishes newer Debian packages.
4. Keep the full JSON report with release evidence for 30 days, matching the CI
   artifact policy; never attach it to public issues.
