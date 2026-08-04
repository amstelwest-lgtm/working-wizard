---
name: GitHub push playbook
description: How to push this Replit project to GitHub when git push fails — covers pack corruption root cause, auth, and the API fallback.
---

# GitHub Push Playbook

**Repo:** `amstelwest-lgtm/working-wizard` (public)
**Token secret:** `GITHUB_PERSONAL_ACCESS_TOKEN` (classic token, `repo` scope)
**⚠ Fine-grained PATs (`github_pat_...`) do NOT work** — even with Contents write permission, the low-level git blobs API returns 404. Always use a **classic PAT (`ghp_...`)** with the `repo` scope ticked. Tokens with no scopes (`x-oauth-scopes: ` empty) can read public repos but fail all write operations with 404.

---

## Root cause of all past pack corruption — RESOLVED

Two large zip archives (`ziQy6NpE` 86 MB, `ziXdDCjj` 40 MB) were accidentally committed to the repo. They were the "missing delta base" object that caused every `git push` to fail with `remote: fatal: did not receive expected object`. They have been removed from git tracking (`git rm --cached`) and added to `.gitignore`. As of the commit `ae74254`, standard `git push` should work without pack errors.

**If pack corruption reappears:** run `git ls-files | xargs ls -lh | sort -k5 -rh | head -20` to find any new large accidentally-tracked files and remove them before pushing.

---

## Attempt order (fastest to most reliable)

### 1. Plain push with token in URL (try first — should now work reliably)
```bash
git --no-optional-locks push "https://amstelwest-lgtm:${GITHUB_PERSONAL_ACCESS_TOKEN}@github.com/amstelwest-lgtm/working-wizard.git" main --force
```
Blocked operations: `remote set-url` and `git fetch` are forbidden. This direct-URL form IS allowed.

### 2. User runs repack + push in Shell (if step 1 fails)
Have user open Shell tab and run:
```bash
git repack -a -d && git push --no-thin "https://amstelwest-lgtm:${GITHUB_PERSONAL_ACCESS_TOKEN}@github.com/amstelwest-lgtm/working-wizard.git" main --force
```
Repack must run immediately before push (no gap) to prevent Replit checkpoints writing new thin packs between the two commands.

### 3. GitHub API upload — THE RELIABLE FALLBACK
When all git-based pushes fail, bypass git entirely using the GitHub API via Node.js. Loses git history but pushes current state perfectly.

**Two-pass approach (rate limiting makes a single pass fragile for >150 files):**

**Pass A — Upload first batch, create initial commit:**
```javascript
// node --input-type=commonjs script
// 1. GET /repos/{owner}/{repo}/git/refs/heads/main  → get parent SHA
// 2. git ls-files to get all tracked files
// 3. POST /repos/{owner}/{repo}/git/blobs for each file (batches of 5, 200ms delay)
// 4. POST /repos/{owner}/{repo}/git/trees with all blob SHAs
// 5. POST /repos/{owner}/{repo}/git/commits (parent = current HEAD)
// 6. PATCH /repos/{owner}/{repo}/git/refs/heads/main (force: true)
```

**Pass B — Upload any files missed due to rate limiting:**
```javascript
// 1. GET existing tree from GitHub (recursive=1) to find what's already there
// 2. Diff local git ls-files vs existing → missing files list
// 3. Upload missing files ONE AT A TIME, 400ms delay, 4 retries with 3s×attempt backoff on 403
// 4. Create new tree = existing blobs + new blobs (full replacement, no base_tree)
// 5. Create commit with parent = last commit SHA
// 6. Force-update ref
```

**Key gotchas:**
- Empty repos return 409 on blob API until bootstrapped with a Contents API PUT first
- GitHub secondary rate limit (403) triggers if >5 concurrent blob requests — use batches of 5 with 200-400ms delay in Pass A; serial with 400ms delay in Pass B
- Files >100 MB are rejected with HTTP 422 — check for large tracked files first (see root cause note above)
- Use `node --input-type=commonjs` to avoid ESM/CJS ambiguity when piping into node via stdin
- Pass B's tree must include ALL files (existing + new), not just the delta — GitHub trees are snapshots, not patches

**Why this works:** The GitHub API creates blobs and trees from raw file content, completely bypassing the git pack layer, so corrupt local objects are irrelevant.

---

## If GitHub repo needs to be recreated
1. Delete at `github.com/{owner}/{repo}` → Settings → Danger Zone → Delete
2. Create new at `github.com/new` — same name, **NO README/gitignore/license** (must be empty)
3. Run Pass A above
