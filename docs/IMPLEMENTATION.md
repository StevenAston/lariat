# Lariat — Implementation Plan

Companion to `SPEC.md`. This document decomposes the build into phases and discrete tasks. Each task has a **concrete, verifiable done condition** that becomes its acceptance test (per the Software Architect workflow). Tasks are sized so that each has a single done condition; anything needing two is split.

**This plan is for confirmation, not execution.** No application code is written until you confirm it (illustrative snippets in `SPEC.md` excepted, which you authorised).

---

## How to use this with agents

- Each task is self-contained enough to hand to a Claude Code / agent session with `SPEC.md` + this file as context.
- **Module-complete gate** (from the skill): for every task — *implement → write runnable tests against the done condition → add logging (entry/exit, state changes, errors) → confirm results* — before starting the next.
- **Dependency-injected clients.** Build QBT and *arr clients behind interfaces so workers can be unit-tested against fixtures/mocks without a live service. This is essential for testing the safety-critical Swap Worker without risking real media.
- The **`[P]`** tag marks tasks that can run in parallel with their siblings once their dependencies are met.

---

## Testing strategy (applies throughout)

Because the failure modes are destructive and the real target is a 120 TB monolith, testing is organised into **three tiers of increasing fidelity**. Lower tiers are fast and run constantly; higher tiers reproduce the Windows-specific behaviours that actually bite, in an environment physically isolated from real media.

### Tier 1 — Unit + filesystem tests (dev box, every change)

- **Unit tests** against fixtures: captured webhook JSON, captured QBT API responses, and pure-ish logic — the path normaliser, sample detector, swap state machine, recheck maths, and anomaly classifier are all fully unit-testable.
- **Filesystem tests** for the Swap Worker run in an OS temp dir, creating real files and real symlinks (Windows symlink privilege required), exercising copy/move/rollback/idempotency against throwaway files.
- Runs on every commit. Does **not** require the VM.

### Tier 2 — Plain Windows VM, snapshotted (integration)

A single-virtual-disk Windows 11 VM (Hyper-V / VirtualBox / VMware) running the **same versions** of Sonarr, Radarr, qBittorrent (and Plex if needed) as production, with **mirrored category names and folder structure**, seeded with a handful of tiny public-domain torrents (a few MB each).

Reproduces at full fidelity the characteristics a Linux/Docker environment cannot:

- Windows **mandatory file locking** (an open handle blocks overwrite) — the foundation of the upgrade fence. *This is why Docker is unsuitable: Linux file locking is advisory, so the exact failure the upgrade pause guards against cannot occur there — it would give false confidence on the riskiest path.*
- Windows **symlink semantics + privilege** (the symlink-to-symlink / orphan modes actually hit in production).
- Real three-way QBT ↔ *arr ↔ filesystem correlation and real webhook payloads.

Isolation: even a catastrophic logic error in Lariat cannot physically reach the real array — the sandbox is a separate machine, a far stronger boundary than a category allowlist. **Snapshot the configured VM** so destructive tests (especially the upgrade flow) become deterministic and repeatable: snapshot → run → roll back → run again identically.

Home for the integration tests. Stand up **before Task 1.9** (the first done condition needing real QBT + real *arr + real filesystem together). Tasks anchored here: **1.9**, plus the integration-validation passes of **1.4 / 1.5** (real locking), **1.8** (the upgrade fence), and **2.3 / 2.4** (three-way reconciliation / health). The `test_mode` flag + category allowlist still apply as defence-in-depth inside the VM.

### Tier 3 — VHDX-backed parallel DrivePool inside the VM (Move-mode only)

The one fidelity gap Tier 2 leaves is DrivePool's same-disk-vs-cross-disk move behaviour. Close it **only when the Move-mode question is actually on the table (Phase 6)** by creating `.vhdx` container files on the free space of ≥ 2 *different* physical drives, attaching them to the VM, and pooling them with DrivePool inside the VM.

Safety distinction (load-bearing):

- **VHDX containers are safe** — the host treats each as one opaque file; the VM owns the NTFS inside it. Physical spindles are shared, filesystems are not, so there is no shared-writer corruption.
- **Raw physical-disk passthrough of live pool members is forbidden** — NTFS is single-writer; two operating systems on one volume is guaranteed corruption. (Hyper-V also forces a passed-through disk Offline on the host, so it cannot be live in the host pool and the VM simultaneously — the architecture prevents the simultaneous case by construction.)
- Place each VHDX **on a raw underlying volume, outside any `PoolPart` folder** — not inside the host pool — so the DrivePool balancer cannot relocate it mid-test and silently invalidate the cross-disk measurement. *(Moderate confidence the balancer skips locked files; not worth betting test fidelity on.)*
- Spread VHDXs across **distinct physical disks** deliberately — two on one spindle makes a "cross-pool" move a same-spindle move underneath, defeating the test. A few tens of GB each is ample.

Tasks anchored here: **6.1** (Move-mode harness + enablement checklist).

### Drift mitigation (commit to up front)

The failure mode of any test environment is silent divergence from production. Pin app versions to match production, mirror real category names and folder layout, and keep the configured-VM snapshot as the known-good baseline to reset between runs.

> **Reproducibility hook:** standing up Tier 2/3 by hand is itself slow and drift-prone. Scripting the VM's stack install + base config would make the test environment reproducible *and* is reusable for bare-metal reformats — and the same pinned version set would serve as the single source of truth the drift mitigation needs. Tracked as a **sibling provisioning project**, not folded into Lariat's task list until its shape is confirmed.

### Pre-cutover golden path

Before retiring the old script: process one real single episode, one real season pack, and one real upgrade in Copy mode (old script disabled), watching the live log.

---

## Phase 0 — Foundations

**Goal:** a runnable skeleton with config, persistence, logging, and working API clients — nothing media-touching yet.

### Task 0.1: Project scaffold
| Field | Detail |
|---|---|
| Description | Create the monorepo-style layout: `server/` (Express + workers), `client/` (Vite + React), shared `config.yaml`/`.env.example`, `package.json` scripts (`dev`, `build`, `start`, `test`), and an Express server that boots and serves a health endpoint. |
| Input | None. |
| Output / Effect | Directory structure per `SPEC.md` §6/§16; `npm run dev` starts Express on the configured port. |
| Done condition | `GET /api/ping` returns `200` with JSON `{ "ok": true, "version": <pkg version> }`; `npm test` runs (even with zero tests) and exits `0`. |

### Task 0.2: Config + secrets loader `[P after 0.1]`
| Field | Detail |
|---|---|
| Description | Load `.env` (secrets) and `config.yaml` (static), validate against a schema, expose a typed config object. Include the single **path-normalisation helper** (lower-case drive, forward-slash or consistent backslash, trim, NFC) used everywhere for path comparison. |
| Input | `.env`, `config.yaml`. |
| Output / Effect | A validated `config` module; a `normalisePath(p)` function. |
| Done condition | Given a config missing a required key, load throws a descriptive error naming the key; `normalisePath('X:\\Foo\\Bar.mkv') === normalisePath('x:/foo/bar.mkv')` returns `true` in a unit test. |

### Task 0.3: Logging subsystem `[P after 0.1]`
| Field | Detail |
|---|---|
| Description | A logger that writes to console, a rotating log file, and (once 0.4 lands) the `events` table, with levels `debug|info|warn|error|critical` and a structured `detail` object. Expose a hook point for the future WebSocket broadcaster. |
| Input | Log level config. |
| Output / Effect | `log.info(source, message, detail?)` etc.; file + console output. |
| Done condition | A unit test asserts that a logged message at/above the configured level appears in the file output with timestamp, level, source, and serialised detail; a message below the level does not. |

### Task 0.4: SQLite schema, migrations, repositories
| Field | Detail |
|---|---|
| Description | Create the `better-sqlite3` database in WAL mode, the schema for `torrents`, `links`, `events`, `health_checks`, `file_hashes`, `settings` (per `SPEC.md` §7), a simple forward-only migration runner, and thin repository functions (CRUD + the specific queries workers need). |
| Input | DB path from config. |
| Output / Effect | A `.db` file with all tables; repository modules. |
| Done condition | A unit test creates an in-memory DB, runs migrations, inserts a `torrent` + a `link` + an `event`, and reads them back with correct values and the FK relationship intact; running migrations twice is idempotent (no error, no duplicate columns). |

### Task 0.5: QBT client `[P after 0.2/0.3]`
| Field | Detail |
|---|---|
| Description | Thin `fetch`-based client: cookie auth (`/api/v2/auth/login`), `torrentsInfo()`, `torrentsByHash(hash)`, `torrentFiles(hash)`, `pause(hash)`, `resume(hash)`, `recheck(hash)`. Re-auth transparently on `403`. |
| Input | QBT host/port/credentials. |
| Output / Effect | A `QbtClient` instance behind an interface. |
| Done condition | Against a mocked HTTP layer, `torrentsByHash` returns the parsed torrent for a known hash and `null` for an unknown one; a `403` on a data call triggers exactly one re-auth then a retry (asserted via mock call counts). (A live smoke test against the real QBT is a separate manual check, not a unit test.) |

### Task 0.6: Sonarr/Radarr client `[P after 0.2/0.3]`
| Field | Detail |
|---|---|
| Description | Thin v3 REST clients: Sonarr `listEpisodeFiles()` (paginated), `listEpisodes(seriesId, seasonNumber)`, `getSeries(id)`; Radarr `listMovieFiles()`, `getMovie(id)`. API-key header auth. |
| Input | *arr URLs + API keys. |
| Output / Effect | `SonarrClient` / `RadarrClient` behind interfaces. |
| Done condition | Against mocked HTTP, `listEpisodeFiles` correctly assembles a multi-page result into a single array (asserted with a 2-page fixture); each method returns the expected shape for a fixture response. |

### Task 0.7: Boot connectivity + privilege check
| Field | Detail |
|---|---|
| Description | On startup, verify: DB is writable, QBT auth succeeds, each *arr responds to a cheap endpoint, and **symlink creation works** (create + readlink + delete a temp symlink in an OS temp dir). Log each result; refuse to start (or start in a clearly-degraded mode) if a critical check fails. |
| Input | Config + clients. |
| Output / Effect | A startup report logged + exposed at `GET /api/health/system`. |
| Done condition | `GET /api/health/system` returns a JSON object with boolean fields `db`, `qbt`, `sonarr`, `radarr`, `symlink_privilege`, each reflecting the real probe result; with symlink privilege absent, `symlink_privilege` is `false` and a `critical` event is logged. |

**Phase 0 ordering:** 0.1 first; then {0.2, 0.3} → {0.4} and {0.5, 0.6} in parallel; 0.7 last.

---

## Phase 1 — Core Pipeline (the value)

**Goal:** webhook-in → correct symlink swap → correctly-timed recheck → resume, with full event logging. Copy mode only. This phase delivers the robustness that justifies the project.

### Task 1.1: Webhook endpoints + adapters
| Field | Detail |
|---|---|
| Description | `POST /webhook/sonarr` and `/webhook/radarr`. Handle `Test` (log + `200`). Normalise `Download` payloads (import + upgrade) into a single internal `ImportEvent { source, isUpgrade, hash, plexPath, arrRefs }` via per-source adapter modules. Commit captured real payloads as fixtures (Open Question §15.1). |
| Input | *arr webhook JSON. |
| Output / Effect | A validated `ImportEvent` dispatched to the orchestrator; `webhook` events logged. |
| Done condition | Given the committed Sonarr import fixture, the adapter produces an `ImportEvent` with the correct `hash`, `plexPath`, `series_id`, `season_number`, `episode_file_id`, `isUpgrade=false`; the upgrade fixture yields `isUpgrade=true`; a `Test` payload returns `200` and creates an `info` event without dispatching an `ImportEvent`. |

### Task 1.2: Torrent resolver
| Field | Detail |
|---|---|
| Description | Resolve an `ImportEvent` to a QBT torrent: primary by `downloadId`/hash; fallback by path-search (match a torrent file whose derived path equals the event's source/Plex path). Derive the QBT-land path `join(save_path, file.name)` for the imported file. Upsert the `torrents` row. |
| Input | `ImportEvent`, `QbtClient`. |
| Output / Effect | `{ torrent, qbtLandPath, file }` or a flagged "torrent not found" outcome. |
| Done condition | With a mocked QBT, resolution by hash returns the correct torrent and derived QBT-land path for a fixture; with the hash absent but a matching file path present, the fallback resolves the same torrent; with neither, it returns a not-found result that the caller logs as `warn` (no throw). |

### Task 1.3: Season-pack + sample detector
| Field | Detail |
|---|---|
| Description | Given a torrent's file list, filter to video extensions, compute the median size, drop files below $\theta\cdot\tilde{s}$, and return `{ videoFileCount, isSeasonPack }` per `SPEC.md` §9.2.1. |
| Input | Torrent file list, config ($\mathcal{V}$, $\theta$). |
| Output / Effect | `{ videoFileCount, isSeasonPack }`. |
| Done condition | Unit tests: a torrent of 10 similar-sized `.mkv` files + one 30 MB sample returns `videoFileCount=10, isSeasonPack=true`; a single `.mkv` + sample returns `videoFileCount=1, isSeasonPack=false`; an all-similar 2-file torrent returns `count=2, isSeasonPack=true`. |

### Task 1.4: Swap Worker — Copy mode
| Field | Detail |
|---|---|
| Description | Implement the copy-mode critical section per `SPEC.md` §9.1.1: pre-flight guards (target is a regular file, readable; idempotent no-op if already correctly linked; refuse differing existing symlink), pause → rename-to-`.bak` → symlink → verify (`lstat`+`readlink`) → delete `.bak`, with full rollback from `.bak` on any failure. Resume torrent only on failure. |
| Input | `{ qbtLandPath, plexPath, hash }`, `QbtClient`, filesystem. |
| Output / Effect | A symlink at the QBT-land path; a `links` row; `swap` events. |
| Done condition | Filesystem tests in a temp dir: (a) happy path leaves `qbtLandPath` a symlink to `plexPath` and no `.bak`, torrent left paused, `link.swap_status='linked'`; (b) injecting a symlink-creation failure restores the original real file from `.bak`, removes any partial symlink, marks `reverted`, and resumes the torrent; (c) running the swap twice on the same input is a no-op the second time (`link` unchanged, no error); (d) a target that is itself a symlink is rejected pre-flight with a `double_symlink`/guard event and no mutation. |

### Task 1.5: Swap Worker — Move mode `[P after 1.4]`
| Field | Detail |
|---|---|
| Description | Implement move-mode behaviour (behind `import_mode: move`): pause → symlink (no `.bak`) → verify → record; on failure remove partial symlink and flag `critical` (torrent will lack its file). Shares pre-flight guards and idempotency with 1.4. |
| Input | As 1.4, with an empty QBT-land path. |
| Output / Effect | Symlink + `link` row (`swap_mode='move'`). |
| Done condition | Filesystem tests: happy path with an absent QBT-land file creates the symlink and records `swap_mode='move'`; an injected failure removes any partial symlink, marks `swap_status='failed'`, logs a `critical` event, and leaves the torrent paused. |

### Task 1.6: Completion Coordinator (debounce)
| Field | Detail |
|---|---|
| Description | In-memory `Map<hash, {timer, importsSeen, videoFileCount}>`. On each pack import, increment `importsSeen`, (re)start the `debounce_ms` timer, and fire the recheck when C1 (`importsSeen === videoFileCount`) **or** C2 (timer expiry) is met — exactly once per torrent. Optionally consult C3 (Sonarr) when configured. Expose state for inspection. |
| Input | Per-import notifications, config. |
| Output / Effect | A single recheck dispatch per completed pack. |
| Done condition | Tests with a fake clock: feeding 10 imports for a 10-file pack fires the recheck exactly once via C1 and cancels the timer; feeding 8 of 10 then advancing the clock past `debounce_ms` fires exactly once via C2; a single-file torrent fires immediately without arming a timer; duplicate import events for the same file do not double-count toward C1 (dedupe by `link`/path). |

### Task 1.7: Recheck Worker (adaptive polling)
| Field | Detail |
|---|---|
| Description | Implement the adaptive algorithm per `SPEC.md` §9.3: trigger recheck, calibrate, then sleep $\Delta t = \max(T_{\min}, (\hat\tau_{done}-t_i)/2)$ between polls; stall guard for $\hat r \le 0$; hard timeout; resume iff healthy; record `recheck_status` and timings. |
| Input | `hash`, `QbtClient`, config ($T_{\min}$, timeout). |
| Output / Effect | A passed/failed recheck; torrent resumed on pass; `recheck` events; `torrents` updated. |
| Done condition | Tests with a fake clock + scripted progress sequence: a torrent progressing $0 \to 1$ is polled with monotonically non-decreasing intervals each $\ge T_{\min}$, then resumed once on reaching $1.0$ with `recheck_status='passed'`; a torrent stuck at a fixed progress past the hard timeout ends `failed`, is **not** resumed, and logs an `error`; a single regressing reading does not crash the rate computation (guard exercised). |

### Task 1.8: Upgrade pre-step
| Field | Detail |
|---|---|
| Description | For `isUpgrade` events, before the new swap: find the file being replaced (Sonarr episode-file / Radarr movie-file API), find its owning torrent by path-search, pause it, record its hash; resume it after the new swap + recheck complete. |
| Input | `ImportEvent` (upgrade), *arr + QBT clients. |
| Output / Effect | Old torrent paused before swap, resumed after; events logged. |
| Done condition | With mocked clients, an upgrade event locates the old torrent for the replaced file, pauses it before the Swap Worker runs (asserted by call ordering), and resumes it after the recheck stage; if no old torrent is found, it logs a `warn` and proceeds with the new swap without error. |

### Task 1.9: Import orchestrator (wiring)
| Field | Detail |
|---|---|
| Description | The end-to-end controller tying 1.1→1.8 together for both single-file and season-pack imports, including the upgrade branch, in the correct order with correct pause/resume handoff between Swap and Recheck. |
| Input | `ImportEvent`. |
| Output / Effect | A fully processed import: link(s) recorded, recheck timed correctly, torrent resumed on pass. |
| Done condition | An integration test (mocked QBT/​*arr, real temp-dir filesystem) drives: a single-episode import → swap → immediate recheck → resume; a 3-file pack import sequence → 3 swaps → exactly one recheck after the 3rd → resume; an upgrade → old-torrent pause → swap → recheck → both torrents resumed. Each asserts the final DB state and the event trail. |

### Task 1.10: Minimal REST surface `[P after 1.9]`
| Field | Detail |
|---|---|
| Description | Read endpoints (`GET /api/links`, `/api/links/:id`, `/api/torrents`, `/api/torrents/:hash`, `/api/events?filter`) and action endpoints (`POST /api/links/:id/recheck`, `POST /api/links/:id/health-check`). |
| Input | HTTP requests. |
| Output / Effect | JSON responses; actions enqueue the relevant worker. |
| Done condition | Supertest-style tests: `GET /api/links` returns seeded links as JSON; `POST /api/links/:id/recheck` returns `202` and causes the Recheck Worker to be invoked for the link's torrent (asserted via a spy). |

**Phase 1 ordering:** 1.1 → 1.2 → 1.3 → {1.4, 1.5, 1.6} → 1.7 → 1.8 → 1.9 → 1.10. (1.5/1.6 can proceed alongside 1.4 once 1.3 lands.)

---

## Phase 2 — Reconciliation + Health

**Goal:** build the DB picture from the three sources on demand, and keep links honest over time.

### Task 2.1: QBT path map builder
| Field | Detail |
|---|---|
| Description | Single pass over all QBT torrents + files producing `Map<normalisedPath, {hash, file}>` for $O(1)$ lookups, with progress reporting for large torrent counts. |
| Input | `QbtClient`. |
| Output / Effect | The path map. |
| Done condition | A unit test with a fixture of N torrents builds a map whose lookups return the correct `{hash, file}` for known paths and `undefined` for unknown; paths differing only by case/slash resolve to the same entry (uses the normaliser). |

### Task 2.2: Anomaly classifier
| Field | Detail |
|---|---|
| Description | Pure function: given `lstat`/`readlink` results for a QBT-land path and a Plex-land path plus QBT presence, return the correct `SPEC.md` §11.1 enum value. |
| Input | Filesystem facts + QBT presence flag. |
| Output / Effect | An anomaly enum value. |
| Done condition | Table-driven unit tests cover every enum value at least once: healthy, unprocessed, orphan_symlink, double_symlink, wrong_target, missing_real_file, no_torrent, torrent_no_file, unmanaged_torrent — each input combination maps to the documented value. |

### Task 2.3: Reconciliation worker
| Field | Detail |
|---|---|
| Description | Orchestrate `SPEC.md` §9.6: pull *arr inventories, build the QBT map (2.1), `lstat` each relevant path, classify (2.2), upsert `torrents`/`links`, identify batch candidates, emit a summary. Read-only w.r.t. media/torrents. Progress-reported. |
| Input | *arr + QBT clients, filesystem. |
| Output / Effect | Populated/updated DB; a reconciliation summary event; a batch-candidate list. |
| Done condition | An integration test (mocked clients, temp-dir filesystem with a deliberately seeded mix: one healthy symlinked file, one orphan symlink, one unprocessed real file, one *arr file missing on disk, one QBT torrent with no *arr match) produces exactly the expected `current_health` on each resulting `link`/torrent and a summary event whose counts match the seeded mix; **no media or torrent is mutated** (verified by asserting no QBT pause/resume/recheck calls and no filesystem writes). |

### Task 2.4: Health worker
| Field | Detail |
|---|---|
| Description | Per-link checks (a/b/c per `SPEC.md` §9.5) on a `node-cron` schedule and on demand (single link / torrent / filter). Write a `health_checks` row, update `links.current_health` + `last_health_check_id`, emit an event on any transition to non-healthy. Read-only w.r.t. media/torrents. |
| Input | A link (or set), `QbtClient`, filesystem. |
| Output / Effect | `health_checks` rows; updated `links`; transition events. |
| Done condition | Tests: a healthy link yields a `health_checks` row with all booleans true and `overall='healthy'`; breaking the symlink target between two runs flips `overall` to `orphan_symlink` and emits exactly one transition event; the scheduled sweep visits every link (asserted via spy/count) and reports progress. |

### Task 2.5: Startup integration
| Field | Detail |
|---|---|
| Description | On boot, run reconciliation, then **re-arm the Completion Coordinator** for any season where some episodes are linked but others are not (re-query remaining count), so a mid-pack restart resumes correct completion behaviour rather than assuming completeness. |
| Input | Reconciliation output, *arr client. |
| Output / Effect | Coordinators re-armed for in-progress packs; a boot summary. |
| Done condition | An integration test simulating a restart with a half-imported pack (5 of 10 files linked) re-arms a coordinator whose `videoFileCount=10` and `importsSeen=5`, such that 5 further imports (or the fallback timer) fire exactly one recheck. |

**Phase 2 ordering:** {2.1, 2.2} → 2.3 → 2.4 → 2.5.

---

## Phase 3 — Frontend Core

**Goal:** a function-first dashboard and the manual/batch tooling, plus the live log. Depends on Phase 1/2 APIs.

### Task 3.1: Client scaffold + API client + base UI `[after 1.10]`
| Field | Detail |
|---|---|
| Description | Vite + React + Tailwind + Radix base; routing; a typed API client wrapping the REST endpoints; build output served by Express from `client/dist`. |
| Input | REST API. |
| Output / Effect | A served SPA shell with navigation. |
| Done condition | `npm run build` emits `client/dist`; Express serves the SPA at `/`; the shell renders the nav and a placeholder for each route; the API client successfully fetches `/api/ping`. |

### Task 3.2: WebSocket live log `[P after 3.1]`
| Field | Detail |
|---|---|
| Description | `ws` server sharing the Express HTTP server, broadcasting new `events` (via the 0.3 hook); a client live-log view with level/source filters. |
| Input | Event stream. |
| Output / Effect | Real-time event feed in the UI. |
| Done condition | A test client connected to the WS receives a newly-logged event within the same process tick/round-trip; the client view renders received events and filters them by level in the browser. |

### Task 3.3: Dashboard `[P after 3.1]`
| Field | Detail |
|---|---|
| Description | Summary cards per `SPEC.md` §10.1 (totals, by-anomaly counts, last reconciliation/health times, recheck queue depth), backed by a `GET /api/summary` endpoint. |
| Input | Summary API. |
| Output / Effect | The dashboard view. |
| Done condition | With seeded data, the dashboard renders counts that match a direct DB query, and the by-anomaly card reflects the seeded mix. |

### Task 3.4: Links table `[P after 3.1]`
| Field | Detail |
|---|---|
| Description | Sortable/filterable table of links with status + source badges and per-row actions (recheck, health-check, detail). Filter by anomaly type. |
| Input | `/api/links`. |
| Output / Effect | The links view. |
| Done condition | The table renders seeded links, sorts by at least one column, filters to a single anomaly type showing only matching rows, and a row action triggers the corresponding POST (asserted via network spy). |

### Task 3.5: Link + Torrent detail `[P after 3.4]`
| Field | Detail |
|---|---|
| Description | Detail views: a link's full `events` timeline, its symlink/target paths, QBT state, and manual actions; a torrent's links + recheck history + guarded pause/resume. |
| Input | `/api/links/:id`, `/api/torrents/:hash`, `/api/events`. |
| Output / Effect | The detail views. |
| Done condition | The link detail renders the event timeline for a seeded link in chronological order and shows the symlink→target mapping; the torrent detail lists all links under a seeded multi-file torrent. |

### Task 3.6: Manual trigger + matching pipeline `[after 1.9]`
| Field | Detail |
|---|---|
| Description | Backend matching endpoint (title strip → year → S## routing → `fuse.js` fuzzy match → ranked candidates + confidence). Frontend dual Radix combobox (torrent w/ size; *arr entry pre-selected to top match, editable) + ▶ that calls the swap pipeline. |
| Input | QBT torrent list, *arr titles. |
| Output / Effect | A manually-initiated swap. |
| Done condition | For the title fixture `The.Bear.S03.2160p.DSNP.WEB-DL...-FLUX`, the matcher returns the Sonarr series "The Bear" as rank 1 with a confidence above a set threshold and routes to Sonarr; selecting a torrent + entry and pressing ▶ invokes the same Swap Worker path as a webhook import (asserted via spy). |

### Task 3.7: Batch page `[after 3.6, 2.3]`
| Field | Detail |
|---|---|
| Description | Multi-select table of reconciliation "unprocessed" candidates with best-guess *arr entry + confidence badge (low-confidence highlighted); "process selected" runs the swap pipeline per row with per-row status. |
| Input | Batch-candidate list, matching pipeline. |
| Output / Effect | Bulk swaps with live per-row status. |
| Done condition | With a seeded set of 3 unprocessed candidates, selecting all and processing invokes the swap pipeline 3 times and updates each row's status to its outcome; a low-confidence candidate shows the warning badge. |

### Task 3.8: Settings page `[P after 3.1]`
| Field | Detail |
|---|---|
| Description | Edit the runtime-adjustable `settings` subset (debounce, $\theta$, schedules, `import_mode`); persists to the `settings` table; live values take effect without restart for keys that support it. |
| Input | `/api/settings`. |
| Output / Effect | Updated runtime config. |
| Done condition | Changing `debounce_ms` in the UI persists to the `settings` table and the Completion Coordinator reads the new value on its next arm (asserted via a subsequent timer using the updated value). |

**Phase 3 ordering:** 3.1 → {3.2, 3.3, 3.4, 3.8} in parallel → 3.5 → 3.6 → 3.7.

---

## Phase 4 — Integrity (Sparse Reverse Merkle)

**Goal:** optional fast corruption/truncation detection. Independent of Phase 3; needs Phase 1 links.

### Task 4.1: Sparse reverse-Merkle hasher `[after 0.4]`
| Field | Detail |
|---|---|
| Description | Implement the EOF-anchored sampling + XXH3 Merkle tree per `SPEC.md` §12.1, with a file-size pre-test, configurable $w$/$r$, optional full node list for localisation, and progress reporting on large files. Resolve the xxhash binding choice (Open Question §15.5). |
| Input | A file path, $w$, $r$. |
| Output / Effect | `{ root, leafCount, treeJson?, sizeAtHash }`. |
| Done condition | Deterministic unit tests on temp files: the same file yields the same root across runs; a one-byte change *within a sampled (trailing) region* changes the root; truncating the file changes the root; the size pre-test detects a size change without reading content; sample offsets for a known file size match the closed-form ranges in §12.1. |

### Task 4.2: Hash storage + integrity health check `[after 4.1, 2.4]`
| Field | Detail |
|---|---|
| Description | Persist fingerprints in `file_hashes`; add integrity as health-check step (d): size pre-test, then re-hash and compare to stored, setting `integrity_ok` and `integrity_fail` anomaly on mismatch. Opt-in, throttled, off the import hot path. |
| Input | A link, stored fingerprint. |
| Output / Effect | `file_hashes` rows; integrity verdict in `health_checks`. |
| Done condition | A test stores a fingerprint for a temp file, then a clean re-check reports `integrity_ok=true`; corrupting the trailing region flips it to `false` and sets `current_health='integrity_fail'`; the integrity step is skipped when disabled in config. |

### Task 4.3 (bench): content-defined-chunking variant `[P after 4.1]`
| Field | Detail |
|---|---|
| Description | Prototype a rolling-hash (Rabin-style) boundary leaf strategy behind the same interface, to compare insertion-robustness vs cost against the sparse scheme. Exploratory; not wired into health checks. |
| Input | A file path, chunking params. |
| Output / Effect | An alternative fingerprint + a short comparison note. |
| Done condition | A benchmark/test demonstrates that inserting bytes near the start of a file changes **few** chunk hashes under the CDC variant but **many** leaf hashes under the sparse scheme, with measured throughput for both recorded in the test output. |

**Phase 4 ordering:** 4.1 → 4.2; 4.3 optional in parallel after 4.1.

---

## Phase 5 — Topology View (the node graph)

**Goal:** the four-column linked working-set visualisation. Pure read. Depends on Phase 2 (link data) and Phase 3 (frontend).

### Task 5.1: Topology data API `[after 2.3, 3.1]`
| Field | Detail |
|---|---|
| Description | `GET /api/topology?filter=...` returning a bounded working set (≤ configurable max, default ~50) as `{ nodes:[{id, column, label, source, health}], connections:[{fromId, toId, kind, status}] }` for lenses: broken, single-series/movie, batch candidates. |
| Input | Link/torrent data, a filter. |
| Output / Effect | A node+connection graph payload. |
| Done condition | For a seeded series with a complete chain, the endpoint returns 4 nodes (one per column) and 3 connections all marked linked; for a seeded orphan symlink, the library↔symlink connection is marked broken; the result never exceeds the configured max. |

### Task 5.2: Four-column layout + nodes `[after 5.1]`
| Field | Detail |
|---|---|
| Description | A single tall page with four columns (arr / library / torrents-folder / QBT), nodes colour-coded by source, sortable, on stable DOM IDs. |
| Input | Topology payload. |
| Output / Effect | The static four-column layout. |
| Done condition | The page renders each node in its correct column with a stable `data-node-id`, colour-coded by source, and sortable by at least one key. |

### Task 5.3: SVG connector overlay `[after 5.2]`
| Field | Detail |
|---|---|
| Description | An absolutely-positioned SVG overlay drawing cubic-bézier ropes between connected node IDs via `getBoundingClientRect()`, redrawing on resize; full chains recolour; broken/anomalous connections highlighted. |
| Input | Node DOM rects + connections. |
| Output / Effect | The rendered rope network. |
| Done condition | Ropes connect the correct node pairs (endpoints within a small tolerance of the node edge centres in a jsdom/measured test or a visual snapshot), redraw correctly after a simulated resize, and a fully-linked chain renders in the "linked" colour while a broken connection renders highlighted. |

### Task 5.4: Lenses / filters `[after 5.3]`
| Field | Detail |
|---|---|
| Description | UI controls to switch lenses (broken, single-show, batch candidates) and re-query the topology API. |
| Input | User selection. |
| Output / Effect | A re-scoped graph. |
| Done condition | Selecting the "broken" lens re-renders with only non-healthy chains present; selecting a specific series renders only that series' chain. |

**Phase 5 ordering:** strictly sequential 5.1 → 5.2 → 5.3 → 5.4.

---

## Phase 6 — Hardening / Ops

**Goal:** production-readiness and the deferred risky bits, done deliberately.

### Task 6.1: Move-mode test harness + enablement criteria
| Field | Detail |
|---|---|
| Description | A gated, sandbox-only harness exercising Move mode end-to-end against a disposable torrent, plus a documented checklist (including the DrivePool same-disk-vs-cross-disk move behaviour) that must pass before Move is enabled in production. |
| Input | Sandbox torrent + Move-mode Swap Worker. |
| Output / Effect | A pass/fail report against the checklist. |
| Done condition | The harness runs a full Move-mode swap + recheck + resume on a sandbox torrent and produces a report asserting the recheck passed and exactly one physical copy remained throughout; the checklist explicitly records observed DrivePool move behaviour. |

### Task 6.2: Upgrade-flow robustness
| Field | Detail |
|---|---|
| Description | Resolve Open Question §15.3: determine empirically whether an upgrade that replaces the old torrent's target file requires that old torrent to be rechecked (and possibly re-linked) rather than plain-resumed, and implement the correct behaviour. |
| Input | A real/sandbox upgrade scenario. |
| Output / Effect | Correct old-torrent handling post-upgrade. |
| Done condition | A documented test demonstrates the old torrent ends in a healthy seeding state after an upgrade, with the implemented handling (resume vs recheck-then-resume) matching the observed requirement. |

### Task 6.3: Windows service wrapper
| Field | Detail |
|---|---|
| Description | Wrap the service to start on boot without a console window (`node-windows` or NSSM — Open Question §15.7), with logging intact. |
| Input | The built service. |
| Output / Effect | A registered Windows service. |
| Done condition | The service starts on boot, serves `/api/ping`, and writes to the log file, verified after a reboot or a service-restart test. |

### Task 6.4 (future): Notifications
| Field | Detail |
|---|---|
| Description | Optional push on health degradation (Apprise/webhook/email). Out of scope for v1 per requirement; stub the interface only. |
| Input | A health transition event. |
| Output / Effect | (Future) an outbound notification. |
| Done condition | An interface exists with a no-op default implementation and a unit test asserting it is invoked on a degradation transition (no real channel required for v1). |

**Phase 6 ordering:** independent; tackle as needed. 6.1/6.2 before trusting Move/upgrade in production; 6.3 before unattended operation.

---

## Cross-phase dependency map

```
Phase 0 ──► Phase 1 ──► Phase 2 ──► Phase 3 (frontend over P1/P2 APIs)
                 │            │
                 ├──────────► Phase 4 (integrity; needs P1 links + P0 DB)
                 │            │
                 └────────────┴────► Phase 5 (topology; needs P2 data + P3 frontend)

Phase 6 draws on all; do 6.1/6.2 before enabling Move/trusting upgrades, 6.3 before unattended run.
```

**Minimum viable robustness** = Phases 0 + 1. That alone replaces the fragile script and the recheck storm, and gives you durable records. Everything after is additive and independently deferrable, in roughly the order above.

---

## Task Ordering (overall)

**Mixed.** Phases are largely sequential (0 → 1 → 2 → 3, with 4 and 5 branching as shown). Within phases, the `[P]`-tagged tasks may run in parallel or be split across agents once their dependencies are met. The per-phase ordering notes above are authoritative.
