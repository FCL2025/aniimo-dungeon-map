const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {geometry,shortlist,defaultShortlist,agrees}=require('../../app/recognition-portals.js');
const {transform}=require('../../app/recognition-core.js');
const report=JSON.parse(fs.readFileSync(path.join(__dirname,'../../exports/recognition-fixtures/portal-geometry.json'),'utf8'));
const references=report.maps.map(m=>({id:m.id,portals:geometry({size:m.size,portalGeometry:m})}));
const observation=(ref,scale=1,offset=[0,0])=>Object.fromEntries(['entrance','exit'].map(k=>[k,ref.portals[k].map((v,i)=>v*scale+offset[i])]));

test('all 31 maps survive direction filtering at different resolutions, zooms and pans',()=>{
  assert.equal(references.length,31);
  for(const ref of references)for(const scale of [.3,.7,1,2.8]){
    const candidates=shortlist(references,observation(ref,scale,[271,-110]));
    assert.ok(candidates.some(r=>r.id===ref.id),`${ref.id} at ${scale}`);
    assert.ok(candidates.length<=6);
  }
});

test('near-identical distances with different directions do not become the same candidate',()=>{
  const a=references.find(r=>r.id===20031),b=references.find(r=>r.id===20034);
  assert.ok(Math.abs(a.portals.distance-b.portals.distance)<1);
  assert.ok(!shortlist(references,observation(a)).includes(b));
});

test('direction wraps correctly around -180/180 and keeps ambiguous parallel maps',()=>{
  const r=references.find(r=>r.id===20040);
  const ids=shortlist(references,observation(r)).map(r=>r.id);
  assert.deepEqual(ids,[20040,20050]);
});

test('default farthest-view distance preserves all maps across resolutions, pans and capture scales',()=>{
  for(const ref of references)for(const uiScale of [.4,.625,1,1.5,2]){
    const scale=ref.portals.defaultDistance1080/ref.portals.distance*uiScale;
    const seen=observation(ref,scale,[105,-17]);
    const candidates=defaultShortlist(references,seen,uiScale);
    assert.ok(candidates.includes(ref),`${ref.id} at UI scale ${uiScale}`);
    assert.ok(candidates.length<=2);
    seen.exit[0]+=4*uiScale;seen.exit[1]-=3*uiScale;
    assert.ok(defaultShortlist(references,seen,uiScale).includes(ref),`${ref.id} with icon-center error`);
  }
});

test('default distance separates parallel 20040/20050 but retains genuinely close candidates',()=>{
  for(const [id,expected] of [[20040,[20040]],[20050,[20050]],[20032,[20032,20058]]]){
    const ref=references.find(r=>r.id===id),scale=ref.portals.defaultDistance1080/ref.portals.distance*.625;
    assert.deepEqual(defaultShortlist(references,observation(ref,scale),.625).map(r=>r.id),expected);
  }
});

test('an unsupported zoom or missing calibration leaves the direction fallback available',()=>{
  const ref=references.find(r=>r.id===20040),scale=ref.portals.defaultDistance1080/ref.portals.distance*.625*1.4;
  const seen=observation(ref,scale);
  assert.deepEqual(defaultShortlist(references,seen,.625),[]);
  assert.ok(shortlist(references,seen).includes(ref));
  assert.deepEqual(defaultShortlist(references,seen,0),[]);
  assert.deepEqual(defaultShortlist(references,null,.625),[]);
  const missing=references.map(r=>({...r,portals:{...r.portals,defaultDistance1080:null}}));
  assert.deepEqual(defaultShortlist(missing,seen,.625),[]);
  assert.ok(shortlist(missing,seen).some(r=>r.id===ref.id));
});

test('missing geometry, absent doors, and tiny separations request a full search',()=>{
  assert.equal(geometry({}),null);
  assert.equal(geometry({size:[2048,2048],portalGeometry:{entrance:[NaN,1],exit:[1,2]}}),null);
  assert.deepEqual(shortlist(references,null),[]);
  assert.deepEqual(shortlist([...references,{id:1}],observation(references[0])),[]);
  assert.deepEqual(shortlist(references,{entrance:[20,20],exit:[21,20]}),[]);
});

test('terrain must fit both door positions and distance; door direction never confirms alone',()=>{
  const ref=references.find(r=>r.id===20040),seen=observation(ref,.7,[100,30]);
  const model={a:1/.7,b:0,tx:-100/.7,ty:-30/.7},score={model,inliers:10,cells:4};
  assert.equal(agrees(score,ref,seen),true);
  assert.equal(agrees({...score,inliers:7},ref,seen),false);
  assert.equal(agrees({...score,cells:2},ref,seen),false);
  assert.equal(agrees(null,ref,seen),false);
  assert.equal(agrees(score,ref,{...seen,exit:[seen.exit[0]+80,seen.exit[1]]}),false);
  assert.equal(agrees({...score,model:{...model,tx:model.tx+40}},ref,seen),false);
  assert.equal(agrees(score,references.find(r=>r.id===20050),seen),false);
});

test('rotated evidence cannot skip full matching just because distances agree',()=>{
  const ref=references.find(r=>r.id===20040),seen=observation(ref),t={a:0,b:1,tx:700,ty:0};
  const rotated=Object.fromEntries(Object.entries(seen).map(([k,p])=>[k,transform(t,...p)]));
  assert.ok(!shortlist(references,rotated).includes(ref));
});
