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
  const window = { __TAURI__:{ core:{ invoke } }, addEventListener(){}, dispatchEvent(event) { if (event.type === 'tracking-update') updates.push(event.detail); } };
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

function controlled(){
  let now=10000,mode='frames',respond=true,seq=0,timerId=0;
  const timers=new Map(),intervals=[],calls=[],workers=[],updates=[],logs=[];
  const listeners=new Map(),elements=new Map();
  for(const id of ['map','tracking-button','game-resolution'])elements.set(id,{value:id==='map'?'20036':'16:9',
    setAttribute(){},addEventListener(name,fn){listeners.set(id+name,fn);},dispatchEvent(e){listeners.get(id+e.type)?.(e);}});
  const invoke=async(name,args)=>{
    calls.push({name,args});
    if(name==='game_windows')return [{id:'fixture'}];
    if(name==='capture_frame')return {running:true,message:mode==='minimized'?'minimized':null,
      frame:mode==='frames'?{sequence:++seq,capturedAt:now,image:'private-frame',sourceRegion:[0,0,1,1]}:null};
    if(name==='append_tracking_log'){logs.push(args.entry);return 'fixture/logs/tracking.log';}
  };
  class Worker{
    constructor(){workers.push(this);}
    postMessage(m){
      if(m.type==='init')queueMicrotask(()=>this.onmessage({data:{type:'ready'}}));
      if(m.type==='track'){
        this.sent=m;
        if(respond)queueMicrotask(()=>this.onmessage({data:{type:'result',request:m.request,mapId:20036,capturedAt:m.capturedAt,
          location:null,diagnostic:{reason:'no-map-match'},elapsedMs:12}}));
      }
    }
    terminate(){this.terminated=true;}
  }
  const window={__TAURI__:{core:{invoke}},addEventListener(){},dispatchEvent(e){updates.push(e);}};
  const context={window,document:{getElementById:id=>elements.get(id)},localStorage:{getItem:()=>null,setItem(){}},
    I18n:{msg:key=>key,bind(){},error:String},MapScreen:{defaultMini:()=>[.04,.04,.1,.18]},
    DUNGEON_DATA:{maps:[{id:20036,image:'maps/20036.png'}]},Worker,location:{href:'http://localhost/'},URL,
    Date:{now:()=>now},queueMicrotask,Event:class{constructor(type){this.type=type;}},
    CustomEvent:class{constructor(type,options){this.type=type;this.detail=options.detail;}},
    setTimeout:(fn,delay)=>{const id=++timerId;timers.set(id,{fn,at:now+delay});return id;},
    clearTimeout:id=>timers.delete(id),setInterval:fn=>intervals.push(fn)};
  vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../../app/tracking.js'),'utf8'),context);
  const drain=async()=>{for(let i=0;i<15;i++)await Promise.resolve();};
  return {calls,workers,updates,logs,window,
    setMode:value=>mode=value,setRespond:value=>respond=value,
    toggle:async()=>{await elements.get('tracking-button').onclick();await drain();},
    tick:async ms=>{
      now+=ms;
      for(const [id,timer] of [...timers])if(timer.at<=now){timers.delete(id);await timer.fn();}
      await drain();for(const fn of intervals)fn();await drain();
    }};
}

test('unmatched terrain continues normally and logs numerical diagnostics without screenshots',async()=>{
  const h=controlled();await h.toggle();
  for(let i=0;i<10;i++)await h.tick(1000);
  assert.equal(h.workers.length,1);
  assert.equal(h.calls.filter(c=>c.name==='start_capture').length,1);
  assert.ok(h.logs.some(batch=>batch.events.some(e=>e.reason==='no-map-match')));
  assert.ok(!JSON.stringify(h.logs).includes('private-frame'));
  assert.equal(h.window.trackingStatus().diagnosticPath,'fixture/logs/tracking.log');
  await h.toggle();
});
test('a silent worker is replaced and late results from it cannot update the position',async()=>{
  const h=controlled();h.setRespond(false);await h.toggle();
  const old=h.workers[0];assert.ok(old.sent);
  await h.tick(3100);
  assert.equal(old.terminated,true);assert.equal(h.workers.length,2);
  old.onmessage({data:{type:'result',request:old.sent.request,mapId:20036,capturedAt:13100,location:{pixel:[1,2]}}});
  assert.ok(!h.updates.some(e=>e.detail?.pixel?.[0]===1));
  assert.ok(h.window.trackingStatus().history.some(e=>e.event==='worker-timeout'));
  await h.toggle();
});
test('no frames restarts capture while a minimized game remains paused',async()=>{
  const h=controlled();h.setMode('empty');await h.toggle();await h.tick(5100);
  assert.equal(h.calls.filter(c=>c.name==='start_capture').length,2);
  assert.ok(h.window.trackingStatus().history.some(e=>e.event==='capture-timeout'));
  h.setMode('minimized');
  for(let i=0;i<4;i++)await h.tick(6000);
  assert.equal(h.calls.filter(c=>c.name==='start_capture').length,2);
  assert.equal(h.window.trackingStatus().capturePaused,true);
  await h.toggle();
});
test('automatic recovery is bounded during persistent worker failure',async()=>{
  const h=controlled();h.setRespond(false);await h.toggle();
  for(let i=0;i<10;i++){await h.tick(100);await h.tick(3100);}
  assert.equal(h.workers.length,4);
  assert.equal(h.window.trackingStatus().restarts.worker,3);
  await h.toggle();
});
