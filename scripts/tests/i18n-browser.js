// Evaluate in the staged main page. Exercises real controls without capturing a game.
(async () => {
  const assert=(value,message)=>{if(!value)throw Error(message);},el=id=>document.getElementById(id);
  const settle=()=>new Promise(resolve=>requestAnimationFrame(()=>setTimeout(resolve,30)));
  await window.desktopReady;
  await window.manualMapReady;
  document.getElementById('manual-map-dialog')?.close();
  assert(I18n.locales.length===13,'Expected all 13 requested languages');
  assert(el('language-menu').children.length===13,'Language menu is incomplete');
  const set=(id,value)=>{const node=el(id);if(node.type==='checkbox')node.checked=value;else node.value=value;node.dispatchEvent(new Event('change',{bubbles:true}));};
  set('map','20039');set('difficulty','6');set('best-route',true);set('route-number','2');set('route-start','entrance');
  if(document.querySelector('[data-category="chest_gold"]').checked)document.querySelector('[data-category="chest_gold"]').click();
  await settle();
  zoom(1.3);tx+=19;ty-=13;
  window.dispatchEvent(new CustomEvent('tracking-update',{detail:{mapId:20039,pixel:[810,920],at:Date.now()+60000}}));
  const initial={route:JSON.stringify(getRouteSnapshot()),map:el('map'),input:el('icon-size'),token:loadToken,scale,center:[(width/2-tx)/scale,(height/2-ty)/scale],tracking:JSON.stringify(getTrackingSnapshot())};
  const report=[];
  for(const {code,name} of I18n.locales){
    el('language-button').click();
    assert(!el('language-menu').hidden,'Menu did not open');
    el('language-menu').querySelector(`[data-locale="${code}"]`).click();
    await settle();
    assert(I18n.locale===code&&document.documentElement.lang===code,'Locale not applied: '+code);
    assert(el('language-button').textContent.includes(name),'Native language name missing');
    assert(el('language-menu').hidden&&document.activeElement===el('language-button'),'Menu did not close/restore focus');
    assert(document.querySelector('header h1').textContent===ANIIMO_LOCALES.messages[code]['app.heading'],'Heading untranslated: '+code);
    assert(el('fit').textContent===ANIIMO_LOCALES.messages[code].fit,'Toolbar untranslated: '+code);
    assert(el('map').selectedOptions[0].textContent===I18n.t('map.name',{id:20039}),'Map options untranslated');
    assert(el('recognition-button').textContent===I18n.t('switch',{label:I18n.msg('recognition'),state:I18n.msg('off')}),'Recognition switch untranslated');
    assert(el('route-summary').textContent.includes('2')&&!/\{\w+\}/.test(el('route-summary').textContent),'Route interpolation failed');
    assert(el('map')===initial.map&&el('icon-size')===initial.input,'Switching replaced form controls');
    assert(loadToken===initial.token&&JSON.stringify(getRouteSnapshot())===initial.route,'Switching reset map/route');
    assert(scale===initial.scale&&Math.abs((width/2-tx)/scale-initial.center[0])<.01&&Math.abs((height/2-ty)/scale-initial.center[1])<.01,'Switching reset map viewport: '+code);
    assert(JSON.stringify(getTrackingSnapshot())===initial.tracking,'Switching reset tracking');
    assert(el('map').value==='20039'&&el('difficulty').value==='6'&&!document.querySelector('[data-category="chest_gold"]').checked,'Switching reset filters');
    assert(localStorage.getItem(I18n.storageKey)===code,'Locale not persisted');
    el('help-button').click();
    assert(el('help-dialog').open&&el('help-dialog').querySelector('p').textContent===I18n.t('help.map'),'Help untranslated');
    el('close-help').click();
    await settle();
    if(!['zh-TW','zh-CN','ja','ko'].includes(code)){
      const chinese=document.body.innerText.split('\n').filter(line=>/[\u3400-\u9fff]/.test(line));
      assert(!chinese.length,'Untranslated visible text: '+JSON.stringify(chinese));
    }
    report.push({code,translated:true,preserved:true});
  }
  I18n.setLocale('en');
  el('language-button').click();
  const key=value=>document.activeElement.dispatchEvent(new KeyboardEvent('keydown',{key:value,bubbles:true,cancelable:true}));
  key('End');assert(document.activeElement.dataset.locale==='vi','End key failed');
  key('Home');assert(document.activeElement.dataset.locale==='zh-CN','Home key failed');
  key('ArrowUp');assert(document.activeElement.dataset.locale==='vi','Arrow key wrapping failed');
  key('Escape');assert(el('language-menu').hidden&&document.activeElement===el('language-button'),'Escape failed');
  el('language-button').click();
  document.body.dispatchEvent(new PointerEvent('pointerdown',{bubbles:true}));
  assert(el('language-menu').hidden,'Outside click failed');
  assert(!I18n.setLocale('invalid')&&I18n.locale==='en','Invalid locale accepted');
  I18n.setLocale('ja');
  const japanese=ANIIMO_LOCALES.messages.ja.fit;delete ANIIMO_LOCALES.messages.ja.fit;
  assert(I18n.t('fit')===ANIIMO_LOCALES.messages.en.fit,'English fallback failed');
  ANIIMO_LOCALES.messages.ja.fit=japanese;I18n.setLocale('en');
  const original=ANIIMO_LOCALES.messages.en.fit;
  delete ANIIMO_LOCALES.messages.en.fit;
  assert(I18n.t('fit')===ANIIMO_LOCALES.messages['zh-TW'].fit,'Fallback failed');
  ANIIMO_LOCALES.messages.en.fit=original;
  const error=I18n.msg('recognition.retained',{id:20039});showMapNotice(error);
  I18n.setLocale('de');assert(el('app-status').textContent===I18n.format(error),'Pending notice did not translate');
  el('app-status').textContent='';I18n.setLocale('en');assert(!el('app-status').textContent,'Cleared notice reappeared');
  window.dispatchEvent(new CustomEvent('tracking-update',{detail:null}));
  return {passed:true,languages:report,keyboard:true,outsideClick:true,fallback:true,transientMessages:true};
})()
