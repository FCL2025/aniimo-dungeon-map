const test=require('node:test');
const assert=require('node:assert/strict');
const {COMMON,partition,search}=require('../../app/recognition-search.js');
const {compareCandidates}=require('../../app/recognition-core.js');
const refs=[20031,...Array.from({length:29},(_,i)=>20032+i),29999].map(id=>({id}));
const byId=id=>refs.find(r=>r.id===id);
const candidate=(id,inliers=10)=>({id,inliers,cells:4,score:inliers});
function run(overrides={}){
  return search({references:refs,near:[],direction:[],evaluate:r=>candidate(r.id),agrees:()=>false,compare:compareCandidates,...overrides});
}
test('preload exactly the eight requested maps in user order',()=>{
  assert.deepEqual(COMMON,[20032,20034,20035,20040,20037,20036,20038,20039]);
  const {common,other}=partition(refs);
  assert.deepEqual(common.map(r=>r.id),COMMON);assert.equal(other.length,23);
  assert.equal(new Set([...common,...other].map(r=>r.id)).size,31);
});
test('a common map with verified doors ends the search before other maps',async()=>{
  const result=await run({near:[byId(20050),byId(20040)],agrees:s=>s.id===20040});
  assert.deepEqual(result.order,[20040]);assert.equal(result.group,'common');
  assert.equal(result.filter,'default-distance');assert.equal(result.scores[0].inliers,10);
});
test('all added common maps can take the fast path',async()=>{
  for(const id of [20036,20038,20039]){
    const result=await run({near:[byId(id)],agrees:s=>s.id===id});
    assert.deepEqual(result.order,[id]);assert.equal(result.group,'common');
  }
});
test('similar common doors do not exclude uncommon 20052 or 20058',async()=>{
  for(const [common,other] of [[20034,20052],[20032,20058]]){
    const result=await run({near:[byId(common),byId(other)],direction:[byId(common),byId(other)],
      evaluate:r=>candidate(r.id,r.id===other?100:10),agrees:s=>s.id===other});
    assert.equal(result.group,'other');assert.equal(result.scores[0].id,other);
    assert.equal(result.order.length,9);assert.equal(result.order[8],other);
    assert.deepEqual(new Set(result.order.slice(0,8)),new Set(COMMON));
  }
});
test('even high common terrain scores without agreeing doors must search all maps',async()=>{
  const result=await run({evaluate:r=>candidate(r.id,r.id===20058?350:220)});
  assert.equal(result.confirmed,false);assert.equal(result.scores[0].id,20058);
  assert.deepEqual(result.order.slice(0,8),COMMON);assert.equal(result.order.length,31);
});
test('wrong distance hint retries common direction before unrelated maps, without repeating work',async()=>{
  const result=await run({near:[byId(20050)],direction:[byId(20050),byId(20040)],agrees:s=>s.id===20040});
  assert.deepEqual(result.order,[20040]);assert.equal(result.filter,'direction');
});
test('exhaustive fallback scores every reference once despite overlapping stages',async()=>{
  const result=await run({near:refs,direction:refs});
  assert.equal(result.order.length,31);assert.equal(new Set(result.order).size,31);
  assert.deepEqual(result.order.slice(0,8),COMMON);
});
test('absent or repeated preferred IDs cannot hide remaining references',async()=>{
  const result=await run({priority:[20040,20040,99999]});
  assert.equal(result.order[0],20040);assert.equal(result.order.length,31);
  assert.deepEqual(partition(refs,[]).other,refs);
});
