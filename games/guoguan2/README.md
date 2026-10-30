# 过关斩将2 · iOS

原作：朱志强（小小），Fight Man / xiaoxiao No.9，2002-07-23。

保留附件原始 Flash 5 游戏（500×300、18 fps）。`Original/guoguan2.swf` 的 SHA-256 为 `2a26f54d3ede5e716eec060e7afdb2530f0d2423d651aea0f2844ba600be6e0b`。`patch_original.py` 只在标题第3帧追加独立引导动作；逐一比较全部1546个原标签，任意原标签变化都会拒绝构建。另一个无可视对象的 Flash 8 接口运行于 level 16384，原作所有脚本仍以 Flash 5 语义执行。

方向键及 Z/X/C 的原键盘操作继续可用。11 个虚拟按键支持八方向、攻击、跳跃、防御；触控映射跟随原设置的改键。可拖动每个按键并在44–120像素之间改变大小，使用原生持久化保存布局。iOS 容器关闭文字交互；虚拟按键阻止默认触摸长按与文字选择，同时保留设置滑条和布局拖动。

无限生命仅保护剩余复活次数，仍可受伤及原样死亡复活；无敌独立保护玩家受击判定和血量。保护代码在原 Flash 5 上下文运行，使用属性写保护与玩家受击框拦截；两项初始关闭，不改变敌人生命、场景碰撞、玩家攻击、得分或原关卡流程。

固定 Ruffle 0.7.1，运行时归档摘要在 `prepare_runtime.py`。构建入口：`python3 games/guoguan2/scripts/prepare_runtime.py`，随后 `bash games/guoguan2/scripts/build.sh /absolute/output`。只编译 arm64 设备 IPA，不运行模拟器。`validate_ipa.py` 从实际 IPA 读取版本、架构、最低系统与权限，同时验证游戏、接口及全部运行时文件。

图标由内置 imagegen 参考原作标题画面生成，主题为黑色小小火柴人格斗和方格纸；主图 `icon.png` 为1024×1024、无透明通道。提示词保存在 `icon-prompt.txt`。

旧作的中文动态文字使用 GB2312，接口只在显示层转换为 Unicode。额外提供50,937字节设备字体SWF：Noto Serif SC的116个原文字符及ASCII子集，按原宋体设备名注册；中文About正文另临时选择该字体，英文恢复原字体。完整SIL OFL许可随Web离线资源打包，来源及摘要在bridge/menu-font-manifest.json。
