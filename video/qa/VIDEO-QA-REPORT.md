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
