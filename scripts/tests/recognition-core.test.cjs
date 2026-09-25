const {test}=require('node:test');
const assert=require('node:assert/strict');
const {consensus,transform,Evidence}=require('../../app/recognition-core.js');
test('partial geometry recovers scale, rotation and translation despite outliers',()=>{
  const expected={a:1.3,b:.4,tx:128,ty:67},pairs=[];
  for(let i=0;i<30;i++){const x=(i%6)*37,y=Math.floor(i/6)*41,[u,v]=transform(expected,x,y);pairs.push({x,y,u:u+Math.sin(i)*.5,v:v+Math.cos(i)*.5});}
  for(let i=0;i<50;i++)pairs.push({x:i*17%300,y:i*71%300,u:i*91%1000,v:i*47%1000});
  const actual=consensus(pairs);assert.ok(actual);assert.ok(actual.inliers.length>=30);
  const point=transform(actual.model,100,120),target=transform(expected,100,120);assert.ok(Math.hypot(point[0]-target[0],point[1]-target[1])<1);
});
const candidate=(id,inliers=40,cells=8)=>({id,inliers,cells,score:inliers+cells*1.5,area:25000});

test('initial partial map immediately previews first place without locking',()=>{
  const r=new Evidence().observe([candidate(20034,9),candidate(20040,10)],'initial','map');
  assert.equal(r.selected,20040);assert.equal(r.locked,null);assert.equal(r.state,'preview');
});
test('preview follows current rank rather than old accumulated support',()=>{
  const e=new Evidence();e.observe([candidate(20040,150),candidate(20034,140)],'a','map');
  const r=e.observe([candidate(20034,199),candidate(20040,170)],'b','map');
  assert.equal(r.selected,20034);assert.equal(r.locked,null);
});
test('200 exactly locks, 199 does not, and weighted score never triggers the threshold',()=>{
  const e=new Evidence();assert.equal(e.observe([candidate(20040,199)],'below','map').locked,null);
  const r=e.observe([candidate(20040,200),candidate(20034,199)],'threshold','map');
  assert.equal(r.locked,20040);assert.equal(r.lockedMatches,200);
});
test('340 vs 305 locks first place; later higher candidates cannot change it',()=>{
  const e=new Evidence();e.observe([candidate(20040,340),candidate(20034,305)],'a','map');
  const r=e.observe([candidate(20034,900),candidate(20040,220)],'b','map');
  assert.equal(r.locked,20040);assert.equal(r.selected,20040);assert.equal(r.lockedMatches,340);
});
test('ranking uses displayed matches even when weighted scores disagree',()=>{
  const r=new Evidence().observe([candidate(20034,202,20),candidate(20040,210,2)],'count','map');
  assert.equal(r.locked,20040);assert.equal(r.ranked[0].id,20040);
});
test('repeated weak frames never accumulate into a lock; reset releases a strong lock',()=>{
  const e=new Evidence();for(let i=0;i<10;i++)e.observe([candidate(20040,184)],'same','map');
  assert.equal(e.locked,null);assert.equal(e.frames.length,1);
  e.observe([candidate(20040,340)],'strong','map');e.reset();
  const r=e.observe([candidate(20036,30)],'new-game','map');assert.equal(r.locked,null);assert.equal(r.selected,20036);
});
test('non-map and blank frames never select and preserve an existing preview',()=>{
  const e=new Evidence();for(const kind of ['mini','none'])assert.equal(e.observe([candidate(20040,340)],kind,kind).selected,null);
  e.observe([candidate(20040,10)],'small-map','map');
  assert.equal(e.observe([],'gameplay','none').selected,20040);
});
test('invalid tiny matches cannot preview a map',()=>{
  const r=new Evidence().observe([candidate(20040,5),candidate(20034,20,1)],'noise','map');
  assert.equal(r.selected,null);assert.equal(r.locked,null);
});
const {FrameQueue,similar}=require('../../app/recognition-screen.js');
const frame=(id,mapOpen=true)=>({id,mapOpen,source:'live',signature:Array(576).fill(id)});
test('M burst queue is bounded and later gameplay cannot evict captured maps',()=>{
  const q=new FrameQueue();for(let i=0;i<30;i++)q.push(frame(i*3));
  assert.equal(q.items.length,3);const ids=q.items.map(f=>f.id);q.push(frame(100,false));
  assert.deepEqual(q.items.map(f=>f.id),ids);assert.equal(q.items.at(-1).id,87);
});
test('compression noise and duplicate M frames do not create queued work',()=>{
  const q=new FrameQueue(),a=frame(3),b=frame(3);b.signature[0]=8;
  assert.equal(similar(a.signature,b.signature),true);assert.equal(q.push(a),true);assert.equal(q.push(b),false);
  q.clear();assert.equal(q.push(a),true);
});
