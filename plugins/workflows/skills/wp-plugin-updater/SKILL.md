---
name: wp-plugin-updater
description: Update a WordPress plugin repo from a new release zip — wipe the tree (keep .git + composer.json), extract, commit, tag with the version, push.
disable-model-invocation: true
---

Update a vendored WordPress plugin repo from a fresh release zip. Run from the repo root. Destructive: it wipes the working tree.

## Steps

1. **Zip.** Use the path given as the skill argument. If none was given, ask for it.
   Verify it exists and is valid: `unzip -t "$ZIP" >/dev/null`.
2. **Guard.** Confirm cwd is the repo root and the tree is clean:
   `git rev-parse --show-toplevel` equals cwd, and `git status --porcelain` is empty.
   If dirty, stop and report — do not wipe uncommitted work.
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
   If empty, ask the user for the version. Abort if the tag exists:
   `git rev-parse -q --verify "refs/tags/$VERSION"`.
6. **Confirm.** Show `$VERSION` and `git status --short`. Wait for the user to approve.
7. **Ship.**
   ```
   git add -A
   git commit -m "Update to $VERSION"
   git tag "$VERSION"
   git push origin HEAD
   git push origin "$VERSION"
   ```
