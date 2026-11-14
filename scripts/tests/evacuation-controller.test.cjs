const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');

function fixture() {
  const calls = [], timers = new Map(), listeners = new Map(), elements = new Map();
  let mode = 'pve', reply = {state:'watching',samples:1}, deferredStart = null, deferredStatus = null, failStart = false, timerId = 0;
  for (const id of ['evacuation-button','evacuation-button-text','evacuation-panel','evacuation-status','game-window']) {
    elements.set(id,{dataset:{},attributes:{},value:'',setAttribute(k,v){this.attributes[k]=v;}});
  }
  const invoke = async(name,args) => {
    calls.push({name,args});
    if (name === 'start_evacuation') { if (failStart) throw Error('game unavailable'); if (deferredStart) await deferredStart; }
    if (name === 'evacuation_status') return deferredStatus ? await deferredStatus : {...reply};
  };
  const window = {__TAURI__:{core:{invoke}},getGameMode:()=>mode,addEventListener:(name,fn)=>listeners.set(name,fn)};
  const context = {window,document:{getElementById:id=>elements.get(id)},
    I18n:{msg:(key,params)=>({key,params}),bind:(node,message,attribute)=>{node[attribute||'textContent']=message.key;},error:String},
    setTimeout:(fn,ms)=>{const id=++timerId;timers.set(id,{fn,ms});return id;},clearTimeout:id=>timers.delete(id)};
  vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../../app/evacuation.js'),'utf8'),context);
  const drain = async()=>{for(let i=0;i<30;i++)await Promise.resolve();};
  return {calls,timers,elements,state:window.evacuationStatus,
    click:async()=>{await elements.get('evacuation-button').onclick();await drain();},
    reply:value=>{reply=value;},
    mode:async value=>{mode=value;listeners.get('game-mode-change')();await drain();},
    tick:async()=>{const items=[...timers];timers.clear();for(const [,timer] of items)await timer.fn();await drain();},
    deferStart:()=>{let resolve;deferredStart=new Promise(r=>resolve=r);return resolve;},
    deferStatus:()=>{let resolve;deferredStatus=new Promise(r=>resolve=r);return resolve;},
    failStart:()=>{failStart=true;},drain};
}

test('one click starts a round; completion stops all timers and the next round is manual',async()=>{
  const f=fixture();assert.equal(f.timers.size,0);
  await f.click();assert.equal(f.state().active,true);
  assert.equal(f.elements.get('evacuation-button-text').textContent,'evac.running');
  assert.equal(f.elements.get('evacuation-button').disabled,false);
  f.reply({state:'watching',matched:true,samples:2});await f.tick();assert.equal(f.state().state,'confirming');
  f.reply({state:'completed',samples:3});await f.tick();
  assert.equal(f.state().state,'completed');assert.equal(f.state().active,false);assert.equal(f.timers.size,0);
  assert.equal(f.calls.filter(x=>x.name==='stop_evacuation').length,1);
  await f.tick();assert.equal(f.calls.filter(x=>x.name==='start_evacuation').length,1);
  f.reply({state:'watching',samples:0});await f.click();assert.equal(f.state().active,true);
  assert.equal(f.calls.filter(x=>x.name==='start_evacuation').length,2);
  await f.click();assert.equal(f.state().state,'idle');assert.equal(f.timers.size,0);
  assert.ok(f.calls.every(x=>!['start_capture','stop_capture','configure_capture'].includes(x.name)),'map capture stays independent');
});

test('minimized game pauses and resumes, while audio errors remain visible',async()=>{
  const f=fixture();await f.click();
  f.reply({state:'paused'});await f.tick();assert.equal(f.state().state,'paused');assert.equal(f.state().active,true);
  f.reply({state:'watching'});await f.tick();assert.equal(f.state().state,'watching');
  f.reply({state:'completed',audioFailed:true});await f.tick();
  assert.equal(f.elements.get('evacuation-status').textContent,'evac.audioFailed');
});

test('switching to PVP during a slow start serializes native start then cancellation',async()=>{
  const f=fixture(),resolve=f.deferStart();const starting=f.click();await f.drain();
  await f.mode('pvp');assert.equal(f.elements.get('evacuation-panel').hidden,true);
  resolve();await starting;await f.drain();
  assert.deepEqual(f.calls.map(x=>x.name),['start_evacuation','stop_evacuation']);
  assert.equal(f.state().active,false);assert.equal(f.state().busy,false);assert.equal(f.timers.size,0);
  await f.mode('pve');assert.equal(f.state().active,false);
});

test('late completion response after cancellation cannot update a new round',async()=>{
  const f=fixture(),resolve=f.deferStatus();await f.click();
  await f.click();assert.equal(f.state().state,'idle');
  resolve({state:'completed'});await f.drain();
  assert.equal(f.state().state,'idle');assert.equal(f.calls.filter(x=>x.name==='stop_evacuation').length,1);
});

test('start failure and game closure restore a retryable button',async()=>{
  const f=fixture();f.failStart();await f.click();
  assert.equal(f.state().state,'error');assert.equal(f.state().busy,false);assert.equal(f.timers.size,0);
  assert.equal(f.elements.get('evacuation-button').disabled,false);
  const g=fixture();await g.click();g.reply({state:'error',error:'game closed'});await g.tick();
  assert.equal(g.state().state,'error');assert.equal(g.state().active,false);assert.equal(g.timers.size,0);
});
