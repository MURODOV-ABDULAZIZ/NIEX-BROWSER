/**
 * SafeNet Extension Migration Script
 * 
 * Converts old-style flat .js extensions to new manifest-based structure.
 * Run once after updating to new extension system:
 * 
 *   node migrate-extensions.js /path/to/extensions
 */

const fs = require('fs');
const path = require('path');

const extensionsDir = process.argv[2] || path.join(process.env.APPDATA || process.env.HOME, '.safenet', 'extensions');

console.log('[MIGRATE] Starting extension migration...');
console.log('[MIGRATE] Source:', extensionsDir);

if (!fs.existsSync(extensionsDir)) {
  console.log('[MIGRATE] No extensions directory found, nothing to migrate');
  process.exit(0);
}

const files = fs.readdirSync(extensionsDir);
let migratedCount = 0;

for (const file of files) {
  const filePath = path.join(extensionsDir, file);
  const stat = fs.statSync(filePath);

  if (stat.isDirectory()) {
    console.log(`[SKIP] ${file} (already a directory)`);
    continue;
  }

  if (!file.endsWith('.js')) {
    console.log(`[SKIP] ${file} (not a .js file)`);
    continue;
  }

  try {
    const jsCode = fs.readFileSync(filePath, 'utf8');
    if (!jsCode || jsCode.length < 10) {
      console.log(`[SKIP] ${file} (empty)`);
      continue;
    }

    const extId = file.replace(/\.js$/, '');
    const extPath = path.join(extensionsDir, extId);

    if (fs.existsSync(extPath)) {
      console.log(`[SKIP] ${file} (directory already exists)`);
      continue;
    }

    fs.mkdirSync(extPath, { recursive: true });

    const manifest = {
      manifest_version: 2,
      name: extId,
      version: '1.0.0',
      description: 'Legacy extension (auto-migrated)',
      content_scripts: [{
        matches: ['<all_urls>'],
        js: ['script.js'],
        run_at: 'document_idle'
      }],
      permissions: ['<all_urls>']
    };

    fs.writeFileSync(
      path.join(extPath, 'manifest.json'),
      JSON.stringify(manifest, null, 2),
      'utf8'
    );

    fs.writeFileSync(
      path.join(extPath, 'script.js'),
      jsCode,
      'utf8'
    );

    fs.writeFileSync(
      path.join(extPath, '.enabled'),
      '1',
      'utf8'
    );

    fs.renameSync(filePath, filePath + '.bak');

    console.log(`[OK] Migrated ${file} → ${extId}/`);
    migratedCount++;

  } catch (e) {
    console.log(`[ERR] Failed migrating ${file}:`, e.message);
  }
}

console.log(`[DONE] Migrated ${migratedCount} extensions`);
console.log('[INFO] Old .js files backed up as .bak');
