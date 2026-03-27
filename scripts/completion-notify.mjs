#!/usr/bin/env node
import { execSync } from 'node:child_process';

const BIN_ID = '69c38175c3097a1dd5598fdd'; // Updated to new bin with expanded questions
const MKEY = '$2a$10$GeOyXKViWuf6OsSoiA9eT.bifbFDXJ/AsilT9KSjMz.2Ibg5mPDGS';
const API = 'https://api.jsonbin.io/v3';
const OWNER_TARGET = '-1003810705263';
const OPENCLAW_BIN = '/home/claw/.npm-global/bin/openclaw';
const DRY_RUN = process.argv.includes('--dry-run');

const STUDENT_KEYS = ['zenv', 'zenz', 'zene'];

const sgDate = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Singapore' }).format(new Date());

function normName(s=''){ return s.toLowerCase().replace(/\s+/g,'').trim(); }
function toStudentKey(name=''){
  const n = normName(name);
  if (n.includes('zenv')) return 'zenv';
  if (n.includes('zenz')) return 'zenz';
  if (n.includes('zene')) return 'zene';
  return null;
}

function isCompleteSubmission(sub){
  const a = sub.answers || {};
  for (const p of ['a','b','c','d','e','g','h']) {
    for (let i=1;i<=10;i++) {
      if (!String(a[p+i] ?? '').trim()) return false;
    }
  }
  for (let i=1;i<=10;i++) {
    if (a['f'+i] === '' || a['f'+i] === undefined || a['f'+i] === null) return false;
  }
  const para = String(a.i1 || '').trim();
  if (!para) return false;
  const wc = para.split(/\s+/).filter(Boolean).length;
  if (wc < 200 || wc > 250) return false;
  
  const ss = sub.sectionScores || {};
  for (const p of ['a','b','c','d','e','f']) {
    if (!ss[p] && ss[p] !== 0) return false;
  }
  
  return true;
}

function send(msg){
  if (DRY_RUN) { console.log('[DRY_RUN] '+msg); return; }
  const safe = msg.replace(/"/g,'\\"');
  execSync(`${OPENCLAW_BIN} message send --channel telegram --target "${OWNER_TARGET}" --message "${safe}"`,{stdio:'pipe'});
}

(async()=>{
  const today = sgDate();
  const res = await fetch(`${API}/b/${BIN_ID}/latest`, { headers: { 'X-Master-Key': MKEY, 'X-Bin-Meta':'false' }, cache:'no-store' });
  if (!res.ok) throw new Error('GET '+res.status);
  const data = await res.json();

  const subs = Array.isArray(data.submissions) ? data.submissions : [];
  const latestByStudent = {};
  for (const s of subs) {
    const k = toStudentKey(s.name || '');
    if (!k) continue;
    latestByStudent[k] = s;
  }

  const completionState = data.completionState || { byDate: {} };
  if (!completionState.byDate[today]) completionState.byDate[today] = {};

  const completedNow = [];

  for (const k of STUDENT_KEYS) {
    const s = latestByStudent[k];
    const done = !!(s && isCompleteSubmission(s));
    const prior = completionState.byDate[today][k] || { done:false, notified:false };

    if (done && !prior.notified) {
      const score = typeof s.score === 'number' ? `${s.score}/60` : 'N/A';
      send(`✅ ${k.toUpperCase()} completed today. Score (A–F): ${score}.`);
      completionState.byDate[today][k] = { done:true, notified:true, notifiedAt:new Date().toISOString() };
      completedNow.push(k);
    } else {
      completionState.byDate[today][k] = { ...prior, done };
    }
  }

  const allDone = STUDENT_KEYS.every(k => completionState.byDate[today][k]?.done === true);
  const allNotified = completionState.byDate[today]._allNotified === true;
  if (allDone && !allNotified) {
    send('🎉 All 3 students completed today’s test with full required answers.');
    completionState.byDate[today]._allNotified = true;
  }

  if (!DRY_RUN) {
    const put = await fetch(`${API}/b/${BIN_ID}`, {
      method:'PUT',
      headers:{ 'Content-Type':'application/json', 'X-Master-Key':MKEY },
      body: JSON.stringify({ ...data, completionState, completionUpdatedAt: new Date().toISOString() })
    });
    if (!put.ok) throw new Error('PUT '+put.status);
  }

  console.log(JSON.stringify({ today, completedNow, allDone }, null, 2));
})().catch(e=>{ console.error(e); process.exit(1); });
