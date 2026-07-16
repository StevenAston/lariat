# Enabling Move Mode in Lariat

By default, Lariat operates in **Copy mode**. This means:
1. Sonarr/Radarr *copy* the completed file into your Plex library.
2. Two identical files exist temporarily.
3. Lariat renames the original (QBT) file to `.bak`, creates a symlink pointing to the Plex file, verifies it, and deletes the `.bak`.

This is the safest path, because if anything fails, Lariat restores the `.bak` and nothing is lost.

**Move mode** avoids the temporary copy. 
1. Sonarr/Radarr *move* the completed file into your Plex library (leaving the QBT path empty).
2. Lariat immediately creates a symlink at the QBT path pointing to the Plex file.

Move mode is more efficient, but has higher stakes. If something goes wrong, QBT will be missing its file, and Lariat cannot automatically roll back because it doesn't have a `.bak` (Sonarr moved the original).

## The Checklist

Before changing `SWAP_MODE=move` in your `.env`, verify the following in your environment (especially if using **DrivePool**):

- [ ] **Cross-Disk Move Behavior:** When Sonarr/Radarr moves a file within DrivePool, does the underlying path change instantly, or does it trigger a slow copy? (If it triggers a slow copy that fails or locks, Move mode might leave QBT in a broken state if the webhook fires prematurely).
- [ ] **Symlink Permissions:** Ensure you are running Lariat as Administrator or have Developer Mode enabled in Windows. Symlink creation *must* not fail, because there is no `.bak` to roll back to.
- [ ] **Run the Test Harness:** Run the `npm run test:move` harness (which uses `server/src/scripts/move-harness.ts`) on a small test torrent first.

## How to Test

1. Create a dummy torrent or download a small disposable file (e.g. an Ubuntu ISO) into your QBT save path.
2. Note the hash of the torrent.
3. Run the harness:
   ```bash
   npx tsx src/scripts/move-harness.ts <torrent_hash> "C:\path\to\plex\library\ubuntu.iso"
   ```
4. Check that QBT successfully resumes the torrent and it seeds through the newly created symlink.
5. Once verified, you can update your `.env` with `SWAP_MODE=move` and restart Lariat.
