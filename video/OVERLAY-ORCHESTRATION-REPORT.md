# Overlay-Orchestration 疊卡語言 × 19 段旁白 — 最終結構化報告

**研究對象**：`C:\prodcut\video` 現有 19 段旁白影片管線
**結論**：疊卡語言（overlay-orchestration card DSL）**已經完整存在並套用**——它不是獨立規格書，而是內嵌在
`narration.py`（每段綁定 `card`）+ `assemble.py`（把 card 編譯成 ffmpeg 疊圖鏈）裡。
成片 `out\好好說話_作品介紹影片.mp4` 已 QA PASS（175.87s / 24.6MB / 1080x1920 h264 + aac 44100）。

---

## 1. 疊卡語言的 de-facto 語法（現場實作）

語言分四層，全部由 `assemble.py` 編譯成單一 ffmpeg `filter_complex`：

### 1.1 Layer 宣告（圖層清單）
| 圖層 | 來源 | 性質 |
|---|---|---|
| `bg` | `color=c=0x1A1512:s=1080x1920:r=30:d=total+10` | 最底層底色（+10s 緩衝防 EOF 空白） |
| `demo` | `raw\demo_raw.mp4`（Playwright 原生錄影） | 真實操作畫面，只在 demo 視窗出現 |
| 6 張字卡 | `assets\cards\{q_self,title,rules,threegood,tech,end}.png`，各以 `-loop 1 -t total+5 -i` 迴圈輸入（+5s 緩衝） | 疊卡本體 |
| 字幕帶 | `drawbox` 底部 190px 半透明橫帶 + `subtitles` 燒錄 | 最後畫，永遠不被卡蓋住 |

### 1.2 Segment→Card 綁定（語言的「每段語句」）
`assets\audio\timeline.json` 的 19 個 item 每段都帶 `card` 欄位
（`q_self / title / rules / demo / threegood / tech / end`），
這就是「第 N 段旁白亮哪張卡」的宣告式綁定。

### 1.3 Window 推導（語句 → 時間窗）
- **demo 例外**：由段邊界計算——`demo_start = 含「真實」的 seg3 起點 − 1.0s`，
  `demo_end = 最後一個 seg4 結束 + 1.0s`（成片座標 +1.2s head_pad 後為 **43.35–130.43s**）。
- **其餘卡目前是硬編碼絕對視窗**：q_self 0–20、title 20–36、rules 36–demo_start、
  threegood demo_end–demo_end+14、tech +14–total−8、end total−8–total（見 `assemble.py:149-162`）。
- 連續同 card 的段會合併成一個視窗（run aggregation）。

### 1.4 編譯（card → ffmpeg 疊圖語句）
每張卡一條鏈，依序疊上前一層（`[cur][cN]overlay...` 鏈接 = 疊卡的 stack 語意）：
```
[idx:v]format=rgba,
        setpts=PTS-STARTPTS+{a}/TB,          # 時間軸位移 = 卡的「上場時間」
        [fade=t=in:st=0:d=0.6]               # 首卡不淡入
        [fade=t=out:st=(b-a)-0.6:d=0.6]      # 尾卡不淡出
        [cN]
[cur][cN]overlay=0:0:eof_action=pass:enable='between(t,{a},{b})'   # 疊上 + 只在視窗內啟用
```
關鍵語言規則（實測踩過的坑，見 `assemble.py:191-205` 注解與 QA 報告 §5-4）：
1. **fade 必須寫在 setpts 位移「之後」**，否則 `st` 落在未位移時間軸，整張卡不輸出、片尾變空白。
2. 位移後串流的相對 0 秒 = 絕對時間 a，所以淡入固定 `st=0`，淡出 `st=b-a-0.6`。
3. 首卡（a≈0）不淡入、尾卡不淡出，避免開頭/結尾出現純底色幀。
4. demo 疊法：`trim=0:demo_len,setpts=...+demo_start` 再 `overlay=0:0:eof_action=pass`，視窗外就是底色。
5. 字幕帶最後 `drawbox` + `subtitles` 疊在最上層（底部 190px 安全區）。

---

## 2. 19 段旁白 → 疊卡/圖層 完整映射

旁白實測時間軸見 `timeline.json`；成片整體平移 `head_pad=+1.2s`（`assemble.py:97,104-106`）。

| idx | 段 | 旁白內容摘要 | timeline 起訖(s) | 成片起訖(s) | 綁定 card | 落在哪個視窗 |
|---|---|---|---|---|---|---|
| 1 | 1 | 最不會說好話的對象是自己 | 0.00–7.80 | 1.2–9.0 | q_self | q_self 0–20 |
| 2 | 1 | 換成別人你早就生氣了 | 8.15–15.57 | 9.4–16.8 | q_self | q_self 0–20 |
| 3 | 2 | 《好好說話》是陪你說好話的網站 | 15.92–27.34 | 17.1–28.5 | title | title 20–36 |
| 4 | 2 | 不是心靈雞湯，先辨識情緒處境 | 27.69–36.79 | 28.9–38.0 | title | title 20–36（後段進 rules） |
| 5 | 2 | 不說加油、不說別想太多 | 37.14–42.80 | 38.3–44.0 | rules | rules 36–43.35 |
| 6 | 3 | 現在實際操作一次（真實畫面） | 43.15–49.17 | 44.4–50.4 | demo | **demo 43.35–130.43**（本段起點−1s） |
| 7 | 3 | 把心事寫下來 | 49.52–52.38 | 50.7–53.6 | demo | demo |
| 8 | 3 | AI 辨識情緒：工作壓力 4/5 | 52.73–60.72 | 53.9–61.9 | demo | demo |
| 9 | 3 | ① 承接 | 61.07–68.39 | 62.3–69.6 | demo | demo |
| 10 | 3 | ② 好話 | 68.74–78.22 | 69.9–79.4 | demo | demo |
| 11 | 3 | ③ 小步 | 78.57–86.18 | 79.8–87.4 | demo | demo |
| 12 | 3 | 複製・收藏・轉送 | 86.53–95.84 | 87.7–97.0 | demo | demo |
| 13 | 3 | 換對象就變成善意 | 96.19–104.0 | 97.4–105.2 | demo | demo |
| 14 | 3 | 收藏只存在你的裝置 | 104.34–109.55 | 105.5–110.8 | demo | demo |
| 15 | 4 | 危機訊號 → 立刻給求助資源 | 109.90–119.40 | 111.1–120.6 | demo | demo |
| 16 | 4 | 1925/1995/1980，AI 不扮演諮商師 | 119.75–128.23 | 121.0–129.4 | demo | demo（本段結束+1s = demo_end） |
| 17 | 4 | 三好四給落地 | 128.58–141.13 | 129.8–142.3 | threegood | threegood 130.43–144.43 |
| 18 | 5 | 本機 Ollama / 線上雲端+規則備援 / 改寫重話 | 141.48–163.20 | 142.7–164.4 | tech | tech 144.43–167.86 |
| 19 | 6 | 好好說話，先對自己說一句 | 163.55–168.66 | 164.7–169.9 | end | end 167.86–175.86 |

成片總長 `total = 168.66(旁白) + 1.2(head) + 6.0(tail) = 175.86s`（≤180s 硬上限，餘 4.1s）。
字幕由 `narration.py` 依每段 `subs` 平均切在該段時長內產生 SRT，再整體平移 1.2s 燒錄。

---

## 3. 「語言真正套到 19 段」還缺什麼（缺口與風險）

1. **前三張卡視窗是硬編碼，沒有從 19 段推導**：q_self/title/rules 固定 0–20/20–36/36–demo_start。
   若重錄前 5 段旁白（時長改變），這三張卡不會跟著移動；只有 demo/threegood/tech/end 是由
   段邊界與 total 動態算出。→ 要把 DSL 完整套到 19 段，應把卡視窗改為
   「同 card 連續 run 的 [首段起點, 尾段結束] + padding」，demo 的做法就是範本。
2. **段間 gap（0.35s）會在 run 聚合時留下小縫**：目前靠視窗互相覆蓋/硬編碼掩蓋；
   若改純推導，需要在相鄰卡視窗間加 overlap（現行 tech 視窗已留 0.35s 交錯緩衝）。
3. **fade/setpts 順序、EOF 緩衝（bg +10s、卡 +5s）是語言的「運行時語義」**，必須保留，
   已寫死在 assemble.py 注解與 QA 報告 §5。

## 4. 重現指令（VIDEO-QA-REPORT §6）
```powershell
cd C:\prodcut\video
# 旁白+時間軸+字幕: narration.py --clean --gap 0.25   → 19 段 seg_NN.mp3 + timeline.json + subtitles.srt
# 字卡: make_cards.py                                     → 6 張 PNG
# demo 錄影: record_demo.py（Playwright 原生錄影）→ raw\demo_raw.mp4
# 合成: assemble.py                                       → out\好好說話_作品介紹影片.mp4
# 驗收: qa_check.py + verify_frames.py                    → report.json / REPORT.md（PASS）
```

## 5. 驗收現況
- `report.json` / `REPORT.md`：verdict **PASS**——175.87s ≤ 180s、1080x1920、aac 44100、解碼無錯、
  12 幀抽查、183 對相鄰幀平均差異 10.06、近乎靜止比例 0%。
- 19 個 `assets\tts\seg_*.mp3` 齊全（實測 19 個）。

## 6. 關鍵檔案
- `C:\prodcut\video\narration.py` — 19 段 SCRIPT（每段含 `card` 綁定）→ TTS + timeline.json + SRT
- `C:\prodcut\video\assets\audio\timeline.json` — 19 段實測時間軸（語言的語句清單）
- `C:\prodcut\video\make_cards.py` — 6 張字卡 PNG 繪製
- `C:\prodcut\video\assemble.py` — 疊卡語言編譯器（window 推導 + ffmpeg 疊圖鏈）
- `C:\prodcut\video\qa\VIDEO-QA-REPORT.md` — 結構表、缺陷根因、重現指令
- `C:\prodcut\video\out\好好說話_作品介紹影片.mp4` — 成片（PASS）
