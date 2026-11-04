#!/usr/bin/env node
'use strict';
const { fetchQuota } = require('./lib/quota');
fetchQuota().then(q => {
  console.log('Codex bucket: ' + q.bucketId + ' (plan: ' + (q.planType || 'unknown') + ', status: ' + q.status + ')');
  for (const [name, item] of [['Primary', q.fiveHour], ['Secondary', q.weekly]]) {
    const reset = item.resetAt ? new Date(item.resetAt).toLocaleString() : 'unknown';
    console.log(name + ' [' + item.label + ']: ' + (item.remainPct ?? '--') + '% remaining, resets ' + reset);
  }
}).catch(e => { console.error('Codex quota error: ' + e.message); process.exitCode = 1; });