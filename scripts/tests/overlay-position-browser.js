// Run with agent-browser eval --stdin on app/frontend/index.html (file access enabled).
// Uses generated minimap fixtures, not real-game accuracy claims.
(() => {
  const state = window.overlayPositionChecks = { done: false, results: [], error: null };
  const worker = new Worker('recognition-worker.js');
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
  (async () => {
    try {
      await send({ type: 'init', maps: DUNGEON_DATA.maps.map(m => ({ id: m.id, image: new URL(m.image, location.href).href })) }, 'ready');
      await send({ type: 'pin', id: 20036 }, 'pinned');
      for (let i = 0; i < 4; i++) {
        const result = await send({ type: 'analyze', request: i + 1, source: 'live', capturedAt: Date.now(),
          image: new URL(`../../exports/recognition-fixtures/minimap-${i}.jpg`, location.href).href }, 'result');
        const expected = [849 + i * 12, 1252 - i * 6];
        assert(result.location?.mapId === 20036, `Missing location in fixture ${i}`);
        const error = Math.hypot(...result.location.pixel.map((v, k) => v - expected[k]));
        assert(error < 5, `Position error ${error} in fixture ${i}`);
        state.results.push({ expected, actual: result.location.pixel, pixelError: error, inliers: result.location.inliers });
      }
      const blank = await send({ type: 'analyze', request: 10, source: 'live', capturedAt: Date.now(),
        image: new URL('../../exports/recognition-fixtures/blank.png', location.href).href }, 'result');
      assert(blank.location === null, 'Blank input must not invent a position');
    } catch (error) { state.error = String(error.stack || error); }
    finally { worker.terminate(); state.done = true; }
  })();
  return 'Started actual worker position checks';
})();
