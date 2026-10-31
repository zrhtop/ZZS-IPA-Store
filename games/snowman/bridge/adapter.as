// Separate adapter action; original game bytecode is never recompiled.
if (_root.__snowmanCheat == undefined) {
    _root.__snowmanCheat = false;
}
if (_root.__snowmanInvincible == undefined) {
    _root.__snowmanInvincible = false;
}
_root.__snowmanKeys = new Array();
function SnowmanIsDown(code) {
    return (code == _root.Acode && _root.__snowmanKeys[37] == true)
        || (code == _root.Dcode && _root.__snowmanKeys[39] == true)
        || (code == _root.Wcode && _root.__snowmanKeys[38] == true)
        || (code == _root.Scode && _root.__snowmanKeys[40] == true)
        || (code == _root.Jcode && _root.__snowmanKeys[32] == true)
        || Key.isDown(code);
}
_root.__snowmanOriginalCreatePlayer = _root.create_player;
_root.create_player = function() {
    _root.__snowmanOriginalCreatePlayer();
    var santa = _root.bg.santa;
    santa.__snowmanOriginalToDie = santa.to_die;
    santa.to_die = function() {
        if (_root.__snowmanInvincible) { return; }
        var before = _root.game_life;
        this.__snowmanOriginalToDie();
        if (_root.__snowmanCheat && _root.game_life < before) {
            _root.game_life = before;
            _root.adjust_life(_root.game_ui);
        }
    };
};
function gameControl(who)
{
   if(!who.get_hit)
   {
      if(SnowmanIsDown(Acode))
      {
         key_AD_Action(who,-1);
      }
      else if(SnowmanIsDown(Dcode))
      {
         key_AD_Action(who,1);
      }
      else
      {
         normalAction_AD(who);
      }
      if(SnowmanIsDown(Jcode))
      {
         if(!Jcode_pressed)
         {
            Jcode_pressed = true;
            key_J_Action(who);
         }
      }
      else
      {
         Jcode_pressed = false;
      }
      if(SnowmanIsDown(Wcode))
      {
         if(!Wcode_pressed)
         {
            Wcode_pressed = true;
            key_W_Action(who);
         }
      }
      else
      {
         Wcode_pressed = false;
         if(SnowmanIsDown(Scode))
         {
            if(!Scode_pressed)
            {
               Scode_pressed = true;
               key_S_Action(who);
            }
         }
         else
         {
            Scode_pressed = false;
         }
      }
   }
   playerMove(who,game_speed * who.speed_rate,0);
}

_root.__snowmanAttackCount = 0;
_root.__snowmanOriginalShootAction = _root.shootAction;
_root.shootAction = function(where, point) {
    _root.__snowmanAttackCount++;
    _root.__snowmanOriginalShootAction(where, point);
};
function SnowmanGetState() {
    var santa = _root.bg.santa;
    return {bridgeVersion:1, key39:_root.__snowmanKeys[39], isDown39:SnowmanIsDown(39), codeRight:_root.Dcode, frame:_root._currentframe, lives:_root.game_life,
        playerX:santa._x, playerY:santa._y, playerFrame:santa._currentframe,
        playerUnbreak:santa.unbreak, playing:santa != undefined,
        paused:_root.game_paused, cheat:_root.__snowmanCheat,
        invincible:_root.__snowmanInvincible, power:_root.game_power, range:_root.game_range, speed:_root.game_speed,
        level:_root.game_level, stage:_root.game_stage, time:_root.game_time,
        score:_root.game_score, music:_root.game_music, attackCount:_root.__snowmanAttackCount};
}
function SnowmanSetKey(code, down) {
    if (code == 37 || code == 38 || code == 39 || code == 40 || code == 32) {
        _root.__snowmanKeys[code] = down == true;
    }
    return true;
}
function SnowmanReleaseKeys() {
    _root.__snowmanKeys = new Array();
    return true;
}
function SnowmanSetCheat(enabled) {
    _root.__snowmanCheat = enabled == true;
    return _root.__snowmanCheat;
}
function SnowmanSetInvincible(enabled) {
    _root.__snowmanInvincible = enabled == true;
    return _root.__snowmanInvincible;
}
function SnowmanStartGame() {
    if (_root.testMode != "1") { return false; }
    if (_root.game_stage == 0 && _root.btns.btn01.onRelease != undefined) {
        _root.btns.btn01.onRelease();
        return true;
    }
    return false;
}
function SnowmanTestDamage() {
    if (_root.testMode != "1") { return false; }
    var santa = _root.bg.santa;
    if (santa == undefined) { return false; }
    santa.unbreak = false;
    santa.to_die();
    return SnowmanGetState();
}
// Stage-clear watchdog: repairs a softlock in the original game logic.
// A stage normally advances only when the last rolling snowball's explode()
// observes monsters_exist <= 1 and arms the mission countdown on its splash
// clip. A rolling snowball is removed 13 frames later by its iceball frame
// script, so if the final two or more snowballs explode inside that window,
// every explode() still sees the others counted, none arms the countdown,
// monsters_exist reaches 0 and the stage never advances. The stage timer
// also stops while no monsters exist, so the stage cannot time out either.
// This watcher calls next_game() once a live, unpaused stage has had zero
// monsters for 240 frames (8 seconds) with no transition already running.
// The slowest normal clear finishes in about 175 frames, so the watchdog
// never fires during a normal clear.
if (_root.__snowmanClearFrames == undefined) {
    _root.__snowmanClearFrames = 0;
}
_root.createEmptyMovieClip("__snowmanClearWatchdog", 9999);
_root.__snowmanClearWatchdog.onEnterFrame = function() {
    if (_root.bg == undefined || _root.bg.santa == undefined
        || _root.game_paused || _root.next_stage != undefined
        || _root.monsters_exist == undefined || _root.monsters_exist > 0) {
        _root.__snowmanClearFrames = 0;
        return;
    }
    _root.__snowmanClearFrames++;
    if (_root.__snowmanClearFrames >= 240) {
        _root.__snowmanClearFrames = 0;
        _root.next_game();
    }
};
flash.external.ExternalInterface.addCallback("SnowmanGetState", _root, SnowmanGetState);
flash.external.ExternalInterface.addCallback("SnowmanSetKey", _root, SnowmanSetKey);
flash.external.ExternalInterface.addCallback("SnowmanReleaseKeys", _root, SnowmanReleaseKeys);
flash.external.ExternalInterface.addCallback("SnowmanSetCheat", _root, SnowmanSetCheat);
flash.external.ExternalInterface.addCallback("SnowmanSetInvincible", _root, SnowmanSetInvincible);
flash.external.ExternalInterface.addCallback("SnowmanStartGame", _root, SnowmanStartGame);
flash.external.ExternalInterface.addCallback("SnowmanTestDamage", _root, SnowmanTestDamage);
trace("SNOWMAN_BRIDGE_READY");
