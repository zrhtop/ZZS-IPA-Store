// Executed in the original Flash 5 movie. Its version and all existing tags stay intact.
if (!_root.__ggBooted) {
    _root.__ggBooted = true;
    _root.__ggKeys = new Array();
    _root.__ggInfinite = false;
    _root.__ggInvincible = false;
    ASSetPropFlags(Key, "isDown", 0, 7);
    _root.__ggOriginalKey = Key.isDown;
    Key.isDown = function(code) {
        return (code == _root.ap_l && _root.__ggKeys[37])
            || (code == _root.ap_u && _root.__ggKeys[38])
            || (code == _root.ap_r && _root.__ggKeys[39])
            || (code == _root.ap_d && _root.__ggKeys[40])
            || (code == _root.ap_a && _root.__ggKeys[90])
            || (code == _root.ap_b && _root.__ggKeys[88])
            || (code == _root.ap_c && _root.__ggKeys[67])
            || _root.__ggOriginalKey(code);
    };
    // Install in the Flash 5 context: newer-movie prototypes do not intercept it.
    ASSetPropFlags(MovieClip.prototype, "hitTest", 0, 7);
    MovieClip.prototype.__ggNativeHitTest = MovieClip.prototype.hitTest;
    MovieClip.prototype.hitTest = function(a, b, c) {
        var hurtbox = _root.chj.mc1p.pz;
        if (_root.__ggInvincible && hurtbox != undefined && (this == hurtbox || a == hurtbox)) { return false; }
        if (arguments.length == 1) { return this.__ggNativeHitTest(a); }
        return this.__ggNativeHitTest(a, b, c);
    };
    _root.__ggApplyProtection = function() {
        var inGame = _root._currentframe == 36 && _root.chj.mc1p != undefined;
        if (inGame && _root.__ggInfinite) {
            if (_root.rsh < 0) {
                ASSetPropFlags(_root, "rsh", 0, 4);
                _root.rsh = 0;
            }
            ASSetPropFlags(_root, "rsh", 4, 0);
        } else { ASSetPropFlags(_root, "rsh", 0, 4); }
        if (inGame && _root.__ggInvincible && _root.chj.upx > 0) {
            ASSetPropFlags(_root.chj, "upx", 4, 0);
        } else { ASSetPropFlags(_root.chj, "upx", 0, 4); }
    };
    loadMovieNum("guoguan2-bridge.swf", 16384);
}
