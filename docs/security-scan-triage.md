# Image scan triage — 2026-11-24

Recorded scans of locally built images. A fresh scan of commit `193a003`
produced exactly the same package findings as the earlier `23bd697` image. After
the pnpm 11.29.0 upgrade, a scan of the final `3dfc6ad` image reports 0 fixable
findings at any severity; the `glob`/`minimatch` entries were bundled only in
the old pnpm CLI.
`worldforge.deskt.theworkpc.com` still serves the `23bd697`-image built before
this scan; apply the same dispositions to both.

- Scanner: Trivy `0.76.2` (pinned in CI and documented in
  [container-security.md](container-security.md)).
- Vendor evidence: `scripts/verify-vendor-patches.sh` verified 13
  vendor/backport dispositions for `amd64`.
- Commands: `scripts/verify-vendor-patches.sh` then `scripts/scan-image.sh`.
- Raw reports and vendor evidence were kept outside the repository under
  `/tmp/user/1000/opencode/p3-scan/` (23bd697),
  `/tmp/user/1000/opencode/p3-scan-193a003/` (report SHA-256 prefix
  `89de9202ac70c7c2`), and `/tmp/user/1000/opencode/p3-scan-pnpm11/` (pnpm
  11.29.0 rebuild); do not commit reports containing host or package metadata.

## Counts

| Severity | Total | Scanner-listed fix | No fix listed |
| --- | ---: | ---: | ---: |
| HIGH | 55 | 0 | 55 |
| MEDIUM | 84 | 0 | 84 |
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
- **Fixable MEDIUM resolved:** the two earlier entries (`glob 10.5.0` and
  `minimatch 9.0.9`, CVE-2026-118773 and CVE-2026-118764) came from pnpm
  10.34.9's bundled CLI, not the application dependency tree. Upgrading the
  pinned package manager to pnpm 11.29.0 (which bundles neither package) and
  moving install settings to `pnpm-workspace.yaml` removes both. A rebuilt image
  rescan reports **0 fixable findings** at any severity; counts are 55 HIGH, 84
  MEDIUM, 81 LOW, 18 UNKNOWN, all without a scanner-listed fix.
- **UNKNOWN/LOW/MEDIUM with no fix** are retained in the report and reviewed
  with the next base-image rebuild; they are not treated as approved exceptions.

## Follow-up

1. Re-run the scan after the next image build and compare counts.
2. Upgrade the affected Node tooling when a compatible `glob`/`minimatch`
   upgrade is available.
3. Re-evaluate vendor backports when dhi.io publishes newer Debian packages.
4. Keep the full JSON report with release evidence for 30 days, matching the CI
   artifact policy; never attach it to public issues.
