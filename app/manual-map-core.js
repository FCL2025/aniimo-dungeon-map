'use strict';
// Screen coordinates: positive Y points down. Directions are relative to the entrance.
((root) => {
  const directions = ['right', 'downRight', 'down', 'downLeft', 'left', 'upLeft', 'up', 'upRight'];
  // Keep the eight primary directions stable; include nearby sectors for manual input.
  const toleranceDegrees = 8;
  function vector(map) {
    const geometry = map?.portalGeometry;
    if (!Array.isArray(geometry?.entrance) || !Array.isArray(geometry?.exit)) return null;
    const [x, y] = geometry.entrance, [ex, ey] = geometry.exit;
    if (![x, y, ex, ey].every(Number.isFinite) || x === ex && y === ey) return null;
    const dx = ex - x, dy = ey - y;
    return { dx, dy, distance:Math.hypot(dx, dy), angle:Math.atan2(dy, dx) * 180 / Math.PI };
  }
  function direction(map) {
    const geometry = vector(map);
    if (!geometry) return null;
    const sector = Math.round(geometry.angle / 45);
    return directions[(sector + 8) % 8];
  }
  function candidates(maps, selectedDirection) {
    if (!selectedDirection) return maps.slice();
    const sector = directions.indexOf(selectedDirection);
    if (sector < 0) return [];
    const primary = [], nearby = [];
    for (const map of maps) {
      const geometry = vector(map);
      if (!geometry) continue;
      if (direction(map) === selectedDirection) primary.push(map);
      else if (Math.abs((geometry.angle - sector * 45 + 540) % 360 - 180) <= 22.5 + toleranceDegrees) nearby.push(map);
    }
    return primary.concat(nearby);
  }
  function distanceHint(map, maps) {
    const geometry = vector(map), primary = direction(map);
    if (!geometry) return null;
    const distances = maps.filter(item => direction(item) === primary).map(item => vector(item).distance);
    const min = Math.min(...distances), max = Math.max(...distances);
    // Relative labels only when the maps in one direction have a clear distance gap.
    if (max < min * 1.2) return null;
    return geometry.distance === min ? 'nearer' : geometry.distance === max ? 'farther' : null;
  }
  const api = { directions, toleranceDegrees, vector, direction, candidates, distanceHint };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.ManualMapCore = api;
})(globalThis);
