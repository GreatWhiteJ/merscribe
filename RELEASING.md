# Releasing

MerScribe releases are built and published automatically by
[`.github/workflows/release.yml`](.github/workflows/release.yml) when you push a
version tag. A matrix builds on Windows, macOS, and Linux runners and uploads the
installers to the matching GitHub Release.

## Cut a release

```bash
# 1. Bump the version
npm version patch        # or: minor / major  (updates package.json + creates a tag)

# 2. Push the commit and the tag
git push origin master --follow-tags
```

Pushing the `v*` tag triggers the workflow, which produces:

| Platform | Artifact |
|----------|----------|
| Windows  | `MerScribe-<v>-setup.exe` (NSIS installer) |
| macOS    | `MerScribe-<v>-arm64.dmg` (Apple Silicon), `MerScribe-<v>-x64.dmg` (Intel) |
| Linux    | `MerScribe-<v>-x86_64.AppImage` |

> For quick **local** smoke-testing (no admin, no signing) there's still
> `pnpm dist` → an unpacked app + zip under `dist/`. That's a dev convenience,
> not a distributed artifact — releases ship the installer above.

## Code signing

Builds are **unsigned** until you add the secrets below (repo → Settings →
Secrets and variables → Actions). Unsigned apps still run — users click through a
one-time OS warning (Windows SmartScreen "Run anyway" / macOS right-click → Open).

### Windows (Authenticode)
Obtain an OV or EV code-signing certificate as a `.pfx`, then:

```bash
base64 -w0 cert.pfx > cert.txt   # the contents go into WIN_CSC_LINK
```

| Secret | Value |
|--------|-------|
| `WIN_CSC_LINK` | base64 of the `.pfx` |
| `WIN_CSC_KEY_PASSWORD` | the `.pfx` password |

(An **EV** certificate clears SmartScreen immediately; an OV cert builds reputation over time.)

### macOS (Developer ID + notarization)
Export your *Developer ID Application* certificate as a `.p12`, base64 it, then:

| Secret | Value |
|--------|-------|
| `MAC_CSC_LINK` | base64 of the `.p12` |
| `MAC_CSC_KEY_PASSWORD` | the `.p12` password |
| `APPLE_ID` | your Apple ID email |
| `APPLE_APP_SPECIFIC_PASSWORD` | an app-specific password for that Apple ID |
| `APPLE_TEAM_ID` | your Apple Developer Team ID |

With these set, the workflow signs **and notarizes** the macOS build automatically.

### Linux
AppImages don't require signing.
