# APEX Deployment Guide

Two deployment paths exist on separate branches. **Do not mix them.**

---

## Branch: `dev` — Direct SCP Deploy

**Model:** Build SEA binary, SCP it to a remote host's ~/bin. Users SSH in and run it directly. No Artifactory, no npm registry, no turnkey launcher.

### Build + Deploy

```bash
# One-shot: build everything + SCP to remote
npm run deploy

# Or step by step:
npm run build
npm run build:sea          # Docker builds linux/amd64 SEA binary → .bin/
npm run deploy:remote      # SCP to $QWEN_DEPLOY_HOST:~/bin/qwen
```

### What Gets Deployed

| Artifact                     | Destination                    | Method |
| ---------------------------- | ------------------------------ | ------ |
| `.bin/qwen-code-linux-amd64` | `$QWEN_DEPLOY_HOST:~/bin/qwen` | `scp`  |

### Config

- `QWEN_DEPLOY_HOST` env var controls the remote host (default: `curosr`)
- No turnkey launcher — users run the binary directly
- No npm package — not published to any registry
- No Artifactory uploads
- APEX.md / settings.json / skills are baked into the SEA binary and extracted at runtime to a temp dir, then deployed to `$QWEN_CODE_HOME` by `sea-launch.cjs`

### Dockerfile.sea Base Image

```dockerfile
FROM docker.repo.eng.netapp.com/node:22.15.0 AS builder
```

Requires VPN / corp network for the internal Docker registry.

---

## Branch: `feat/apex-embed-assets` — Turnkey + npm Distribution

**Model:** Build SEA binary, publish to Artifactory generic repo + npm registry. Users get either:

1. **Turnkey:** Download `ontap-apex` script → it auto-downloads the binary + MCP servers
2. **npm:** `npm install -g @netapp/seclab-apex` → postinstall downloads MCP servers

### Build

```bash
# SEA binary (requires Docker)
npm run build:sea

# npm tarball
npm run build && npm run bundle && npm run prepare:package
cd dist && npm pack
```

### Publish

```bash
# Upload SEA binary + launcher + npm tar to Artifactory
# (reads version from package.json, prompts for password once)
npm run publish:turnkey

# Publish to npm registry (--auth-type=legacy is baked in)
npm run publish:npm

# Both in one shot
npm run publish:all
```

### What Gets Deployed

| Artifact                                | Destination                                   | Method                |
| --------------------------------------- | --------------------------------------------- | --------------------- |
| `.bin/qwen-code-linux-amd64`            | Artifactory `apex/{version}/apex-linux-amd64` | `curl -u palanisd -T` |
| `.bin/ontap-apex`                       | Artifactory `apex/{version}/ontap-apex`       | `curl -u palanisd -T` |
| `dist/netapp-seclab-apex-{version}.tgz` | Artifactory `apex/{version}/`                 | `curl -u palanisd -T` |
| `@netapp/seclab-apex`                   | `npm.repo.eng.netapp.com`                     | `npm publish`         |

### Version Bump Checklist

When bumping version, update ALL of these:

1. `package.json` → `"version"` field
2. `.bin/ontap-apex` → `APEX_VERSION` default

The publish scripts read version from `package.json` automatically — no hardcoded URLs.

### Skills Deployment

Skills from `apex-assets/skills/` are deployed to `$QWEN_CODE_HOME/skills/` via:

- **SEA binary:** `sea-launch.cjs` → `deployApexAssets()` copies from embedded `apex/skills/` to config home
- **npm install:** `postinstall-apex.js` copies from `apex/skills/` in the package to `~/.apex/skills/`
- **Runtime bundled:** Also available at `dist/bundled/` for the SkillManager to load from the temp runtime dir

### Dockerfile.sea Base Image

Currently using public Docker Hub (for off-VPN builds):

```dockerfile
FROM node:22.15.0 AS builder
```

**Switch back to internal registry before pushing to internal CI:**

```dockerfile
FROM docker.repo.eng.netapp.com/node:22.15.0 AS builder
```

---

## Key Differences Summary

|                                     | `dev`              | `feat/apex-embed-assets`        |
| ----------------------------------- | ------------------ | ------------------------------- |
| Deploy method                       | SCP to remote host | Artifactory + npm registry      |
| Turnkey launcher (`ontap-apex`)     | No                 | Yes                             |
| npm package (`@netapp/seclab-apex`) | No                 | Yes                             |
| `publish:turnkey` script            | No                 | Yes                             |
| `publish:npm` script                | No                 | Yes                             |
| `scripts/publish-artifacts.js`      | No                 | Yes                             |
| `scripts/postinstall-apex.js`       | No                 | Yes                             |
| Skills deployed to config home      | No (bundled-only)  | Yes (all 3 paths)               |
| Hard rules in system prompt         | No                 | Yes                             |
| Artifactory version path            | N/A                | `apex/{version}/`               |
| End user setup                      | SSH + run binary   | `curl ontap-apex` or `npm i -g` |
