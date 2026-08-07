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

for (let i = 0; i < 80; i += 1) {
  const result = usageManager.recordUsage({ type: 'image', success: true, metadata: { source: 'test' } });
  assert.strictEqual(result.ok, true, `image usage should be recorded at step ${i}`);
}

const blocked = usageManager.canPerformAnalysis('image');
assert.strictEqual(blocked.allowed, false, 'free plan should stop further image analyses after the daily limit');

const overLimit = usageManager.recordUsage({ type: 'image', success: true, metadata: { source: 'test' } });
assert.strictEqual(overLimit.ok, false, 'over-limit image usage should be rejected');
console.log('usage-manager tests passed');
