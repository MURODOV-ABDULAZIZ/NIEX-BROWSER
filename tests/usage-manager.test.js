const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const SubscriptionManager = require('../modules/subscription-manager');
const UsageManager = require('../modules/usage-manager');

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'safenet-usage-'));
const storagePath = path.join(tempDir, 'usage.json');
const subscriptionManager = new SubscriptionManager({ storagePath: path.join(tempDir, 'subscription.json') });
const usageManager = new UsageManager({ subscriptionManager, storagePath, secret: 'test-secret' });

// DIZAYN (subscription-manager): free tarifda FAQAT video AI kunlik limitli.
//   Rasm/OCR/PDF/deepScan — CHEKSIZ. Shu sababli image hech qachon bloklanmaydi.
for (let i = 0; i < 200; i += 1) {
  const c = usageManager.canUseImage();
  assert.strictEqual(c.allowed, true, `free image unlimited — step ${i}`);
  usageManager.consumeImage(`img-${i}`);
}
assert.strictEqual(usageManager.canUseImage().allowed, true, 'free image stays unlimited');

// VIDEO — free tarifda 60 daqiqa/kun. Local kadr-skaner sekundlari ham hisoblanadi.
//   60 daqiqa (3600s) to'lgach video tahlil TO'XTAYDI.
for (let i = 0; i < 60; i += 1) {
  usageManager.recordUsage({ type: 'video-local', amount: 60, metadata: { source: 'frame-scanner-local' } });
}
const vid = usageManager.getDailyUsage();
assert.strictEqual(Math.round(vid.counters.videoMinutes), 60, 'video-local 60x60s → 60 videoMinutes');
assert.strictEqual(vid.exhausted.videoMinutes, true, 'video daily limit exhausted after 60 min');
assert.strictEqual(usageManager.canPerformAnalysis('video-local', 1).allowed, false, 'video analysis stops when daily limit reached');

console.log('usage-manager tests passed');
