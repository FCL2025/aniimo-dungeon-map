'use strict';
// Screen coordinates: positive Y points down. Directions are relative to the entrance.
((root) => {
  const directions = ['right', 'downRight', 'down', 'downLeft', 'left', 'upLeft', 'up', 'upRight'];
  function direction(map) {
    const geometry = map.portalGeometry;
    if (!geometry) return null;
    const [x, y] = geometry.entrance, [ex, ey] = geometry.exit;
    if (![x, y, ex, ey].every(Number.isFinite) || x === ex && y === ey) return null;
    const sector = Math.round(Math.atan2(ey - y, ex - x) / (Math.PI / 4));
    return directions[(sector + 8) % 8];
  }
  function candidates(maps, selectedDirection) {
    return maps.filter(map => !selectedDirection || direction(map) === selectedDirection);
  }
  const api = { directions, direction, candidates };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.ManualMapCore = api;
})(globalThis);
