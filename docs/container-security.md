# Container vulnerability scanning

WorldForge scans the runtime image's package inventory, including operating-system
packages, application dependencies and operational tools. Not every statically
bundled native component is identified by that inventory scan. Passing application
tests or a container healthcheck is not evidence that an image has no security
advisories. Findings identify package versions; they do not by themselves prove
reachability or exploitability through WorldForge.

## Release policy

`.github/workflows/docker-publish.yml` builds with `--pull`, scans before any
registry push, and blocks **HIGH or CRITICAL findings with a scanner-reported
fixed version**. Invalid reports and scanner failures also block. There is no
CVE ignore list, and unfixed findings are not removed from the report. A
retry/promotion reusing a version must pass the scan again before registry updates.

The gate does **not** certify a vulnerability-free image:

- Unfixed HIGH/CRITICAL findings are counted and produce a visible warning.
  They remain risks requiring review, not approved exceptions or proof of safety.
- MEDIUM, LOW, and UNKNOWN findings are retained but do not currently block.
- Docker Hub and Trivy may differ because of advisory databases, severities,
  package matching and repeated findings across binary packages.
- Results change as new advisories and distribution fixes are published.

The workflow runs for packaging/dependency pull requests, releases, manual
dispatches and a weekly Monday scan of the default branch. Scheduled/manual
runs build and test but **never publish**. Full JSON reports are retained as
`image-security-<run-id>-<attempt>` artifacts for 30 days, including failed gates
when a report was produced. A database/scan failure is not a clean scan.

## Runtime hardening

The security candidate uses Node 22 on Debian 13 (`trixie-slim`) and pnpm
`10.34.9`, pinned in `Dockerfile` and `package.json`. The separate bundled
npm/npx installation is removed from the runtime because WorldForge uses pnpm.
This removes unused vulnerable code, rather than hiding scanner output.

Prisma CLI, tsx, pnpm, the generated client and installed application tree
remain for startup migrations and setup/admin/recovery operations. SQLite's CLI
remains for recovery snapshots and integrity checks. The container still uses
UID/GID `10001`, the same `/data` layout and origin/proxy requirements. No
application data migration is added by hardening.

`scripts/smoke-release-image.sh` uses a unique disposable project/volume and an
ephemeral loopback port. It verifies health, login, SQLite integrity, account
creation and admin bootstrap without printing setup tokens. Never run
integration tests against configured campaign data.

## Reproduce locally

Install Trivy `0.76.2` (pinned in CI), then run:

```bash
docker build --pull -t worldforge-security:test .
bash scripts/verify-vendor-patches.sh worldforge-security:test /tmp/worldforge-vendor-evidence.json
bash scripts/scan-image.sh worldforge-security:test /tmp/worldforge-image-security.json /tmp/worldforge-vendor-evidence.json
bash scripts/smoke-release-image.sh worldforge-security:test
```

The scanner uses the local Docker daemon and downloads advisory metadata. Set
`TRIVY_BIN` to an explicit path if needed. JSON retains all severities even
when the policy check exits nonzero. Re-evaluate existing reports with:

```bash
node scripts/check-image-vulnerabilities.mjs /tmp/worldforge-image-security.json /tmp/worldforge-vendor-evidence.json
```

For remaining findings, identify the package/version/path, review distribution
and upstream advisories, distinguish available fixes from unfixed findings,
and evaluate actual runtime exposure. Do not blindly remove SQLite/Prisma or
operational tools to reduce a score, silently allowlist findings, or overwrite
an existing version tag. Publish a new patch only after tests, image smoke,
review and scanning pass.

## November 6, 2026 verification

Trivy `0.76.2`, using the same downloaded advisory database, compared published
`0.4.1` digest `sha256:e4477cad4c3edd37b280d7b4e55323f4ba13ab83884dcf6b2b180dc01ab92de1`
with the local `0.4.2` candidate. These are **package/advisory findings**, not
unique CVE counts or a Docker Hub score prediction.

| Finding | Published 0.4.1 | Local 0.4.2 candidate |
| --- | ---: | ---: |
| Critical | 4 | 0 |
| High | 86 | 51 |
| Medium | 153 | 86 |
| Low | 93 | 64 |
| Fixable high/critical (release gate) | 43 | 0 |

The candidate's JavaScript findings are three MEDIUMs, with no HIGH/CRITICAL.
The 51 residual HIGH findings are OS package matches spanning 13 advisory IDs
and 19 binary packages; none has a Debian fixed version listed in this scan.
They are **not resolved** by passing the gate:

| Reported source family | Residual HIGH advisory IDs |
| --- | --- |
| util-linux | CVE-2026-76642, CVE-2026-78408, CVE-2026-78409, CVE-2026-78410 |
| SQLite | CVE-2026-119373, CVE-2026-119374, CVE-2026-119379 |
| ACL | CVE-2026-54369 |
| systemd | CVE-2026-16742 |
| ncurses | CVE-2025-69720 |
| Perl | CVE-2026-9538 |
| zlib matches | CVE-2026-76844, CVE-2026-85091 |

This is a residual-risk inventory, not an allowlist. A missing Debian fixed
version does **not** mean no upstream fix exists. The upstream investigation
below identifies fixes and distinguishes installed components from source
package matches. Actual exploitability and native-library coverage have not
been comprehensively verified.

The published-image baseline fails the new gate; the candidate passes.
Fresh isolated candidate startup, `/login`, SQLite integrity, account setup and
admin bootstrap pass. Local scans are not a substitute for rescanning the
eventual published digest; `0.4.2` has not been published by this verification.

## Upstream investigation of the 13 HIGH advisory IDs

Checked November 6, 2026 against the Debian Security Tracker and linked upstream
advisories. These fixes are not currently supplied by the installed Debian 13
packages; do not mix Debian unstable binaries into the stable image blindly.

| Family | Fix or applicability finding | Candidate action |
| --- | --- | --- |
| SQLite (three IDs) | All fixed upstream in 3.54.0; Debian sid has fixed 3.54.1 packages, while trixie remains affected. | A tested backport or supported patched package is needed for the system CLI/library. Updating it does not update Prisma's separate engine. |
| util-linux (four IDs) | Upstream fixes exist; 2.42.4 covers the set, including the later nsenter fix. Debian trixie 2.41.5 remains flagged. | Prefer a supported distribution update/backport. No workload need for mount/nsenter was identified, but removing/mitigating utilities is not a library patch. |
| zlib (two IDs) | Both map to upstream commit `df84af25dc1942490e1d1c899a07619152a46148` (v1.4); Debian sid has a backport in `1:1.3.dfsg+really1.3.2-4`. | Requires a tested stable-distribution patch. Debian confirms CVE-2026-76844 is a zlib issue; the scanner's webpack title is wrong, not evidence the zlib match is harmless. |
| ACL | Fixed upstream in 2.4.0. Debian notes new ABI and compatibility considerations, with a point-release update planned. | Wait for a supported update or separately test a full backport; do not substitute a library solely by version number. |
| ncurses | CVE-2025-69720 affects the `infocmp` CLI; fixed in upstream 6.5-20251213 and newer. `infocmp` is present. | A supported patch or verified removal of the unused CLI would remove that component's exposure; library/source-package scanner matches may remain. |
| systemd | CVE-2026-16742 concerns systemd-homed; fixes exist in 258.10/259.8/260.4/261.2/262. Candidate has system libraries but no systemd-homed executable. | The described homed attack path is absent in this image. Keep the source-package finding visible; do not install homed without re-evaluation. |
| Perl | CVE-2026-9538 is fixed in Archive::Tar 3.10. `perl-base` is present, but loading Archive::Tar fails and no `Archive/Tar.pm` is installed. | The described module attack path is absent. Keep the source-package finding visible; adding the module would require review. |

The container is non-root, but mount/umount retain their distribution SUID bits;
the observed `/etc/fstab` has no active entries. Those facts limit some attack
preconditions, not proof that the whole util-linux source package is safe.
No exploit payloads were executed and no CVEs were suppressed for this review.

### Prisma's SQLite is a separate concern

An isolated container query reports Prisma's embedded SQLite as **3.46.0**, with
`ENABLE_FTS5` and without `ENABLE_SESSION` in its compile options. WorldForge
actually uses FTS5 for `ArticleSearchIndex`, so a blanket "SQLite is unused"
disposition would be wrong. The current index uses default full detail, not
`detail=none`, and no application path enabling FTS5 secure-delete or applying
SQLite session changesets was found. The specific advisory trigger conditions
have not been demonstrated through normal WorldForge input; this is not a
comprehensive non-exploitability proof.

A system-library upgrade or different base image cannot patch this statically
bundled engine. Resolving that independently requires a supported Prisma engine
update or a separately designed/tested driver change. Do not disable FTS5 or
silently change existing databases to make a scanner score look better.

Sources (each tracker entry links its upstream patches):

- [SQLite 119373](https://security-tracker.debian.org/tracker/CVE-2026-119373),
  [119374](https://security-tracker.debian.org/tracker/CVE-2026-119374),
  [119379](https://security-tracker.debian.org/tracker/CVE-2026-119379)
- [util-linux 76642](https://security-tracker.debian.org/tracker/CVE-2026-76642),
  [78408](https://security-tracker.debian.org/tracker/CVE-2026-78408),
  [78409](https://security-tracker.debian.org/tracker/CVE-2026-78409),
  [78410](https://security-tracker.debian.org/tracker/CVE-2026-78410)
- [zlib 76844](https://security-tracker.debian.org/tracker/CVE-2026-76844),
  [85091](https://security-tracker.debian.org/tracker/CVE-2026-85091)
- [ACL](https://security-tracker.debian.org/tracker/CVE-2026-54369),
  [ncurses](https://security-tracker.debian.org/tracker/CVE-2025-69720),
  [systemd](https://security-tracker.debian.org/tracker/CVE-2026-16742),
  [Perl](https://security-tracker.debian.org/tracker/CVE-2026-9538)

## Verified vendor backports (post-0.4.2 candidate)

Docker's public Debian 13 hardened repository supplies packages whose
`changelog.Debian.gz` explicitly names the required fixes. The image installs
only the reviewed packages; it does not upgrade unrelated packages from that
repository.

| Package | Installed version | Verified fixes |
| --- | --- | --- |
| `sqlite3`, `libsqlite3-0` | `3.46.1-7+deb13u2+dhi3` | CVE-2026-119373, -119374, -119379 |
| `ncurses-bin`, `ncurses-base`, `libtinfo6` | `6.5+20250216-2+deb13u0+dhi5` | CVE-2025-69720 |
| `zlib1g` | `1:1.3.dfsg+really1.3.1-1+deb13u0+dhi4` | CVE-2026-85091 |

`systemd-homed` and Perl `Archive::Tar` are absent; CI verifies that absence from
the built image. Vendor settlements are **not** a version-number allowlist:
`scripts/verify-vendor-patches.sh` extracts the installed changelog, requires
the exact CVE text, records the actual package version, and fails closed when
evidence is missing. `scripts/check-image-vulnerabilities.mjs` applies a
disposition only when CVE, package name, and installed version all match. The
full JSON report still shows every finding; the policy output separates
`vendorResolvedHighCritical` from `unresolvedHighCritical`.

Result with the vendor layer: **13 of the 51 high matches are evidence-resolved,
38 remain unresolved.** The remaining set is util-linux (36 package matches
across 4 CVEs), ACL (1), and zlib CVE-2026-76844 (1). Docker does not publish
those fixes yet. They stay unresolved; no exception was added.

Runtime exposure reduction for the unresolved util-linux set: the image
removes setuid from `mount` and `umount`. WorldForge does not mount filesystems;
Docker performs mounts before startup. `nsenter` is not setuid and the described
issue requires a privileged operator to invoke it against an attacker-controlled
target. These are mitigations, **not patches**, so the scanner findings remain.
The ACL pathname issue requires a privileged caller processing an attacker path;
WorldForge runs unprivileged and does not use those libacl path APIs. zlib
CVE-2026-76844 concerns the system gz write path; Node uses its own bundled zlib.
Those applicability observations do not certify the packages safe.

Trivy continues to flag the backported packages because its Debian matcher uses
the distribution tracker, which does not record vendor changelogs. That is why
the gate evaluates explicit evidence instead of silently ignoring CVEs.

### Prisma's embedded SQLite

The package layer above patches the SQLite CLI and `libsqlite3-0`. It does not
patch Prisma's static engine. On November 6, 2026, a prototype built
`better-sqlite3` against the verified SQLite 3.54.1 amalgamation and connected
Prisma 6.19.3 through its supported driver adapter. Basic queries, FTS5,
migrations, timestamp compatibility, and the production image all worked, but
interactive/concurrent transactions failed (`transaction failed to commit/roll
back`) with both the bundled 3.49.2 driver and the patched build. The failure
reproduced with Prisma's JavaScript engine and is not caused by the SQLite
version. The prototype is **not shipped**.

Therefore Prisma's embedded SQLite remains unresolved in this release. Do not
claim the OS package settlement fixes it. A future attempt must first establish
correct transaction/locking behavior across the existing concurrent tests, or
adopt a supported Prisma/engine upgrade that removes the Rust SQLite engine.
