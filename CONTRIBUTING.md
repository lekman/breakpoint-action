# Contributing

## Fork maintenance

This is a fork of [namespacelabs/breakpoint-action](https://github.com/namespacelabs/breakpoint-action). The Go binary (`breakpoint`) is unchanged — all modifications are in the TypeScript action wrapper.

### Syncing with upstream

```bash
git remote add upstream https://github.com/namespacelabs/breakpoint-action.git
git fetch upstream
git merge upstream/main
```

After merging, rebuild and test. Our changes are isolated to `main.ts` (key fetch logic, `include-actor`) and `action.yml` (new input). Conflicts are unlikely unless upstream changes `createConfiguration()`.

### Build and release

There is no CI. The `dist/` folder contains pre-built bundles committed to the repo. The pre-commit hook runs `npm run build && git add dist/*` automatically.

```bash
# Install dependencies
npm install

# Build (compiles main.ts and post.ts into dist/)
npm run build

# Commit (pre-commit hook rebuilds dist/ and stages it)
git add -A
git commit -m "feat: description"
```

### Tagging a release

Consumers pin to the major tag (`v0`). Releases use semver tags. The major tag is a floating pointer.

```bash
# Create a semver tag
git tag v0.2.0

# Move the major tag to the latest release
git tag -f v0
git push origin main --tags --force
```

### Testing

No automated tests. Test by referencing the fork in a workflow:

```yaml
- uses: lekman/breakpoint-action@main
  with:
    duration: 5m
```

Verify:
1. SSH keys are fetched via API (check action output for "Fetched N SSH key(s)")
2. EMU usernames (with underscores) resolve without 404
3. `include-actor` adds the workflow trigger user
4. Bot actors are skipped

### Key differences from upstream

| Area | Upstream | This fork |
|------|----------|-----------|
| SSH key fetch | Go binary calls `github.com/<user>.keys` | TypeScript fetches via `api.github.com/users/<user>/keys` |
| EMU support | Broken (404 on underscore usernames) | Works |
| Actor auto-include | Not supported | `include-actor` input (default: true) |
| Key passing | `authorized_github_users` in config | `authorized_keys` in config (pre-resolved) |
