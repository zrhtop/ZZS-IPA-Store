圣诞雪球人 / Deep Freeze — iOS 适配

原作发行：Miniclip。iOS 适配：ZRH。

实现与保全
- Original/snowman.swf 是用户提供的原文件，SHA-256：
  03874a0451d37ef0148a8cb7fb27e0b7ec4077977ec8426d8983e53a9dadb947
- scripts/patch_original.py 校验原件，将已编译适配脚本插入主时间线第19帧。
  原件的1154个标签均逐字节保留，包括所有素材、原始ActionScript和UI。
- 适配层只合并触屏/键盘输入，并在手动开启无限生命时恢复原受伤处理扣掉的生命。
  受伤动画、移动、射击、关卡、时间限制仍沿用原程序。
- bridge/adapter.as 为适配脚本，adapter.avm1.b64 为 FFDec 26.4.0 编译的字节码。
  修改脚本后需重新编译；原游戏代码不需重新编译。
- Flash由固定 Ruffle 0.7.1运行，下载包和内置文件均有摘要校验。

构建
在安装Xcode和iOS Simulator的Mac运行：
  python3 games/snowman/scripts/prepare_runtime.py
  bash games/snowman/scripts/build.sh /absolute/path/to/build-output
准备过程自动生成触控适配SWF、离线运行时和完整AppIcon尺寸。
输出包含 arm64 IPA、真实Info.plist元数据、运行检查报告和模拟器截图。

操作与安装
支持iOS 15及以上，iPhone/iPad横屏。舞台保持550×400比例完整显示。
四向按键分别控制左右移动、跳跃、向下穿越平台；射击保持原游戏的按键规则。
右上角齿轮中的“无限生命”默认关闭，每次启动需用户手动开启。
AltStore Classic源：https://repo.zrh.jp/source.json
IPA没有开发者证书预签，须由AltStore或用户自己的签名工具重签安装。

验证与实际限制
Chrome实际运行检查覆盖虚拟按键、正常扣命、作弊开关和原暂停/声音按钮。
按源主人要求，发布不等待模拟器；CI要求arm64设备编译和实际IPA包体校验。
如需可选模拟器检查，可设置SNOWMAN_RUN_SIMULATOR=1。
原UI与素材的字节保留不等于已经逐关证明与旧Adobe Flash渲染完全相同；
原游戏有随机雪花和动画，截图并非固定帧像素基准。
SWF引用的历史Miniclip联网排行榜资源目前返回HTML；联网排行榜服务未恢复。
真机安装、触感和设备性能仍须在实际iPhone/iPad上确认。
