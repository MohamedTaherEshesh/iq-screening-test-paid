// OMS-MND-261126-18: per-question visible-time reporting in university-client.js
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const source = fs.readFileSync(new URL('../university-client.js', import.meta.url), 'utf8')
  .replace(/^import .*$/m, 'const EmailVerificationClient=class{constructor(){this.state={};this.verified=false}};')
  .replace(/\nboot\(\);\s*$/, '\n');
function ctx() {
  const els = {}; let now = 0; let vis = 'visible'; const sent = []; const listeners = {};
  const c = vm.createContext({
    window: {OMSAZE_ADVANCED70_CONFIG: {enabled: false}}, console, clearInterval() {}, setInterval() {},
    performance: {now: () => now},
    sessionStorage: {getItem() { return null }, removeItem() {}, setItem() {}},
    document: {get visibilityState() { return vis }, getElementById: id => els[id] ??= {innerHTML: '', onclick: null, addEventListener() {}},
      addEventListener(t, f) { listeners[t] = f }},
  });
  vm.runInContext(source, c);
  vm.runInContext('api=async b=>{__sent.push(JSON.parse(JSON.stringify(b)));return {}};session={testId:"t1"};', Object.assign(c, {__sent: sent}));
  return {c, sent, tick: ms => { now += ms }, hide() { vis = 'hidden'; listeners.visibilitychange() }, show() { vis = 'visible'; listeners.visibilitychange() }};
}
test('navigation reports the previous question visible time', () => {
  const t = ctx();
  vm.runInContext('dwellOn(0)', t.c); t.tick(5000);
  vm.runInContext('dwellOn(1)', t.c); t.tick(2000);
  vm.runInContext('dwellOn(1)', t.c); // re-render of the same question sends nothing
  vm.runInContext('dwellOn(null)', t.c);
  assert.deepEqual(t.sent.map(b => [b.index, b.prevIndex, b.prevMs]), [[0, null, null], [1, 0, 5000], [null, 1, 2000]]);
  assert.ok(t.sent.every(b => b.action === 'view' && b.testId === 't1'));
});
test('hidden tab time is not counted', () => {
  const t = ctx();
  vm.runInContext('dwellOn(3)', t.c); t.tick(1000);
  t.hide(); t.tick(60000); t.show(); t.tick(500);
  vm.runInContext('dwellOn(4)', t.c);
  assert.deepEqual(t.sent.map(b => [b.index, b.prevIndex, b.prevMs]), [[3, null, null], [3, 3, 1000], [4, 3, 500]]);
});
test('finish takes the last question time once', () => {
  const t = ctx();
  vm.runInContext('dwellOn(7)', t.c); t.tick(3000);
  const lp = vm.runInContext('const __lp=dwellTake();dwell.idx=null;__lp', t.c);
  assert.deepEqual({...lp}, {i: 7, ms: 3000});
  assert.equal(vm.runInContext('dwellTake()', t.c), null);
});
