// Separate adapter action; original game bytecode is never recompiled.
if (_root.__snowmanCheat == undefined) {
    _root.__snowmanCheat = false;
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
flash.external.ExternalInterface.addCallback("SnowmanGetState", _root, SnowmanGetState);
flash.external.ExternalInterface.addCallback("SnowmanSetKey", _root, SnowmanSetKey);
flash.external.ExternalInterface.addCallback("SnowmanReleaseKeys", _root, SnowmanReleaseKeys);
flash.external.ExternalInterface.addCallback("SnowmanSetCheat", _root, SnowmanSetCheat);
flash.external.ExternalInterface.addCallback("SnowmanStartGame", _root, SnowmanStartGame);
flash.external.ExternalInterface.addCallback("SnowmanTestDamage", _root, SnowmanTestDamage);
trace("SNOWMAN_BRIDGE_READY");
