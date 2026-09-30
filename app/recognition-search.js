/* Search common dungeons first; priority never changes terrain scores. */
(function(root){
  'use strict';
  const COMMON=Object.freeze([20032,20034,20035,20040,20037,20036,20039]);
  function partition(references,priority=COMMON){
    const byId=new Map(references.map(r=>[r.id,r]));
    const common=[...new Set(priority)].map(id=>byId.get(id)).filter(Boolean);
    const ids=new Set(common.map(r=>r.id));
    return {common,other:references.filter(r=>!ids.has(r.id))};
  }
  async function search({references,near,direction,evaluate,agrees,compare,priority=COMMON}){
    const groups=partition(references,priority),seen=new Set(),scores=[],order=[];
    const nearIds=new Set(near.map(r=>r.id)),directionIds=new Set(direction.map(r=>r.id));
    for(const group of ['common','other']){
      const refs=groups[group];
      for(const [filter,items] of [
        ['default-distance',refs.filter(r=>nearIds.has(r.id))],
        ['direction',refs.filter(r=>directionIds.has(r.id))],
        ['terrain',refs],
      ]){
        let added=false;
        for(const r of items){
          if(seen.has(r.id))continue;
          seen.add(r.id);order.push(r.id);added=true;
          const result=await evaluate(r);if(result)scores.push(result);
        }
        if(!added)continue;
        scores.sort(compare);
        const best=scores.find(s=>s.inliers>=6&&s.cells>=2);
        // Similar rooms alone must not suppress an uncommon map. Both fixed
        // doors must agree with the independently estimated terrain transform.
        if(best&&agrees(best,references.find(r=>r.id===best.id)))
          return {scores,order,confirmed:true,confirmedId:best.id,group,filter};
      }
    }
    return {scores,order,confirmed:false,group:null,filter:null};
  }
  const api={COMMON,partition,search};
  if(typeof module==='object'&&module.exports)module.exports=api;else root.MapSearch=api;
})(typeof self==='object'?self:globalThis);
