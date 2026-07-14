---
name: wp-plugin-updater
description: Update one or more WordPress plugin repos from release zips — wipe each tree (keep .git + composer.json), extract, commit, tag with the version, push.
disable-model-invocation: true
---

Update vendored WordPress plugin repos from fresh release zips. Handles a single repo or a
batch, and local checkouts or remote URLs. Destructive: it wipes each repo's working tree.

## Targets

Resolve the argument into a list of `(repo, zip)` targets:

- **A lone zip path** → one target: the current dir + that zip.
- **Lines of `<repo>  <zip>`** (repo = local path *or* git/https clone URL) → one target per line.
- Nothing usable → ask.

For each target, get a working dir:
- **Local path** → use it as-is. It must be a clean repo root (guard in step 2).
- **Clone URL** → `git clone "$URL" "$(mktemp -d)/repo"` and use that; it is disposable.

Run **Prepare** (steps 1–5) in every target's dir. Then **Confirm once** for the whole batch.
Then **Ship** every target.

## Prepare (per target)

1. **Zip.** Verify it exists and is valid: `unzip -t "$ZIP" >/dev/null`.
2. **Guard.** `cd` into the repo dir. Confirm it is the git root and clean:
   `git rev-parse --show-toplevel` equals it, and `git status --porcelain` is empty.
   If dirty, stop and report — do not wipe uncommitted work. (Fresh clones are always clean.)
3. **Wipe** everything except `.git` and `composer.json`:
   ```
   cp composer.json /tmp/wp-plugin-updater-composer.json
   find . -mindepth 1 -maxdepth 1 ! -name .git ! -name composer.json -exec rm -rf {} +
   ```
4. **Extract** into a temp dir, then copy into the repo root, stripping a single wrapping folder:
   ```
   TMP=$(mktemp -d); unzip -q "$ZIP" -d "$TMP"
   SRC="$TMP"; entries=$(ls -A "$TMP")
   [ "$(printf '%s\n' "$entries" | wc -l)" -eq 1 ] && [ -d "$TMP/$entries" ] && SRC="$TMP/$entries"
   cp -a "$SRC"/. .
   rm -rf "$TMP"
   cp /tmp/wp-plugin-updater-composer.json composer.json
   ```
5. **Version.** Detect from the plugin header:
   ```
   VERSION=$(grep -rhoP '^\s*\*\s*Version:\s*\K[0-9][0-9A-Za-z.\-]*' *.php | head -1)
   ```
   If empty, ask the user for the version. Abort this target if the tag exists:
   `git rev-parse -q --verify "refs/tags/$VERSION"`.

## Confirm (once)

Show a table of every target → detected `$VERSION` → `git status --short` line count.
Wait for the user to approve the whole batch.

## Ship (per target)

```
git add -A
git commit -m "Update to $VERSION"
git tag "$VERSION"
git push origin HEAD
git push origin "$VERSION"
```
