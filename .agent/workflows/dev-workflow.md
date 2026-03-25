---
description: local development, testing, and release workflow for the market bot
---

# Development & Release Workflow

> [!IMPORTANT]
> Always develop and test locally using the **test bot** before pushing to `main`.
> Never push directly to `main` without validating locally first.

## 1. Local Development

Run the bot locally using the **test Telegram bot token** (stored in `.env.test`):

```bash
npm run dev
```

- Uses `.env.test` instead of `.env`
- `.env.test` contains `TELEGRAM_BOT_TOKEN=<test_bot_token>` and optionally `PROXY_URL`
- `.env.test` is gitignored — never commit it

Make and test all changes against the test bot before proceeding.

## 2. Versioning Rules

Use semantic versioning (`MAJOR.MINOR.PATCH`):

| Type | When to use | Command |
|---|---|---|
| `patch` | Bug fix, minor tweak | `npm run release` |
| `minor` | New feature, backwards-compatible | `npm run release -- minor` |
| `major` | Breaking change or major refactor | `npm run release -- major` |

## 3. Releasing to Production

When changes are tested and ready:

```bash
npm run release           # patch bump (default)
npm run release -- minor  # minor bump
npm run release -- major  # major bump
```

This script will:
1. Bump the version in `package.json`
2. Commit: `chore: release vX.Y.Z`
3. Create a git tag `vX.Y.Z`
4. Push commit + tag to `main`

Render.com will automatically redeploy from `main`.

## 4. Files

| File | Purpose |
|---|---|
| `.env` | Production secrets (gitignored) |
| `.env.test` | Test bot secrets (gitignored) |
| `scripts/release.js` | Version bump + push automation |

## 5. Agent Instructions

When working on this project:
- **Always suggest** `npm run dev` to test changes locally first
- **Never** `git push` directly — always use `npm run release [patch|minor|major]`
- **Determine bump type** from the nature of the change (see table above)
- **Do not** modify `.env` or `.env.test` — ask the user to update secrets manually
