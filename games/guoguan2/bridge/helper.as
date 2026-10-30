// Flash 8 interface movie on a separate level; original gameplay remains Flash 5.
stop();
var game = _level0;
function getGameState() {
    var stage = game.chj;
    var guy = stage.mc1p;
    return {bridgeVersion:1, frame:game._currentframe, lives:game.rsh + 1,
        reserveLives:game.rsh, health:stage.upx, playing:guy != undefined,
        playerX:guy._x, playerY:guy._y, playerFrame:guy._currentframe,
        playerHit:guy.d, score:stage.fen, cheat:game.__ggInfinite,
        invincible:game.__ggInvincible, keyRight:game.__ggKeys[39]};
}
function setTouchKey(code, down) {
    if (code == 37 || code == 38 || code == 39 || code == 40 || code == 90 || code == 88 || code == 67) {
        game.__ggKeys[code] = down == true;
        return true;
    }
    return false;
}
function releaseTouchKeys() {
    game.__ggKeys = new Array();
    return true;
}
function setInfiniteLives(enabled) {
    game.__ggInfinite = enabled == true;
    game.__ggApplyProtection();
    return game.__ggInfinite;
}
function setInvincible(enabled) {
    game.__ggInvincible = enabled == true;
    game.__ggApplyProtection();
    return game.__ggInvincible;
}
function startGame() {
    // UI still enters through the original title/options buttons.
    return false;
}
function testDamage() {
    // Test-only probe cannot change gameplay in the installed app.
    if (game.__ggTestMode != true || game.chj.mc1p == undefined) { return false; }
    game.chj.upx -= 10;
    return getGameState();
}
function applyMenuFont(field) {
    if (typeof field.text != "string" || typeof field.setTextFormat != "function") { return; }
    if (field.__ggOriginalFont == undefined) { field.__ggOriginalFont = field.getTextFormat().font; }
    var hasChinese = false;
    for (var i = 0; i < field.text.length; i++) {
        if (field.text.charCodeAt(i) >= 0x2E80) { hasChinese = true; break; }
    }
    var format = new TextFormat();
    format.font = hasChinese ? "ËÎÌå" : field.__ggOriginalFont;
    if (format.font != undefined) { field.setTextFormat(format); }
}
function repairMenuText() {
    if (game._currentframe != 4) { return; }
    var menu = game.getInstanceAtDepth(-16383);
    if (menu == undefined) { return; }
    var names = ["op","he","pl","pr","co","up","down","left","rigft","boxing","leap","protect","revert","about","aboutxt","update"];
    for (var i = 0; i < names.length; i++) {
        var value = menu[names[i]];
        var fixed = GGFixGBText(value);
        if (fixed != value) { menu[names[i]] = fixed; }
    }
    for (var depth = -16384; depth <= -16264; depth++) {
        var field = menu.getInstanceAtDepth(depth);
        if (typeof field.text == "string") {
            var originalText = field.html ? field.htmlText : field.text;
            var fixedText = GGFixGBText(originalText);
            if (fixedText != originalText) {
                if (field.html) { field.htmlText = fixedText; }
                else { field.text = fixedText; }
            }
            applyMenuFont(field);
        }
    }
    var helpClip = menu.getInstanceAtDepth(-16300);
    if (typeof helpClip.help == "string") {
        var help = GGFixGBText(helpClip.help);
        if (help != helpClip.help) { helpClip.help = help; }
        applyMenuFont(helpClip.getInstanceAtDepth(-16383));
    }
}
this.onEnterFrame = function() { game.__ggApplyProtection(); repairMenuText(); };
flash.external.ExternalInterface.addCallback("getGameState", this, getGameState);
flash.external.ExternalInterface.addCallback("setTouchKey", this, setTouchKey);
flash.external.ExternalInterface.addCallback("releaseTouchKeys", this, releaseTouchKeys);
flash.external.ExternalInterface.addCallback("setInfiniteLives", this, setInfiniteLives);
flash.external.ExternalInterface.addCallback("setInvincible", this, setInvincible);
flash.external.ExternalInterface.addCallback("startGame", this, startGame);
flash.external.ExternalInterface.addCallback("testDamage", this, testDamage);

// Standalone helper-v8 suggestion. Does not modify any original SWF tag.
var GGGBPairs = new Object();
GGGBPairs["51688"] = "设";
GGGBPairs["54979"] = "置";
GGGBPairs["45295"] = "帮";
GGGBPairs["55034"] = "助";
GGGBPairs["49066"] = "开";
GGGBPairs["51900"] = "始";
GGGBPairs["52710"] = "玩";
GGGBPairs["48338"] = "家";
GGGBPairs["51706"] = "生";
GGGBPairs["50172"] = "命";
GGGBPairs["45236"] = "按";
GGGBPairs["48380"] = "键";
GGGBPairs["51663"] = "上";
GGGBPairs["53186"] = "下";
GGGBPairs["55283"] = "左";
GGGBPairs["54226"] = "右";
GGGBPairs["46070"] = "出";
GGGBPairs["51373"] = "拳";
GGGBPairs["52472"] = "跳";
GGGBPairs["54462"] = "跃";
GGGBPairs["53501"] = "旋";
GGGBPairs["47079"] = "风";
GGGBPairs["48086"] = "恢";
GGGBPairs["47284"] = "复";
GGGBPairs["47576"] = "关";
GGGBPairs["54234"] = "于";
GGGBPairs["55287"] = "作";
GGGBPairs["54751"] = "者";
GGGBPairs["55020"] = "朱";
GGGBPairs["54974"] = "志";
GGGBPairs["51135"] = "强";
GGGBPairs["53409"] = "小";
GGGBPairs["45286"] = "版";
GGGBPairs["51368"] = "权";
GGGBPairs["52217"] = "所";
GGGBPairs["54224"] = "有";
GGGBPairs["52714"] = "完";
GGGBPairs["46025"] = "成";
GGGBPairs["51413"] = "日";
GGGBPairs["50906"] = "期";
GGGBPairs["50410"] = "年";
GGGBPairs["54466"] = "月";
GGGBPairs["54490"] = "在";
GGGBPairs["46552"] = "地";
GGGBPairs["54992"] = "中";
GGGBPairs["47610"] = "国";
GGGBPairs["45489"] = "北";
GGGBPairs["48809"] = "京";
GGGBPairs["54218"] = "邮";
GGGBPairs["53220"] = "箱";
GGGBPairs["52728"] = "网";
GGGBPairs["54967"] = "址";
GGGBPairs["53445"] = "信";
GGGBPairs["53154"] = "息";
GGGBPairs["51179"] = "请";
GGGBPairs["50636"] = "盘";
GGGBPairs["52906"] = "为";
GGGBPairs["47037"] = "方";
GGGBPairs["53234"] = "向";
GGGBPairs["49112"] = "控";
GGGBPairs["54982"] = "制";
GGGBPairs["41379"] = "。";
GGGBPairs["41900"] = "，";
GGGBPairs["49097"] = "可";
GGGBPairs["48119"] = "击";
GGGBPairs["46322"] = "打";
GGGBPairs["46544"] = "敌";
GGGBPairs["51403"] = "人";
GGGBPairs["49580"] = "连";
GGGBPairs["53496"] = "续";
GGGBPairs["53206"] = "现";
GGGBPairs["54736"] = "招";
GGGBPairs["46767"] = "动";
GGGBPairs["46532"] = "的";
GGGBPairs["52652"] = "同";
GGGBPairs["51889"] = "时";
GGGBPairs["54489"] = "再";
GGGBPairs["48114"] = "或";
GGGBPairs["48555"] = "将";
GGGBPairs["45755"] = "不";
GGGBPairs["51411"] = "扔";
GGGBPairs["52447"] = "踢";
GGGBPairs["52680"] = "腿";
GGGBPairs["49332"] = "来";
GGGBPairs["48308"] = "即";
GGGBPairs["52958"] = "无";
GGGBPairs["45475"] = "保";
GGGBPairs["48036"] = "护";
GGGBPairs["46507"] = "但";
GGGBPairs["50403"] = "你";
GGGBPairs["48097"] = "会";
GGGBPairs["51879"] = "失";
GGGBPairs["53674"] = "血";
GGGBPairs["51703"] = "慎";
GGGBPairs["54211"] = "用";
GGGBPairs["47811"] = "好";
GGGBPairs["49330"] = "啦";
GGGBPairs["41889"] = "！";
GGGBPairs["50426"] = "您";
GGGBPairs["53972"] = "以";
GGGBPairs["51431"] = "如";
GGGBPairs["47611"] = "果";
GGGBPairs["51890"] = "什";
GGGBPairs["50100"] = "么";
GGGBPairs["48552"] = "建";
GGGBPairs["53993"] = "议";
GGGBPairs["54262"] = "遇";
GGGBPairs["46525"] = "到";
GGGBPairs["48048"] = "话";
GGGBPairs["47352"] = "给";
GGGBPairs["52946"] = "我";
GGGBPairs["53435"] = "谢";
GGGBPairs["51897"] = "使";
GGGBPairs["52174"] = "宋";
GGGBPairs["52453"] = "体";
GGGBPairs["52932"] = "文";
function GGFixGBText(value) {
    if (typeof value != "string") { return value; }
    var result = "";
    for (var i = 0; i < value.length; i = i + 1) {
        var lead = value.charCodeAt(i);
        var trail = value.charCodeAt(i + 1);
        var decoded = null;
        if (lead >= 161 && lead <= 247 && trail >= 161 && trail <= 254) {
            decoded = GGGBPairs[String(lead * 256 + trail)];
        }
        if (decoded != null) { result = result + decoded; i = i + 1; }
        else { result = result + value.charAt(i); }
    }
    return result;
}
