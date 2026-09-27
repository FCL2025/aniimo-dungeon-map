const {test}=require('node:test');
const assert=require('node:assert/strict');
const {PositionGate,arrowHeading}=require('../../app/tracking-core.js');
const {relativeRegion}=require('../../app/recognition-screen.js');
test('first position is immediate and old samples cannot rewind tracking',()=>{
  const gate=new PositionGate();assert.ok(gate.accept([500,700],1000));assert.ok(!gate.accept([499,699],999));assert.ok(gate.accept([510,710],1100));
});
test('one large outlier is rejected but two consistent positions reacquire without a four second wait',()=>{
  const gate=new PositionGate();gate.accept([500,700],1000);assert.ok(!gate.accept([1000,1200],1100));assert.ok(gate.accept([1006,1202],1200));
  assert.ok(!gate.accept([200,300],1300));assert.ok(gate.accept([1010,1204],1400));
});
test('stale location and explicit reset allow a fresh position',()=>{
  const gate=new PositionGate();gate.accept([500,700],1000);assert.ok(gate.accept([1000,1200],2600));gate.reset();assert.ok(gate.accept([50,80],2700));
  assert.ok(!gate.accept([NaN,20],2800));assert.ok(!gate.accept([3000,20],2800));
});
test('native crop coordinates map back to the same minimap region',()=>{
  const source=[81/1920,41/1080,202/1920,202/1080],region=[.0427,.0389,.1042,.1852],relative=relativeRegion(region,source);
  assert.ok(Math.abs(relative[0]*202+81-region[0]*1920)<1e-8);
  assert.ok(Math.abs(relative[2]*202-region[2]*1920)<1e-8);
  assert.deepEqual(relativeRegion(region),region);
});
test('yellow minimap arrow reports its facing across rotations',()=>{
  const frame=degrees=>{
    const width=200,height=200,data=new Uint8ClampedArray(width*height*4),angle=degrees*Math.PI/180;
    for(let y=0;y<height;y++)for(let x=0;x<width;x++){
      const dx=x-100,dy=y-100,u=dx*Math.cos(angle)+dy*Math.sin(angle),v=-dx*Math.sin(angle)+dy*Math.cos(angle);
      const i=(y*width+x)*4;data[i]=90;data[i+1]=90;data[i+2]=90;data[i+3]=255;
      if(u>=-11&&u<=17&&Math.abs(v)<(17-u)*.75){data[i]=248;data[i+1]=227;data[i+2]=63;
        if(u<-3&&Math.abs(v)<3){data[i]=250;data[i+1]=250;data[i+2]=220;}}
    }
    return {data,width,height};
  };
  for(const expected of [0,45,90,135,180,225,270,315]){
    const actual=arrowHeading(frame(expected));
    assert.ok(Number.isFinite(actual),`Missing heading at ${expected}°`);
    const error=Math.abs(((actual*180/Math.PI-expected+540)%360)-180);
    assert.ok(error<=10,`Heading ${actual*180/Math.PI}° differs from ${expected}°`);
  }
  const blank={width:200,height:200,data:new Uint8ClampedArray(200*200*4)};
  assert.equal(arrowHeading(blank),null);
});
