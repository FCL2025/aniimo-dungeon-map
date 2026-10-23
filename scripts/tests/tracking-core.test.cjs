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

test('sustained fast movement reacquires from three coherent observations',()=>{
  for(const step of [[80,0],[48,64]]){
    const gate=new PositionGate();gate.accept([200,200],1000);
    const results=[];
    for(let i=1;i<=10;i++)results.push(gate.accept([200+step[0]*i,200+step[1]*i],1000+100*i));
    assert.deepEqual(results,[false,false,true,false,false,true,false,false,true,false]);
    assert.deepEqual(gate.last.pixel,[200+step[0]*9,200+step[1]*9]);
  }
});
test('moving reacquisition rejects erratic, excessive and stale jumps',()=>{
  for(const samples of [
    [[500,200,1100],[580,200,1200],[500,280,1300]],
    [[500,200,1100],[660,200,1200],[820,200,1300]],
    [[500,200,1100],[580,200,1800],[660,200,1900]],
  ]){
    const gate=new PositionGate();gate.accept([200,200],1000);
    for(const [x,y,t] of samples)assert.equal(gate.accept([x,y],t),false);
    assert.deepEqual(gate.last.pixel,[200,200]);
  }
});
test('duplicate observations cannot complete moving reacquisition or survive reset',()=>{
  const gate=new PositionGate();gate.accept([200,200],1000);
  assert.equal(gate.accept([500,200],1100),false);
  assert.equal(gate.accept([580,200],1200),false);
  assert.equal(gate.accept([660,200],1200),false);
  assert.equal(gate.accept([660,200],1300),true);
  gate.reset();assert.equal(gate.accept([200,200],2000),true);
  assert.equal(gate.accept([740,200],2100),false);
});
test('moving confirmation uses capture intervals and expires across scale changes',()=>{
  const gate=new PositionGate();gate.accept([200,200],1000);
  assert.equal(gate.accept([500,200],1100),false);
  assert.equal(gate.accept([580,200],1200),false);
  assert.equal(gate.accept([700,200],1350),true);
  assert.equal(gate.accept([900,200],1450,true),false);
  assert.equal(gate.accept([980,200],1550,true),false);
  assert.equal(gate.accept([1060,200],1650,true),false);
});

test('the same fast velocity reacquires despite slower or irregular capture intervals',()=>{
  for(const intervals of [[250,250,250],[400,400,400],[600,600,600],[100,250,400]]){
    const gate=new PositionGate();gate.accept([200,200],1000);
    let at=1000,x=200;
    const accepted=intervals.map(dt=>{at+=dt;x+=dt*.8;return gate.accept([x,200],at);});
    assert.deepEqual(accepted,[false,false,true],`intervals: ${intervals}`);
    assert.deepEqual(gate.last.pixel,[x,200]);
  }
});

test('slower capture still rejects excessive speed and expired motion evidence',()=>{
  for(const samples of [
    [[500,200,1250],[800,200,1500],[1100,200,1750]],
    [[400,200,1250],[880.8,200,1851],[1080.8,200,2101]],
  ]){
    const gate=new PositionGate();gate.accept([200,200],1000);
    for(const [x,y,at] of samples)assert.equal(gate.accept([x,y],at),false);
    assert.deepEqual(gate.last.pixel,[200,200]);
  }
});

test('a scale change discards pending motion before collecting three fresh observations',()=>{
  const gate=new PositionGate();gate.accept([200,200],1000);
  for(const [x,at,confirm] of [[500,1100,false],[580,1200,false],[660,1300,true],[740,1400,false],[820,1500,false]]){
    assert.equal(gate.accept([x,200],at,confirm),false);
  }
  assert.equal(gate.accept([900,200],1600),true);
});
