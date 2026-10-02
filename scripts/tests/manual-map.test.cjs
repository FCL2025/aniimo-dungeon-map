const {test}=require('node:test'),assert=require('node:assert/strict');
const {direction,candidates}=require('../../app/manual-map-core.js');
const audit=require('../../exports/recognition-fixtures/portal-geometry.json');
const ids=[20032,20034,20035,20036,20037,20039,20040];
const maps=ids.map(id=>({id,portalGeometry:audit.maps.find(row=>row.id===id)}));
test('direction follows entrance-to-exit screen geometry for the supported maps',()=>{
  assert.deepEqual(Object.fromEntries(maps.map(map=>[map.id,direction(map)])),{
    20032:'right',20034:'down',20035:'upRight',20036:'left',20037:'downRight',20039:'up',20040:'left'
  });
});
test('ambiguous westward exits retain both maps; empty and all directions stay explicit',()=>{
  assert.deepEqual(candidates(maps,'left').map(map=>map.id),[20036,20040]);
  assert.deepEqual(candidates(maps,'downLeft'),[]);
  assert.deepEqual(candidates(maps,null).map(map=>map.id),ids);
});
test('direction uses relative portals, not map center, and handles missing geometry',()=>{
  assert.equal(direction({portalGeometry:{entrance:[1800,1900],exit:[1700,1900]}}),'left');
  assert.equal(direction({portalGeometry:{entrance:[10,10],exit:[10,10]}}),null);
  assert.equal(direction({}),null);
});
