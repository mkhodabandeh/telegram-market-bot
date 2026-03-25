#!/usr/bin/env node
/**
 * Release script: bumps package.json version, commits, tags, pushes to main,
 * and triggers a Render deploy via RENDER_DEPLOY_HOOK from .env.
 *
 * Usage:
 *   npm run release           # patch bump (x.y.Z)
 *   npm run release -- minor  # minor bump (x.Y.0)
 *   npm run release -- major  # major bump (X.0.0)
 */

require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') });
const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const pkgPath = path.resolve(__dirname, '../package.json');
const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));

const bumpType = process.argv[2] || 'patch';
if (!['patch', 'minor', 'major'].includes(bumpType)) {
  console.error(`❌ Invalid bump type "${bumpType}". Use: patch | minor | major`);
  process.exit(1);
}

let [major, minor, patch] = pkg.version.split('.').map(Number);

if (bumpType === 'major') { major++; minor = 0; patch = 0; }
else if (bumpType === 'minor') { minor++; patch = 0; }
else { patch++; }

const newVersion = `${major}.${minor}.${patch}`;
const tag = `v${newVersion}`;

pkg.version = newVersion;
fs.writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + '\n');
console.log(`✅ Bumped version: ${pkg.version.replace(newVersion, '')}${newVersion} (${bumpType})`);

// Check for uncommitted changes beyond package.json
const status = execSync('git status --porcelain').toString().trim();
const otherChanges = status.split('\n').filter(l => l && !l.includes('package.json'));
if (otherChanges.length > 0) {
  console.warn('⚠️  There are uncommitted changes beyond package.json:');
  otherChanges.forEach(l => console.warn('  ', l));
  console.warn('   Commit or stash them before releasing, or they will be left out.');
}

try {
  execSync('git add package.json', { stdio: 'inherit' });
  execSync(`git commit -m "chore: release ${tag}"`, { stdio: 'inherit' });
  execSync(`git tag ${tag}`, { stdio: 'inherit' });
  execSync('git push', { stdio: 'inherit' });
  execSync('git push --tags', { stdio: 'inherit' });
  console.log(`\n🏷  Tag ${tag} pushed to main.`);
} catch (err) {
  console.error('❌ Git operation failed:', err.message);
  process.exit(1);
}

// Trigger Render deploy via deploy hook
const deployHook = process.env.RENDER_DEPLOY_HOOK;
if (!deployHook) {
  console.warn('⚠️  RENDER_DEPLOY_HOOK not set in .env — skipping Render deploy trigger.');
  console.warn('   Add RENDER_DEPLOY_HOOK=<url> to .env to enable auto-deploy on release.');
} else {
  console.log('🚀 Triggering Render deploy...');
  fetch(deployHook, { method: 'GET' })
    .then(res => {
      if (res.ok) {
        console.log(`✅ Render deploy triggered successfully! (${tag})`);
      } else {
        console.warn(`⚠️  Render deploy hook returned status ${res.status}`);
      }
    })
    .catch(err => console.error('❌ Failed to call deploy hook:', err.message));
}
