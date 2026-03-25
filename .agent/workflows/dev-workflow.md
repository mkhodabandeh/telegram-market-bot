---
description: local development, testing, and release workflow for the market bot
---

# Development & Release Workflow

> [!IMPORTANT]
> **Chosen strategy: GitHub Actions CI (syntax check) + Tag-based Render deploys.**
> Commit and push to `main` freely at any time. Only `npm run release` triggers a production deploy.

---

## The Full Picture

```
[local dev]  →  npm run dev     → test with test bot (.env.test)
[commit]     →  git push        → GitHub Actions runs syntax check ✅
[release]    →  npm run release → bumps version, creates git tag → Render deploys
```

**Render is configured to deploy on git tags only** — not on every push.
This means you can push work-in-progress to `main` all day without affecting production.

---

## Daily Development

```bash
npm run dev          # runs bot locally with .env.test (test bot token)
```

- Uses `.env.test` (gitignored — never commit it)
- Does NOT affect the production bot at all
- Test all features against your test Telegram bot first

---

## Committing Work

```bash
git add .
git commit -m "feat: describe what you did"
git push                  # safe — does NOT deploy to production
```

GitHub Actions will run a syntax check on every push. If it fails, fix it before releasing.

Use descriptive commit message prefixes (not mandatory but keeps history clean):
| Prefix | Meaning |
|---|---|
| `feat:` | New feature |
| `fix:` | Bug fix |
| `chore:` | Tooling, config, housekeeping |
| `refactor:` | Code restructure, no behavior change |

---

## Releasing to Production

Only when locally tested and ready:

```bash
npm run release           # bug fix   → patch bump (x.y.Z)
npm run release -- minor  # new feature → minor bump (x.Y.0)
npm run release -- major  # breaking change → major bump (X.0.0)
```

This script:
1. Bumps `version` in `package.json`
2. Commits: `chore: release vX.Y.Z`
3. Creates git tag `vX.Y.Z`
4. Pushes commit + tag to `main`
5. **Render detects the new tag and deploys** 🚀

### Versioning rules
| Change type | Bump |
|---|---|
| Fixing a bug | `patch` (default) |
| Adding a new command or feature | `minor` |
| Breaking existing behavior / major refactor | `major` |

---

## Files Reference

| File | Purpose |
|---|---|
| `.env` | Production secrets — never commit, never touch |
| `.env.test` | Test bot secrets — gitignored, never commit |
| `scripts/release.js` | Version bump + tag + push automation |
| `.github/workflows/ci.yml` | Syntax check on every push to main |

---

## Agent Instructions

When working on this project as an AI agent:

1. **Develop using `npm run dev`** — never use `npm run start` for local testing
2. **Commit freely** — `git push` to `main` is safe and does not deploy production
3. **Never manually `git push --tags`** — use `npm run release` only
4. **Determine release type** from the nature of changes: `patch` for fixes, `minor` for features, `major` for breaking changes
5. **Do not modify `.env` or `.env.test`** — ask the user to update secrets manually
6. **Render deploy = git tag** — only `npm run release` creates a tag and triggers production deploy
