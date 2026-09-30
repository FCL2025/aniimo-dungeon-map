const {test}=require('node:test');
const assert=require('node:assert/strict');
const {PositionGate,validMatch,consistentModel,nearbyPairs}=require('../../app/tracking-core.js');
const {relativeRegion}=require('../../app/recognition-screen.js');
test('first position is immediate and old samples cannot rewind tracking',()=>{
  const gate=new PositionGate();assert.ok(gate.accept([500,700],1000));assert.ok(!gate.accept([499,699],999));assert.ok(gate.accept([510,710],1100));
});
test('one large outlier is rejected but two consistent positions reacquire without a four second wait',()=>{
  const gate=new PositionGate();gate.accept([500,700],1000);assert.ok(!gate.accept([1000,1200],1100));assert.ok(gate.accept([1006,1202],1200));
  assert.ok(!gate.accept([200,300],1300));assert.ok(gate.accept([1010,1204],1400));
});
test('brief loss still rejects a remote false match and two observations reacquire',()=>{
  const gate=new PositionGate();gate.accept([500,700],1000);assert.ok(!gate.accept([1000,1200],2600));assert.ok(gate.accept([1004,1202],2700));gate.reset();assert.ok(gate.accept([50,80],2800));
  assert.ok(!gate.accept([NaN,20],2800));assert.ok(!gate.accept([3000,20],2800));
});
test('movement limit rejects fast drift, malformed positions and duplicated reacquisition frames',()=>{
  const gate=new PositionGate();gate.accept([500,700],1000);
  assert.ok(!gate.accept([580,700],1100));assert.ok(!gate.accept([580,700],1100));
  assert.ok(gate.accept([583,700],1200));
  for(const pixel of [[],[1],[1,2,3],{},null])assert.ok(!gate.accept(pixel,1400));
  assert.ok(gate.accept([1300,1200],7000));
});
test('changes in minimap scale or orientation require consistent reacquisition',()=>{
  const model={a:.5,b:0,tx:100,ty:200};
  assert.ok(consistentModel({...model,a:.52},model));
  assert.ok(!consistentModel({...model,a:1.2},model));
  assert.ok(!consistentModel({...model,a:0,b:.5},model));
  const gate=new PositionGate();gate.accept([500,700],1000);
  assert.ok(!gate.accept([505,700],1100,true));assert.ok(gate.accept([506,700],1200,true));
});
test('global matches require stronger, distributed, accurate terrain',()=>{
  const match={model:{a:.5,b:0,tx:100,ty:200},inliers:9,cells:2,error:1,area:800};
  assert.ok(validMatch(match));assert.ok(!validMatch(match,true));
  assert.ok(validMatch({...match,inliers:14,cells:3},true));
  for(const patch of [{area:50},{error:4},{model:{...match.model,a:NaN}}])assert.ok(!validMatch({...match,...patch}));
  const pairs=[{x:10,y:10,u:105,v:205},{x:10,y:10,u:205,v:305}];
  assert.deepEqual(nearbyPairs(pairs,match.model,30),[pairs[0]]);
});
test('native crop coordinates map back to the same minimap region',()=>{
  const source=[81/1920,41/1080,202/1920,202/1080],region=[.0427,.0389,.1042,.1852],relative=relativeRegion(region,source);
  assert.ok(Math.abs(relative[0]*202+81-region[0]*1920)<1e-8);
  assert.ok(Math.abs(relative[2]*202-region[2]*1920)<1e-8);
  assert.deepEqual(relativeRegion(region),region);
});
