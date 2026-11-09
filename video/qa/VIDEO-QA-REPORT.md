# T3 影片品質報告 —《好好說話》作品介紹影片（v2 重組版，2026-11-05）

**產出**：`C:\prodcut\video\out\好好說話_作品介紹影片.mp4`
**舊版備份**：`out\backup_v1.mp4`（175.867s / 24.6 MB，task-1~4 前的版本）
**verdict：PASS（自動關卡全過）＋ 人工抽幀零個資終審：待 Lead 終審**

v2 重點：卡窗改由 `timeline.json` 推導、seg5 疊入真實 UI 截圖、
疊上動態疊卡 `assets/overlay/overlay.mp4`（ProRes 4444 alpha）、
tech 字卡文案改為「好話牆」、end 字卡加上網址。

---

## 1. 最終規格（ffprobe 實測）

```
duration = 176.000s   (<= 180s 硬上限：PASS，餘 4.0s；≤179.5s 熔斷未觸發)
size     = 37,490,554 bytes = 35.75 MB
video    = h264 High profile, level 4.1, 1080x1920, 30/1 fps, yuv420p, 5280 frames
audio    = aac LC, 44100 Hz, stereo, 172.836s（= 旁白 171.636 + head_pad 1.2）
container= mp4 (isom), +faststart
overlay  = assets/overlay/overlay.mp4: prores 4444, yuva444p12le, 1080x1920@30, 5276 幀 = 175.867s
           合成時以 trim+tpad(clone) 對齊到 total=176s
```

解碼檢查：`ffmpeg -v error -i out.mp4 -f null -` → **無任何錯誤輸出**

### 疊圖層順序（由下到上）
底色 → demo 錄影（demo 視窗內）→ 6 張 PNG 字卡（卡窗由 timeline 推導）→
seg5 三張截圖（S4/S7/S8）→ **overlay.mp4 動態疊卡（alpha 疊加）** →
底部 190px 字幕橫帶 + 燒錄字幕（永遠最後）。

### alpha 疊加驗證（實測）
- overlay.mp4 本身：t=145s 抽幀 alpha>0 覆蓋率 100%（seg dim 0.4 全螢幕半透明），
  t=1.0s（首卡前）alpha>0 = 0% → alpha 通道確實存在且正確。
- 成片 t=145s 與「proper alpha blend 模型（shot*(1-a)+ovl_rgb*a）」誤差 **8.09**；
  與「當不透明疊加」誤差 **68.37** → 確認 ffmpeg overlay filter 有吃 alpha，
  疊卡正確半透明疊在截圖之上，輸出仍為 yuv420p h264。

---

## 2. qa_check.py 四關（全部 PASS）

| 關卡 | 結果 |
|---|---|
| 1_spec | PASS — 176.0s ≤ 180s（餘 4.0s）；1080x1920 直式；音訊 aac 44100Hz |
| 2_decode | PASS — `ffmpeg -v error -f null -` 無錯誤 |
| 3_frames | PASS — 抽出 12 幀到 `frames/f01..f12`（覆蓋舊檔），供人工零個資終審 |
| 4_motion | PASS — 185 對相鄰幀平均差異 **15.40**，近乎靜止比例 **1%**（門檻 <35% 且 mean>0.5）|

詳細見 `video/report.json` / `video/REPORT.md`（qa_check.py 自動產生）。

## 3. verify_motion.py（demo 視窗 43.35–130.426s）— PASS

```
python verify_motion.py out/好好說話_作品介紹影片.mp4 --demo-start 43.35 --demo-end 130.426
全片          n=351  mean=6.910  變化步數 48.4%  ✓ (需 ≥15%)
Demo 43-130s  n=174  mean=10.220 max=123.57  變化步數 73.0%  ✓ (需 ≥15%)
最長連續凍結：8.0s（29.0s → 37.0s）——落在 title/rules 字卡靜態區，屬設計如此
判定：PASS
```

每 10 秒視窗 mean diff：demo 段（40–130s）介於 4.7–21.3，無一窗凍結；
140–170s（seg5 截圖 + 動態疊卡動畫）mean 5.7–10.6，疊卡動畫有在動。

---

## 4. 19 段新結構（timeline.json → 成片座標 = timeline + head_pad 1.2s）

| idx | seg | timeline 起訖(s) | 成片起訖(s) | card | 內容摘要 |
|---|---|---|---|---|---|
| 1 | 1 | 0.000–7.800 | 1.200–9.000 | q_self | 最不會說好話的對象是自己 |
| 2 | 1 | 8.150–15.566 | 9.350–16.766 | q_self | 換成別人你早就生氣了 |
| 3 | 2 | 15.916–27.340 | 17.116–28.540 | title | 《好好說話》是什麼 |
| 4 | 2 | 27.690–36.786 | 28.890–37.986 | title | 先辨識情緒與處境，最後才給話 |
| 5 | 2 | 37.136–42.800 | 38.336–44.000 | rules | 不說「加油」、不說「別想太多」 |
| 6 | 3 | 43.150–49.174 | 44.350–50.374 | demo | 現在實際操作一次（真實畫面） |
| 7 | 3 | 49.524–52.380 | 50.724–53.580 | demo | 把心事寫下來 |
| 8 | 3 | 52.730–60.722 | 53.930–61.922 | demo | AI 情緒辨識：工作壓力 4/5 |
| 9 | 3 | 61.072–68.392 | 62.272–69.592 | demo | ① 承接 |
| 10 | 3 | 68.742–78.222 | 69.942–79.422 | demo | ② 好話 |
| 11 | 3 | 78.572–86.180 | 79.772–87.380 | demo | ③ 小步 |
| 12 | 3 | 86.530–95.842 | 87.730–97.042 | demo | 複製・收藏・轉送 |
| 13 | 3 | 96.192–103.992 | 97.392–105.192 | demo | 換對象 = 送出去的善意 |
| 14 | 3 | 104.342–109.550 | 105.542–110.750 | demo | 收藏只存在你的瀏覽器 |
| 15 | 4 | 109.900–119.404 | 111.100–120.604 | demo | 危機訊號 → 立刻給求助資源 |
| 16 | 4 | 119.754–128.226 | 120.954–129.426 | demo | 1925/1995/1980，AI 不當諮商師 |
| 17 | 4 | 128.576–141.128 | 129.776–142.328 | threegood | 三好四給落地 |
| 18 | 5 | 141.478–163.654 | 142.678–164.854 | tech | **好話牆**：匿名掛牆/AI 先回應、鼓勵經 AI 審核、越具體分越高雙方得分、每週一重算排行榜前十稱號、紀錄只存在瀏覽器 |
| 19 | 6 | 164.004–171.636 | 165.204–172.836 | end | 好好說話，先對自己說一句（good-words.vercel.app） |

旁白音軌總長 171.636s；成片 total = 171.636 + 1.2 (head_pad) + 3.164 (tail_pad) = **176.000s**。

## 5. 卡窗推導（assemble.py 由 timeline 聚合，不再硬編碼）

同 card 連續 run 聚合成 [首段 start, 尾段 end]；非 demo 內縮 150ms；全部 + head_pad 1.2s。
demo 例外照舊：起點 −1s、結束 +1s。

| card run | timeline 起訖 | 成片卡窗（內縮後） |
|---|---|---|
| q_self | 0.000–15.566 | **1.350–16.616** |
| title | 15.916–36.786 | **17.266–37.836** |
| rules | 37.136–42.800 | **38.486–43.850** |
| demo | 43.150–128.226 | **43.350–130.426**（±1s 例外） |
| threegood | 128.576–141.128 | **129.926–142.178** |
| tech | 141.478–163.654 | **142.828–164.704** |
| end | 164.004–171.636 | **165.354–172.686**（尾卡 enable 撐到 total=176，不淡出） |

**demo 視窗 = [43.350, 130.426]**，與 `raw/demo_timing.json` 的 `demo_window_video` 完全一致 ✓

### seg5 截圖視窗（tech run 成片時間三等分）
| 截圖 | 成片視窗 |
|---|---|
| S4_wall_after_publish | 142.678–150.070 |
| S7_me_panel | 150.070–157.462 |
| S8_leaderboard_top10 | 157.462–164.854 |

各張以 `scale=contain` 到 1080x1920、底色（0x1A1512）pad。demo 視窗內不疊全螢幕圖（避免蓋操作畫面），
其餘截圖（S1/S2/S3/S5/S6/S9/S10）未入片。

---

## 6. 疊卡清單（overlay.mp4 動態疊卡，共 21 卡，時間為成片秒數）

| 卡 id | 效果 | 成片視窗(s) | 側 |
|---|---|---|---|
| c1-1 | big-statement | 1.350–8.850 | left |
| c1-2 | quote-reveal | 9.500–16.616 | right |
| c3-1 | timeline-milestones | 17.266–28.390 | left |
| c3-2 | stat-board | 29.040–37.836 | right |
| c5 | compare-bars | 38.486–43.850 | left |
| c6-1..c6-11 | various (demo 段, dim 0.12, offsetY −560) | 44.500–129.276 | 左右交替 |
| c17 | timeline-milestones | 129.926–142.178 | left |
| c18-1 | stat-board 好話牆運作 | 142.828–149.920 | left |
| c18-2 | number-roll 排行榜前十 | 150.220–157.312 | right |
| c18-3 | segment-board 每週一重算 | 157.612–164.704 | left |
| c19 | quote-reveal 收尾 | 165.354–172.686 | right |

（21 卡 = 2+2+1+11+1+3+1；來源 `overlay/overlay.json`。）

## 7. 截圖清單（assets/shots，共 11 張，全部 page.route 虛構資料）

S1_home_clean, S2_rewrite_result, S3_response_3part, S4_wall_after_publish,
S5_wall_filter, S6_encourage_flow, S7_me_panel, S8_leaderboard_top10,
S9_crisis_panel, S10_mobile_375_home, S10_mobile_375_result。
入片者：S4 / S7 / S8（見 §5）。

## 8. 零個資驗證（BRIEF §8）★失格紅線

- **錄影與截圖來源**：全部經 Playwright，`page.route` 攔截 /api/respond、/api/wall、
  /api/leaderboard 回傳**虛構資料**（牆友#AF3B 等假名、假分數）；錄影為 Playwright
  原生頁面錄影（`record_video_dir`），桌面/工作列/瀏覽器 UI 在物理上不可能入鏡。
- **PIL 防呆**：每張截圖檢查尺寸 + stddev≥3；錄影前 preflight 空白防呆。
- **自動抽幀**：qa_check.py 抽 12 幀到 `frames/`（f01–f12，覆蓋舊檔）。
- **人工抽幀終審**：**待 Lead 終審** —— 請 Lead 逐幀檢視 `video/frames/f01_0013.54s.png` …
  `f12_0162.46s.png`，確認無姓名/暱稱/學校單位/Logo/人像/帳號/Email。
  （「1980 張老師」為真實熱線名稱，非個資。）

---

## 8b. v3 視覺修正（2026-11-05 第二輪，回應「特效字後面背景同字/字太小/字幕醜」）

- **字幕**：原 `FontSize=15,MarginV=34` 實測文字落在 y≈1612–1677、**浮在 190px 橫帶（y1730+）上方**，形成「文字懸空 + 底下空黑帶」的醜感。改為橫帶 `y=1680,h=240,alpha 0.62` + `FontSize=19,MarginV=3,Outline=2,Shadow=1`；隔離渲染實測所有 cue（最長 31 字）最多 2 行、落在 **y1671–1880、x72–1004，完全在帶內**；成片抽幀實測一致。
- **特效卡字太小**：卡片內層原 `zoom 0.56`（24px 詞實際只有 13px）。改 `CARD_W_SCALE=0.72`，各卡字號上調（fx-title 21→26、stat 值 44→60、keyword 詞 24→32、compare 標 21→28、segment 標題 17→24、checklist 24→32、timeline 19→26、quote 預設 40→52、big-statement 預設 54→68、段頭板標題 40→52），`SUBTITLE_TOP` 對齊新帶 1680。重渲 5276 幀後 verify 全 PASS（bbox x[44..1036]、y 最大 1187 < 1680）。
- **背景同字重複**：靜態 PNG 字卡在疊加時以 `colorchannelmixer=aa=0.22` 壓淡（尾卡 0.5），特效卡的玻璃卡疊在上面為主視覺；實測卡區中心亮度由 ~80 降到 ~45、特效卡文字亮像素仍充足（t=5s 左卡區 18864 px）。
- v3 成片：176.0s / 34.9MB / h264 High 4.1 1080x1920@30 yuv420p + AAC 44.1k，qa_check 4 關 PASS（motion mean 14.17、靜止 1%），verify_motion PASS（demo 視窗 43.35–130.43s）。舊版備份 `out/backup_v2_176s.mp4`。

## 8c. v4 背景生成 + 字卡跳出 + 字幕再修（2026-11-06 第三輪）

回應「背景去生成、字要跳出來、不要只擺字；字幕還是醜、太大又太下面」。

- **生成背景**：NIM 此 key 無生圖模型授權（`/v1/images/generations` 404），改程序化生成——
  `gen_bg.py` 在 270x480 float 場疊 12 個種子確定性漂移高斯光斑，依 timeline 各 run 換暖色
  palette（邊界 2s 交叉淡變）+ film grain + vignette，放大到 1080x1920@30輸出 `assets/bg/bg.mp4`
  （178s，crf18）。assemble.py 底層由純色改疊 bg.mp4（`-stream_loop -1`；`-loop` 只給 image2 用）。
  實測卡段背景 std 13–66（v3 純色 ≈0）、demo 視窗仍由真實錄影覆蓋。
- **字卡跳出（pop）**：`clock.ts` 新增 `easeOutBack`，`CardShell` 進場改
  `translateY(rise) scale(0.62→1 with overshoot)`，transform-origin 50% 60%。重渲 5276 幀 verify 全 PASS。
- **字幕再修**：`FontSize 19→16`、`MarginV 3→12`（文字上移，底部留白 40→97px）、`Outline 2→1`、
  橫帶 `y=1700,h=220,alpha 0.55`；`Stage.SUBTITLE_TOP` 對齊 1700。隔離渲染實測：行高 70px、
  底行 y1753–1823、常見 1–2 行落帶內、最長 31 字 x 寬 ≤ 930px。
- **靜態字卡再壓淡**（aa 0.22→0.12，尾卡 0.55）：生成背景上不再有同字鬼影。
- v4 成片：176.0s / **49.9 MB**（crf 20→23，動態背景+grain 在 crf20 會到 81MB）/ h264 1080x1920@30
  yuv420p + AAC 44.1k，qa_check 4 關 PASS、verify_motion PASS。備份 `out/backup_v3_176s.mp4`。

## 8d. v5 背景改用 Google Flow 真實生圖（2026-11-06 第四輪）

依 `SKILL-google-flow-image-gen`（hermes `creative/google-flow-image-gen`＋obsidian 鏡像）與
`finance-ig/tools/flow-gen2.js` 的實測經驗，用受控 Chrome（port 9334，profile 登入為使用者本人先前手動完成）
在 Flow 專案 ed000562 以 **9:16、x1、🍌 Nano Banana 2.1** 生成 6 張抽象暖色背景（prompt 禁止文字/人/Logo；
NIM key 無生圖授權故走 Flow UI）。驗收：9 張候選全部 768×1376、SHA-256 全異、RapidOCR 7/9 無文字
（cand-05/06 各有低信心偽字元，未採用）。依亮度/色溫對到各段：q_self=cand-07、title=cand-01、
rules=cand-03、threegood=cand-09、tech=cand-04、end=cand-02 → `assets/bg/img/*.jpg`。

- `gen_bg_img.py`：每張圖放大到 1296×2304 後 zoompan 慢推 1.0→1.10 + 中心微漂移，依 timeline run 連續覆蓋
  [0,178s]（空隙用前段圖延伸、demo 段深色），concat 成 `assets/bg/bg.mp4`（28MB）。
- assemble 疊 bg.mp4 成底（`-stream_loop -1`），另加 `scale=out_range=tv` + bt709標籤，輸出維持 yuv420p/tv。
- v5 成片：176.0s / **36.9MB** / h264 High 4.1 1080x1920@30 yuv420p(tv) + AAC；qa_check 4 關 PASS、
  verify_motion PASS；實測各段背景 mean RGB 互異（q_self 24/18/13、title 97/68/53、threegood 90/57/31…）、
  demo 視窗仍是真實錄影、字幕 y1647–1823（底緣留白 97px）。備份 `out/backup_v4_176s.mp4`。
- 花絮：flow-gen2.js 的 45s 早退會把「其實已送出」誤判 not-triggered，圖仍在背景生成完成；
  用 `gwbg-harvest.js` 捲到底抓 asb 原圖（=s2048）收割即可，不必重燒額度。

## 8e. v6 背景殘字清零 + 動畫窗格放大（2026-11-06 第五輪）

回應「後面的字還是沒拿掉」＋「動畫文字窗格太小」。

- **背景殘字清零**：靜態字卡（6 張 Pillow 滿版卡）在合成時 `colorchannelmixer=aa=0`，
  只有收尾網址卡留 0.95。理由：背景已是生成的 Flow 圖，任何滿版文字都會與 overlay 動態卡重複。
  證明（檔案本體量測）：舊靜態文字帶的邊緣能量 v6 vs 純生成背景 bg.mp4 比值 **0.42–0.92（<1）**，
  即畫面上「沒有比背景更多的文字結構」；若仍有 12% 殘字，比值會 >1。
- **收尾網址卡改寫**：`make_cards.py` 的 `card_end` 由「滿版漸層 + 大字『好好說話』+ 金句」
  （與 overlay c19 金句卡同句＝重複來源）改為 **透明底單一面板**（y1430–1690、x90–990，佔畫面 11.3%，
  面板外 0 不透明像素），只放 `good-words.vercel.app` 與「免登入 · 不上傳 · 手機優先」。
  並把字卡層的**合成**移到 overlay 之後，避免被段內 40% dim 壓暗：URL 行最大亮度 140 → **233**。
- **動畫窗格放大**：`CARD_W_SCALE 0.72 → 0.92`（+28%）＋ 10 種卡的 `width` 各加 60–100px
  （如 timeline 680→780、quote 640→740、big-statement 760→820、segment-board 520→640）。
  另加**高度自適應**：量到卡高後以「上緣留白 12px、下緣字幕帶 1700」夾出可用高度，必要時降 scale
  （下限 0.5）——demo 段卡片中心在 y=400，這條限制會自動縮小過高的卡，不會切頂。
  冒煙量測：單側亮區寬由 461–681px 變 541–836px；5276 幀 verify 全 PASS（x[43..1039]、y≤1210 < 1700）。
- v6 成片：176.0s / 36.9MB / h264 High 4.1 1080x1920@30 yuv420p + AAC；qa_check 4 關 PASS、
  verify_motion PASS；字幕仍落 y1647–1823（底緣留白 97px）。備份 `out/backup_v5_176s.mp4`。

## 8f. v7 視覺審查（視覺模型子智能體）後的修正（2026-11-07）

用可讀圖的子智能體（NIM `nemotron-3-nano-omni-30b`，另 3 條 vision 路線 llama-3.2-90B/11B、gemma-3 啟動失敗）
實際看 15 張整幀＋字幕帶＋卡片原尺寸裁切後給的批評。原始判讀：**像「教育宣導的簡易投影片」、
有 DIY 感、時間軸／數據卡像套模板**；一位評審視角給 **65/100**，扣分在「看不出實際功能、創意不足」。
四項已修：

1. **卡片再放大並統一寬度**（回應「窗格太小」＋審查「左右不平衡」）：
   `CARD_W_SCALE 0.92` ＋ `build_overlay` 統一 `width`（一般段 860、demo 段 780），
   實際卡寬 791px ＝**畫面 73%**（原本 461–681px），字級再上調 20–25%（fx-title 26→34、
   數據值 60→74、關鍵詞 32→42、清單 32→42、大字 68→78、數字 92→108…）。
2. **字幕改漸層遮罩**（回應「字幕醜」）：`subtitle_gradient.png`（y1560–1920，alpha 0→100→205，
   上緣 140px 曲線淡入）取代 `drawbox` 硬邊黑條。量測：v6 在 y1699 有 36.8/列的硬邊；
   v7 剖面 225→187→98→58→50 **單調遞減無硬邊**。字級 16→17（行高 74px）、底緣留白 98px。
3. **去重複文字**：段頭板標題改成短標籤（`最不會說好話的對象`→`痛點`、`《好好說話》是什麼`→`作品登場`、
   `真實操作一次`→`操作示範`、`護欄與底線`→`安全底線`、`好話牆怎麼玩`→`參與方式`、`先對自己說一句`→`結語`），
   因為原文與旁白字幕整句重複（審查員指出「同一句話在卡片與字幕重複」）。
4. **玻璃卡質感統一**：冷灰藍玻璃 `rgba(13,16,23,.74)` → 暖色漸層玻璃
   `linear-gradient(160deg, rgba(30,23,19,.74), rgba(14,11,10,.82))`、blur 16→10px、
   內緣高光、圓角 20→24、padding 加大；demo 段 dim 0.12 → **0.04**，讓真實網站畫面更清楚。
- v7 成片：176.0s / **36.7MB** / yuv420p(tv) + AAC；qa_check 4 關 PASS、verify_motion PASS、
   5276 幀 verify_overlay ALL PASS（x[43..1040]、y≤1255 < 1700）。備份 `out/backup_v6_176s.mp4`。

## 8g. v8：seg2 後半改播全幅真實畫面（2026-11-07，選項 A）

審查員的核心批評是「像模板、看不出真實功能」。使用者選 A 後實作：

- **overlay**：`PLAN[3]` 加 `window=(0.0,0.52)`（卡片只佔 seg2 前 52%＝17.266–27.818s）；
  `PLAN[4]`（原「先辨識，再給話」抽象數據卡）整張**移除** → 卡片數 21→20。
- **assemble**：新增 seg2 全幅截圖視窗 —— `S2_rewrite_result` 28.386–33.812s、
  `S10_mobile_375_result` 33.812–37.986s（原本 shots 只在 seg5）。
- **dim 覆寫**：`SEG_DIM = {2: 0.15}`（其餘非 demo 段維持 0.40），讓真實畫面不要被壓暗。
- 驗證（像素＋OCR，不是目視）：
  - t=30.0（S2）：上半平均亮度 197.5、亮像素 93.7%、白底特徵 40.5%（對照卡片段 t=22 只有 5.0%）
    → 確實是全幅網站畫面。
  - OCR（rapidocr）在 t=30 讀到「承接／好話／小步·今晚做一件就好／複製這句／匿名上好話」等
    **真實產品輸出**；t=35.5 讀到「工作壓力…」的實際輸入與三段回應 → 正是審查員要求
    「輸入負面自語 → 系統改寫成承接/好話/小步」的畫面。
  - 個資：OCR 文字中無姓名／Email／帳號（截圖來自 capture_shots.py 的虛構資料，
    匿名代號 `demo-shots-a3f9aa11bb22`）。
- v8 成片：176.0s / **37.5MB** / yuv420p(tv) + AAC；qa_check 4 關 PASS、verify_motion PASS、
  verify_overlay ALL PASS（5276 幀）。備份 `out/backup_v7_176s.mp4`。
- 已知取捨：seg2 後半（約 9.6s）沒有動畫字卡，只有真畫面＋字幕（刻意的，讓產品自己說話）；
  若日後覺得太靜，可再加 Ken Burns 慢推。

## 8h. v9：seg5 讓真實截圖露出來（2026-11-07）

視覺複驗對 v8 給 **95/100**（改善度 5/5），唯一扣分點是「seg5 的數據卡仍像抽象模板」
（該段其實背後是 S4/S7/S8 三張真實截圖，但被 40% 暗化＋大卡蓋住）。已修：

- `SEG_DIM = {2: 0.15, 5: 0.18}`：seg5 暗化 0.40 → 0.18。
- `CARD_W_SEG5 = 700`（實際 644px＝畫面 60%，其餘段維持 860/791px）：讓好話牆、排行榜、
  我的紀錄三張真截圖在卡片旁邊清楚可見。
- 量測（卡片右側 x700–1080 區域平均亮度，越亮＝截圖越清楚）：
  t=146 +27.1、t=154 +47.0、t=161 +63.4（v9 vs v8）。
- v9 成片：176.0s / **37.9MB** / yuv420p(tv) + AAC；qa_check 4 關 PASS、verify_motion PASS、
  verify_overlay ALL PASS（5276 幀，卡片 x[44..1039]、y≤1206）。備份 `out/backup_v8_176s.mp4`。

## 8i. v10：「讓模型看影片」實驗 + 三項修正（2026-11-08）

### 模型能不能看影片？（實測，三條視覺路線各回報一次）
素材：`qa/motion/`（全片膠捲 3 張、分段連續影格 3 條、動畫 GIF 3 個 4fps、低碼率 mp4 20s）。

| 路線（provider nvidia） | mp4 | 動畫 GIF | 膠捲 PNG | 分數 |
|---|---|---|---|---|
| `meta/llama-3.2-90b-vision-instruct` | ✗ 讀不到 | ✓ 讀到（並描述動態） | 部分 ✓ | 80/100 |
| `google/gemma-3-12b-it` | ✗ | — | — | 啟動失敗 |
| `nvidia/nemotron-3-nano-omni-30b-a3b-reasoning` | ✗ 讀不到 | ✓ 讀到（並描述動態） | ✓ | 78/100 |

**結論：目前可用的模型路線都無法直接讀 mp4；但 `read_image` 支援 GIF，動畫 GIF 可以讓模型看到動態**
（Omni 從 GIF 描述出「字卡以淡入位移呈現、未見凍結」；Llama 也從 GIF 描述出卡片出現/背景漸層）。
另外 `meta/llama-3.2-11b-vision-instruct`、`nvidia/nemotron-3.5-super-vl-120b-a12b`、
`nvidia/cosmos-reason2-8b` 三條在此 session **不被允許或啟動失敗**。

### 依它們的建議做的三項修正
1. **字卡進場放慢**：`parts.tsx` 進場 420/520ms → **620/800ms**、出場 260→320ms（審查：「過渡略顯生硬」；
   也符合使用者「寧慢勿快」偏好）。
2. **字幕對比加強**：漸層遮罩 RAMP 140→170px、滿值 alpha 205→**228**、曲線 gamma 1.5→0.7，
   字幕 `Outline 2→3`。量測（對 v8）：亮畫面段 t=100 字幕底平均亮度 38.6 → **24.0**（壓得更黑）；
   y1647 處 alpha 100→143。
3. **手機版截圖不再被放大**：新增 `S10_mobile_375_result_framed.png`（`make_framed_shot.py`：
   原生 750×1624 置中、圓角＋白框、背景用自身放大模糊壓暗）。量測 t=35.5：
   中央（手機內容）銳利度 3.88 vs 兩側（模糊底）0.24／0.26 ＝ **16.2×**，不再模糊。

### 順手修掉一個真 bug（verify 抓到）
放慢進場後 `verify_overlay` FAIL：卡片「跳出」overshoot 讓卡片瞬間外擴約 11px，
超出安全區（f04300 x1=**32**、f04520 x2=**1048**）。修法：把縮放原點釘在靠邊那一側
（`--card-origin`：左卡 `0% 60%`、右卡 `100% 60%`），overshoot 只往畫面內長。
修後 verify **ALL PASS**（f04300 x[44..711]、f04520 x[368..1036]）。
- v10 成片：176.0s / 37.6MB / yuv420p(tv) + AAC；qa_check 4 關 PASS、verify_motion PASS、
  verify_overlay ALL PASS（5276 幀）。備份 `out/backup_v9_176s.mp4`。

## 8j. v11：字幕全面改版（ASS／無黑底／字級縮小）（2026-11-08）

使用者反映：「字幕有點醜、為什麼要那麼大、以及黑底漸層，請去找別人那種好看的上字幕法」。

### 依據（外部搜尋服務無 API key，改用本機既有的權威規格）
`~/.dsh/skills/bilingual-subtitles/references/formatting.md`（使用者自己的字幕 skill，內文標明為業界慣例）：
* 直式 1080×1920：主要語言字級 ≈4.8% 畫面高、**描邊 3–6px 黑＋陰影 1–2px**、**不要底框**
* 字體建議 **Noto Sans TC**（OFL 可散布；明列「避免 Microsoft JhengHei」）
* 中文每行 12–16 字、1–2 行；cue 提早 0.2s 出現、延後 0.3s 消失；中文與拉丁／數字間補空格

### 實作
- 新增 `video/make_ass.py`：SRT → ASS。白字＋黑描邊＋柔和陰影、無任何色塊；
  依 **em 寬度**（全形 1.0／拉丁數字 0.5）自動斷行、拉丁詞不可拆（AI 不會被拆成 A／I）、
  標點禁則（收尾標點不落行首）、兩行平衡切法；塞不下 2 行的 cue 自動 `\fs` 縮一級。
- `assemble.py`：**移除** `drawbox`／漸層遮罩那層，改成單一 `subtitles=ASS:fontsdir=<fonts>`。
- 字級：80（墨高實測 50px，1 行區塊 50px、2 行區塊 130px），MarginL/R 90、固定 5 條候選中由視覺模型選出的樣式。

### 修掉一個會漏字的真 bug（本輪最重要的發現）
用「逐條 cue 驗證」發現 **31 條裡有 7 條在成片完全沒出現**（23%）。最小重現（背景＋字幕）確認與合成鏈無關：
* V1 去掉 0.2/0.3s 重疊 → 7/7 出現；V2 保留重疊但去掉淡入 → 0/7；V3 兩者都去掉 → 7/7
  ⇒ 主因是**cue 重疊時 libass 的防碰撞（Collisions）把較晚那條往上搬、搬出畫面**。
* 修法：每條 cue 加 `\an2\pos(540,1620)` 固定位置（免疫防碰撞），保留「提早 0.2s／延後 0.3s」的可讀性紅利。
  修後逐條複驗 **31/31 全部出現**。

### 量測結果（v11 vs v10）
| 項目 | v10（舊） | v11（新） |
|---|---|---|
| 字幕黑底 | 有（亮畫面時帶內比帶上方暗 **155**） | **無**（落差 −5） |
| 兩行區塊高度 | 187px | **130px（−30%）** |
| 底緣留白 | 98px | 313px |
| 文字 vs 周圍對比（亮底 demo） | 226 | 121（白字＋黑描邊仍清楚） |
| 字形 | Microsoft JhengHei（版權字型） | **Noto Sans TC（OFL）** |
| cue 出現率 | 24/31（7 條消失） | **31/31** |

- v11 成片：176.0s / 41.2MB / yuv420p(tv) + AAC；qa_check 4 關 PASS、verify_motion PASS。
  備份 `out/backup_v10_176s.mp4`。

### v11b：視覺終審後的微調（同輪）
視覺模型比較新舊字幕後給分：**字級 8:2、位置 5:3、可讀性 5:2、整體美感 5:2**（新:舊），
認為亮色畫面上「白字＋黑描邊 6px，對比良好、清晰可讀」，建議再縮小與上移：
* 字級 **80→70px**（墨高 43px）、描邊 **6→4px**、`MarginV 300→400`（底緣留白 **411px**，正好符合
  skill 的 Reels 下緣安全區 420px 建議）
* 位置安全性：掃 `overlay.mp4` alpha 通道（352 個取樣點）確認**卡片全片最低只到 y=1210**，
  字幕區間 y1395–1509 不會撞卡。
* 量測：兩行區塊 **187→113px（−40%）**、單行 43px、**31/31 cue 出現**。
* v11b 成片：176.0s / 41.1MB；qa_check 4 關 PASS、verify_motion PASS。commit `4819b2a`。

## 8k. v13：背景改「有意義的真實網站畫面」＋版面三段化（2026-11-09）

使用者反映：「背景都太沒意義」「有些文字放的位置怪怪的」「用插件來檢核」。

### 檢核工具（先說結論：沒有現成的影片檢核插件）
* `cordis_inspect_list` 只有 harness 執行時檢核（Service／Event／Config／Tool／Slot／Theme／Builtin），
  `plugin_manager list_plugins` 的 202 個條目都是 session／llm／storage／sandbox 等基礎設施 → **沒有影片或影像檢核插件**。
* 因此改用兩條自建檢核：(a) **自動版面稽核腳本**（讀 `overlay.mp4` 的 alpha 通道與成片像素），
  (b) **可讀圖的子智能體**（NIM omni 模型）看抽幀。兩者都能重複執行、可回歸。
* 外部網路搜尋不可用（`DEEPSEEK_API_KEY` 未設定），改用本機 skill 內既有的規格書。

### 自動稽核抓到的三個真缺陷（都已修）
1. **卡片侵入段頭板區**：703 個取樣點中有 **111 個（16%）** 卡片頂端越界到 y<235，
   與段頭板（tag＋標題，固定在左上方）疊在一起 → 看起來「位置怪」。
2. **收尾網址卡被字幕壓住**：面板原本在 y1430–1690，而字幕在 y1395–1509 →
   面板內每次都量到 1.3k–3.4k 個字幕白字像素（＝字幕壓在網址上）。
3. **背景無意義**：6 張 Flow 抽象光斑與內容無關；第一版改成模糊截圖時用了 30px 模糊＋壓暗到 30%，
   視覺審查回報「仍是抽象光斑、看不出是網站」→ 改為**模糊 10px＋壓暗 46%**，仍可辨識網站版面。

### 修法
* **版面三段化**（`Stage.tsx`）：頂部 0–250px 只給段頭板、內容 250–1370px 給卡片（中心 y810）、
  1370px 以下給字幕與收尾卡。demo 段卡片 offsetY 由 −560 改 −210（配合新內容區）。
  稽核回歸：卡片越界頂部 **111 → 0 / 703**、侵入字幕區 **0**。
* **收尾網址卡**移到 y1560–1795（字幕底緣 1509，間隔 52px）：面板內字幕白字像素 **0**，
  金色網址像素 1.6 萬（清楚可見）。
* **背景**改用該段相關的真實截圖（`make_bg_from_shots.py`）：
  seg1←S1 首頁、seg2←S2 改寫結果／S3 三段、seg5←S4 好話牆／S8 排行榜、收尾←S10 手機版，
  模糊 10px＋壓暗 46%＋暗角，再交給 `gen_bg_img.py` 做 Ken Burns 推鏡。
* **去重複**（子智能體指出「卡片與字幕重複」）：自動比對 20 張卡片與同時段字幕的相似度，
  最口語化的 4 張改寫（c1-1／c1-2／c6-1／c19）；其餘 7 張屬「同一資訊的不同形式」
  （卡片是列表／數字，字幕是旁白句子），保留並在下方向使用者說明。

- v13 成片：176.0s / 41.0MB / yuv420p(tv) + AAC；qa_check 4 關 PASS、verify_motion PASS。
  備份 `out/backup_v12_176s.mp4`。

### 尚未處理（需要你決定，屬內容／結構層）
- 審查員建議：**在片中放一段「使用者輸入負面自語 → 系統即時改寫成承接/好話/小步 → 貼上牆」的真實流程畫面**，
  並認為 seg2 的抽象時間軸／數據卡最像「套模板」。
  可選做法：(A) seg2 後半改播 `S2_rewrite_result`／`S10_mobile_375_result` 全幅真畫面（現成截圖）；
  (B) 把 seg2 的 2 張抽象卡換成截圖卡；(C) 維持現狀。
- 另一選項：全程右下角放一個小 `good-words.vercel.app` 浮水印，方便評審找網站。

## 9. v2 合成踩過的坑（記錄，避免後人踩）

1. **fade 的 st 必須是 setpts 位移「之後」的絕對秒數**：
   `setpts=PTS-STARTPTS+a/TB` 後串流 pts = a+k/25（絕對時間），
   所以正確寫法是 `fade=t=in:st=a`、`fade=t=out:st=b-0.6`。
   若用相對 st=(b-a)-0.6，所有幀 pts 都 > st+d，fade out 會把整張卡 alpha 降成 0，
   實測整段字卡/截圖完全不輸出（v2 第一次合成因此所有卡與截圖都消失，已修復重跑）。
2. **overlay.mp4 的 alpha 疊加確認**：prores 4444 (yuva444p12le) 直接當 overlay 第二輸入，
   ffmpeg overlay filter 自動吃 alpha；長度用 `trim=0:total+2` + `tpad=stop_mode=clone:stop_duration=2`
   對齊（overlay 175.867s < total 176s），輸出維持 yuv420p。
3. EOF 緩衝保留：底色 +10s、字卡/截圖迴圈輸入 +5s，避免片尾空白幀。

## 10. 重現指令

```powershell
$py = "C:\Users\User\.dsh\dsh-runtimes\dsh-primary-runtime\dependencies\python\python.exe"
cd C:\prodcut\video
& $py make_cards.py        # 6 張字卡（tech=好話牆, end=含網址）
& $py assemble.py          # 卡窗由 timeline 推導 + seg5 截圖 + overlay alpha 疊加
& $py qa_check.py          # 4 關 + 抽 12 幀 -> report.json / REPORT.md / frames/
& $py verify_motion.py "out\好好說話_作品介紹影片.mp4" --demo-start 43.35 --demo-end 130.426
```

（task-1~4 的旁白/截圖/demo錄影/overlay 渲染見各自 task；本報告只覆蓋 task-5 合成 + QA。）
