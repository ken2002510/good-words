'use strict';

/**
 * data.js — 內容層
 *
 * 對接內容組的介面契約（C:\prodcut\content\）：
 *   emotions.json        [{ id, name, keywords[], intensity[], situation }]
 *   goodwords.json       { [emotionId]: [ { 承接, 好話, 小步 } x >=6 ] }
 *   crisis.json          危機詞庫（擴充用，格式寬鬆）
 *   share_templates.json 轉送模板
 *
 * 設計原則：**網站無論如何都要能跑**。
 *  - content/ 存在且合法 → 用內容組的資料
 *  - 任何一個檔案缺席／壞掉 → 該部分退回內建 fallback，不 throw、不白畫面
 *  - 讀取失敗會在 /api/health 回報，方便對接時除錯
 *
 * 一律用 fs.readFileSync 讀進來後 JSON.parse（不依賴 BOM 處理套件），
 * 並主動剝除 UTF-8 BOM —— 這是本專案已踩過的坑，寧可多防一層。
 */

const fs = require('fs');
const path = require('path');

/** content/ 位置：可用環境變數覆寫（部署時把內容放在別處） */
const CONTENT_DIR = process.env.CONTENT_DIR
  ? path.resolve(process.env.CONTENT_DIR)
  : path.resolve(__dirname, '..', '..', 'content');

/** 剝除 BOM 後 parse */
function readJson(file) {
  const buf = fs.readFileSync(file);
  let text = buf.toString('utf8');
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1); // UTF-8 BOM
  return JSON.parse(text);
}

// ─────────────────────────────────────────────────────────────
// 內建 fallback（覆蓋 BRIEF 點名的 8 類情緒，每類 >= 6 句）
// 等內容組的 content/*.json 到位後會被自動取代。
// ─────────────────────────────────────────────────────────────

const FALLBACK_EMOTIONS = [
  {
    id: 'work',
    name: '工作／課業壓力',
    keywords: ['工作', '上班', '主管', '老闆', '同事', '加班', '報告', '考試', '課業', '論文', '專案', '被罵', 'KPI', '業績', '失業', '裁員', '辭職', '開會', '進度'],
    intensity: [3, 4],
    situation: '工作或課業上的負荷，已經超過你現在能輕鬆消化的量。',
  },
  {
    id: 'relationship',
    name: '感情',
    keywords: ['分手', '失戀', '男朋友', '女朋友', '另一半', '曖昧', '暗戀', '喜歡的人', '被拒絕', '離婚', '吵架', '冷戰', '不理我', '已讀', '被封鎖', '第三者', '劈腿'],
    intensity: [3, 5],
    situation: '一段對你重要的關係，現在讓你心裡很不安穩。',
  },
  {
    id: 'family',
    name: '家庭',
    keywords: ['家人', '爸', '媽', '父母', '家裡', '回家', '哥哥', '姐姐', '弟弟', '妹妹', '小孩', '孩子', '老公', '老婆', '婆家', '親戚', '過年'],
    intensity: [3, 4],
    situation: '家裡的關係或期待，壓在你身上，而你沒辦法說不要。',
  },
  {
    id: 'selfworth',
    name: '自我價值',
    keywords: ['我很爛', '沒用', '廢物', '一無是處', '比不上', '不如人', '失敗', '丟臉', '自責', '後悔', '沒資格', '討厭自己', '不夠好', '很笨', '很差'],
    intensity: [3, 5],
    situation: '你正在用很嚴厲的眼光看自己，那個標準可能不是你自己訂的。',
  },
  {
    id: 'loneliness',
    name: '孤單',
    keywords: ['孤單', '寂寞', '一個人', '沒朋友', '沒人懂', '沒人理', '邊緣', '被排擠', '格格不入', '沒有人', '空虛', '獨自'],
    intensity: [3, 4],
    situation: '身邊就算有人，那種「沒有人真的在我這邊」的感覺還是很明顯。',
  },
  {
    id: 'anxiety',
    name: '焦慮',
    keywords: ['焦慮', '緊張', '害怕', '擔心', '睡不著', '失眠', '心跳', '喘不過氣', '恐慌', '坐不住', '腦中一直', '停不下來', '明天', '怎麼辦'],
    intensity: [3, 5],
    situation: '你的身體和腦袋都還停在警戒狀態，沒辦法真的休息。',
  },
  {
    id: 'loss',
    name: '失落／告別',
    keywords: ['離開', '過世', '走了', '死掉', '告別', '懷念', '想念', '失去', '結束', '畢業', '道別', '最後一次'],
    intensity: [3, 5],
    situation: '你失去了一個對你重要的東西或人，而日子還是照常要過。',
  },
  {
    id: 'anger',
    name: '生氣／委屈',
    keywords: ['生氣', '憤怒', '不爽', '委屈', '不公平', '憑什麼', '過分', '欺負', '誤會', '被冤枉', '忍耐', '忍很久'],
    intensity: [3, 5],
    situation: '有一件事對你來說是不公平的，你的不舒服是真實的。',
  },
];

const FALLBACK_GOODWORDS = {
  work: [
    { 承接: '你不是不夠努力，你是已經撐著很久了。', 好話: '會累，是因為你一直在做一件不容易的事。', 小步: '今晚挑一件事，明確地做到「這樣就好」，剩下的明天再說。' },
    { 承接: '被這樣對待，會難過是很正常的。', 好話: '你的表現在別人嘴裡，不構成你這個人的價值。', 小步: '把今天最刺的那句話寫下來，然後在旁邊寫：這是他說的，不等於事實。' },
    { 承接: '你現在的感覺，像是怎麼做都不夠。', 好話: '你不是不夠好，是標準被放在你追不到的地方。', 小步: '睡前寫下今天你真的完成的三件事，再小都算。' },
    { 承接: '你一直告訴自己要撐住，其實已經很辛苦了。', 好話: '撐住不是唯一選項，你也可以先放下十分鐘。', 小步: '今天晚上十一點前，關掉所有工作訊息，去做一件跟進度無關的事。' },
    { 承接: '你擔心的事情很多，多到不知道先處理哪一個。', 好話: '一次只前進一格，也是在前進。', 小步: '把待辦清單拿出來，只留一項，其餘的寫上「下週再看」。' },
    { 承接: '你怕自己讓別人失望，所以一直不敢停。', 好話: '你值得被體諒，不是等到你做完所有事以後。', 小步: '找一個你信任的人，只說一句：我最近有點累。不用解釋。' },
  ],
  relationship: [
    { 承接: '你把很多心意放在這段關係裡，這一點不假。', 好話: '被留下或沒被選上，不代表你不值得被好好對待。', 小步: '今晚不要看他的訊息。改成寫三行給自己，寫完就收起來。' },
    { 承接: '現在最難的，可能是你還在想「是不是我哪裡做不好」。', 好話: '一段關係的結束，不是一個人的成績單。', 小步: '把和他的對話通知關掉一晚，讓耳朵安靜一次。' },
    { 承接: '你其實知道答案，只是還捨不得承認。', 好話: '捨不得，說明你真的在乎過；那本身沒有錯。', 小步: '找出一件只屬於你、跟他無關的事，今晚做一件。' },
    { 承接: '你現在的痛，不是矯情，是真的失去。', 好話: '不用急著好起來，難過有它自己的速度。', 小步: '給自己十分鐘，把想說卻沒說出口的話寫在紙上，不用給任何人看。' },
    { 承接: '你一直忍著不吵，是因為你怕吵了就沒了。', 好話: '害怕失去而不敢說真心話，那份委屈不該只有你一個人吞。', 小步: '寫下一句你最想說的話，先不送出，放著明天再看一次。' },
    { 承接: '你在等一個回應，等到自己都變得不像自己。', 好話: '你的價值不需要靠誰回覆來確認。', 小步: '今晚睡前，手機放在伸手拿不到的地方。' },
  ],
  family: [
    { 承接: '家裡的事最難的地方，是你沒辦法乾脆走開。', 好話: '你可以愛他們，同時不同意他們。', 小步: '今晚試著只回一句「我知道你的意思」，不接著爭辯。' },
    { 承接: '你被期待的樣子，可能不是你想要的樣子。', 好話: '你的人生不是用來完成別人的想像的。', 小步: '寫下一個「這是我自己要的」的小決定，明天去執行它。' },
    { 承接: '你已經盡力顧到每個人的感受了。', 好話: '你也該被算在「要顧到的人」裡面。', 小步: '今晚替自己留半小時，做一件純粹自己開心的事。' },
    { 承接: '那些話聽起來像關心，落到你身上卻像壓力。', 好話: '會覺得刺，是因為你其實很在乎他們怎麼看你。', 小步: '把最刺的那句話寫下來，然後寫一句你想回的版本，不一定要說出去。' },
    { 承接: '你扛了很多家裡的事，卻很少被算進去。', 好話: '你做的那些，不是理所當然。', 小步: '今天跟一位家人說一句具體的請求，例如：今晚可以換你收一次嗎？' },
    { 承接: '回家比上班還累，這件事是真的。', 好話: '你需要一個可以不用表現的地方。', 小步: '今晚找一個角落待十五分鐘，不回應任何人。' },
  ],
  selfworth: [
    { 承接: '你對自己說的話，比對別人嚴厲太多了。', 好話: '你會這樣罵自己，是因為你其實很希望自己好。', 小步: '把今天罵自己的那句話寫下來，改成你會對好朋友說的版本。' },
    { 承接: '你覺得自己不夠好，這個感覺很真實。', 好話: '不夠好和沒有價值，是兩件不同的事。', 小步: '寫下一件今天你做到的事，不加上「可是」。' },
    { 承接: '你在比較裡把自己放到最後一名。', 好話: '別人的進度，不是你的標準。', 小步: '今晚睡前，寫下一個你比半年前的自己進步的地方。' },
    { 承接: '你做錯了一件事，然後把它變成了整個人的評價。', 好話: '一件事做壞了，不等於你這個人壞了。', 小步: '用一句話承認那件事，然後加上：我下次會怎麼做。寫完就停。' },
    { 承接: '你一直在等自己變得「夠格」。', 好話: '你不用先變好，才值得被好好對待。', 小步: '今天做一件純粹為自己好的事，不需要理由。' },
    { 承接: '你把很多責任都往自己身上放。', 好話: '不是每件事會壞掉，都是你的錯。', 小步: '挑一件你正在自責的事，寫下其中不屬於你的那部分。' },
  ],
  loneliness: [
    { 承接: '你不是想太多，你是真的很久沒被好好聽見了。', 好話: '想要有人懂，不是軟弱，是人都會有的需要。', 小步: '今晚傳一則訊息給一個你想過但沒聯絡的人，只寫：最近好嗎。' },
    { 承接: '在人群裡還是覺得空，那種感覺很累。', 好話: '孤單不代表你有問題，只代表你還沒遇到對的頻率。', 小步: '今晚去做一件會遇到人的小事，例如去便利商店買東西，跟店員說謝謝。' },
    { 承接: '你習慣了自己解決，因為開口好像也沒用。', 好話: '你可以先從說一句「我今天不太好」開始，不用講完整的故事。', 小步: '今晚寫下一個你願意試著說出口的人名，明天再決定要不要說。' },
    { 承接: '你把自己的需要縮得很小，小到幾乎看不見。', 好話: '你的需要不需要先被批准。', 小步: '今晚做一件只因為你想做、不為任何人的事。' },
    { 承接: '一個人的晚上特別長。', 好話: '孤單會過去，它不是你的全部。', 小步: '今晚十一點前上床，放一段有人說話的聲音陪你。' },
    { 承接: '你已經很久沒有被問「你還好嗎」。', 好話: '那我問你：你今天還好嗎？', 小步: '現在對著自己回答這個問題，寫一句就好。' },
  ],
  anxiety: [
    { 承接: '你的身體還在那個緊張的狀態裡，停不下來。', 好話: '這不是你想太多，是你的身體還沒收到「安全了」的訊號。', 小步: '現在做一次：吸氣四秒、停兩秒、吐氣六秒，重複五輪。' },
    { 承接: '你腦袋一直轉，轉到累了也停不了。', 好話: '想不出答案的晚上，不需要硬想。', 小步: '把腦中所有擔心的事寫在紙上，寫完放桌上，明天再看。' },
    { 承接: '你怕的事情還沒發生，但你已經先痛過一次了。', 好話: '先把今天過完，明天的事明天再應付。', 小步: '今晚只準備明天要用的東西，不做任何決定。' },
    { 承接: '你一直在為還沒發生的事準備最壞的版本。', 好話: '你先想到壞的，是因為你想保護自己，不是因為你悲觀。', 小步: '寫下最壞的情況，再寫一句：如果真的發生，我第一步會做什麼。' },
    { 承接: '你緊張到連休息都覺得有罪惡感。', 好話: '休息不是偷懶，是讓你還能繼續的方式。', 小步: '今晚給自己二十分鐘完全放空，設鬧鐘，時間到再回去。' },
    { 承接: '你撐著一張「我沒事」的臉，其實很耗力氣。', 好話: '你不需要對所有人都有精神。', 小步: '今晚推掉一件不必要的事，就一件。' },
  ],
  loss: [
    { 承接: '有些離開，不會因為時間過去就真的變淡。', 好話: '你還會難過，是因為那份感情是真的。', 小步: '今晚寫一句想對他說的話，寫完收進抽屜，不用給誰看。' },
    { 承接: '你正在學著過一個少了某個人的生活。', 好話: '想他的時候，不用覺得自己不夠堅強。', 小步: '今晚挑一件你們以前一起做的小事，自己再做一次。' },
    { 承接: '別人都說要往前看，可是你還沒準備好。', 好話: '你可以慢慢來，沒有人規定難過要多久。', 小步: '今晚允許自己提早半小時休息，什麼都不做。' },
    { 承接: '你在別人面前正常，一個人的時候才塌下來。', 好話: '在外人面前撐著，已經很不容易了。', 小步: '今晚找一個安全的地方，讓自己哭一次，不用忍。' },
    { 承接: '有些話來不及說，卡在心裡很久了。', 好話: '來不及說的，不代表沒有意義。', 小步: '把那些話寫成一封信，寫完可以燒掉或收起來。' },
    { 承接: '你怕忘記，也怕記得。', 好話: '記得的方式不只一種，你可以選對自己最不痛的那種。', 小步: '今晚挑一張照片或一件物品，看五分鐘就好。' },
  ],
  anger: [
    { 承接: '你遇到的事，是真的不公平。', 好話: '生氣不是修養不好，是你在保護自己。', 小步: '今晚把想罵的話全部寫下來，寫完不傳出去。' },
    { 承接: '你已經忍了很久，忍到自己都覺得沒立場生氣了。', 好話: '你早就有立場，只是你一直把自己的感受排到最後。', 小步: '寫下一句你想設的界線，例如：這件事我沒辦法接受。' },
    { 承接: '被誤會的時候，解釋好像也沒用。', 好話: '被誤會很痛，但錯不在你身上。', 小步: '今晚找一個相信你的人，只講一次事情的經過。' },
    { 承接: '你表面說沒事，心裡還在那件事裡面。', 好話: '裝沒事很累，你不用一直裝。', 小步: '今晚給自己十分鐘，承認一句：我其實很生氣。' },
    { 承接: '你氣的不只是那件事，是長久下來的累積。', 好話: '累積到現在才爆，已經是你撐很久的證明。', 小步: '寫下最近三個月讓你忍下來的事，寫完撕掉。' },
    { 承接: '你不想把事情鬧大，所以自己吞了。', 好話: '不鬧大可以，但不必連委屈都一起吞掉。', 小步: '今晚對一件小事說「不」，練習一次。' },
  ],
};

function buildFallbackEmotions() {
  return FALLBACK_EMOTIONS.map((e) => ({ ...e, keywords: [...e.keywords], intensity: [...e.intensity] }));
}
function buildFallbackGoodwords() {
  const out = {};
  for (const [k, arr] of Object.entries(FALLBACK_GOODWORDS)) out[k] = arr.map((x) => ({ ...x }));
  return out;
}

/** 轉送模板（BRIEF §3「做好事」：好話轉送）。fallback 版。 */
const FALLBACK_SHARE_TEMPLATES = {
  default: {
    friend: { label: '給朋友', opening: '嗨，我在想你可能也辛苦了。', closing: '不用回我，看完就好。' },
    family: { label: '給家人', opening: '我知道我們平常不太講這些。', closing: '只是想到你。' },
    colleague: { label: '給同事', opening: '知道你最近也很忙。', closing: '有空再說就好。' },
  },
};

// ─────────────────────────────────────────────────────────────
// 載入
// ─────────────────────────────────────────────────────────────

function safeLoad(file, label, warnings) {
  try {
    const p = path.join(CONTENT_DIR, file);
    if (!fs.existsSync(p)) {
      warnings.push({ file, status: 'missing', action: '使用內建 fallback' });
      return null;
    }
    const data = readJson(p);
    warnings.push({ file, status: 'ok' });
    void label;
    return data;
  } catch (err) {
    warnings.push({ file, status: 'error', detail: String(err && err.message), action: '使用內建 fallback' });
    return null;
  }
}

/**
 * 內建 fallback 類別 id → content/ 實際 id 的對照。
 * content 隊友用的是更細的 14 類，跟 BRIEF 舉例的 8 類不是同一套命名。
 * 這個映射讓「有內容用內容、沒內容用內建」兩邊都能運作。
 */
const FALLBACK_TO_CONTENT = {
  selfworth: 'self_negation',
  work: 'work_stress',
  relationship: 'heartbreak',
  family: 'family_conflict',
  loneliness: 'loneliness',
  anxiety: 'anxiety',
  loss: 'future_loss',
  anger: 'anger_helpless',
};

/** 寬鬆驗證：內容組格式若有小出入，能用就用，不能用的部分才丟掉。 */
function validateEmotions(raw, warnings) {
  // 實際格式：{ version, updated, note, emotions: [...] }；也接受直接給陣列
  const arr = Array.isArray(raw) ? raw : (raw && Array.isArray(raw.emotions) ? raw.emotions : null);
  if (!arr) return null;

  const out = [];
  for (const e of arr) {
    if (!e || typeof e !== 'object') continue;
    const id = String(e.id || e.emoji_id || '').trim();
    const name = String(e.name || e.名稱 || e.title || '').trim();
    if (!id || !name) continue;

    // intensity 可能是數字陣列（BRIEF 契約）或文字陣列（content 實際格式）→ 一律存成描述字串
    let intensityDefault = 3;
    let intensityWords = [];
    if (Array.isArray(e.intensity)) {
      const nums = e.intensity.filter((x) => typeof x === 'number');
      const strs = e.intensity.filter((x) => typeof x === 'string' && x.trim());
      if (nums.length) intensityDefault = Math.max(2, Math.min(5, Math.round(nums.reduce((a, b) => a + b, 0) / nums.length)));
      if (strs.length) intensityWords = strs.map(String);
    }

    out.push({
      id,
      name,
      keywords: Array.isArray(e.keywords) ? e.keywords.map(String).filter(Boolean) : [],
      intensity: intensityDefault,
      intensityWords,
      typicalPhrases: Array.isArray(e.typical_phrases) ? e.typical_phrases.map(String) : [],
      situation: String(e.situation || e.處境描述 || e.description || ''),
    });
  }

  if (!out.length) {
    warnings.push({ file: 'emotions.json', status: 'invalid', action: '使用內建 fallback' });
    return null;
  }
  return out;
}

function validateGoodwords(raw, emotionIds, warnings) {
  if (!raw || typeof raw !== 'object') return null;

  // 實際格式：{ version, updated, readme, rules, goodwords: {...} }；也接受直接給 map
  const map = (raw.goodwords && typeof raw.goodwords === 'object') ? raw.goodwords : raw;

  const out = {};
  let count = 0;
  for (const [id, arr] of Object.entries(map)) {
    if (!Array.isArray(arr)) continue;
    const list = [];
    for (const item of arr) {
      if (!item || typeof item !== 'object') continue;
      const accept = item.承接 ?? item.accept ?? item.hold;
      const goodword = item.好話 ?? item.goodword ?? item.good;
      const smallstep = item.小步 ?? item.smallstep ?? item.step;
      if (!accept && !goodword) continue;
      list.push({
        承接: String(accept || ''),
        好話: String(goodword || ''),
        小步: String(smallstep || ''),
      });
    }
    if (list.length) {
      out[id] = list;
      count += list.length;
    }
  }

  if (!count) {
    warnings.push({ file: 'goodwords.json', status: 'invalid', action: '使用內建 fallback' });
    return null;
  }

  const missing = emotionIds.filter((id) => !out[id]);
  if (missing.length) {
    warnings.push({
      file: 'goodwords.json',
      status: 'partial',
      detail: `缺少情緒類別: ${missing.join(', ')}`,
      action: '缺少的類別用內建 fallback 補齊',
    });
  }
  return out;
}

/**
 * 轉送模板正規化。
 * content/share_templates.json 的實際結構是：
 *   { recipients: [ { id:'friend', name:'朋友', tones: [ { tone_id, tone_name,
 *       template, fields:{ opening, 承接, closing } } ] } ] }
 * 而內部引擎要的是 { default: { friend:{label,opening,closing}, ... } }。
 * 這裡把前者轉成後者，並保留每個對象的多種語氣（tones）供前端選用。
 */
function normalizeShareTemplates(raw) {
  if (!raw || typeof raw !== 'object') return null;

  // 已經是內部格式就直接用
  if (raw.default && typeof raw.default === 'object') return raw;

  if (!Array.isArray(raw.recipients) || !raw.recipients.length) return null;

  const out = { default: {}, tones: {} };
  for (const r of raw.recipients) {
    const id = String(r.id || '').trim();
    if (!id) continue;
    const label = String(r.name ? `給${r.name}` : id);
    const tones = Array.isArray(r.tones) ? r.tones : [];

    // 預設取第一個語氣當該對象的代表文案
    const first = tones[0];
    const f = (first && first.fields) || {};
    out.default[id] = {
      label,
      opening: String(f.opening || '').trim(),
      closing: String(f.closing || '').trim(),
      relationNote: String(r.relation_note || ''),
    };

    // 全部語氣都留著，讓前端可以讓使用者挑「輕聲版／直白版／遠距版」
    out.tones[id] = tones.map((t, i) => ({
      id: String(t.tone_id || `${id}_${i}`),
      name: String(t.tone_name || `版本 ${i + 1}`),
      template: String(t.template || ''),
      opening: String((t.fields && t.fields.opening) || '').trim(),
      承接: String((t.fields && t.fields.承接) || '').trim(),
      closing: String((t.fields && t.fields.closing) || '').trim(),
    })).filter((t) => t.template || t.opening || t.closing);
  }

  return Object.keys(out.default).length ? out : null;
}

/**
 * 建立內容包。每次啟動載入一次，並快取。
 * @returns {{emotions, goodwords, shareTemplates, crisisExtra, warnings, source}}
 */
function loadContent() {
  const warnings = [];

  const rawEmotions = safeLoad('emotions.json', 'emotions', warnings);
  const rawGoodwords = safeLoad('goodwords.json', 'goodwords', warnings);
  const rawCrisis = safeLoad('crisis.json', 'crisis', warnings);
  const rawShare = safeLoad('share_templates.json', 'share_templates', warnings);

  const emotions = validateEmotions(rawEmotions, warnings) || buildFallbackEmotions();
  const goodwords = validateGoodwords(rawGoodwords, emotions.map((e) => e.id), warnings) || {};

  // 補齊：內建 fallback 有的類別，content 沒給就用內建的。
  // 內建類別 id 與 content 的 id 不同，靠 FALLBACK_TO_CONTENT 對照；
  // 若 content 已有對應 id 就優先採用 content 的內容，內建的只在缺漏時墊底。
  const fb = buildFallbackGoodwords();
  for (const [fbId, arr] of Object.entries(fb)) {
    const targetId = FALLBACK_TO_CONTENT[fbId] || fbId;
    if (!goodwords[targetId] || !goodwords[targetId].length) goodwords[targetId] = arr;
    // 內建 id 自身也保留一份，讓規則引擎在任何情況下都查得到
    if (!goodwords[fbId] || !goodwords[fbId].length) goodwords[fbId] = arr;
  }

  // 通用類別：任何情緒都能用的安全牌
  goodwords._any = goodwords._any || [
    { 承接: '你願意把它寫下來，已經比昨天多走了一步。', 好話: '你現在的感覺是真的，它不需要經過誰的同意才能成立。', 小步: '今晚只要做一件事：在十一點前躺平，讓身體先休息。' },
    { 承接: '這件事在你心裡放了一段時間了。', 好話: '你沒有自己以為的那麼糟，你只是一直在用最嚴格的標準看自己。', 小步: '寫下一句今天你對自己最兇的話，然後在後面補一句：我不用這樣說自己。' },
    { 承接: '你現在可能連要說什麼都還很亂。', 好話: '亂著也可以，不用先整理好才有資格被接住。', 小步: '深呼吸三次，然後喝一杯水。就從這裡開始。' },
  ];

  const shareTemplates = normalizeShareTemplates(rawShare) || FALLBACK_SHARE_TEMPLATES;

  const crisisExtra = Array.isArray(rawCrisis)
    ? rawCrisis
    : (rawCrisis && Array.isArray(rawCrisis.words) ? rawCrisis.words : []);

  return {
    emotions,
    goodwords,
    shareTemplates,
    crisisExtra,
    warnings,
    contentDir: CONTENT_DIR,
    usingFallback: !rawEmotions || !rawGoodwords,
  };
}

let _cache = null;
function getContent({ reload = false } = {}) {
  if (reload || !_cache) _cache = loadContent();
  return _cache;
}

module.exports = {
  getContent,
  loadContent,
  CONTENT_DIR,
  FALLBACK_EMOTIONS,
  buildFallbackEmotions,
  buildFallbackGoodwords,
  FALLBACK_SHARE_TEMPLATES,
};
