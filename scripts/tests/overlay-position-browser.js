// Run with agent-browser eval --stdin on app/frontend/index.html (file access enabled).
// Uses generated minimap fixtures, not real-game accuracy claims.
(() => {
  const state = window.overlayPositionChecks = { done: false, results: [], error: null };
  const worker = new Worker('tracking-worker.js');
  let pending;
  const send = (data, type) => new Promise((resolve, reject) => {
    pending = { type, resolve, reject }; worker.postMessage(data);
  });
  worker.onmessage = ({ data }) => {
    if (data.type === 'error') pending.reject(new Error(data.message));
    else if (data.type === pending.type) pending.resolve(data);
  };
  worker.onerror = event => pending?.reject(new Error(event.message));
  const assert = (condition, message) => { if (!condition) throw new Error(message); };
  const fixture=name=>window.trackingFixtureOverrides?.[name]||new URL('../../exports/recognition-fixtures/'+name,location.href).href;
  (async () => {
    try {
      const started=performance.now(),map=DUNGEON_DATA.maps.find(m=>m.id===20036);
      const ready=await send({ type: 'init', map: { id: map.id, image: new URL(map.image, location.href).href } }, 'ready');
      state.initMs=performance.now()-started;state.features=ready.features;
      for (let i = 0; i < 4; i++) {
        const result = await send({ type: 'track', request: i + 1, source: 'live', capturedAt: Date.now(),
          image: fixture(`minimap-${i}.jpg`) }, 'result');
        const expected = [849 + i * 12, 1252 - i * 6];
        assert(result.location?.mapId === 20036, `Missing location in fixture ${i}`);
        const error = Math.hypot(...result.location.pixel.map((v, k) => v - expected[k]));
        assert(error < 5, `Position error ${error} in fixture ${i}`);
        state.results.push({ expected, actual: result.location.pixel, pixelError: error, inliers: result.location.inliers,elapsedMs:result.elapsedMs,local:result.local });
      }
      const blank = await send({ type: 'track', request: 10, source: 'live', capturedAt: Date.now(),
        image: fixture('blank.png') }, 'result');
      assert(blank.location === null, 'Blank input must not invent a position');
      const bitmap=await createImageBitmap(await (await fetch(fixture('minimap-0.jpg'))).blob());
      const x=81,y=41,w=202,h=202,canvas=new OffscreenCanvas(w,h),ctx=canvas.getContext('2d');
      ctx.drawImage(bitmap,x,y,w,h,0,0,w,h);const sourceRegion=[x/bitmap.width,y/bitmap.height,w/bitmap.width,h/bitmap.height];bitmap.close();
      const cropped=URL.createObjectURL(await canvas.convertToBlob({type:'image/jpeg',quality:.9}));
      const r=await send({type:'track',request:11,image:cropped,sourceRegion,capturedAt:Date.now()},'result');URL.revokeObjectURL(cropped);
      assert(r.location?.mapId===20036&&Math.hypot(r.location.pixel[0]-849,r.location.pixel[1]-1252)<5,'Cropped native frame did not preserve coordinates');
      state.croppedFrame={passed:true,elapsedMs:r.elapsedMs,actual:r.location.pixel};
    } catch (error) { state.error = String(error.stack || error); }
    finally { worker.terminate(); state.done = true; }
  })();
  return 'Started actual worker position checks';
})();
