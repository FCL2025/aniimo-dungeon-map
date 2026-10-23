const {test}=require('node:test');
const assert=require('node:assert/strict');
const vm=require('node:vm');
const fs=require('node:fs');
const MapTracking=require('../../app/tracking-core.js');

for(const interval of [100,250])test(`global fallback reacquires moving positions at ${interval}ms capture intervals`,async()=>{
  const results=[],searches=[];
  let pixel;
  const context=vm.createContext({
    importScripts(){},self:{},MapTracking,performance:{now:()=>0},
    decode:async()=>({close(){}}),postMessage:result=>results.push(result),
    MapScreen:{inspect:()=>({mapOpen:false}),relativeRegion:()=>[],defaultMini:()=>[]},
    crop:()=>({pixels:{},width:100,height:100}),
    features:()=>({descriptors:{delete(){}}}),
    MapRecognition:{consensus:pairs=>pairs,transform:model=>[model.tx,model.ty]},
    score(query,reference,filter){
      const model={a:.5,b:0,tx:pixel[0]/2,ty:pixel[1]/2};
      // The translated pair is outside the local prediction radius. Exercise
      // the actual worker fallback and gate without needing OpenCV or a video.
      const pairs=filter([{x:0,y:0,u:model.tx,v:model.ty}]);
      searches.push(reference.id);
      if(!pairs.length)return null;
      return {model,inliers:14,cells:3,error:1,area:800};
    },
  });
  vm.runInContext(fs.readFileSync(require.resolve('../../app/tracking-worker.js'),'utf8'),context);
  vm.runInContext("reference={id:'global'};nearbyReference=()=>({id:'local'});",context);
  for(let i=0;i<7;i++){
    pixel=[200+.8*interval*i,200];
    context.self.onmessage({data:{type:'track',image:{},capturedAt:1000+interval*i,request:i}});
    await vm.runInContext('queue',context);
  }
  assert.ok(results.every(r=>r.type==='result'));
  assert.deepEqual(results.map(r=>!!r.location),[true,false,false,true,false,false,true]);
  assert.equal(searches.filter(s=>s==='global').length,7);
  assert.ok(searches.includes('local'));
});
