const {test,before}=require('node:test'),assert=require('node:assert/strict');
const cv=require('../../app/vendor/opencv.js');
const geometry=require('../../app/recognition-core.js');
const {TerrainFlow,composeInverse}=require('../../app/tracking-flow.js');
const {PositionGate}=require('../../app/tracking-core.js');
before(()=>new Promise(resolve=>cv.then(()=>resolve())));

// A deterministic, textured terrain with known motion. These are not game FPS/accuracy measurements.
function texture(seed=123){
  const size=400,data=new Uint8ClampedArray(size*size*4);
  const random=()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed>>>24;};
  const coarse=Array.from({length:100*100},random);
  for(let y=0;y<size;y++)for(let x=0;x<size;x++){
    const value=coarse[Math.floor(y/4)*100+Math.floor(x/4)];
    const i=(y*size+x)*4;data[i]=data[i+1]=data[i+2]=value;data[i+3]=255;
  }
  return {width:size,height:size,data};
}
function frame(source,dx=0,dy=0){
  const data=new Uint8ClampedArray(200*200*4);
  for(let y=0;y<200;y++)for(let x=0;x<200;x++){
    const src=((y+100+dy)*source.width+x+100+dx)*4;
    data.set(source.data.subarray(src,src+4),(y*200+x)*4);
  }
  return {width:200,height:200,data};
}
function corners(pixels){
  const rgba=cv.matFromImageData(pixels),gray=new cv.Mat(),points=new cv.Mat(),mask=new cv.Mat();
  try{
    cv.cvtColor(rgba,gray,cv.COLOR_RGBA2GRAY);cv.goodFeaturesToTrack(gray,points,200,.01,8,mask);
    const result=[];for(let i=0;i<points.rows;i++)result.push([points.data32F[i*2],points.data32F[i*2+1]]);
    return result;
  }finally{rgba.delete();gray.delete();points.delete();mask.delete();}
}
const base={a:2,b:0,tx:100,ty:100};
function anchored(source=texture()){
  const flow=new TerrainFlow(cv,geometry),pixels=frame(source);
  flow.begin(pixels,1000);flow.commit(base,corners(pixels),1000);
  assert.ok(flow.last,'Fixture must have distributed terrain');return flow;
}

test('inverse motion composes with rotated/scaled map coordinates',()=>{
  const m={a:1.02,b:.03,tx:-19,ty:6},b={a:1.4,b:.5,tx:320,ty:220};
  const next=composeInverse(b,m),oldPoint=[80,130],newPoint=geometry.transform(m,...oldPoint);
  const wanted=geometry.transform(b,...oldPoint),actual=geometry.transform(next,...newPoint);
  assert.ok(Math.hypot(actual[0]-wanted[0],actual[1]-wanted[1])<1e-8);
});
test('real Lucas-Kanade supports fast movement instead of dropping two of three updates',()=>{
  const source=texture(),flow=anchored(source),gate=new PositionGate();gate.accept([600,600],1000);
  try{
    for(let i=1;i<=4;i++){
      const pixels=frame(source,20*i),at=1000+i*100;
      const motion=flow.begin(pixels,at);
      assert.equal(motion.valid,true,JSON.stringify(motion));
      const wanted=[600+80*i,600];
      assert.ok(Math.hypot(motion.pixel[0]-wanted[0],motion.pixel[1]-wanted[1])<2);
      assert.equal(gate.accept(wanted,at,false,motion),true);
      flow.commit({...base,tx:100+40*i},corners(pixels),at);
    }
  }finally{flow.reset();}
});
test('blank overlays and unrelated terrain cannot extend the previous floor',()=>{
  for(const next of [{width:200,height:200,data:new Uint8ClampedArray(200*200*4)},frame(texture(98765))]){
    const flow=anchored();try{assert.equal(flow.begin(next,1100).valid,false);}finally{flow.reset();}
  }
});
test('flow bridges expire even when successive frames still track',()=>{
  const source=texture(),flow=anchored(source);
  try{
    for(let i=1;i<=6;i++){
      const motion=flow.begin(frame(source,i*2),1000+i*100);
      assert.equal(motion.valid,true);flow.commit(motion.model,motion.observed,motion.anchorAt);
    }
    assert.equal(flow.begin(frame(source,14),1700).reason,'expired');
    flow.reset();assert.equal(flow.begin(frame(source,14),1800).reason,'no-anchor');
  }finally{flow.reset();}
});
test('capture gaps, duplicate timestamps and resized minimaps reset continuity',()=>{
  for(const [pixels,at,reason] of [[frame(texture()),1000,'expired'],[frame(texture()),1601,'expired'],
    [{width:201,height:200,data:new Uint8ClampedArray(201*200*4)},1100,'size-change']]){
    const flow=anchored();try{assert.equal(flow.begin(pixels,at).reason,reason);}finally{flow.reset();}
  }
});
test('flow evidence cannot bypass jump protection for a different position or timestamp',()=>{
  for(const patch of [{pixel:[900,900]},{at:1099},{fromAt:999},{anchorAt:399},{anchorAt:1200},{valid:false}]){
    const gate=new PositionGate();gate.accept([600,600],1000);
    const motion={valid:true,pixel:[680,600],at:1100,fromAt:1000,anchorAt:1000,...patch};
    assert.equal(gate.accept([680,600],1100,false,motion),false,JSON.stringify(patch));
  }
  const gate=new PositionGate();gate.accept([600,600],1000);
  assert.equal(gate.accept([680,600],1100,true,{valid:true,pixel:[680,600],at:1100,fromAt:1000,anchorAt:1000}),false);
});
