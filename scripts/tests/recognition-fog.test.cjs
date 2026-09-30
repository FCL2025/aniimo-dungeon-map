const test=require('node:test'),assert=require('node:assert/strict');
const Fog=require('../../app/recognition-fog.js'),Core=require('../../app/recognition-core.js');
const data=require('../../app/fog-references.json');
const candidate={id:20034,inliers:13,cells:3,area:2000,error:1,score:17,model:{a:1.266667,b:0,tx:-200,ty:20}};
const exit=[500,450],reference={id:20034,portals:{entrance:[100,100],exit:Core.transform(candidate.model,...exit)}};
test('all five labelled references have valid sparse terrain descriptors',()=>{
  assert.deepEqual(data.samples.map(s=>s.id),[20032,20034,20035,20037,20040]);
  for(const s of data.samples){assert.ok(Fog.valid(s));assert.deepEqual(s.source.size,[1920,1080]);}
});
test('incomplete, nonfinite and malformed reference data is rejected',()=>{
  const s=data.samples[0];
  for(const bad of [{...s,descriptors:s.descriptors.slice(1)},{...s,points:[[NaN,0],...s.points.slice(1)]},{...s,descriptors:s.descriptors.map((v,i)=>i?v:256)}])assert.equal(Fog.valid(bad),false);
});
test('terrain and side door must share the expected resolution-scaled transform',()=>{
  assert.ok(Fog.agrees(candidate,reference,exit,.625));
  assert.equal(Fog.agrees(candidate,reference,[exit[0]+30,exit[1]],.625),false);
  assert.equal(Fog.agrees(candidate,reference,exit,1),false);
  assert.equal(Fog.agrees(candidate,reference,null,.625),false);
});
test('weak, concentrated, rotated and inaccurate terrain cannot take the shortcut',()=>{
  for(const patch of [{inliers:7},{cells:1},{area:100},{error:3},{model:{...candidate.model,b:.15}}])
    assert.equal(Fog.agrees({...candidate,...patch},reference,exit,.625),false);
});
test('a closer unsampled dungeon or indistinguishable door vector rejects an otherwise valid match',()=>{
  const shifted={...candidate,model:{...candidate.model,tx:candidate.model.tx+6}};
  const other={id:20052,portals:{entrance:reference.portals.entrance,exit:[reference.portals.exit[0]+6,reference.portals.exit[1]]}};
  assert.ok(Fog.agrees(shifted,reference,exit,.625));
  assert.equal(Fog.agrees(shifted,reference,exit,.625,[reference,other]),false);
  assert.ok(Fog.agrees(candidate,reference,exit,.625,[reference,other]));
  assert.equal(Fog.agrees(candidate,reference,exit,.625,[reference,{...other,portals:reference.portals}]),false);
});
test('ambiguous fog matches continue the normal search',()=>{
  assert.equal(Fog.choose([candidate,{...candidate,id:20035,inliers:12}],Core.compareCandidates),null);
  assert.equal(Fog.choose([candidate,{...candidate,id:20035,inliers:9}],Core.compareCandidates).id,20034);
});
test('default-scale terrain fit rejects descriptor outliers without letting a tiny room change zoom',()=>{
  const pairs=Array.from({length:20},(_,i)=>({x:10+i*3,y:20+i%5*7,u:1.25*(10+i*3)+15+(i%3-1)*.4,v:1.25*(20+i%5*7)-30}));
  pairs.push(...Array.from({length:10},(_,i)=>({x:100+i,y:100+i,u:i*23,v:i*17})));
  const result=Fog.consensus(pairs,1.25);assert.equal(result.inliers.length,20);
  assert.equal(result.model.a,1.25);assert.equal(result.model.b,0);assert.ok(Math.abs(result.model.tx-15)<.1);
  assert.equal(Fog.consensus(pairs.slice(0,7),1.25),null);
});
test('sparse fog gate excludes explored terrain',()=>{
  const pixels={width:120,height:80,data:new Uint8ClampedArray(120*80*4)};
  for(let i=0;i<pixels.data.length;i+=4)pixels.data.set([65,75,95,255],i);
  assert.ok(Fog.sparse(pixels));
  for(let i=0;i<pixels.data.length;i+=4)pixels.data.set([145,135,125,255],i);
  assert.equal(Fog.sparse(pixels),false);
});
