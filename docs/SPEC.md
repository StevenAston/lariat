# Lariat — Specification

> **Working name:** *Lariat*. From Spanish *la reata* ("the rope that ties"), from *reatar* "to tie again" (Latin *re-* + *aptare*, "to fasten again"). The system's whole job is to **re-tie** qBittorrent to a library file via a symlink after Sonarr/Radarr have moved or copied it. The snaking connector lines in the eventual visualisation are, fittingly, ropes. Rename at will.

**Status:** Draft specification for confirmation. No application code is to be written until this and the accompanying `IMPLEMENTATION_PLAN.md` are confirmed.

---

## 1. Purpose and Goals

Lariat is a long-running supervisory service, with a web frontend, that manages and audits the symlink-swap workflow currently performed by a one-shot Python script. It exists to make a deliberately fragile media pipeline **observable, recoverable, and trustworthy**.

Concretely, it must:

1. **Replace** the current one-shot script as the authoritative handler of Sonarr/Radarr import and upgrade events, performing the symlink swap that lets qBittorrent (QBT) continue seeding while Plex serves a real file.
2. **Record everything** it does — a flight recorder. Every swap, recheck, health check, anomaly, and manual action is durably logged with enough context to reconstruct what happened after the fact.
3. **Continuously verify** that the links it has created remain valid: the symlink exists, its target exists and is readable, and QBT still holds a healthy torrent for it.
4. **Reconcile** the three sources of truth (Sonarr/Radarr file inventories, the filesystem, and QBT's torrents) into a single coherent picture on demand.
5. **Allow manual intervention** — trigger a swap for a torrent that was missed, singly or in batches, through a usable interface rather than the command line.
6. **Eventually visualise** the link topology as a constrained node graph for at-a-glance comprehension and as a portfolio-quality artefact.

The guiding non-functional goal is **precision over cleverness**. The current system works most of the time; Lariat's value is in the long tail of failure modes the current system handles badly or not at all.

---

## 2. Non-Goals

- **Lariat does not replace Sonarr, Radarr, QBT, or Plex.** It is a coordination and audit layer on top of them.
- **Lariat does not manage downloading, indexers, or quality profiles.** Those remain entirely in the *arr applications.
- **Lariat does not delete user media or torrents autonomously.** See §13, Safety Invariants. The only file it ever removes is a `.bak` it created itself, and only after the replacement symlink is verified.
- **Lariat is not a general-purpose file manager.** It only ever touches paths that the *arr applications or QBT have told it about.
- **No multi-user, auth, or remote-access concerns for v1.** It runs on the same Windows host as everything else and is accessed locally. (Bind to `localhost` by default.)
- **No Docker, no Linux.** This is a Windows 11 native deployment by deliberate choice (DrivePool, performance).

---

## 3. Environment and Constraints

| Constraint | Detail | Consequence for design |
|---|---|---|
| **OS** | Windows 11, native (no WSL, no Docker, no containers) | Symlink creation requires privilege (see below). Path handling is Windows-style (`X:\...`, case-insensitive, backslashes). |
| **Storage** | StableBit DrivePool presenting ~120 TB as a single drive letter | Hardlinks are not viable across the pool; symlinks are the mechanism. A "move" within the pool may be instant *or* a full copy depending on whether source and destination land on the same underlying physical disk. |
| **Co-location** | QBT, Sonarr, Radarr, Plex, and Lariat all run on the same host with the same filesystem view | **No path-translation layer is needed.** A path string means the same thing to every process. This removes the single hardest problem a containerised version would face. |
| **Symlink privilege** | Creating symlinks on Windows requires either Developer Mode enabled or the process running elevated (Administrator), or the `SeCreateSymbolicLinkPrivilege` granted | The existing script already creates symlinks, so this is presumably satisfied. Lariat must run under the same privilege. **To confirm before build.** |
| **Single host, single process** | One Node process supervises everything | In-memory coordination state (debounce timers) is safe and simple. No distributed coordination, no external queue. |

### 3.1 Glossary (used throughout)

- **QBT-land path** — the path where QBT believes a torrent's file lives, i.e. `join(torrent.save_path, file.name)`. After a swap, a **symlink** lives here. QBT seeds *through* this symlink.
- **Plex-land path** — the path in a Plex library where the **real file** lives. Reported by Sonarr/Radarr as the import destination. Plex reads this directly and never touches a symlink.
- **Swap** — the operation of replacing the real file at the QBT-land path with a symlink pointing to the Plex-land real file, so only one physical copy persists.
- **Link** — the persistent result of a swap: a (symlink → target) mapping for one file. The core entity Lariat tracks.

---

## 4. Background: The Current System and Its Failure Modes

Understanding why the current design exists is load-bearing. The following are *Chesterton's fences* — each was erected to keep something out.

### 4.1 Current flow

1. Sonarr/Radarr send a torrent to QBT; QBT downloads it to its save path (QBT-land).
2. On completion, Sonarr/Radarr **copy** the file into the Plex library (Plex-land). A symlink cannot be used here because Plex (in this environment) cannot read through a symlink placed in the library.
3. A Custom Script connection (a `.bat` launching `completed_download_symlinking.py`) fires on **On Import** and **On Upgrade**:
   - finds the torrent (by searching QBT for a file matching the source path),
   - pauses it,
   - renames the QBT-land real file to `.bak`,
   - creates a symlink at the QBT-land path pointing to the Plex-land real file,
   - deletes the `.bak`,
   - writes a "needs recheck" flag/state file.
4. A **second** script runs every 30 minutes, reads the flag files, rechecks each torrent, and resumes it if healthy.

### 4.2 Failure modes this produces

- **Recheck storm on season packs.** When a season pack imports episode-by-episode, the old approach would recheck the whole torrent after *each* episode, which both wasted time and *interrupted the import sequence*, causing it to restart. The flag-file + 30-minute-poller split is a workaround for the lack of any memory between invocations. **This is the single biggest driver of Lariat's architecture** (see §6.2).
- **Transient double storage.** During the swap, the file exists twice (QBT-land real file + Plex-land copy) until the `.bak` is deleted. This is brief, not persistent — the current script *does* collapse it. (This matters: the "two copies of everything" worry is largely already solved.)
- **Race conditions between QBT and the script.** If QBT and the script (or Sonarr) touch the same file simultaneously, one loses; historically this has produced a symlink pointing at a deleted file, or a symlink pointing at another symlink, or two empty symlinks. Pausing/stopping the torrent first removes QBT from the contest entirely; a recheck is needed afterward regardless, so the pause is nearly free. **This is why pausing first is non-negotiable.**
- **Upgrade lock contention.** On Windows, an open file handle is a hard lock. The old torrent seeds *through* the symlink and therefore holds the **Plex-land real file** open. When an upgrade arrives, Sonarr must overwrite that exact Plex-land file — impossible while it is locked. The old torrent must be paused first to release the handle. This is the "everything blows up if it's not that way" fence.
- **No durable record.** When something goes wrong, there is no history. Diagnosis is forensic and manual.

### 4.3 Source-script behaviours worth preserving

From `completed_download_symlinking.py`, the following behaviours are correct and should carry forward (re-implemented, not copied):

- Pause the relevant torrent before any filesystem mutation, with a configurable settle delay.
- For upgrades, identify and pause the *old* torrent before the swap, and resume it afterward.
- Roll back from `.bak` if the swap fails partway.
- Resume the new torrent only if the swap *failed* (if it succeeded, leave it paused for the recheck stage).
- Treat `Test` events as a connectivity check and exit cleanly.

---

## 5. Key Architectural Decisions (with rationale)

| # | Decision | Rationale | Reversible? |
|---|---|---|---|
| **D1** | **Long-running Node.js service**, not a one-shot script | A persistent process can hold debounce state in memory, eliminating the flag-file/poller hack and the recheck storm. | Hard to reverse — it's the foundation. |
| **D2** | **Identify torrents by `downloadId` from the webhook**, not by searching QBT for a matching file path | The Sonarr/Radarr webhook payload includes `downloadId`, which is the torrent infohash. This is far more robust than path-matching (which breaks when paths differ subtly or after a move). Path-search is retained only as a fallback. | Easy — fallback already exists. |
| **D3** | **Switch the *arr connection from Custom Script to Webhook (JSON over HTTP)** | A long-running HTTP service is the natural receiver. JSON payloads are richer and avoid the `.bat` shim. *Caveat in Open Questions:* webhook payloads may omit the download-client *source path*; mitigated by D2 (we derive QBT-land path from QBT directly using the hash). | Moderate — could fall back to a thin Custom Script that POSTs to the local API. |
| **D4** | **SQLite (`better-sqlite3`) as the datastore, WAL mode** | Single file, zero admin overhead, synchronous API (simple control flow), durable, queryable — ideal for a flight recorder. WAL allows the frontend to read while workers write. | Easy — schema is portable. |
| **D5** | **Roll our own thin QBT client over `fetch`** | The QBT Web API is plain cookie-authenticated HTTP. npm wrappers exist but their maintenance/coverage is uncertain; a ~100-line client is fully transparent and dependency-stable. | Trivial. |
| **D6** | **Copy mode is the default; Move mode is opt-in** | Copy mode keeps the original as `.bak` until the symlink is verified — strictly safer rollback. Move mode's only benefit (avoiding a transient copy + some I/O) is marginal and, on DrivePool, possibly illusory. | Per-config flag. |
| **D7** | **React + Vite + Tailwind + Radix Primitives**, built to static files served by Express | One process, one port. Radix supplies accessible UI chrome; the node-graph is custom SVG. | Frontend is decoupled from backend via REST/WS. |
| **D8** | **Reconciliation runs on startup and on explicit user request only** | Per requirement. No surprise full scans. Health checks (lighter, per-link) cover the periodic need. | Config could add a schedule later. |
| **D9** | **Non-cryptographic hashing (XXH3) for the optional integrity subsystem** | The threat model is accidental corruption/truncation/replacement, not adversaries. XXH3 is extremely fast and collision-resistant enough for this. | Algorithm is pluggable. |

---

## 6. System Architecture

### 6.1 Component overview

```
                         ┌───────────────────────────────────────────────┐
   Sonarr  ──webhook──►  │                  Express HTTP                   │
   Radarr  ──webhook──►  │  /webhook/sonarr  /webhook/radarr              │
                         │  /api/*           (REST)                       │
   Browser ──HTTP/WS──►  │  /ws              (live event stream)          │
                         │  static client/dist                            │
                         └───────────────┬───────────────────────────────┘
                                         │ dispatches to
            ┌────────────────────────────┼─────────────────────────────────────┐
            ▼                            ▼                                       ▼
   ┌─────────────────┐      ┌──────────────────────────┐          ┌──────────────────────┐
   │  Swap Worker    │      │ Completion Coordinator   │          │   Health Worker      │
   │  pause→link→    │─────►│ (debounce, per hash)     │─────────►│ cron + on-demand     │
   │  verify→record  │      │ fires recheck when pack  │  arms    │ (a) symlink valid?   │
   └────────┬────────┘      │ complete or timer expires│          │ (b) target ok?       │
            │               └────────────┬─────────────┘          │ (c) qbt healthy?     │
            │                            ▼                         │ (d) integrity? [P4]  │
            │               ┌──────────────────────────┐          └──────────┬───────────┘
            │               │   Recheck Worker         │                     │
            │               │ adaptive progress poll   │                     │
            │               │ resume iff healthy       │                     │
            │               └──────────────────────────┘                     │
            │                                                                 │
            ▼                                                                 ▼
   ┌──────────────────────────────────────────────────────────────────────────────────┐
   │                          SQLite (better-sqlite3, WAL)                               │
   │     torrents · links · events · health_checks · file_hashes[P4] · settings         │
   └──────────────────────────────────────────────────────────────────────────────────┘
            ▲                                   ▲                          ▲
            │                                   │                          │
   ┌────────┴─────────┐              ┌──────────┴──────────┐    ┌──────────┴───────────┐
   │  QBT Client      │              │ Sonarr/Radarr Client│    │ Reconciliation Worker│
   │ (thin, fetch)    │              │ (thin, fetch, v3)   │    │ startup + on request │
   └──────────────────┘              └─────────────────────┘    └──────────────────────┘
```

### 6.2 The debounce: why the long-running process matters

The recheck storm is fundamentally a **statelessness** problem. The old script has no memory that it just processed the same torrent moments ago. A persistent process keeps a map:

$$\text{pending} : \text{hash} \rightarrow \{\text{timer},\ \text{imports\_seen},\ \text{video\_file\_count},\ \dots\}$$

When an import for hash $h$ arrives, the swap is performed immediately (Sonarr is waiting on nothing — the swap is fast), the link is recorded, and the **recheck** is deferred. The coordinator decides *when* to recheck based on completion (§9.2). This collapses the flag-file table and the 30-minute poller into one coherent in-process mechanism, and guarantees the recheck never fires mid-import-sequence.

---

## 7. Data Model

SQLite, WAL mode. The natural grain is **per-file** (`links`), with torrents as a grouping parent, because a season pack is one torrent but many files / episodes / symlinks. Torrent-level operations (pause, recheck, resume) act on `torrents`; file-level facts (symlink path, target, per-file health) live on `links`.

### 7.1 `torrents`

One row per torrent hash Lariat manages.

| Column | Type | Notes |
|---|---|---|
| `hash` | TEXT PK | Infohash, normalised to lower-case. |
| `name` | TEXT | Torrent display name (from QBT). |
| `save_path` | TEXT | QBT save path. |
| `size_bytes` | INTEGER | Total torrent size. |
| `category` | TEXT | QBT category (e.g. `tv-sonarr`, `radarr`). |
| `arr_source` | TEXT | `sonarr` \| `radarr` \| `unknown`. |
| `is_season_pack` | INTEGER | Boolean; derived per §9.2.1. |
| `video_file_count` | INTEGER | Count of *real* video files after sample filtering. |
| `recheck_status` | TEXT | `none` \| `pending` \| `running` \| `passed` \| `failed`. |
| `recheck_started_at` | INTEGER | Unix ms. |
| `recheck_finished_at` | INTEGER | Unix ms. |
| `last_qbt_state` | TEXT | Last observed QBT state string. |
| `last_seen_at` | INTEGER | Last time confirmed present in QBT. |
| `created_at` / `updated_at` | INTEGER | Audit. |

### 7.2 `links`

One row per managed file (the core entity).

| Column | Type | Notes |
|---|---|---|
| `id` | INTEGER PK | |
| `torrent_hash` | TEXT FK → torrents.hash | Nullable only for orphan/anomaly records discovered by reconciliation. |
| `qbt_path` | TEXT | Where the symlink lives (QBT-land). **Unique** (a path holds one link). |
| `plex_path` | TEXT | Where the real file lives (Plex-land) = symlink target. |
| `arr_source` | TEXT | `sonarr` \| `radarr`. |
| `series_id` | INTEGER | Sonarr. |
| `season_number` | INTEGER | Sonarr. |
| `episode_file_id` | INTEGER | Sonarr. |
| `movie_id` | INTEGER | Radarr. |
| `movie_file_id` | INTEGER | Radarr. |
| `swap_status` | TEXT | `pending` \| `linked` \| `failed` \| `reverted`. |
| `swap_mode` | TEXT | `copy` \| `move` (which path was taken). |
| `swap_at` | INTEGER | Unix ms. |
| `current_health` | TEXT | One of the §11.1 anomaly enum values; `healthy` when all checks pass. |
| `last_health_check_id` | INTEGER FK → health_checks.id | |
| `created_at` / `updated_at` | INTEGER | |

### 7.3 `events` (the flight recorder — append-only)

Many rows per link and/or torrent. Never updated, never deleted (subject to a retention policy in config, default: keep all).

| Column | Type | Notes |
|---|---|---|
| `id` | INTEGER PK | |
| `ts` | INTEGER | Unix ms. |
| `level` | TEXT | `debug` \| `info` \| `warn` \| `error` \| `critical`. |
| `source` | TEXT | `webhook` \| `swap` \| `coordinator` \| `recheck` \| `health` \| `reconcile` \| `manual` \| `system`. |
| `torrent_hash` | TEXT | Nullable. |
| `link_id` | INTEGER | Nullable. |
| `message` | TEXT | Human-readable. |
| `detail_json` | TEXT | Structured payload (paths, before/after states, errors, timings). |

This table is where the historical disasters (lost torrent, mangled symlink) would have left a breadcrumb trail. It is also the feed for the live WebSocket stream.

### 7.4 `health_checks`

Per-link health-check results over time (history, not just latest).

| Column | Type | Notes |
|---|---|---|
| `id` | INTEGER PK | |
| `link_id` | INTEGER FK → links.id | |
| `checked_at` | INTEGER | Unix ms. |
| `symlink_exists` | INTEGER | bool. |
| `symlink_is_symlink` | INTEGER | bool (guards against the real-file-where-symlink-expected case). |
| `target_exists` | INTEGER | bool. |
| `target_is_regular_file` | INTEGER | bool (guards against symlink→symlink). |
| `target_readable` | INTEGER | bool. |
| `target_matches_expected` | INTEGER | bool (readlink == recorded `plex_path`). |
| `qbt_has_torrent` | INTEGER | bool. |
| `qbt_state` | TEXT | |
| `qbt_progress` | REAL | $[0,1]$. |
| `integrity_ok` | INTEGER | Nullable bool (Phase 4). |
| `overall` | TEXT | Computed anomaly enum value. |

### 7.5 `file_hashes` (Phase 4)

Sparse reverse-Merkle fingerprints for integrity verification. See §12.

| Column | Type | Notes |
|---|---|---|
| `id` | INTEGER PK | |
| `link_id` | INTEGER FK → links.id | |
| `algo` | TEXT | e.g. `xxh3-128`. |
| `window_bytes` | INTEGER | Sample window $w$. |
| `ratio` | INTEGER | Sample ratio denominator $r$ (1:r). |
| `leaf_count` | INTEGER | Number of leaf samples $n$. |
| `root` | TEXT | Hex Merkle root. |
| `tree_json` | TEXT | Optional: full node list for localisation of changes. |
| `file_size_at_hash` | INTEGER | Size when hashed (size change alone is a fast mismatch signal). |
| `computed_at` | INTEGER | |

### 7.6 `settings`

Key-value store for runtime-adjustable config that should survive restarts and be editable from the UI (a subset of the file config). Static/secret config stays in files (§14).

---

## 8. *arr Connection Model

### 8.1 Recommended: Webhook connection

Configure Sonarr and Radarr **Connect → Webhook** to POST to `http://localhost:<port>/webhook/sonarr` and `/webhook/radarr` respectively, on **On Import** (a.k.a. On Download) and **On Upgrade**, plus **On Test**.

Fields Lariat needs from the JSON payload:

- **`eventType`** — `Download` for imports (upgrades are the same event with an upgrade flag), `Test` for connectivity.
- **`isUpgrade`** (boolean) — distinguishes upgrade from fresh import.
- **`downloadId`** — the torrent infohash (→ D2). The primary correlation key.
- Sonarr: **`series.id`**, **`episodes[].id`**, **`episodes[].seasonNumber`**, **`episodeFile.id`**, **`episodeFile.path`** (Plex-land destination).
- Radarr: **`movie.id`**, **`movieFile.id`**, **`movieFile.path`** (Plex-land destination).

The **QBT-land path** is derived from QBT using `downloadId` (not from the webhook), which is robust against the webhook omitting a source path.

> **Open Question (§15):** exact field names/availability vary across *arr versions. These must be verified against the live instances and pinned in a small adapter module, with a captured sample payload committed as a fixture.

### 8.2 Fallback: thin Custom Script

If the webhook proves to lack something essential, retain the existing `.bat` → tiny script, but have that script merely `POST` the environment variables (which *do* include `sourcepath`) to a local `/webhook/sonarr-env` endpoint. This keeps all logic in the service while guaranteeing the richer env-var dataset. Treated as a contingency, not the primary path.

---

## 9. Core Flows

### 9.1 Import — single file (movie, or single episode)

1. Webhook arrives; adapter normalises it to an internal `ImportEvent { source, isUpgrade, hash, plexPath, arrRefs }`.
2. Log `info` `webhook` event.
3. (Upgrade only) run the upgrade pre-step (§9.4) first.
4. Resolve the torrent in QBT by `hash` (fallback: path-search by `plexPath`/source). Fetch `save_path` and file list; upsert `torrents`.
5. Determine the QBT-land path for the imported file: `join(save_path, file.name)`.
6. Run the **Swap Worker** (§9.1.1) for that one file.
7. Record the `link`. Because $\text{video\_file\_count} = 1$, mark the torrent as not a season pack and hand directly to the **Recheck Worker** (§9.3) — no debounce needed (or a short, configurable safety debounce, default $0$ s for singles).

#### 9.1.1 Swap Worker (the critical section)

Given a target file (QBT-land path `Q`, Plex-land path `P`, torrent hash `h`):

**Pre-flight guards (abort the swap, log, and flag if any fail):**
- `P` exists, is a *regular file* (not a symlink — guards against symlink→symlink), and is readable.
- If `Q` is *already* a symlink pointing to `P` → **idempotent no-op**: the link is already correct; record/refresh the `link` row and return success. (Critical for repeated season-pack events and for reconciliation-triggered re-processing.)
- If `Q` is a symlink pointing somewhere *else* → flag `WRONG_TARGET`, do not silently overwrite; require explicit manual resolution.

**Copy mode (default):**
1. Pause torrent `h`; wait `pause_settle_ms`.
2. `Q` should currently be a real file (the QBT-land original). Rename `Q` → `Q.bak`.
3. Create symlink `Q` → `P`.
4. **Verify:** `lstat(Q)` is a symlink and `readlink(Q) == P`. If not, abort to rollback.
5. Delete `Q.bak`.
6. Record `link` (`swap_status = linked`, `swap_mode = copy`); log `info`.

**Move mode (opt-in):**
1. Pause torrent `h`; wait `pause_settle_ms`.
2. `Q` should currently be empty (Sonarr moved the file to `P`). Create symlink `Q` → `P`.
3. **Verify** as above. On failure → rollback.
4. Record `link` (`swap_mode = move`); log `info`.

**Rollback (on any failure):**
- Copy mode: if `Q.bak` exists and `Q` is not the intended symlink, remove a partial `Q` if present and rename `Q.bak` → `Q`. Mark `link` `reverted`. Resume torrent `h`. Log `error` with full detail.
- Move mode: remove a partial symlink `Q` if present. The real file is at `P` (Sonarr moved it); the torrent now lacks its file and **will fail recheck** — flag `critical`, leave paused, surface prominently. (This asymmetry is the safety cost of Move mode and the reason Copy is default.)

**Post-condition on success:** torrent remains **paused** (the recheck stage will resume it). Only a *failed* swap resumes the torrent immediately.

### 9.2 Import — season pack (the debounce path)

1–6. As §9.1 steps 1–6, performing the swap for the imported episode immediately.
7. Determine season-pack status (§9.2.1). If a pack:
   - increment `imports_seen` for `h` in the coordinator;
   - register or **reset** a debounce timer of `debounce_ms` (default to be chosen, see §15) for `h`;
   - the recheck fires when **either** completion condition is met:
     - **(C1, primary)** `imports_seen == video_file_count` — every real video file in the torrent has been imported; **or**
     - **(C2, fallback)** the debounce timer expires with no new import — a safety net against a missed webhook; **or**
     - **(C3, optional confirmation)** a Sonarr API query (§9.2.2) reports zero remaining monitored, aired, file-less episodes for the season.
8. On the chosen trigger, hand `h` to the **Recheck Worker** once.

#### 9.2.1 Season-pack and sample detection

From the torrent's file list, take video-extension files $\mathcal{F}_{\text{video}}$ (configurable extension set $\mathcal{V}$: `.mkv .mp4 .avi .m4v .ts ...`). Let $\tilde{s}$ be the **median** size of $\mathcal{F}_{\text{video}}$. Keep only files clearing a fraction of the median:

$$\mathcal{F}_c = \{\, f \in \mathcal{F}_{\text{video}} : s_f \ge \theta\,\tilde{s} \,\}, \qquad \theta \approx 0.6$$

Then $\text{video\_file\_count} = |\mathcal{F}_c|$ and the torrent is a season pack iff $|\mathcal{F}_c| > 1$. A small sample file (e.g. 30 MB beside 1.4 GB episodes, $\approx 2\%$ of the median) is excluded cleanly, while two legitimately different-sized episodes both survive. The median anchor is robust because a single outlier cannot skew it; $\theta$ stays tunable.

> If there is **no** corresponding season-pack structure — i.e. the torrent has only one real video file — the pack path simply does not apply and the single-file path (§9.1) is used. There is no guessing.

#### 9.2.2 Optional Sonarr completion confirmation (C3)

`GET /api/v3/episode?seriesId={id}&seasonNumber={n}`, then count episodes where `monitored == true AND hasFile == false AND airDateUtc < now`. Zero ⇒ season complete. This is belt-and-suspenders alongside C1/C2 and can be disabled.

### 9.3 Recheck — adaptive progress polling

QBT exposes `progress` $\in [0,1]$ while a torrent is in a checking state. We poll adaptively to converge on completion without hammering the API.

Let $T_{\min} = 10\,\text{s}$ be the floor. Let $(t_i, p_i)$ be timestamp and progress at poll $i$, with $(t_0, p_0)$ the first post-trigger reading.

**Phase 1 — calibration:**
1. Trigger recheck on `h`; mark `torrents.recheck_status = running`.
2. Sleep $T_{\min}$; poll → $(t_0, p_0)$.
3. Sleep $T_{\min}$; poll → $(t_1, p_1)$.

**Phase 2 — adaptive loop** (at each poll $i \ge 1$):

Rolling rate, anchored at the first reading for stability:

$$\hat{r} = \frac{p_i - p_0}{t_i - t_0}$$

Projected completion time and next sleep:

$$\hat{\tau}_{\text{done}} = t_i + \frac{1 - p_i}{\hat{r}}, \qquad \Delta t = \max\!\left(T_{\min},\ \frac{\hat{\tau}_{\text{done}} - t_i}{2}\right)$$

Sleep $\Delta t$; poll; recompute. Terminate when $p_i = 1.0$ or the torrent leaves the checking state.

**Guards:**
- If $\hat{r} \le 0$ (progress stalled or regressed — QBT occasionally reports this), skip the rate update and reuse the previous estimate.
- Hard ceiling `recheck_timeout_ms` (default 3 h): on exceed, log `error`, set `recheck_status = failed`, leave the torrent paused.

**On completion:**
- If healthy (progress $= 1.0$ and no error state), **resume** the torrent; set `recheck_status = passed`; log `info`.
- Else set `recheck_status = failed`; leave paused; flag prominently; log `error`.

This yields roughly logarithmic convergence: for a large multi-episode torrent the first sleep might be minutes, the last few $\sim 10\,\text{s}$.

### 9.4 Upgrade — the pause-old-torrent fence

When `isUpgrade` is true, the **old** torrent seeds through the symlink and holds the **Plex-land real file** open. Sonarr must overwrite that file. Therefore, *before* the new swap:

1. Identify the file being replaced and its torrent:
   - Sonarr: from `series.id` + episode IDs, query the current episode file(s) and their path(s); find the QBT torrent owning that path (path-search, since the *old* torrent's hash is not in the new event).
   - Radarr: from `movie.id`, get the current `movieFile.path`; find its torrent.
2. **Pause the old torrent**; wait `pause_settle_ms`. Record its hash for later resume.
3. Proceed with the normal swap for the new file (§9.1.1). The new file's QBT-land path differs from the old one's (different torrent), so there is no collision.
4. After the new swap and recheck, **resume the old torrent** (it continues seeding through its now-replaced symlink target — note: if the upgrade replaced the very file the old torrent points at, the old torrent's content has changed and *it too* may need a recheck; see Open Questions).

> This fence is **orthogonal to Copy/Move**: Move changes how the *new* file lands; the lock problem concerns the *old* file/torrent and persists in both modes. The existing logic is preserved.

> **Frequency:** upgrades are not uncommon for TV and fairly frequent for movies, so this path must be correct, not merely best-effort.

### 9.5 Health check

Per `link`, performed on a schedule (`node-cron`, default every 30 min) and on demand:

- **(a) Symlink validity:** `lstat(qbt_path)` exists and is a symlink.
- **(b) Target validity:** `readlink` resolves; target exists; target is a *regular file* (not a symlink → catches symlink→symlink); target is readable; `readlink == plex_path`.
- **(c) QBT health:** torrent `hash` still present in QBT; record state and progress. (QBT should never delete on its own; a missing torrent is an anomaly to surface, not to act on.)
- **(d) Integrity (Phase 4):** recompute the sparse Merkle root and compare to stored (§12).

Each run writes a `health_checks` row, updates `links.current_health` and `links.last_health_check_id`, and emits an event on any transition to a non-healthy state. The scheduled run iterates all `links`; the on-demand run targets a single link, a torrent's links, or a filtered set. Progress is surfaced (per the "always show it's working" principle) for full sweeps.

### 9.6 Reconciliation (startup + on user request)

Builds/refreshes the database by correlating the three sources. This is **not** a recursive walk of 120 TB — it only stats paths the APIs return.

1. **Inventory from *arr:**
   - Sonarr: `GET /api/v3/episodefile` (paginated) → `{path, seriesId, seasonNumber, episodeIds[], id}`.
   - Radarr: `GET /api/v3/moviefile` → `{path, movieId, id}`.
   This is the universe of files that *should* exist (the Plex-land set).
2. **Build the QBT path map** in a single pass over all torrents and their files:
   $$\text{qbtMap} : \text{normalisePath}(\text{join}(save\_path, file.name)) \rightarrow \{\text{hash}, \text{file}\}$$
   so subsequent lookups are $O(1)$ rather than $O(\text{torrents} \times \text{files})$.
3. **Stat each *arr Plex-land path** with `lstat`, and **classify** (see §11.1 enum). Cross-reference against `qbtMap` to find the owning torrent (via the symlink relationship: a QBT-land symlink whose target equals this Plex-land path).
4. **Stat each QBT-land path** from `qbtMap` with `lstat`; classify (real file vs symlink vs missing; symlink target sanity).
5. **Upsert** `torrents` and `links`, computing `current_health` from the classification. Anything where the owning torrent cannot be found is flagged immediately.
6. **Identify batch candidates:** QBT torrents present with real files on disk but no corresponding `link` (i.e. unprocessed), and *arr files that are real files with no symlink yet.
7. Emit a reconciliation summary event with counts per classification; surface in the UI.

The closed loop, in the user's own framing: walk QBT torrents → list their files → check which are symlinks and where they point; pull the *arr file inventories → find those files on disk; the intersection and its discrepancies are the truth.

### 9.7 Manual trigger and batch

**Single trigger UI:** a filtered combobox of QBT torrents (title + size, loaded on open), a second combobox of best-matching *arr entries (pre-selected to the top fuzzy match, editable), and a **▶ / Go** action.

**Matching pipeline** (backend, on torrent selection):
1. Strip the torrent title: remove quality/source tokens (`2160p 1080p 720p BluRay WEB-DL WEBRip HDTV REMUX HEVC x264 x265 H.264 H.265 HDR DV DDP Atmos ...`), the release-group suffix (after the final `-`), convert dots to spaces.
2. Extract a year if present (disambiguation).
3. Detect `S\d+` / `Season \d+` → route to Sonarr; absence → try Radarr first.
4. Fuzzy-match the cleaned title against Sonarr series / Radarr movie titles (`fuse.js`).
5. Return ranked candidates with confidence scores.

**Confidence is surfaced:** low-confidence matches get a visual warning so the user eyeballs them.

**Batch page:** the reconciliation "unprocessed" set rendered as a multi-select table — torrent title, size, best-guess *arr entry + confidence, status. "Process selected" runs the swap pipeline for each. This *is* the onboarding flow (no separate onboarding page); it remains useful permanently for catching anything missed.

A manually triggered swap follows the **same** Swap Worker and (for packs) coordinator/recheck path as a webhook-driven one.

---

## 10. Frontend

**Stack:** React + Vite + Tailwind; **Radix Primitives** for accessible chrome (Combobox/Select, Dialog, Tooltip, Tabs, ScrollArea, Toast, DropdownMenu, Checkbox for batch selection). Built to `client/dist/`, served by Express. Function-first; a single stylesheet is sufficient to start.

### 10.1 Views

| View | Purpose | Key elements |
|---|---|---|
| **Dashboard** | At-a-glance system state | Summary cards: total links, healthy, by-anomaly counts, torrents managed, last reconciliation time, last health sweep, recheck queue depth. |
| **Links table** | The working list | Sortable/filterable table; status + source badges per row; quick actions (recheck, health-check, view detail). Filter by anomaly type. |
| **Link detail** | Forensics for one link | Full `events` timeline for the link/torrent; symlink vs target paths; QBT state; integrity status; manual recheck / re-health / re-swap buttons. |
| **Torrent detail** | Torrent-level view | All links under a torrent; torrent state; recheck history; pause/resume (manual, guarded). |
| **Manual trigger** | Process a missed item | The dual-combobox + ▶ flow (§9.7). |
| **Batch** | Bulk processing / onboarding | Multi-select table of unprocessed candidates with confidence badges; "process selected". |
| **Live log** | Real-time feed | WebSocket stream of `events`; filter by level/source; invaluable while a season pack processes. |
| **Settings** | Runtime config | Edit the `settings` subset (debounce, thresholds, schedules, import mode). Secrets stay in files. |
| **Topology (Phase 5)** | The node graph | See §10.2. |

### 10.2 The node-graph view (deferred, Phase 5)

A four-column, position-constrained node network on a **single tall page** (the user's simplification — columns need not scroll independently, which removes the hardest engineering):

1. **Arr column** — Sonarr + Radarr entries, colour-coded by source (mixable or separated, sortable).
2. **Library files** — the real Plex-land files within library folders only.
3. **Torrents folder** — the QBT-land entries (mix of symlinks and real files).
4. **QBT torrents** — the torrent objects.

**Connectors:** an absolutely-positioned SVG overlay spanning the page draws cubic-bézier "ropes" between linked nodes — arr↔library (by `arr.path == plex_path`), library↔symlink (by `readlink == plex_path`), symlink↔torrent (by `qbt_path == join(save_path, file.name)`). A fully linked chain (all three ropes present) recolours; broken/anomalous links are highlighted. Redraw on resize/layout via `getBoundingClientRect()` per node ID.

**Scope is a filtered working set (≈5–50 items), not the whole library.** This is essential: it keeps the SVG performant *and* keeps the view legible (thousands of nodes and ropes would be both slow and meaningless), and it removes the need for virtualisation entirely. The view is **pure read** — it mutates nothing, touches no filesystem — so it cannot destabilise the core system regardless of how it is built, and it can be deferred indefinitely. Common lenses: "everything broken", "this one show's full chain", "batch candidates".

---

## 11. Health Classification

### 11.1 Anomaly enum (used by health checks, reconciliation, and UI badges)

| Value | Meaning | Typical cause |
|---|---|---|
| `healthy` | All checks pass | Normal. |
| `unprocessed` | Real file at QBT-land path, in *arr DB, no symlink yet | Awaiting swap; batch candidate. |
| `orphan_symlink` | Symlink exists, target missing | Plex-land file deleted/moved. |
| `double_symlink` | Symlink target is itself a symlink | The historical disaster; must never be created, must be detected. |
| `wrong_target` | Symlink target ≠ expected `plex_path` | Mis-link; never auto-overwritten. |
| `missing_real_file` | *arr expects a file that is not on disk | Serious; possible data loss. |
| `no_torrent` | Link/file present but no QBT torrent owns it | Torrent removed from QBT. |
| `torrent_no_file` | QBT torrent present but its file missing on disk | Deleted out from under QBT. |
| `unmanaged_torrent` | QBT torrent not linked to any *arr file | Non-media, or pre-import, or manual add. |
| `recheck_failed` | Last recheck did not pass | Corruption / partial content. |
| `integrity_fail` | Sparse Merkle mismatch (Phase 4) | Silent corruption / replacement. |
| `swap_failed` | Swap operation errored | See event detail. |

The UI colours rows by this enum; the dashboard counts by it.

---

## 12. Integrity Subsystem — Sparse Reverse Merkle (Phase 4, optional)

A fast, sampling-based fingerprint to detect corruption, truncation, or silent replacement of a link's target beyond mere existence. Built on **XXH3** (non-cryptographic, multi-GB/s, ample collision resistance for an accidental-corruption threat model).

### 12.1 The sampling scheme

Anchored at end-of-file (EOF) and walking toward the start. Parameters: sample window $w = 32\ \text{MiB}$ and ratio $1:r$ (so a sampled window is followed by a skipped gap of $(r-1)w$; $r = 4 \Rightarrow$ 96 MiB skip, $r = 8 \Rightarrow$ 224 MiB skip). Let $L$ be the file size and stride $S = r\,w$.

Sample $k$ (for $k = 0, 1, \dots$) covers the byte range

$$\big[\,\max(0,\ L - kS - w),\ \ L - kS\,\big),$$

so $k = 0$ is the trailing $w$ bytes $[L-w, L)$, $k=1$ is $[L - S - w,\ L - S)$, and so on, with the final sample clamped at the start of the file. The number of leaves is $n = \lceil L / S \rceil$.

**Merkle construction:** leaf $h_k = \mathrm{XXH3}(\text{bytes of sample } k)$; internal nodes combine children as $H(\text{left} \,\|\, \text{right})$ over concatenated child digests; an unpaired node is promoted unchanged. The root is the file fingerprint. Storing the full node list (`tree_json`) allows **localising** a change to a subtree ("the trailing quarter differs") rather than only "something differs".

### 12.2 Honest assessment of what this does and does not buy

This is the part where I want to be straight rather than sell the idea, per your preference for flagged uncertainty.

- **Sparse sampling is not complete.** At $1:4$ only $25\%$ of the file is read; at $1:8$, $12.5\%$. Consequently a localised single-bit flip that lands in a *skipped* region is **invisible** — roughly $75\%$ (or $87.5\%$) of isolated corruptions are missed. This is a fast heuristic, **not** a substitute for a full hash when you need to catch arbitrary corruption.
- **It is strong on truncation and large-region damage.** With EOF anchoring, truncating the file shifts every sampled offset relative to the original content, so essentially all leaves change — truncation (a very common real failure for partially-downloaded/overwritten torrent files) is detected emphatically. A file-size check alone (`file_size_at_hash`) catches truncation/append even faster, as a cheap pre-test.
- **The bit-insertion robustness claim needs a caveat.** Fixed-offset sampling — anchored at EOF *or* BOF — is **not** robust to insertion or deletion in general: an insert shifts all subsequent bytes, so every sample window past the insertion point captures different bytes and its leaf changes. EOF anchoring specifically buys robustness for the *trailing* leaves against growth at the *front* (and vice-versa for BOF anchoring), which is a real but narrow property. **True insertion/deletion robustness requires content-defined chunking** — boundaries chosen by a rolling hash (Rabin fingerprint), as used by rsync, restic, and borg — so that an insertion only disturbs the one chunk containing it. That is the technique to reach for if insertion-robustness is the actual goal; it costs more CPU (every byte participates in the rolling hash). It is worth prototyping as an alternative leaf-boundary strategy behind the same `file_hashes` interface, but it should not be conflated with the fast sparse scheme.
- **Cost is non-trivial on spinning disks.** At $1:4$, a 50 GB file means ~12.5 GB of sequential read; on a DrivePool array at ~150 MB/s that is ~83 s. Integrity hashing must therefore be opt-in, scheduled (or on-demand per file), throttled, and progress-reported — never run inline on the import hot path.

**Verdict:** valuable as a fast change/truncation detector and a neat, localising structure; explicitly not a cryptographic or completeness guarantee. Ship it as opt-in with the size pre-test, and keep content-defined chunking on the bench as the insertion-robust variant.

---

## 13. Safety Invariants

These are hard rules, derived directly from the historical failures. They apply everywhere and override convenience.

1. **Never delete real media or torrents autonomously.** The only file Lariat removes is a `.bak` it created itself, only after the replacement symlink is verified by `lstat` + `readlink`.
2. **Always pause the relevant torrent(s) before any filesystem mutation** on a path QBT could touch, with a configurable settle delay. A recheck is required afterward regardless, so the pause is nearly free.
3. **Verify before trusting.** After creating a symlink, confirm via `lstat` that it is a symlink and `readlink` equals the intended target *before* deleting any `.bak` and *before* recording success.
4. **Never create a symlink whose target is missing or is itself a symlink.** Pre-flight guards reject these, preventing the orphan-symlink and double-symlink disasters at the source.
5. **Never silently overwrite a differing symlink.** A `wrong_target` is flagged for manual resolution, not auto-corrected.
6. **Idempotency.** A swap requested for an already-correct link is a no-op. Re-processing (from repeated events or reconciliation) must be safe.
7. **Resume only after a passing recheck.** A torrent is resumed post-swap only when recheck reports healthy; a failed recheck leaves it paused and flagged.
8. **Roll back on partial failure.** Copy mode restores from `.bak`; Move mode removes a partial symlink and flags `critical` (the torrent will lack its file — the documented cost of Move).
9. **Reconciliation and health checks are read-only with respect to media and torrents.** They classify and record; they do not mutate. Remediation is an explicit, separate, user-initiated action.

---

## 14. Configuration and Secrets

- **Secrets** (QBT credentials, *arr API keys) in `.env`, never committed. Mirrors the current script's approach.
- **Static config** in `config.yaml` (or `config.json`): hosts/ports/URLs, paths, log file location, video extension set, thresholds ($\theta$, $w$, $r$), timeouts, schedules, `import_mode: copy|move`, debounce window.
- **Runtime-adjustable subset** mirrored into the `settings` table and editable from the UI; on conflict, the UI/`settings` value wins for the runtime-adjustable keys, with file values as defaults/bootstrap.
- All paths handled in a Windows-aware, case-insensitive, normalised manner via a single path-normalisation helper used everywhere (so `X:\Foo\bar.mkv` and `x:/foo/Bar.mkv` compare equal).

---

## 15. Open Questions (resolve before / during build)

1. **Webhook payload fidelity.** Do the live Sonarr/Radarr webhook payloads include `downloadId` and a usable Plex-land `path` on import *and* upgrade, in your versions? Action: capture one real payload of each type and commit as fixtures; confirm before relying on D2/D3. If `downloadId` is ever empty, the path-search fallback must cover it.
2. **Debounce window default.** What `debounce_ms` is right for your largest season packs given C1 (import-count) is primary and C2 (timer) is only a fallback? A few minutes is a reasonable starting fallback; should it be per-source configurable?
3. **Upgrade + old-torrent recheck.** When an upgrade replaces the exact file the *old* torrent points at, the old torrent's content has changed; does it need its own recheck (and possible re-link) rather than a plain resume? This is the subtlest part of the upgrade flow and warrants empirical testing before the redesign is trusted.
4. **Copy vs Move, finally.** Given the transient-only nature of the double copy and DrivePool's uncertain move semantics, is Move worth enabling at all, or should it remain a tested-but-dormant flag? (Default: dormant.)
5. **xxhash binding (Phase 4).** Native `xxhash-addon` (fast, needs Windows build tools) vs WASM `hash-wasm` (no build step, slightly slower)? Leaning `hash-wasm` to avoid native-build friction on Windows; confirm when Phase 4 starts.
6. **Recheck "healthy" definition.** Is `progress == 1.0` plus absence of an error state sufficient, or do you want to additionally assert a specific QBT state (e.g. not `missingFiles`, not `error`) before resuming?
7. **Windows service wrapping.** `node-windows` vs NSSM for boot-start without a console window — decide at hardening (Phase 6); not needed for development.
8. **Event retention.** Keep all events forever (simplest, fine at this scale) or prune beyond N days? Default: keep all; revisit if the DB grows unexpectedly.
9. **ORM vs raw SQL.** Default is raw `better-sqlite3` with thin repository functions (simplest, transparent). Flagging only: a light query layer (e.g. Drizzle) is an option if agent-driven development would benefit — but it adds abstraction we have not yet justified, so it is *not* assumed.

---

## 16. Phasing (summary — full task breakdown in `IMPLEMENTATION_PLAN.md`)

| Phase | Theme | Delivers |
|---|---|---|
| **0** | Foundations | Scaffold, config, secrets, SQLite schema + migrations, logging, QBT + *arr clients, boot connectivity check. |
| **1** | Core pipeline (the value) | Webhook ingestion + adapters, Swap Worker (copy mode), Completion Coordinator (debounce), Recheck Worker (adaptive), event logging, minimal REST. |
| **2** | Reconciliation + health | Reconciliation worker, Health worker (cron + on-demand), anomaly classification, batch-candidate detection. |
| **3** | Frontend core | Dashboard, links/torrent tables + detail, manual trigger, batch page, WebSocket live log, settings. |
| **4** | Integrity | Sparse reverse-Merkle module (+ size pre-test), hash storage, integrity health check; content-defined-chunking variant on the bench. |
| **5** | Topology view | The four-column node graph over a filtered working set (pure read). |
| **6** | Hardening / ops | Move-mode enablement after testing, upgrade-flow robustness, Windows service wrapper, notifications (future). |

Phases 0→1 deliver the core robustness that justifies the project; everything after is additive and independently deferrable.
