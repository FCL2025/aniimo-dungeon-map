'use strict';
(() => {
  const $ = id => document.getElementById(id);
  const data = window.DUNGEON_DATA;
  if (!data) { $('asset-error').hidden = false; $('bubble').disabled = true; return; }
  const screen = $('screen'), bubble = $('bubble'), panel = $('map-panel'), canvas = $('map-canvas');
  const ctx = canvas.getContext('2d'), key = 'aniimo-mobile-preview-v1';
  const reduced = matchMedia('(prefers-reduced-motion: reduce)');
  const clamp = (n, min, max) => Math.max(min, Math.min(max, n));
  const directionNames = { up:'↑ 上', upRight:'↗ 右上', right:'→ 右', downRight:'↘ 右下', down:'↓ 下', downLeft:'↙ 左下', left:'← 左', upLeft:'↖ 左上' };
  let saved = {};
  try { saved = JSON.parse(localStorage.getItem(key)) || {}; } catch { /* Storage is optional in local-file previews. */ }
  let current = data.maps.find(m => m.id === saved.map) || data.maps.find(m => m.id === 20034) || data.maps[0];
  let expanded = false, animating = false, dragging = null, suppressClick = false;
  let x = 18, y = 90, width = 1, height = 1, scale = 1, tx = 0, ty = 0, fitted = false;
  let frame = 0, gesture = null, gameCount = 0;
  const pointers = new Map(), images = new Map();
  const assets = window.MOBILE_PREVIEW_ASSETS || {};
  const url = path => assets[path] || 'frontend/' + path;
  function imageFor(path) {
    if (!images.has(path)) {
      const img = new Image(); img.onload = draw; img.onerror = () => { $('asset-error').hidden = false; };
      img.src = url(path); images.set(path, img);
    }
    return images.get(path);
  }
  bubble.querySelector('img').src = url('icons/Img_Map_Mark_GrabEgg_Lair.png');
  screen.querySelector('.game-art').style.backgroundImage = `linear-gradient(120deg,#223a47bb,#10263055),url("${url('maps/20034.png')}")`;
  for (const map of data.maps) {
    const option = document.createElement('option'); option.value = map.id;
    option.textContent = `${directionNames[ManualMapCore.direction(map)] || ''} · 地宮 ${map.id}`;
    $('map-choice').append(option);
  }
  $('map-choice').value = current.id;
  $('difficulty').value = [5,6].includes(saved.difficulty) ? String(saved.difficulty) : '5';
  $('snap').checked = saved.snap === true;
  $('opacity').value = Number.isFinite(saved.opacity) ? clamp(saved.opacity, 0, 95) : 82;
  const position = saved.position && Number.isFinite(saved.position.x) && Number.isFinite(saved.position.y) ? saved.position : {x:.04,y:.28};
  function save() {
    const position = {x:x / Math.max(1, screen.clientWidth - 54), y:y / Math.max(1, screen.clientHeight - 54)};
    try { localStorage.setItem(key, JSON.stringify({position, map:current.id, difficulty:Number($('difficulty').value), snap:$('snap').checked, opacity:Number($('opacity').value)})); } catch { /* Preview stays usable without storage. */ }
  }
  function setPosition(nextX, nextY) {
    x = clamp(nextX, 8, Math.max(8, screen.clientWidth - 62));
    y = clamp(nextY, 8, Math.max(8, screen.clientHeight - 62));
    bubble.style.left = x + 'px'; bubble.style.top = y + 'px';
  }
  function side() { return x + 27 <= screen.clientWidth / 2 ? 'left' : 'right'; }
  function announce() {
    $('status').textContent = expanded ? '單點地圖收合；拖曳或縮放不會收合' : `按鈕靠${side() === 'left' ? '左，向右' : '右，向左'}展開`;
  }
  function layoutPanel() {
    const w = Math.min(360, screen.clientWidth - 20), h = Math.min(345, screen.clientHeight - 20);
    const left = clamp(side() === 'left' ? x : x + 54 - w, 10, screen.clientWidth - w - 10);
    const top = clamp(y + 27 - h / 2, 10, screen.clientHeight - h - 10);
    Object.assign(panel.style, {left:left + 'px', top:top + 'px', width:w + 'px', height:h + 'px'});
    panel.dataset.side = side(); $('collapse').textContent = side() === 'left' ? '↙' : '↘';
    return {left, top, w, h};
  }
  async function toggle(open) {
    if (animating || open === expanded) return;
    animating = true; pointers.clear(); gesture = null;
    panel.hidden = false; const rect = layoutPanel(); resizeCanvas();
    const small = `translate(${x - rect.left}px, ${y - rect.top}px) scale(${54 / rect.w}, ${54 / rect.h})`;
    const collapsed = {transform:small, opacity:0, borderRadius:'40px'};
    const full = {transform:'translate(0,0) scale(1,1)', opacity:1, borderRadius:'14px'};
    bubble.classList.add('open'); expanded = open; bubble.setAttribute('aria-expanded', String(open));
    const animation = panel.animate(open ? [collapsed, full] : [full, collapsed], {
      duration:reduced.matches ? 0 : (open ? 230 : 180), easing:'cubic-bezier(.2,.8,.2,1)', fill:'both'
    });
    await animation.finished.catch(() => {});
    panel.hidden = !open; animation.cancel(); bubble.classList.toggle('open', open);
    animating = false; announce();
    if (open) canvas.focus({preventScroll:true}); else bubble.focus({preventScroll:true});
  }
  bubble.addEventListener('pointerdown', event => {
    if (event.button !== 0 || dragging || animating) return;
    bubble.classList.remove('docking'); bubble.setPointerCapture(event.pointerId);
    dragging = {id:event.pointerId, startX:event.clientX, startY:event.clientY, x, y, moved:false};
    suppressClick = false;
  });
  bubble.addEventListener('pointermove', event => {
    if (!dragging || event.pointerId !== dragging.id) return;
    const dx = event.clientX - dragging.startX, dy = event.clientY - dragging.startY;
    if (Math.hypot(dx,dy) > 7) dragging.moved = true;
    if (dragging.moved) { bubble.classList.add('dragging'); setPosition(dragging.x + dx, dragging.y + dy); announce(); }
  });
  function finishDrag(event) {
    if (!dragging || event.pointerId !== dragging.id) return;
    suppressClick = dragging.moved || event.type === 'pointercancel'; dragging = null;
    bubble.classList.remove('dragging');
    if ($('snap').checked && suppressClick) { bubble.classList.add('docking'); setPosition(side() === 'left' ? 8 : screen.clientWidth - 62, y); }
    save(); announce();
  }
  bubble.addEventListener('pointerup', finishDrag); bubble.addEventListener('pointercancel', finishDrag);
  bubble.addEventListener('click', event => { if (!suppressClick || event.detail === 0) void toggle(true); suppressClick = false; });
  bubble.addEventListener('keydown', event => {
    const directions = {ArrowLeft:[-16,0],ArrowRight:[16,0],ArrowUp:[0,-16],ArrowDown:[0,16]};
    if (directions[event.key]) { event.preventDefault(); const [dx,dy] = directions[event.key]; setPosition(x+dx,y+dy); save(); announce(); }
  });
  $('collapse').onclick = () => void toggle(false);
  document.addEventListener('keydown', event => { if (event.key === 'Escape' && expanded) void toggle(false); });
  function fit() {
    const [x1,y1,x2,y2] = current.bounds;
    scale = Math.min((width - 30)/(x2-x1), (height - 30)/(y2-y1));
    tx = (width - (x1+x2)*scale)/2; ty = (height - (y1+y2)*scale)/2; fitted = true; draw();
  }
  function resizeCanvas() {
    if (panel.hidden) return;
    const w = canvas.clientWidth, h = canvas.clientHeight;
    if (!w || !h) return;
    const changed = w !== width || h !== height;
    width = w; height = h;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.round(w*dpr); canvas.height = Math.round(h*dpr); ctx.setTransform(dpr,0,0,dpr,0,0);
    if (changed || !fitted) fit(); else draw();
  }
  function draw() {
    if (frame) return;
    frame = requestAnimationFrame(() => {
      frame = 0; if (panel.hidden) return;
      ctx.clearRect(0,0,width,height);
      const map = imageFor(current.image);
      if (map.complete && map.naturalWidth) ctx.drawImage(map,tx,ty,current.size[0]*scale,current.size[1]*scale);
      const colors = {egg:'#dfb65b',chest_gold:'#dfb65b',chest_glass:'#9eddf2',entrance:'#79cabe',exit:'#ff8798'};
      const difficulty = Number($('difficulty').value);
      const pins = current.pins.filter(p => p.difficultyCandidates.includes(difficulty)).sort((a,b) => Number(b.category.startsWith('chest_'))-Number(a.category.startsWith('chest_')));
      for (const pin of pins) {
        const px = tx+pin.pixel[0]*scale, py = ty+pin.pixel[1]*scale;
        if (px < -20 || py < -20 || px > width+20 || py > height+20) continue;
        const icon = imageFor(data.icons.assets[pin.iconKey].image), size = ['egg','entrance','exit'].includes(pin.category) ? 22 : 16;
        if (icon.complete && icon.naturalWidth) {
          const ratio = Math.min(size/icon.naturalWidth,size/icon.naturalHeight);
          const iw = icon.naturalWidth*ratio, ih = icon.naturalHeight*ratio;
          ctx.drawImage(icon,px-iw/2,py-ih/2,iw,ih);
        }
        if (pin.category.startsWith('chest_')) {
          ctx.beginPath(); ctx.arc(px,py,size/2+1,0,Math.PI*2); ctx.strokeStyle = colors[pin.category]; ctx.lineWidth = 1; ctx.stroke();
          if (pin.floor === 2) { ctx.fillStyle='#102630'; ctx.fillRect(px+2,py+3,14,10); ctx.fillStyle='#dce8e6'; ctx.font='bold 8px sans-serif'; ctx.fillText('2F',px+3,py+11); }
        }
        if (pin.provenance === 'template_supplement') {
          ctx.beginPath(); ctx.setLineDash([2,2]); ctx.arc(px,py,size/2+3,0,Math.PI*2); ctx.strokeStyle=colors[pin.category] || '#a5bac4'; ctx.stroke(); ctx.setLineDash([]);
        }
      }
    });
  }
  function point(event) { const r = canvas.getBoundingClientRect(); return {x:event.clientX-r.left,y:event.clientY-r.top}; }
  function zoom(factor, center) {
    const next = clamp(scale*factor,.04,3); tx = center.x-(center.x-tx)*next/scale; ty = center.y-(center.y-ty)*next/scale; scale = next; draw();
  }
  function pair() { const [a,b] = [...pointers.values()]; return {distance:Math.hypot(a.x-b.x,a.y-b.y),center:{x:(a.x+b.x)/2,y:(a.y+b.y)/2}}; }
  canvas.addEventListener('pointerdown', event => {
    if (animating || event.button !== 0) return;
    canvas.setPointerCapture(event.pointerId); pointers.set(event.pointerId,point(event));
    if (pointers.size === 1) gesture = {start:point(event),last:point(event),moved:false,multi:false,at:performance.now()};
    else { gesture.multi = true; gesture.pair = pair(); }
  });
  canvas.addEventListener('pointermove', event => {
    if (!pointers.has(event.pointerId) || !gesture) return;
    const p = point(event); pointers.set(event.pointerId,p);
    if (pointers.size >= 2) {
      const next = pair(), old = gesture.pair;
      if (old && old.distance > 0) { zoom(next.distance/old.distance,old.center); tx += next.center.x-old.center.x; ty += next.center.y-old.center.y; }
      gesture.pair = next; gesture.moved = true; draw();
    } else {
      if (Math.hypot(p.x-gesture.start.x,p.y-gesture.start.y)>7) gesture.moved = true;
      if (gesture.moved || gesture.multi) { tx += p.x-gesture.last.x; ty += p.y-gesture.last.y; draw(); }
      gesture.last = p;
    }
  });
  function finishMapGesture(event) {
    if (!pointers.has(event.pointerId) || !gesture) return;
    pointers.delete(event.pointerId);
    if (pointers.size) { gesture.last = [...pointers.values()][0]; return; }
    const tap = event.type === 'pointerup' && !gesture.moved && !gesture.multi && performance.now()-gesture.at < 450;
    gesture = null; if (tap) void toggle(false);
  }
  canvas.addEventListener('pointerup',finishMapGesture); canvas.addEventListener('pointercancel',finishMapGesture);
  canvas.addEventListener('wheel',event => { event.preventDefault(); if (!animating) zoom(Math.exp(-event.deltaY*.001),point(event)); },{passive:false});
  canvas.addEventListener('keydown',event => {
    if (event.key === '+' || event.key === '=') { event.preventDefault(); zoom(1.2,{x:width/2,y:height/2}); }
    if (event.key === '-') { event.preventDefault(); zoom(1/1.2,{x:width/2,y:height/2}); }
  });
  $('fit').onclick = fit;
  function title() { $('map-title').textContent = `地宮 ${current.id} · ${$('difficulty').selectedOptions[0].textContent}`; }
  $('map-choice').onchange = () => { current = data.maps.find(m=>m.id===Number($('map-choice').value)); fitted = false; title(); fit(); save(); };
  $('difficulty').onchange = () => { title(); draw(); save(); };
  $('snap').onchange = save;
  function opacity() { panel.style.setProperty('--map-opacity',Number($('opacity').value)/100); $('opacity-value').textContent = $('opacity').value+'%'; }
  $('opacity').oninput = () => { opacity(); save(); };
  async function place(edge) {
    if (animating) return;
    if (expanded) await toggle(false);
    setPosition(edge === 'left' ? 18 : screen.clientWidth-72,screen.clientHeight*.28); save(); announce();
  }
  $('place-left').onclick = () => void place('left'); $('place-right').onclick = () => void place('right');
  $('orientation').onclick = async () => {
    if (animating) return; if (expanded) await toggle(false);
    const right = side() === 'right'; screen.classList.toggle('portrait');
    $('orientation').textContent = screen.classList.contains('portrait') ? '改為橫向' : '改為直向';
    setPosition(right ? screen.clientWidth-72 : 18,screen.clientHeight*.28); save(); announce();
  };
  for (const id of ['joystick','game-action']) $(id).onclick = () => { $('game-feedback').textContent = `已收到遊戲操作 ${++gameCount} 次`; };
  new ResizeObserver(() => { setPosition(x,y); if (expanded && !animating) { layoutPanel(); resizeCanvas(); } announce(); }).observe(screen);
  new ResizeObserver(resizeCanvas).observe(canvas);
  setPosition(position.x*(screen.clientWidth-54),position.y*(screen.clientHeight-54)); opacity(); title(); announce();
})();
