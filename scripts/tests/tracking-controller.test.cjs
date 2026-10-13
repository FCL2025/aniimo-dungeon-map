const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');

test('tracking-only controller captures, follows a manual map change, and stops', async () => {
  const calls = [], workers = [], updates = [], listeners = new Map(), values = new Map();
  const storage = { getItem:key => values.get(key) ?? null, setItem:(key,value) => values.set(key,value) };
  const makeElement = id => ({ id, value:id === 'map' ? '20032' : '16:9', disabled:false, textContent:'', attributes:{},
    setAttribute(name,value) { this.attributes[name] = value; },
    addEventListener(name, callback) { const key = `${id}:${name}`; (listeners.get(key) || listeners.set(key, []).get(key)).push(callback); },
    dispatchEvent(event) { for (const callback of listeners.get(`${id}:${event.type}`) || []) callback(event); } });
  const elements = new Map(['tracking-button','map','game-resolution'].map(id => [id, makeElement(id)]));
  let captureSequence = 0;
  const invoke = async (name, args) => {
    calls.push({ name, args });
    if (name === 'game_windows') return [{ id:'fixture-window', title:'Aniimo' }];
    if (name === 'capture_frame') return { running:true, frame:captureSequence++ === 0 ?
      { sequence:1, capturedAt:Date.now(), image:'fixture-image', sourceRegion:[0,0,1,1] } : null };
    return null;
  };
  class FakeWorker {
    constructor(url) { this.url = url; this.terminated = false; workers.push(this); }
    postMessage(message) {
      if (message.type === 'init') queueMicrotask(() => this.onmessage({ data:{ type:'ready' } }));
      if (message.type === 'track') queueMicrotask(() => this.onmessage({ data:{ type:'result', request:message.request,
        mapId:Number(elements.get('map').value), capturedAt:message.capturedAt, location:{ pixel:[800,900], inliers:20 } } }));
    }
    terminate() { this.terminated = true; }
  }
  const window = { __TAURI__:{ core:{ invoke } }, dispatchEvent(event) { if (event.type === 'tracking-update') updates.push(event.detail); } };
  const context = { window, document:{ getElementById:id => elements.get(id) }, localStorage:storage,
    I18n:{ msg:(key,params) => ({key,params}), bind:(node,value) => { if (node) node.textContent = value.key || String(value); }, error:String },
    DUNGEON_DATA:{ maps:[{id:20032,image:'maps/20032.png'},{id:20036,image:'maps/20036.png'}] },
    MapScreen:{ defaultMini:aspect => [0.04,0.04,0.1,0.1 * aspect] },
    Worker:FakeWorker, location:{ href:'http://localhost/index.html' }, URL, Date, JSON, Number, Object,
    Promise, structuredClone, queueMicrotask, setTimeout, clearTimeout, setInterval:() => 0,
    Event:class { constructor(type) { this.type = type; } },
    CustomEvent:class { constructor(type,options) { this.type = type; this.detail = options.detail; } } };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../../app/tracking.js'), 'utf8'), context);
  const until = async predicate => { for (let n=0; n<40; n++) { if (predicate()) return; await new Promise(resolve => setTimeout(resolve, 10)); } throw Error('Timed out'); };
  await elements.get('tracking-button').onclick();
  await until(() => updates.some(value => value?.pixel?.[0] === 800));
  assert.equal(workers.length, 1);
  assert.equal(workers[0].url, 'tracking-worker.js');
  assert.equal(window.trackingStatus().gameWindowId, 'fixture-window');
  await window.enterManualMode(20036);
  await until(() => workers.length === 2 && window.trackingStatus().map === 20036);
  assert.equal(workers[0].terminated, true);
  await elements.get('tracking-button').onclick();
  assert.equal(window.trackingStatus().capturing, false);
  assert.equal(workers[1].terminated, true);
  assert.ok(calls.some(call => call.name === 'configure_capture' && call.args.watchMap === false));
  assert.ok(calls.some(call => call.name === 'stop_capture'));
});
