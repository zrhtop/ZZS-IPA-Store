(() => {
  'use strict';
  const bridge = Object.freeze({state:'getGameState',key:'setTouchKey',release:'releaseTouchKeys',cheat:'setInfiniteLives',start:'startGame',damage:'testDamage',invincible:'setInvincible'});
  const stage = {width:500,height:300};
  const diagnostics = {ready:false,gameLoaded:false,fatalError:null,runtime:'0.7.1',stage,bridgeVersion:null,smokeMode:false};
  const heldPointers = new Map();
  const traces = [];
  let player, api, active = true, bridgeReady = false, smokePromise = null;
  let desiredCheat = false, desiredInvincible = false;
  const sleep = ms => new Promise(resolve => setTimeout(resolve,ms));
  const game = document.getElementById('game');
  const toggle = document.getElementById('cheat-switch');
  const invincibleToggle = document.getElementById('invincible-switch');
  function call(name,...args) { return api ? api.callExternalInterface(name,...args) : undefined; }
  function state() {
    try { const value=call(bridge.state);return value && typeof value==='object' ? value : null; }
    catch { return null; }
  }
  function getDiagnostics() {
    const current=state();
    return {...diagnostics,active,bridgeReady,cheatEnabled:desiredCheat,invincibleEnabled:desiredInvincible,state:current,traceTail:traces.slice(-8)};
  }
  function fail(error) {
    diagnostics.fatalError=String(error && error.message || error);
    diagnostics.ready=false;
    releaseKeys();
    const alert=document.getElementById('fatal-error');
    alert.textContent='游戏加载失败\n'+diagnostics.fatalError;alert.hidden=false;
  }
  function fitStage() {
    const area=document.getElementById('stage-area').getBoundingClientRect();
    const scale=Math.max(0,Math.min(area.width/stage.width,area.height/stage.height));
    game.style.width=`${stage.width*scale}px`;game.style.height=`${stage.height*scale}px`;
  }
  function setKey(code,down) {
    if (!bridgeReady || !active) return false;
    call(bridge.key,Number(code),Boolean(down));return true;
  }
  function releaseKeys() {
    heldPointers.clear();
    document.querySelectorAll('.control.held').forEach(button=>button.classList.remove('held'));
    try {call(bridge.release);} catch { /* The player may still be initializing. */ }
  }
  function updateCheatUI(enabled) {
    toggle.checked=Boolean(enabled);
    updateAssistanceIndicator();
  }
  function updateAssistanceIndicator() {
    const indicator=document.getElementById('cheat-indicator');
    indicator.textContent=[desiredCheat?'无限生命':'',desiredInvincible?'无敌':''].filter(Boolean).join(' · ');
    indicator.hidden=!desiredCheat && !desiredInvincible;
  }
  function setInvincible(enabled) {
    if(!bridgeReady)return false;
    call(bridge.invincible,Boolean(enabled));
    const current=state();
    if(!current || Boolean(current.invincible)!==Boolean(enabled))return false;
    desiredInvincible=Boolean(enabled);invincibleToggle.checked=desiredInvincible;updateAssistanceIndicator();return true;
  }
  function setCheat(enabled) {
    if (!bridgeReady) return false;
    call(bridge.cheat,Boolean(enabled));
    const current=state();
    if (!current || Boolean(current.cheat)!==Boolean(enabled)) return false;
    desiredCheat=Boolean(enabled);updateCheatUI(desiredCheat);return true;
  }
  async function waitFor(predicate,label,timeout=45000) {
    const start=performance.now();
    while(performance.now()-start<timeout) {
      if (diagnostics.fatalError) throw new Error(diagnostics.fatalError);
      const value=predicate();if(value)return value;
      await sleep(50);
    }
    throw new Error(`等待超时：${label}`);
  }
  async function load(smokeMode=false) {
    releaseKeys();bridgeReady=false;diagnostics.ready=false;diagnostics.gameLoaded=false;diagnostics.smokeMode=smokeMode;
    await api.load({url:'guoguan2.swf',...(smokeMode?{parameters:{testMode:'1'}}:{})});
    diagnostics.gameLoaded=true;
    const current=await waitFor(()=>{const s=state();return s && Number(s.bridgeVersion)===1?s:null},'原游戏控制接口');
    bridgeReady=true;diagnostics.bridgeVersion=Number(current.bridgeVersion);diagnostics.ready=true;
    call(bridge.release);setCheat(false);setInvincible(false);
    if (!active) api.suspend();
    return current;
  }
  function setActive(value) {
    active=Boolean(value) && !window.SnowmanControlLayout?.isEditing();releaseKeys();
    if(api){if(active)api.resume();else api.suspend();}
  }
  function bindControls() {
    document.querySelectorAll('.control[data-control]').forEach(button=>{
      // Cancel WebKit's native long-press handling without replacing pointer input.
      // Keep these listeners on game keys so settings scrolling/sliders still work.
      for(const name of ['touchstart','touchmove'])button.addEventListener(name,event=>{
        event.preventDefault();
      },{passive:false});
      button.addEventListener('selectstart',event=>event.preventDefault());
      const keys=String(button.dataset.keys || button.dataset.key).split(',').map(Number);
      button.addEventListener('pointerdown',event=>{
        event.preventDefault();if(!bridgeReady || !active || window.SnowmanControlLayout?.isEditing())return;
        heldPointers.set(event.pointerId,{keys,button});
        try{button.setPointerCapture(event.pointerId);}catch{}
        button.classList.add('held');keys.forEach(key=>setKey(key,true));
      });
      const end=event=>{
        if(!heldPointers.has(event.pointerId))return;
        event.preventDefault();const owner=heldPointers.get(event.pointerId);heldPointers.delete(event.pointerId);
        const remaining=Array.from(heldPointers.values());
        if(!remaining.some(item=>item.button===owner.button))owner.button.classList.remove('held');
        for(const key of owner.keys)if(!remaining.some(item=>item.keys.includes(key)))setKey(key,false);
      };
      for(const event of ['pointerup','pointercancel','lostpointercapture'])button.addEventListener(event,end);
      button.addEventListener('contextmenu',event=>event.preventDefault());
    });
    const dialog=document.getElementById('cheat-dialog');
    const backdrop=document.getElementById('settings-backdrop');
    function closeSettings(){if(typeof dialog.close==='function')dialog.close();else dialog.removeAttribute('open');backdrop.hidden=true;releaseKeys();}
    document.getElementById('settings').addEventListener('click',()=>{
      releaseKeys();updateCheatUI(desiredCheat);toggle.disabled=!bridgeReady;invincibleToggle.checked=desiredInvincible;invincibleToggle.disabled=!bridgeReady;document.getElementById('adjust-controls').disabled=!bridgeReady;
      if(typeof dialog.showModal==='function')dialog.showModal();
      else{dialog.classList.add('dialog-fallback');dialog.setAttribute('open','');backdrop.hidden=false;}
    });
    document.getElementById('close-settings').addEventListener('click',closeSettings);
    document.getElementById('adjust-controls').addEventListener('click',()=>{closeSettings();window.SnowmanControlLayout.open();});
    backdrop.addEventListener('click',closeSettings);
    dialog.addEventListener('close',releaseKeys);
    toggle.addEventListener('change',()=>{if(!setCheat(toggle.checked))updateCheatUI(desiredCheat);});
    invincibleToggle.addEventListener('change',()=>{if(!setInvincible(invincibleToggle.checked))invincibleToggle.checked=desiredInvincible;});
    window.addEventListener('blur',releaseKeys);
    document.addEventListener('visibilitychange',()=>setActive(!document.hidden));
    window.addEventListener('resize',fitStage);
    window.addEventListener('contextmenu',event=>event.preventDefault());
    if(window.ResizeObserver)new ResizeObserver(fitStage).observe(document.getElementById('stage-area'));
  }
  async function runSmokeTest() {
    if(smokePromise)return smokePromise;
    smokePromise=(async()=>{
      const checks=[];
      const check=(name,passed)=>{checks.push({name,passed:Boolean(passed)});if(!passed)throw new Error(`检查失败：${name}`);};
      try {
        await waitFor(()=>diagnostics.ready && bridgeReady,'原版游戏加载');
        const current=state();
        check('original-swf-loaded',diagnostics.gameLoaded && Number(current?.bridgeVersion)===1);
        check('infinite-lives-default-off',current.cheat===false && desiredCheat===false);
        check('invincibility-default-off',current.invincible===false && desiredInvincible===false);
        const ids=['37','38','39','40','up-left','up-right','down-left','down-right','90','88','67'];
        check('eleven-virtual-controls-present',ids.every(id=>document.querySelector(`[data-control="${id}"]`)));
        check('layout-editor-available',typeof window.SnowmanControlLayout?.open==='function');
        return {success:true,diagnostics:getDiagnostics(),checks};
      } catch(error) {
        return {success:false,error:String(error.message||error),diagnostics:getDiagnostics(),checks};
      }
    })();
    return smokePromise;
  }
  window.SnowmanHost={getDiagnostics,setActive,setCheat,setInvincible,setKey,releaseKeys,runSmokeTest,getGameState:state,setTouchKey:setKey,setInfiniteLives:setCheat};
  bindControls();fitStage();
  try{
    player=window.RufflePlayer.newest().createPlayer();player.tabIndex=0;
    game.appendChild(player);api=player.ruffle();
    api.traceObserver=message=>{traces.push(String(message));if(traces.length>30)traces.shift();};
    load(false).catch(fail);
  }catch(error){fail(error);}
})();
