(() => {
  'use strict';
  const bridge = Object.freeze({state:'SnowmanGetState',key:'SnowmanSetKey',release:'SnowmanReleaseKeys',cheat:'SnowmanSetCheat',start:'SnowmanStartGame',damage:'SnowmanTestDamage'});
  const stage = {width:550,height:400};
  const diagnostics = {ready:false,gameLoaded:false,fatalError:null,runtime:'0.7.1',stage,bridgeVersion:null,smokeMode:false};
  const heldPointers = new Map();
  const traces = [];
  let player, api, active = true, bridgeReady = false, smokePromise = null;
  let desiredCheat = false;
  const sleep = ms => new Promise(resolve => setTimeout(resolve,ms));
  const game = document.getElementById('game');
  const toggle = document.getElementById('cheat-switch');
  function call(name,...args) { return api ? api.callExternalInterface(name,...args) : undefined; }
  function state() {
    try { const value=call(bridge.state);return value && typeof value==='object' ? value : null; }
    catch { return null; }
  }
  function getDiagnostics() {
    const current=state();
    return {...diagnostics,active,bridgeReady,cheatEnabled:desiredCheat,state:current,traceTail:traces.slice(-8)};
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
    document.getElementById('cheat-indicator').hidden=!enabled;
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
    await api.load({url:'snowman.swf',...(smokeMode?{parameters:{testMode:'1'}}:{})});
    diagnostics.gameLoaded=true;
    const current=await waitFor(()=>{const s=state();return s && Number(s.bridgeVersion)===1?s:null},'原游戏控制接口');
    bridgeReady=true;diagnostics.bridgeVersion=Number(current.bridgeVersion);diagnostics.ready=true;
    call(bridge.release);setCheat(false);
    if (!active) api.suspend();
    return current;
  }
  function setActive(value) {
    active=Boolean(value);releaseKeys();
    if(api){if(active)api.resume();else api.suspend();}
  }
  function bindControls() {
    document.querySelectorAll('[data-key]').forEach(button=>{
      const key=Number(button.dataset.key);
      button.addEventListener('pointerdown',event=>{
        event.preventDefault();if(!bridgeReady || !active)return;
        heldPointers.set(event.pointerId,{key,button});
        try{button.setPointerCapture(event.pointerId);}catch{}
        button.classList.add('held');setKey(key,true);
      });
      const end=event=>{
        if(!heldPointers.has(event.pointerId))return;
        event.preventDefault();const owner=heldPointers.get(event.pointerId);heldPointers.delete(event.pointerId);
        const stillHeld=Array.from(heldPointers.values()).some(x=>x.key===owner.key);
        if(!stillHeld){owner.button.classList.remove('held');setKey(owner.key,false);}
      };
      for(const event of ['pointerup','pointercancel','lostpointercapture'])button.addEventListener(event,end);
      button.addEventListener('contextmenu',event=>event.preventDefault());
    });
    const dialog=document.getElementById('cheat-dialog');
    const backdrop=document.getElementById('settings-backdrop');
    function closeSettings(){if(typeof dialog.close==='function')dialog.close();else dialog.removeAttribute('open');backdrop.hidden=true;releaseKeys();}
    document.getElementById('settings').addEventListener('click',()=>{
      releaseKeys();updateCheatUI(desiredCheat);toggle.disabled=!bridgeReady;
      if(typeof dialog.showModal==='function')dialog.showModal();
      else{dialog.classList.add('dialog-fallback');dialog.setAttribute('open','');backdrop.hidden=false;}
    });
    document.getElementById('close-settings').addEventListener('click',closeSettings);
    backdrop.addEventListener('click',closeSettings);
    dialog.addEventListener('close',releaseKeys);
    toggle.addEventListener('change',()=>{if(!setCheat(toggle.checked))updateCheatUI(desiredCheat);});
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
      function pressControl(code,down){
        const button=document.querySelector(`[data-key="${code}"]`);
        button.dispatchEvent(new PointerEvent(down?'pointerdown':'pointerup',{pointerId:8000+code,pointerType:'touch',isPrimary:true,bubbles:true,cancelable:true,button:0,buttons:down?1:0}));
      }
      function changeCheat(enabled){toggle.checked=enabled;toggle.dispatchEvent(new Event('change',{bubbles:true}));return state()?.cheat===enabled;}
      function clickOriginalButton(x,y){
        const canvas=player.shadowRoot && player.shadowRoot.querySelector('canvas');
        if(!canvas)throw new Error('原游戏画布不可用');
        const rect=canvas.getBoundingClientRect();
        const init={pointerId:9000,pointerType:'touch',isPrimary:true,bubbles:true,cancelable:true,clientX:rect.left+x*rect.width/stage.width,clientY:rect.top+y*rect.height/stage.height,button:0};
        canvas.dispatchEvent(new PointerEvent('pointermove',{...init,buttons:0}));
        canvas.dispatchEvent(new PointerEvent('pointerdown',{...init,buttons:1}));
        canvas.dispatchEvent(new PointerEvent('pointerup',{...init,buttons:0}));
      }
      function check(name,passed,detail){checks.push({name,passed:Boolean(passed),...(detail===undefined?{}:{detail})});if(!passed)throw new Error(`检查失败：${name}`);}
      try{
        await waitFor(()=>diagnostics.ready && bridgeReady,'Ruffle原版初次加载');setActive(true);await load(true);
        const initial=state();check('original-swf-loaded',diagnostics.gameLoaded && initial.bridgeVersion===1,{frame:initial.frame});
        check('cheat-default-off',initial.cheat===false);
        call(bridge.start);
        const start=await waitFor(()=>{const s=state();return s && s.playing && !s.paused && Number.isFinite(Number(s.playerX))?s:null},'原版开始游戏',15000);
        check('original-menu-starts-playable-game',start.playing,{frame:start.frame,level:start.level,playerX:start.playerX,playerY:start.playerY});
        pressControl(39,true);await sleep(400);pressControl(39,false);const moved=state();
        check('virtual-right-button-moves-player',Number(moved.playerX)>Number(start.playerX),{from:start.playerX,to:moved.playerX});
        pressControl(37,true);await sleep(200);pressControl(37,false);const movedLeft=state();
        check('virtual-left-button-moves-player',Number(movedLeft.playerX)<Number(moved.playerX),{from:moved.playerX,to:movedLeft.playerX});
        pressControl(38,true);await sleep(150);pressControl(38,false);const jumped=state();
        check('virtual-up-button-jumps',Number(jumped.playerY)<Number(movedLeft.playerY),{from:movedLeft.playerY,to:jumped.playerY});
        pressControl(32,true);
        const shot=await waitFor(()=>{const current=state();return Number(current?.attackCount)>Number(jumped.attackCount)?current:null},'原游戏射击弹体',2500);
        pressControl(32,false);
        check('virtual-fire-button-reaches-game',Number(shot.attackCount)>Number(jumped.attackCount),{from:jumped.attackCount,to:shot.attackCount});
        const platform=await waitFor(()=>{const current=state();return current && Math.abs(Number(current.playerY)-300)<2 && Number(current.playerFrame)===1?current:null},'原关卡上层平台着陆',6000);
        pressControl(40,true);await sleep(200);pressControl(40,false);const dropped=state();
        check('virtual-down-button-drops-through-platform',Number(dropped.playerY)>Number(platform.playerY),{from:platform.playerY,to:dropped.playerY});
        clickOriginalButton(20,380);await sleep(80);check('original-pause-button-pauses',state().paused===true);
        clickOriginalButton(20,380);await sleep(80);check('original-pause-button-resumes',state().paused===false);
        const musicBefore=state().music;clickOriginalButton(58,380);await sleep(80);
        check('original-sound-button-toggles',typeof musicBefore==='boolean' && state().music===!musicBefore,{before:musicBefore,after:state().music});
        clickOriginalButton(58,380);await sleep(80);check('original-sound-button-restores',state().music===musicBefore);
        releaseKeys();setCheat(false);const normalBefore=state();call(bridge.damage);await sleep(150);const normalAfter=state();
        check('normal-mode-damage-consumes-life',Number(normalAfter.lives)===Number(normalBefore.lives)-1,{before:normalBefore.lives,after:normalAfter.lives});
        check('manual-cheat-switch-enables',changeCheat(true) && state().cheat===true);
        const protectedLives=Number(state().lives);
        for(let n=0;n<3;n++){call(bridge.damage);await sleep(120);}
        const protectedAfter=state();
        check('infinite-lives-survives-repeated-damage',Number(protectedAfter.lives)===protectedLives,{before:protectedLives,after:protectedAfter.lives,hits:3});
        check('manual-cheat-switch-disables',changeCheat(false) && state().cheat===false);
        const restoredBefore=Number(state().lives);call(bridge.damage);await sleep(150);const restoredAfter=state();
        check('disabling-cheat-restores-life-loss',Number(restoredAfter.lives)===restoredBefore-1,{before:restoredBefore,after:restoredAfter.lives});
        releaseKeys();return {success:true,diagnostics:getDiagnostics(),checks};
      }catch(error){releaseKeys();try{setCheat(false);}catch{}return {success:false,error:String(error.message||error),diagnostics:getDiagnostics(),checks};}
    })();
    return smokePromise;
  }
  window.SnowmanHost={getDiagnostics,setActive,setCheat,setKey,releaseKeys,runSmokeTest};
  bindControls();fitStage();
  try{
    player=window.RufflePlayer.newest().createPlayer();player.tabIndex=0;
    game.appendChild(player);api=player.ruffle();
    api.traceObserver=message=>{traces.push(String(message));if(traces.length>30)traces.shift();};
    load(false).catch(fail);
  }catch(error){fail(error);}
})();
