#!/usr/bin/env node
import { execSync } from 'node:child_process';

const BIN_ID = '69babf10b7ec241ddc7d652f';
const MKEY = '$2a$10$GeOyXKViWuf6OsSoiA9eT.bifbFDXJ/AsilT9KSjMz.2Ibg5mPDGS';
const API = 'https://api.jsonbin.io/v3';
const TEST_LINK = 'https://englishtest-smoky.vercel.app/test.html';
const OWNER_NOTIFY_TARGET = '-1003810705263';
const OPENCLAW_BIN = '/home/claw/.npm-global/bin/openclaw';

const STUDENTS = {
  zenv: { tg: '8666119688' },
  zenz: { tg: '7200952299' },
  zene: { tg: '8225160376' }
};

const PARTS_10 = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'];

const sgDate = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Singapore' }).format(new Date());

function keyForItem(part, item, idx) {
  if (typeof item === 'string') return `${part}:${idx}:${item.toLowerCase().trim()}`;
  if (part === 'i') return `${part}:${idx}:${(item.prompt || '').toLowerCase().trim()}`;
  if (part === 'f') return `${part}:${idx}:${(item.q || '').toLowerCase().trim()}:${item.ans}`;
  return `${part}:${idx}:${(item.q || '').toLowerCase().trim()}`;
}

function pickByUnused(part, arr, usedSet, count) {
  const available = arr
    .map((item, idx) => ({ item, key: keyForItem(part, item, idx) }))
    .filter(x => !usedSet.has(x.key));

  if (available.length < count) return null;

  // random sample without replacement
  for (let i = available.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [available[i], available[j]] = [available[j], available[i]];
  }

  const selected = available.slice(0, count);
  return {
    values: selected.map(x => x.item),
    keys: selected.map(x => x.key)
  };
}

function run(cmd) {
  return execSync(cmd, { stdio: 'pipe', encoding: 'utf8' }).trim();
}

const DRY_RUN = process.argv.includes('--dry-run');

function sendTelegram(target, message) {
  if (DRY_RUN) {
    console.log(`[DRY_RUN] send -> ${target}: ${message}`);
    return;
  }
  const safe = message.replace(/"/g, '\\"');
  run(`${OPENCLAW_BIN} message send --channel telegram --target "${target}" --message "${safe}"`);
}

(async () => {
  const today = sgDate();

  const getRes = await fetch(`${API}/b/${BIN_ID}/latest`, {
    headers: { 'X-Master-Key': MKEY, 'X-Bin-Meta': 'false' },
    cache: 'no-store'
  });
  if (!getRes.ok) throw new Error(`GET ${getRes.status}`);

  const bin = await getRes.json();
  const qb = bin.questionBank;
  if (!qb) throw new Error('questionBank missing in JSONBin');

  const state = bin.dispatchState || {
    used: {
      zenv: { a: [], b: [], c: [], d: [], e: [], f: [], g: [], h: [], i: [] },
      zenz: { a: [], b: [], c: [], d: [], e: [], f: [], g: [], h: [], i: [] },
      zene: { a: [], b: [], c: [], d: [], e: [], f: [], g: [], h: [], i: [] }
    },
    lastSentDate: {},
    allCompletedNotified: false
  };

  const dailyAssignments = bin.dailyAssignments || {};
  const todayAssignments = dailyAssignments[today] || {};

  let sentCount = 0;
  let completedNow = [];
  let canAssignAny = false;

  // For same-day assignments with limited bank: rotate starting position per student
  const studentOrder = ['zenv', 'zenz', 'zene'];
  const rotationOffset = { zenv: 0, zenz: 4, zene: 8 }; // stagger picks

  for (const level of Object.keys(STUDENTS)) {
    // prevent duplicate same-day sends
    if (state.lastSentDate[level] === today && todayAssignments[level]) {
      continue;
    }

    // Don't track used questions across days - allow mixing old/new
    const usedSet = {};
    [...PARTS_10, 'i'].forEach(p => usedSet[p] = new Set());

    const levelBank = qb[level];
    if (!levelBank) continue;

    const assignment = {};
    let canAssign = true;

    for (const p of PARTS_10) {
      const pool = levelBank[p] || [];
      if (pool.length < 10) { canAssign = false; break; }
      const offset = rotationOffset[level] || 0;
      const rotated = [...pool.slice(offset), ...pool.slice(0, offset)];
      const picked = pickByUnused(p, rotated, usedSet[p], 10);
      if (!picked) { canAssign = false; break; }
      assignment[p] = picked.values;
      picked.keys.forEach(k => usedSet[p].add(k));
    }

    if (canAssign) {
      const pickedI = pickByUnused('i', levelBank.i || [], usedSet.i, 1);
      if (!pickedI) canAssign = false;
      else {
        assignment.i = pickedI.values[0];
        pickedI.keys.forEach(k => usedSet.i.add(k));
      }
    }

    if (!canAssign) {
      completedNow.push(level);
    } else {
      todayAssignments[level] = assignment;
      state.lastSentDate[level] = today;

      const link = `${TEST_LINK}?name=${encodeURIComponent(level)}`;
      sendTelegram(STUDENTS[level].tg, link);
      sentCount++;
      canAssignAny = true;
    }
  }

  const allCompleted = !canAssignAny;

  dailyAssignments[today] = todayAssignments;

  // Cleanup: keep only last 7 days of assignments to prevent bin bloat
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - 7);
  const cutoffStr = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Singapore' }).format(cutoff);
  Object.keys(dailyAssignments).forEach(date => {
    if (date < cutoffStr) delete dailyAssignments[date];
  });

  const payload = {
    ...bin,
    dailyAssignments,
    dispatchState: state,
    dispatchUpdatedAt: new Date().toISOString()
  };

  if (!DRY_RUN) {
    const putRes = await fetch(`${API}/b/${BIN_ID}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', 'X-Master-Key': MKEY },
      body: JSON.stringify(payload)
    });
    if (!putRes.ok) throw new Error(`PUT ${putRes.status}`);
  }

  if (allCompleted && !state.allCompletedNotified) {
    sendTelegram(OWNER_NOTIFY_TARGET, 'All current question-bank items have been tested. Time to refresh/add new questions.');
    state.allCompletedNotified = true;
    if (!DRY_RUN) {
      await fetch(`${API}/b/${BIN_ID}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', 'X-Master-Key': MKEY },
        body: JSON.stringify({ ...payload, dispatchState: state, dispatchUpdatedAt: new Date().toISOString() })
      });
    }
  }

  console.log(JSON.stringify({ today, sentCount, completedNow, allCompleted }, null, 2));
})().catch(err => {
  console.error(err);
  process.exit(1);
});
