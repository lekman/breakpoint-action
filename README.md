# Breakpoint (EMU-compatible fork)

Fork of [namespacelabs/breakpoint-action](https://github.com/namespacelabs/breakpoint-action) with fixes for GitHub Enterprise Managed Users (EMU).

Pause, debug with SSH, and resume your GitHub Actions jobs with [namespacelabs/breakpoint](https://github.com/namespacelabs/breakpoint).

## Changes from upstream

### EMU account support

The upstream action passes GitHub usernames to the Go binary, which fetches SSH keys from `github.com/<username>.keys`. This endpoint returns 404 for EMU accounts (usernames containing underscores, e.g. `Jane-Doe_contoso`).

This fork fetches SSH keys via the GitHub REST API (`api.github.com/users/<username>/keys`) in the TypeScript wrapper, then passes the resolved public keys to the binary as `authorized_keys`. The API endpoint works for all account types including EMU.

### Auto-include workflow actor

New input `include-actor` (default: `true`). When enabled, the action reads `GITHUB_ACTOR` and adds that user's SSH keys automatically. Bot actors (usernames ending in `[bot]`) are skipped.

This means you can use the breakpoint without hardcoding usernames — whoever triggered the workflow (PR author, manual dispatch user) is authorized to SSH in.

## Usage

### Debug-only breakpoint (recommended)

Gate the breakpoint on debug mode so it never runs in normal CI:

```yaml
- name: Breakpoint
  if: runner.debug == '1'
  uses: lekman/breakpoint-action@v0
  with:
    duration: 30m
```

To trigger: re-run the failed job with **"Enable debug logging"** checked in the GitHub Actions UI. The action auto-includes the workflow actor — no `authorized-users` needed.

### Pause on failure

```yaml
- name: Breakpoint if tests failed
  if: failure()
  uses: lekman/breakpoint-action@v0
  with:
    duration: 30m
    authorized-users: jack123, alice321
```

### Pause at any step

```yaml
- name: Breakpoint to check build results
  uses: lekman/breakpoint-action@v0
  with:
    duration: 30m
    authorized-users: jack123, alice321
```

When Breakpoint activates, it outputs the SSH connection details:

```bash
┌───────────────────────────────────────────────────────────────────────────┐
│                                                                           │
│ Breakpoint running until 2023-05-24T16:06:48+02:00 (29 minutes from now). │
│                                                                           │
│ Connect with: ssh -p 40812 runner@rendezvous.namespace.so                 │
│                                                                           │
└───────────────────────────────────────────────────────────────────────────┘
```

### Run in the background

```yaml
- name: Start Breakpoint in the background
  uses: lekman/breakpoint-action@v0
  with:
    mode: background
    authorized-users: jack123, alice321
```

> [!NOTE]
> Breakpoint takes on the environment of the step it's launched in.
> Modifications to environment variables in later steps won't be reflected in the SSH session.

## Configuration

| Input | Default | Description |
|-------|---------|-------------|
| `duration` | `30m` | Initial breakpoint duration. Ignored in background mode. Format: `30s`, `2h5m`, etc. |
| `mode` | `pause` | `pause` blocks the workflow. `background` runs alongside other steps. |
| `authorized-users` | — | Comma-separated GitHub usernames. SSH keys fetched via API. |
| `include-actor` | `true` | Auto-include `GITHUB_ACTOR` as an authorized user. Bot actors (`[bot]`) are skipped. |
| `authorized-keys` | — | Comma-separated SSH public keys (bypass GitHub lookup). |
| `webhook-definition` | — | Path to a webhook JSON file with `url` and `payload` fields. |
| `slack-announce-channel` | — | Slack channel for breakpoint notifications. Requires `SLACK_BOT_TOKEN` env var. |
| `shell` | `/bin/bash` | Path to the login shell. |
| `endpoint` | `rendezvous.namespace.so:5000` | QUIC endpoint of the breakpoint rendezvous server. |

At least one of `authorized-users`, `authorized-keys`, or `include-actor` must result in SSH keys. The action fails if no keys are resolved.

## Prerequisites

Authorized users must have at least one **Authentication** SSH key on their GitHub profile (Settings > SSH and GPG keys). Signing-only keys are not returned by the API.
