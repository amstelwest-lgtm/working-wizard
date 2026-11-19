# Milōn desktop folder-sync agent (PR G)

Upload-only watcher for partner-named folders. macOS and Windows. **Not** bundled with the web app or root `pnpm build`.

## Packaging choice

**Shipped here:** small **Node 22 CLI** with `chokidar` and OS keychain via optional `keytar`. Lowest cross-platform cost for PR G; fits unsigned dev builds.

**Next step for tray UX:** wrap the same `src/agent.ts` core in **Tauri 2** (smaller binary than Electron, native Keychain / Credential Manager). Electron remains an option if you need mature tray icons on older Windows without Rust tooling.

**Out of scope for this PR:** code signing, notarization, auto-update, or store distribution.

### Signing / distribution (when you ship binaries)

| Platform | Needs |
| --- | --- |
| macOS | Apple Developer ID Application cert, `notarytool`, `APPLE_ID`, `APPLE_APP_SPECIFIC_PASSWORD`, `APPLE_TEAM_ID` |
| Windows | Authenticode cert (EV recommended), `SIGNTOOL` or vendor CLI |

Env names only — never commit values: `APPLE_*`, `WINDOWS_SIGNING_CERT`, `WINDOWS_SIGNING_PASSWORD`.

## Install (dev, unsigned)

```bash
cd desktop-sync
pnpm install
pnpm run dev -- --help
```

Pair from **Settings → Desktop folder sync** in the web app (Ben test firm only until allowlist grows).

## Commands

```bash
# Pair once; tokens go to OS keychain (or `~/.milon-desktop-sync/token` if keytar missing)
pnpm run dev -- pair --api https://YOUR_DEPLOY --code XXXX-XXXX --folders "/path/to/VAT 2026=folder-label"

# Watch (uses saved token + folder map)
pnpm run dev -- watch

# Disconnect locally after server revoke
pnpm run dev -- disconnect

# Uninstall local state + keychain
pnpm run dev -- uninstall
```

## Behaviour

- Watches **only** folders you pass at pair time (no home disk, no drive root).
- Allow-list: pdf, csv, xlsx, xls, png, jpg/jpeg. Max size 20 MiB (same as source docs).
- Skips hidden, system, secret-pattern paths (see `src/filter.ts`).
- **Never** writes, moves, renames, or deletes local files.
- Sends **folder label** only; dedupes on SHA-256 before upload.
- On revoke / firm off: uploads fail with `revoked` and the agent shows **Disconnected**.

## Build unsigned artifact

```bash
pnpm run package:unsigned
```

Produces `dist/` JavaScript plus a `milon-desktop-sync-unsigned.zip` manifest for internal QA.