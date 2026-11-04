const {test}=require('node:test'),assert=require('node:assert/strict');
const {vector,direction,candidates,distanceHint}=require('../../app/manual-map-core.js');
const ids=require('../../exports/grab-eggs-data/map-pool.json').mapIds;
// Current scene exports include the rebuilt 20031 and both new scenes.
const maps=ids.map(id=>{
  const record=require(`../../exports/grab-eggs-data/maps/${id}.json`);
  return {id,portalGeometry:Object.fromEntries(['entrance','exit'].map(kind=>{
    const pins=record.pins.filter(pin=>pin.category===kind&&pin.provenance==='scene_reference');
    assert.equal(pins.length,1);return [kind,pins[0].pixel];
  }))};
});
const matching=dir=>candidates(maps,dir).map(map=>map.id);
const at=angle=>({portalGeometry:{entrance:[100,100],exit:[100+100*Math.cos(angle*Math.PI/180),100+100*Math.sin(angle*Math.PI/180)]}});
test('all twelve current maps retain their primary directions, including rebuilt 20031',()=>{
  assert.deepEqual(Object.fromEntries(maps.map(map=>[map.id,direction(map)])),{
    20031:'upLeft',20032:'right',20033:'right',20034:'down',20035:'upRight',20036:'left',
    20037:'downRight',20038:'upRight',20039:'up',20040:'left',20061:'downLeft',20062:'upLeft'
  });
});
test('boundary candidates remain findable from both plausible directions, primary maps first',()=>{
  assert.deepEqual(matching('right'),[20032,20033,20037,20038]);
  assert.deepEqual(matching('downRight'),[20037,20034]);
  assert.deepEqual(matching('down'),[20034,20061]);
  assert.deepEqual(matching('downLeft'),[20061,20036]);
  assert.deepEqual(matching('left'),[20036,20040]);
  assert.deepEqual(matching('upLeft'),[20031,20062]);
  assert.deepEqual(matching('up'),[20039]);
  assert.deepEqual(matching('upRight'),[20035,20038]);
  assert.deepEqual(matching(null),ids);
  assert.deepEqual(matching('invalid'),[]);
  assert.deepEqual(maps.map(m=>m.id),ids);
});
test('manual tolerance has a bounded edge and wraps across west correctly',()=>{
  assert.equal(candidates([at(30.499)],'right').length,1);
  assert.equal(candidates([at(30.501)],'right').length,0);
  assert.equal(candidates([at(-30.499)],'right').length,1);
  assert.equal(candidates([at(-30.501)],'right').length,0);
  assert.equal(candidates([at(179),at(-179)],'left').length,2);
  assert.equal(candidates([at(149.499)],'left').length,0);
  assert.equal(candidates([at(-149.501)],'left').length,1);
});
test('relative geometry is invariant to translation and uniform zoom',()=>{
  for(const map of maps){
    const transform=point=>point.map(n=>n*2.5+373);
    const changed={portalGeometry:{entrance:transform(map.portalGeometry.entrance),exit:transform(map.portalGeometry.exit)}};
    assert.equal(direction(changed),direction(map));
    assert.ok(Math.abs(vector(changed).angle-vector(map).angle)<1e-9);
    assert.ok(Math.abs(vector(changed).distance-vector(map).distance*2.5)<1e-9);
  }
});
test('distance labels distinguish near-parallel maps without implying tiny differences matter',()=>{
  assert.deepEqual(Object.fromEntries(maps.map(map=>[map.id,distanceHint(map,maps)])),{
    20031:null,20032:'nearer',20033:'farther',20034:null,20035:'farther',20036:null,
    20037:null,20038:'nearer',20039:null,20040:null,20061:null,20062:null
  });
});
test('missing, malformed, nonfinite and coincident portals stay out of direction filters',()=>{
  for(const map of [{},{portalGeometry:{}},{portalGeometry:{entrance:[0,0],exit:[0,0]}},
    {portalGeometry:{entrance:[NaN,0],exit:[1,2]}},{portalGeometry:{entrance:[0,0],exit:[Infinity,2]}},
    {portalGeometry:{entrance:[0],exit:[1,2]}}]){
    assert.equal(vector(map),null);assert.equal(direction(map),null);
    assert.deepEqual(candidates([map],'right'),[]);
    assert.deepEqual(candidates([map],null),[map]);
  }
});
