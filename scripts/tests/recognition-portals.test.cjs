const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {geometry,shortlist,defaultShortlist,agrees,doorHypotheses,vectorSeparation,vectorTolerance}=require('../../app/recognition-portals.js');
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
test('similar door geometry in an unscored map prevents early confirmation',()=>{
  const ref=references.find(r=>r.id===20040),seen=observation(ref),score={model:{a:1,b:0,tx:0,ty:0},inliers:10,cells:4,error:1};
  const other={id:99999,portals:{...ref.portals,exit:[ref.portals.exit[0]+1,ref.portals.exit[1]]}};
  assert.equal(agrees(score,ref,seen,[ref,other]),false);
  assert.equal(agrees(score,ref,seen,[ref]),true);
  assert.equal(agrees({...score,error:4},ref,seen,[ref]),false);
});

// Current pool, straight from the exported map pins (same rule as analyze_portal_geometry.py).
const PIXELS_PER_MAP_PIXEL_1080=.63158;
const pool=JSON.parse(fs.readFileSync(path.join(__dirname,'../../exports/grab-eggs-data/map-pool.json'),'utf8')).mapIds.map(id=>{
  const map=JSON.parse(fs.readFileSync(path.join(__dirname,`../../exports/grab-eggs-data/maps/${id}.json`),'utf8'));
  const pin=kind=>map.pins.find(p=>p.category===kind&&p.provenance==='scene_reference').pixel;
  const entrance=pin('entrance'),exit=pin('exit'),distance=Math.hypot(exit[0]-entrance[0],exit[1]-entrance[1]);
  return {id,portals:geometry({size:map.size,portalGeometry:{entrance,exit,defaultDistance1080:distance*PIXELS_PER_MAP_PIXEL_1080}})};
});
const screenDoors=(ref,uiScale,offset=[0,0],error=[0,0])=>{
  const [vx,vy]=ref.portals.vector1080,entrance=[600*uiScale+offset[0],500*uiScale+offset[1]];
  return {entrance:[entrance[0]+error[0],entrance[1]+error[1]],exit:[entrance[0]+vx*uiScale,entrance[1]+vy*uiScale]};
};

test('door vectors of the current pool are far apart compared with the tolerance',()=>{
  assert.equal(pool.length,12);
  const tolerance=Math.max(...pool.map(r=>vectorTolerance(r.portals.vector1080)));
  // Closest pair (20032/20033) differs by ~103 px at 1080p; icons are found to a few pixels.
  assert.ok(vectorSeparation(pool)>=3*tolerance,`separation ${vectorSeparation(pool)} vs tolerance ${tolerance}`);
});

test('both doors select exactly one dungeon at any resolution, pan and icon error',()=>{
  for(const ref of pool)for(const uiScale of [.333,.5,.625,1,1.333,2])for(const error of [[0,0],[5,-4],[-6,6]]){
    const doors=screenDoors(ref,uiScale,[uiScale*37,-uiScale*23],error.map(v=>v*uiScale/.625));
    const result=doorHypotheses(pool,doors,uiScale);
    assert.ok(result.matched,`${ref.id} at ${uiScale}`);
    assert.deepEqual(result.items.map(h=>h.id),[ref.id],`${ref.id} at ${uiScale} with ${error}`);
    const [x,y]=result.items[0].entrance;
    assert.ok(Math.hypot(x-doors.entrance[0],y-doors.entrance[1])<=12*uiScale/.625);
  }
});

test('a missing or inconsistent front door falls back to one hypothesis per dungeon',()=>{
  const ref=pool[0],doors=screenDoors(ref,.625);
  for(const observed of [{exit:doors.exit},{exit:doors.exit,entrance:[doors.entrance[0]+80,doors.entrance[1]-60]}]){
    const result=doorHypotheses(pool,observed,.625);
    assert.equal(result.matched,false);assert.equal(result.items.length,pool.length);
    const own=result.items.find(h=>h.id===ref.id);
    assert.ok(Math.hypot(own.entrance[0]-doors.entrance[0],own.entrance[1]-doors.entrance[1])<1e-6);
  }
  assert.deepEqual(doorHypotheses(pool,null,.625).items,[]);
  assert.deepEqual(doorHypotheses(pool,{entrance:doors.entrance},.625).items,[]);
  assert.deepEqual(doorHypotheses(pool,doors,0).items,[]);
});
