const fs = require('fs');
const path = require('path');
const sharp = require('sharp');
const { imagesToIco } = require('png-to-ico');

async function main() {
  const repoRoot = path.join(__dirname, '..');
  const srcPng = path.join(repoRoot, 'assets', 'brand', 'niex-logo.png');
  const outIco = path.join(repoRoot, 'assets', 'icon.ico');
  const tmpDir = path.join(__dirname, 'tmp-ico');

  if (!fs.existsSync(srcPng)) {
    console.error('Source PNG not found:', srcPng);
    process.exit(1);
  }

  if (!fs.existsSync(tmpDir)) fs.mkdirSync(tmpDir);

  const sizes = [16, 32, 48, 256];
  const pngFiles = [];

  try {
    for (const size of sizes) {
      const outP = path.join(tmpDir, `niex-${size}.png`);
      await sharp(srcPng)
        .resize(size, size, { fit: 'contain' })
        .png()
        .toFile(outP);
      pngFiles.push(outP);
    }

    const icoBuffer = await imagesToIco(pngFiles);
    fs.writeFileSync(outIco, icoBuffer);
    console.log('Wrote', outIco);
  } catch (err) {
    console.error('Failed to generate ICO:', err);
    process.exit(1);
  } finally {
    // cleanup
    try {
      for (const f of pngFiles) if (fs.existsSync(f)) fs.unlinkSync(f);
      if (fs.existsSync(tmpDir)) fs.rmdirSync(tmpDir);
    } catch (_) {}
  }
}

main();
