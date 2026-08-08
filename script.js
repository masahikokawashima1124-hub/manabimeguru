// ===== Firebase認証・同期の状態 =====
// fbCurrentUser と _syncDirtyTimer は script.js 全体から参照されるため、
// ファイル冒頭で宣言しておく（Firebase セクションで初期化）。
let fbCurrentUser = null;
let _syncDirtyTimer = null;

// ===== おためしモード（未登録のまま使う） =====
// 初めて来た人にメール登録を求めると、そこで大半が離脱する。
// 登録せずにそのまま遊べるようにし、データはこの端末の localStorage にだけ置く。
// あとからアカウント登録すると migrateLocalProfilesToFirestore() がそのまま引き取る。
const GUEST_KEY = "guest_mode";

function isGuestMode() {
  return localStorage.getItem(GUEST_KEY) === "1";
}

function setGuestMode(on) {
  if (on) localStorage.setItem(GUEST_KEY, "1");
  else localStorage.removeItem(GUEST_KEY);
}

// ===== プラン（無料／プレミアム） =====
// account-design.md §10 段階2。plan は Firestore の households/{uid} が持ち、
// クライアントからは書き換えられない（firestore.rules で禁止）。
// 未登録のおためし中とログイン直後の既定は "free"。
let fbPlan = "free";

function isPaidPlan() {
  return fbPlan === "paid";
}

// 無料プランで引けるレアリティ。SR・URはプレミアム限定。
const FREE_RARITIES = ["N", "R"];

function isPremiumRarity(rarity) {
  return !FREE_RARITIES.includes(rarity);
}

// いま引けるカードの母集団。無料プランではSR・URが出ない（出てから鍵をかけると萎えるので、
// そもそも抽選に混ぜない）。ずかんにはシルエットで並べて、集める目標としては見せ続ける。
function drawableCardPool() {
  return isPaidPlan() ? CARD_POOL : CARD_POOL.filter((c) => !isPremiumRarity(c.rarity));
}

// 無料プランのプロフィール上限。プレミアムで PROFILE_MAX 人まで増える。
const FREE_PROFILE_MAX = 1;

function profileLimit() {
  return isPaidPlan() ? PROFILE_MAX : FREE_PROFILE_MAX;
}

// ===== 状態管理 =====
const state = {
  subject: null,
  category: null,
  problems: [],
  index: 0,
  correctCount: 0,
  sessionStamps: 0,
  sessionStampsExact: 0,
  stampsBeforeSession: 0,
};

// 最近見た問題（isRepeat）が正解のときは、ポイントを減らす。
// 「答えを知っている分野」の周回でポイントを稼ぐことを防ぎ、初めての問題に挑む動機を保つ。
const REPEAT_STAMP_RATIO = 0.5;

// ===== プロフィール（1台の端末を兄弟で分けて使うための仕組み） =====
// 将来の「1家庭1アカウント＋子どもプロフィール複数」（Nintendo Switch方式）の土台。
// 子どもはメールもパスワードも持たず、なまえとアバターだけを持つ。
// 学習データは localStorage のキーに `<プロフィールID>:` を前置して分ける。
// 音のON/OFFと言語は端末ごとの設定なので、プロフィールでは分けない。
const PROFILES_KEY = "profiles";
const ACTIVE_PROFILE_KEY = "active_profile";
const PROFILE_AVATARS = ["🦊", "🐰", "🐻", "🐼", "🐨", "🐯", "🦁", "🐮"];
const PROFILE_NAME_MAX = 8;
const PROFILE_MAX = 6;

function getProfiles() {
  try {
    const list = JSON.parse(localStorage.getItem(PROFILES_KEY) || "[]");
    return Array.isArray(list) ? list.filter((p) => p && p.id) : [];
  } catch {
    return [];
  }
}

function saveProfiles(list) {
  localStorage.setItem(PROFILES_KEY, JSON.stringify(list));
}

function getActiveProfileId() {
  return localStorage.getItem(ACTIVE_PROFILE_KEY) || "";
}

function setActiveProfileId(id) {
  localStorage.setItem(ACTIVE_PROFILE_KEY, id);
}

function getActiveProfile() {
  const id = getActiveProfileId();
  return getProfiles().find((p) => p.id === id) || null;
}

// プロフィールごとに分けるキーに使う接頭辞をつける
function pk(key) {
  const id = getActiveProfileId();
  return id ? `${id}:${key}` : key;
}

// IDが重なると2人ぶんの学習データが混ざってしまうため、既存のIDと必ず違う値にする
function newProfileId(existing) {
  const used = new Set(existing.map((p) => p.id));
  let id;
  let n = 0;
  do {
    id = `p${Date.now()}${Math.floor(Math.random() * 1000)}${n ? `-${n}` : ""}`;
    n += 1;
  } while (used.has(id));
  return id;
}

function createProfile(name, avatar) {
  const list = getProfiles();
  if (list.length >= profileLimit()) return null;
  const profile = {
    id: newProfileId(list),
    name: String(name || "").slice(0, PROFILE_NAME_MAX) || t("profile.defaultName"),
    avatar: PROFILE_AVATARS.includes(avatar) ? avatar : PROFILE_AVATARS[0],
    createdAt: new Date().toISOString(),
  };
  // 年度の開始月は家庭ごとに同じはずなので、すでにいる子の設定を引き継ぐ。
  // 兄弟を追加するたびに保護者が設定し直す手間をなくすため。
  const inherited = list
    .map((p) => localStorage.getItem(`${p.id}:${SCHOOL_YEAR_START_KEY}`))
    .find((v) => v !== null && v !== "");
  if (inherited) localStorage.setItem(`${profile.id}:${SCHOOL_YEAR_START_KEY}`, inherited);

  list.push(profile);
  saveProfiles(list);
  return profile;
}

function deleteProfile(id) {
  // そのプロフィールの学習データ（`<id>:` で始まるキー）も一緒に消す
  const doomed = [];
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    if (key && key.startsWith(`${id}:`)) doomed.push(key);
  }
  doomed.forEach((key) => localStorage.removeItem(key));

  saveProfiles(getProfiles().filter((p) => p.id !== id));
  if (getActiveProfileId() === id) localStorage.removeItem(ACTIVE_PROFILE_KEY);
}

// プロフィール導入前から使っていた端末では、既存データが接頭辞なしで入っている。
// それを最初の1人のプロフィールとして引き継ぐ（データを失わせない）。
const LEGACY_KEYS = ["study_grade", "stamps_total", "daily_points", "gacha_owned", "gacha_pity"];

function migrateLegacyDataIfNeeded() {
  if (localStorage.getItem(PROFILES_KEY)) return; // すでにプロフィール制に移行済み

  const legacyFound = [];
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    if (!key) continue;
    if (LEGACY_KEYS.includes(key) || key.startsWith("seen_history_")) legacyFound.push(key);
  }
  if (legacyFound.length === 0) return; // まっさらな端末なので移行するものがない

  const profile = {
    id: newProfileId([]),
    name: t("profile.defaultName"),
    avatar: PROFILE_AVATARS[0],
    createdAt: new Date().toISOString(),
  };
  saveProfiles([profile]);
  setActiveProfileId(profile.id);

  legacyFound.forEach((key) => {
    const value = localStorage.getItem(key);
    if (value !== null) localStorage.setItem(`${profile.id}:${key}`, value);
    localStorage.removeItem(key);
  });
}

// ===== 学年設定 =====
// せっていで選んだ学年。その学年までの問題だけが出題される（例: 3年なら1〜3年）。
const GRADE_KEY = "study_grade";
const GRADES = [1, 2, 3, 4, 5, 6];
const DEFAULT_GRADE = 3;

// 1回のチャレンジで出す問題数
const SESSION_SIZE = 10;

function getGrade() {
  const v = parseInt(localStorage.getItem(pk(GRADE_KEY)) || "", 10);
  return GRADES.includes(v) ? v : DEFAULT_GRADE;
}

function setGrade(grade) {
  if (!GRADES.includes(grade)) return;
  localStorage.setItem(pk(GRADE_KEY), String(grade));
  markSyncDirty();
}

// ===== 年度の開始月 =====
// 同じ「1年生」でも4月と3月では約1年ぶんの差がある。学校で習ったころに合わせて
// 問題を増やすために、いまが年度の何ヶ月目かを出して、生成器の解禁時期をずらす。
//
// 開始月は国・地域で違う（日本=4月／米国・欧州の多く=9月／韓国・南半球=3月など）。
// 保護者に毎回きくと手間になるので、表示言語から初期値を決めて、変えたい人だけ触る。
const SCHOOL_YEAR_START_KEY = "school_year_start";
const SCHOOL_YEAR_START_QUICK = [4, 9, 3];
const SCHOOL_YEAR_START_BY_LOCALE = { ja: 4, en: 9 };

function defaultSchoolYearStart() {
  return SCHOOL_YEAR_START_BY_LOCALE[getLocale()] || 4;
}

// 保存されていなければ言語から決めた既定値を返す（書き込みはしない）。
// これで、設定を一度も触らない家庭でも妥当な値で動く。
function getSchoolYearStart() {
  const v = parseInt(localStorage.getItem(pk(SCHOOL_YEAR_START_KEY)) || "", 10);
  return v >= 1 && v <= 12 ? v : defaultSchoolYearStart();
}

function setSchoolYearStart(month) {
  const m = parseInt(month, 10);
  if (!(m >= 1 && m <= 12)) return;
  localStorage.setItem(pk(SCHOOL_YEAR_START_KEY), String(m));
  markSyncDirty();
}

// いまが年度の何ヶ月目か。開始月を1として1〜12を返す。
// 例: 4月始まりなら 4月→1、8月→5、翌3月→12。
function currentSchoolMonth(now) {
  const month = (now || new Date()).getMonth() + 1;
  return ((month - getSchoolYearStart() + 12) % 12) + 1;
}

// ===== ガチャポイント =====
// 学年を変えても引き継げるよう、ポイントとカードは学年で分けずに1つにまとめる。
const STORAGE_KEY = "stamps_total";

function getTotalStamps() {
  return parseInt(localStorage.getItem(pk(STORAGE_KEY)) || "0", 10);
}

function addStamps(count) {
  const total = getTotalStamps() + count;
  localStorage.setItem(pk(STORAGE_KEY), String(total));
  markSyncDirty();
  return total;
}

const GACHA_PULL_COST = 10;

function spendStamps(count) {
  const total = Math.max(0, getTotalStamps() - count);
  localStorage.setItem(pk(STORAGE_KEY), String(total));
  markSyncDirty();
  return total;
}

// ===== 日ごとの獲得ポイント履歴（1週間グラフ用） =====
const DAILY_POINTS_KEY = "daily_points";
// 曜日ラベルは i18n.js の "weekdays" から引く（tList("weekdays")）

function dayKey(date) {
  return `${date.getFullYear()}-${date.getMonth() + 1}-${date.getDate()}`;
}

function getDailyPoints() {
  try {
    const parsed = JSON.parse(localStorage.getItem(pk(DAILY_POINTS_KEY)) || "{}");
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

function recordDailyPoints(count) {
  const log = getDailyPoints();
  const today = dayKey(new Date());
  log[today] = (log[today] || 0) + count;

  // 直近14日ぶんだけ残す
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - 14);
  const trimmed = {};
  Object.entries(log).forEach(([key, value]) => {
    const [y, m, d] = key.split("-").map(Number);
    if (new Date(y, m - 1, d) >= cutoff) trimmed[key] = value;
  });

  localStorage.setItem(pk(DAILY_POINTS_KEY), JSON.stringify(trimmed));
  markSyncDirty();
}

// ===== 汎用ユーティリティ =====
function randInt(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function pick(arr) {
  return arr[randInt(0, arr.length - 1)];
}

function shuffle(arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = randInt(0, i);
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function gcd(a, b) {
  a = Math.abs(a); b = Math.abs(b);
  while (b) { [a, b] = [b, a % b]; }
  return a || 1;
}

function reduceFraction(num, den) {
  if (den < 0) { num = -num; den = -den; }
  const g = gcd(num, den);
  return { num: num / g, den: den / g };
}

function fractionToText(f) {
  if (f.den === 1) return `${f.num}`;
  return `${f.num}/${f.den}`;
}

function parseFractionInput(str) {
  str = str.trim();
  if (str.includes("/")) {
    const [n, d] = str.split("/").map((s) => parseInt(s.trim(), 10));
    if (Number.isFinite(n) && Number.isFinite(d) && d !== 0) return reduceFraction(n, d);
    return null;
  }
  const n = parseInt(str, 10);
  if (!Number.isFinite(n)) return null;
  return { num: n, den: 1 };
}

// ===== 効果音（Web Audio APIで合成、音声ファイル不要） =====
const SOUND_KEY = "sound_enabled";
let audioCtx = null;

function isSoundEnabled() {
  return localStorage.getItem(SOUND_KEY) !== "0";
}

function setSoundEnabled(enabled) {
  localStorage.setItem(SOUND_KEY, enabled ? "1" : "0");
}

function getAudioContext() {
  if (!audioCtx) {
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) return null;
    audioCtx = new Ctx();
  }
  if (audioCtx.state === "suspended") audioCtx.resume();
  return audioCtx;
}

function playTone(freq, startOffset, duration, type, peakGain) {
  if (!isSoundEnabled()) return;
  const ctx = getAudioContext();
  if (!ctx) return;
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = type;
  osc.frequency.value = freq;
  osc.connect(gain);
  gain.connect(ctx.destination);
  const t0 = ctx.currentTime + startOffset;
  gain.gain.setValueAtTime(0, t0);
  gain.gain.linearRampToValueAtTime(peakGain, t0 + 0.01);
  gain.gain.exponentialRampToValueAtTime(0.001, t0 + duration);
  osc.start(t0);
  osc.stop(t0 + duration + 0.02);
}

function playClickSound() {
  playTone(1000, 0, 0.05, "square", 0.05);
}

function playCorrectSound() {
  playTone(523.25, 0, 0.12, "sine", 0.18);
  playTone(783.99, 0.09, 0.18, "sine", 0.18);
}

function playWrongSound() {
  playTone(196, 0, 0.22, "sawtooth", 0.1);
  playTone(174.61, 0.11, 0.24, "sawtooth", 0.09);
}

function playLevelUpSound() {
  [523.25, 659.25, 783.99, 1046.5].forEach((f, i) => playTone(f, i * 0.09, 0.16, "triangle", 0.16));
}

// ===== BGM（画面ごとに切り替え、必要になった時点で読み込む） =====
// loop 省略時はループ再生。volume 省略時は BGM_VOLUME。
const BGM_SOURCES = {
  home: { src: "assets/bgm/home.mp3" },
  quiz: { src: "assets/bgm/quiz.mp3" },
  collection: { src: "assets/bgm/collection.mp3" },
  gachaView: { src: "assets/bgm/gacha-view.mp3" },
  // ガチャ演出の効果音（5秒・1回きり）。レアリティで鳴り分ける。
  gachaRevealNR: { src: "assets/se/gacha-reveal-nr.mp3", loop: false, volume: 0.7 },
  gachaRevealSR: { src: "assets/se/gacha-reveal-sr.mp3", loop: false, volume: 0.7 },
};

// レアリティごとに、どの効果音を鳴らすか
function gachaRevealKeyFor(rarity) {
  return rarity === "SR" || rarity === "UR" ? "gachaRevealSR" : "gachaRevealNR";
}

const SCREEN_TO_BGM = {
  "screen-home": "home",
  "screen-settings": "home",
  "screen-result": "home",
  "screen-subject": "home",
  "screen-category": "home",
  "screen-start": "home",
  "screen-quiz": "quiz",
  "screen-collection": "collection",
  "screen-gacha": "home",
};

const BGM_VOLUME = 0.32;
const BGM_FADE_MS = 600;

const bgmPlayers = {};
let currentBgmKey = null;
// ガチャ演出中は画面遷移で曲が上書きされないようにロックする
let bgmLocked = false;
let audioUnlocked = false;

function bgmVolumeFor(key) {
  const conf = BGM_SOURCES[key];
  return conf && conf.volume !== undefined ? conf.volume : BGM_VOLUME;
}

function getBgmPlayer(key) {
  if (!bgmPlayers[key]) {
    const conf = BGM_SOURCES[key];
    const audio = new Audio();
    audio.src = conf.src;
    audio.preload = "none";
    audio.loop = conf.loop !== false;
    audio.volume = 0;
    bgmPlayers[key] = audio;
  }
  return bgmPlayers[key];
}

function fadeAudio(audio, to, ms, onDone) {
  if (audio._fadeTimer) clearInterval(audio._fadeTimer);
  const from = audio.volume;
  const steps = Math.max(1, Math.round(ms / 40));
  let step = 0;
  audio._fadeTimer = setInterval(() => {
    step += 1;
    const v = from + (to - from) * (step / steps);
    audio.volume = Math.min(1, Math.max(0, v));
    if (step >= steps) {
      clearInterval(audio._fadeTimer);
      audio._fadeTimer = null;
      if (onDone) onDone();
    }
  }, 40);
}

function stopAllBgmExcept(keepKey) {
  Object.entries(bgmPlayers).forEach(([key, audio]) => {
    if (key === keepKey || audio.paused) return;
    fadeAudio(audio, 0, BGM_FADE_MS, () => {
      audio.pause();
      audio.currentTime = 0;
    });
  });
}

function playBgm(key, { restart = false } = {}) {
  if (!key || !BGM_SOURCES[key]) return;
  if (currentBgmKey === key && !restart) return;

  currentBgmKey = key;
  stopAllBgmExcept(key);

  if (!isSoundEnabled() || !audioUnlocked) return;

  const audio = getBgmPlayer(key);
  if (restart) audio.currentTime = 0;
  const play = audio.play();
  if (play && play.catch) play.catch(() => {}); // 自動再生がまだ許可されていない場合は次の操作で再開する
  fadeAudio(audio, bgmVolumeFor(key), BGM_FADE_MS);
}

function updateBgmForScreen(id) {
  // ガチャ画面から出たらロックを解除し、行き先の曲に戻す
  if (id !== "screen-gacha") bgmLocked = false;
  if (bgmLocked) return;
  playBgm(SCREEN_TO_BGM[id] || "home");
}

function stopAllBgm() {
  Object.values(bgmPlayers).forEach((audio) => {
    if (audio._fadeTimer) clearInterval(audio._fadeTimer);
    audio.pause();
    audio.currentTime = 0;
    audio.volume = 0;
  });
}

// ブラウザは操作前の自動再生を止めるため、最初のタップ／キー入力で解禁する
function unlockAudioOnFirstGesture() {
  if (audioUnlocked) return;
  audioUnlocked = true;
  getAudioContext();
  if (currentBgmKey) playBgm(currentBgmKey, { restart: true });
}

["pointerdown", "keydown", "touchstart"].forEach((evt) => {
  document.addEventListener(evt, unlockAudioOnFirstGesture, { once: true, passive: true });
});

// ===== CSSだけで描くキャラクター描画 =====
function darken(hex, amount) {
  const n = parseInt(hex.replace("#", ""), 16);
  const r = Math.max(0, (n >> 16) - amount);
  const g = Math.max(0, ((n >> 8) & 0xff) - amount);
  const b = Math.max(0, (n & 0xff) - amount);
  return `rgb(${r}, ${g}, ${b})`;
}

function accessoryMarkup(type, color, overrideAccent) {
  const accent = overrideAccent || darken(color, 40);
  switch (type) {
    case "tuft":
      return `<div class="acc acc-tuft" style="background:${accent}"></div>`;
    case "comb":
      return `<div class="acc acc-comb"><span></span><span></span><span></span></div>`;
    case "comb-gold":
      return `<div class="acc acc-comb acc-comb-gold"><span></span><span></span><span></span></div>`;
    case "ear-tufts":
      return `<div class="acc acc-ear-tufts" style="--acc-color:${accent}"><span class="ear left"></span><span class="ear right"></span></div>`;
    case "glasses":
      return `<div class="acc acc-glasses"><span class="lens left"></span><span class="lens right"></span><span class="bridge"></span></div>`;
    case "crown":
      return `<div class="acc acc-crown"></div>`;
    case "book":
      return `<div class="acc acc-book" style="background:${accent}"></div>`;
    default:
      return "";
  }
}

function renderCreatureHTML(cfg, sizeClass) {
  const hasFace = cfg.eye !== "none";
  const faceMarkup = hasFace
    ? `<div class="creature-eye eye-${cfg.eye} left"></div>
       <div class="creature-eye eye-${cfg.eye} right"></div>
       <div class="creature-blush left"></div>
       <div class="creature-blush right"></div>
       <div class="creature-mouth"></div>`
    : `<div class="creature-crack"></div><div class="creature-crack crack2"></div>`;

  const sparkleMarkup = cfg.sparkle
    ? `<div class="creature-sparkle s1"></div><div class="creature-sparkle s2"></div><div class="creature-sparkle s3"></div>`
    : "";

  return `
    <div class="creature-slot ${sizeClass}">
      <div class="creature">
        <div class="creature-shadow"></div>
        <div class="creature-body shape-${cfg.shape}" style="background:${cfg.color}">
          ${accessoryMarkup(cfg.accessory, cfg.color, cfg.accentOverride)}
          ${faceMarkup}
        </div>
        ${sparkleMarkup}
      </div>
    </div>
  `;
}

// ===== ガイドキャラ「めぐる」（暦の妖精見習い） =====
function currentSeasonAccent() {
  const month = new Date().getMonth() + 1;
  if (month >= 3 && month <= 5) return "#f4a6c1"; // 春
  if (month >= 6 && month <= 8) return "#4caf7d"; // 夏
  if (month >= 9 && month <= 11) return "#e08a3c"; // 秋
  return "#6fb3d9"; // 冬
}

// ガイド役のキャラクター。image があればその画像、なければCSS描画にフォールバックする。
const GUIDE_CHARACTER = {
  name: "はなびのこびと",
  // 吹き出し横は全身イラスト、ステータスバーの丸枠は顔のアップを使う
  faceImage: "assets/characters/hanabi-no-kobito.png",
  poses: {
    greet: "assets/characters/hanabi-greet.png",
    happy: "assets/characters/hanabi-happy.png",
    cheer: "assets/characters/hanabi-cheer.png",
    think: "assets/characters/hanabi-think.png",
  },
};

// 場面ごとに、どの表情で話すか
const GUIDE_MOOD_POSE = {
  home: "greet",
  subject: "happy",
  start: "happy",
  correct: "cheer",
  wrong: "think",
  resultHigh: "cheer",
  resultMid: "happy",
  resultLow: "think",
};

// 吹き出しの横に立つ全身イラスト。表情は setGuide() が差し替える。
function renderGuideCharacterHTML() {
  return `<img id="guide-character-img" class="guide-character-img" src="${GUIDE_CHARACTER.poses.greet}" alt="${GUIDE_CHARACTER.name}">`;
}

// ステータスバーの丸枠に入れる顔アップ
function renderGuideFaceHTML(sizeClass) {
  return `<div class="creature-slot ${sizeClass}"><img class="mascot-art" src="${GUIDE_CHARACTER.faceImage}" alt="${GUIDE_CHARACTER.name}"></div>`;
}

// ===== 図鑑レベル（集めたカードの種類数で決まる） =====
// 名前つきの称号は、カード総数が最終的に200枚くらいまで増える想定で用意してある
// （20枚までは4枚刻み、そこから先は今後のバッチ規模に合わせて20枚刻み）。
// 200枚を超えた分は打ち止めにせず、COMPENDIUM_STEP刻みで「Lv.2」「Lv.3」…と
// 自動で伸びていく。カードを追加するバッチが増えても、称号の翻訳文を
// 都度書き足さずに済むようにするため。
const COMPENDIUM_TITLES = [
  { min: 0 }, { min: 4 }, { min: 8 }, { min: 12 }, { min: 16 }, { min: 20 },
  { min: 40 }, { min: 60 }, { min: 80 }, { min: 100 }, { min: 120 },
  { min: 140 }, { min: 160 }, { min: 180 }, { min: 200 },
].map((tier) => ({ ...tier, get title() { return t(`rank.${this.min}`); } }));

const COMPENDIUM_STEP = 20;
const COMPENDIUM_NAMED_MAX = COMPENDIUM_TITLES[COMPENDIUM_TITLES.length - 1].min;

function compendiumTierFor(count) {
  if (count < COMPENDIUM_NAMED_MAX) {
    let tier = COMPENDIUM_TITLES[0];
    let idx = 0;
    COMPENDIUM_TITLES.forEach((t, i) => { if (count >= t.min) { tier = t; idx = i; } });
    const next = COMPENDIUM_TITLES[idx + 1] || { min: COMPENDIUM_NAMED_MAX };
    return { count, title: tier.title, idx, next, tierMin: tier.min };
  }

  const stepsBeyond = Math.floor((count - COMPENDIUM_NAMED_MAX) / COMPENDIUM_STEP);
  const tierMin = COMPENDIUM_NAMED_MAX + stepsBeyond * COMPENDIUM_STEP;
  const baseTitle = COMPENDIUM_TITLES[COMPENDIUM_TITLES.length - 1].title;
  const title = stepsBeyond === 0 ? baseTitle : t("rank.beyond", { base: baseTitle, n: stepsBeyond + 1 });
  const idx = COMPENDIUM_TITLES.length - 1 + stepsBeyond;
  const next = { min: tierMin + COMPENDIUM_STEP };
  return { count, title, idx, next, tierMin };
}

// ===== ガチャカード コレクション =====
// name / flavor は日本語版のカードデータ。カード画像にも日本語が焼き込まれているため、
// 英語版を作る場合は画像の再生成もあわせて必要になる。
const RARITY_INFO = {
  N: { get label() { return t("rarity.N"); }, weight: 60 },
  R: { get label() { return t("rarity.R"); }, weight: 28 },
  SR: { get label() { return t("rarity.SR"); }, weight: 10 },
  UR: { get label() { return t("rarity.UR"); }, weight: 2 },
};

const THEME_INFO = {
  fireworks: { icon: "🎆", get label() { return t("theme.fireworks"); } },
  ocean: { icon: "🌊", get label() { return t("theme.ocean"); } },
  festival: { icon: "🏮", get label() { return t("theme.festival"); } },
  bugs: { icon: "🦗", get label() { return t("theme.bugs"); } },
  dessert: { icon: "🍧", get label() { return t("theme.dessert"); } },
  special: { icon: "🌞", get label() { return t("theme.special"); } },
  coolbreeze: { icon: "🎐", get label() { return t("theme.coolbreeze"); } },
  starrysky: { icon: "🌌", get label() { return t("theme.starrysky"); } },
};

const CARD_POOL = [
  { id: "n1", name: "はなびのこびと", rarity: "N", theme: "fireworks", shape: "round", color: "#5c6bc0", accessory: "tuft", eye: "dot", flavor: "よぞらに いちばんのりで うちあがる、げんきいっぱいの はなびのせいれい。", image: "n1.webp" },
  { id: "n2", name: "なみのこプクプク", rarity: "N", theme: "ocean", shape: "round", color: "#4fc3f7", accessory: "none", eye: "sleepy", flavor: "なみと いっしょに ぷかぷか うかぶのが だいすき。あわを ふくのが とくい。", image: "n2.webp" },
  { id: "n3", name: "やたいすずめ", rarity: "N", theme: "festival", shape: "oval", color: "#ffb74d", accessory: "none", eye: "dot", flavor: "やたいの にんきものを だれよりも はやく みつける、はなの きく すずめ。", image: "n3.webp" },
  { id: "n4", name: "くわがたぼうや", rarity: "N", theme: "bugs", shape: "oval", color: "#8d6e63", accessory: "ear-tufts", eye: "dot", flavor: "くさむらの おくで じっと まっている、はずかしがりやの むしとりなかま。", image: "n4.webp" },
  { id: "n5", name: "かちわりくん", rarity: "N", theme: "dessert", shape: "round", color: "#b3e5fc", accessory: "none", eye: "dot", flavor: "あつい日に ひとくち たべると、あたまが キーンキーンと するけど やめられない。", image: "n5.webp" },
  { id: "n6", name: "せんこうびのつぶ", rarity: "N", theme: "fireworks", shape: "round", color: "#ffca28", accessory: "tuft", eye: "sleepy", flavor: "ちいさな ひとつぶだけど、しずかな よるを あたたかく てらす。", image: "n6.webp" },
  { id: "n7", name: "うきわらっこ", rarity: "N", theme: "ocean", shape: "round", color: "#4dd0e1", accessory: "none", eye: "dot", flavor: "うきわに のって、いちにちじゅう うみを ぷかぷか さんぽしている。", image: "n7.webp" },
  { id: "n8", name: "きんぎょのすくいっこ", rarity: "N", theme: "festival", shape: "oval", color: "#ef5350", accessory: "none", eye: "dot", flavor: "ポイを もった手から すいすい にげるのが とくいわざ。", image: "n8.webp" },
  { id: "r1", name: "おおだまのぬし", rarity: "R", theme: "fireworks", shape: "round", color: "#e53935", accessory: "comb", eye: "star", flavor: "どーんと ひびく おとと ともに あらわれる、はなびたいかいの ぬし。", image: "r1.webp" },
  { id: "r2", name: "しおさいのせいれい", rarity: "R", theme: "ocean", shape: "round", color: "#26a69a", accessory: "tuft", eye: "star", flavor: "なみの おとに あわせて うたう、しおだまりの まもりびと。", image: "r2.webp" },
  { id: "r3", name: "たいこまつりぼうず", rarity: "R", theme: "festival", shape: "round", color: "#d84315", accessory: "comb", eye: "star", flavor: "まつりばやしの たいこの おとで、みんなを おどらせる げんきもの。", image: "r3.webp" },
  { id: "r4", name: "かぶとむしたいしょう", rarity: "R", theme: "bugs", shape: "oval", color: "#5d4037", accessory: "comb", eye: "star", flavor: "むしとりずかんで いちばん にんきの、りりしい つのを もつ ボス。", image: "r4.webp" },
  { id: "r5", name: "アイスキャンディーせいれい", rarity: "R", theme: "dessert", shape: "oval", color: "#f06292", accessory: "tuft", eye: "star", flavor: "とけそうで とけない、ふしぎな ちからで いつも ひんやり。", image: "r5.webp" },
  { id: "r6", name: "ほたるのひかりんぼ", rarity: "R", theme: "bugs", shape: "round", color: "#dce775", accessory: "none", eye: "star", sparkle: true, flavor: "よるの くさむらで ぴかぴか ひかって、みちしるべに なってくれる。", image: "r6.webp" },
  { id: "sr1", name: "にじいろはなびのきみ", rarity: "SR", theme: "fireworks", shape: "round", color: "#ab47bc", accessory: "crown", eye: "star", sparkle: true, flavor: "うちあがるたびに いろが かわる、たいかいで うわさの めずらしい はなび。", image: "sr1.webp" },
  { id: "sr2", name: "しんかいのぬし", rarity: "SR", theme: "ocean", shape: "round", color: "#1565c0", accessory: "glasses", eye: "star", sparkle: true, flavor: "だれも みたことのない、うみの いちばん ふかい ばしょに すんでいる。", image: "sr2.webp" },
  { id: "sr3", name: "なつまつりのおどりこ", rarity: "SR", theme: "festival", shape: "round", color: "#ec407a", accessory: "comb-gold", eye: "star", sparkle: true, flavor: "おどりの わの まんなかで、いちばん きれいに まう ゆうめいじん。", image: "sr3.webp" },
  { id: "sr4", name: "かんろのこおりひめ", rarity: "SR", theme: "dessert", shape: "round", color: "#81d4fa", accessory: "crown", eye: "star", sparkle: true, flavor: "ひとくちで なつの あつさを わすれさせてくれる、でんせつの あまいこおり。", image: "sr4.webp" },
  { id: "ur1", name: "だいもんじのりゅうじん", rarity: "UR", theme: "fireworks", shape: "round", color: "#ffd700", accessory: "comb-gold", eye: "star", sparkle: true, flavor: "いちねんにいちど やまに おおきな もじを うかびあがらせる でんせつの りゅう。", image: "ur1.webp" },
  { id: "ur2", name: "なつぞらのせいれいおう", rarity: "UR", theme: "special", shape: "round", color: "#ffab40", accessory: "crown", eye: "star", sparkle: true, flavor: "なつの すべての きせつせいれいたちを まとめる、でんせつの おうさま。", image: "ur2.webp" },
  // ─── 第2弾（2026-08-04・夏シーズン継続） ───
  { id: "n9", name: "ひばなのちびすけ", rarity: "N", theme: "fireworks", shape: "round", color: "#ff8a65", accessory: "tuft", eye: "dot", flavor: "せんこうはなびの さきっぽに すむ、ちいさな ひばなの せいれい。パチパチ はねるのが とくい。", image: "n9.webp" },
  { id: "r7", name: "うちあげやのみならい", rarity: "R", theme: "fireworks", shape: "oval", color: "#66bb6a", accessory: "ear-tufts", eye: "star", flavor: "おおきな はなびを うちあげる れんしゅうちゅう。まだ ちいさな はなしか あげられないけど、いつか どーんと あげたい。", image: "r7.webp" },
  { id: "n10", name: "さざなみのこ", rarity: "N", theme: "ocean", shape: "round", color: "#b2ebf2", accessory: "none", eye: "dot", flavor: "なぎさで さざなみと あそぶのが だいすき。あしもとを くすぐるのが とくいわざ。", image: "n10.webp" },
  { id: "r8", name: "かいがらひろいのぷりん", rarity: "R", theme: "ocean", shape: "oval", color: "#ffab91", accessory: "comb", eye: "star", flavor: "なぎさで きれいな かいがらを あつめている。いちばんの おきにいりは、ないしょの ばしょに かくしてあるらしい。", image: "r8.webp" },
  { id: "n11", name: "わたあめのふわりん", rarity: "N", theme: "festival", shape: "round", color: "#f48fb1", accessory: "tuft", eye: "sleepy", flavor: "やたいの わたあめきから うまれた、ふわふわの せいれい。さわると とけそうで、いつも ドキドキしている。", image: "n11.webp" },
  { id: "r9", name: "りんごあめのつやつやん", rarity: "R", theme: "festival", shape: "round", color: "#c62828", accessory: "tuft", eye: "star", flavor: "つやつやの あかい ころもを まとった、やたいの にんきもの。かたい みための わりに、なかは あまくて やさしい。", image: "r9.webp" },
  { id: "n12", name: "せみしぐれのうたいて", rarity: "N", theme: "bugs", shape: "oval", color: "#9ccc65", accessory: "none", eye: "dot", flavor: "きの うえから、なつの おわりを つげる うたを うたっている。うたいすぎて、よく こえが かれる。", image: "n12.webp" },
  { id: "n13", name: "とんぼのつーさん", rarity: "N", theme: "bugs", shape: "egg", color: "#42a5f5", accessory: "tuft", eye: "dot", flavor: "むぎわらぼうしの うえを、すいっと ひとまわり。とぶのが とくいで、みんなを あんないするのが すき。", image: "n13.webp" },
  { id: "sr5", name: "たまむしのひかりぎみ", rarity: "SR", theme: "bugs", shape: "oval", color: "#26a69a", accessory: "comb-gold", eye: "star", sparkle: true, flavor: "きんいろに ひかる はねを もつ、なかなか であえない めずらしい むし。みつけた ひは、いいことが あるかもしれない。", image: "sr5.webp" },
  { id: "n14", name: "すいかわりのたね", rarity: "N", theme: "dessert", shape: "egg", color: "#33691e", accessory: "none", eye: "dot", flavor: "すいかわりで とびだした、ちいさな たねの せいれい。めかくしした ともだちを、こっそり おうえんしている。", image: "n14.webp" },
  { id: "r10", name: "ソーダみつのりゅうちゃん", rarity: "R", theme: "dessert", shape: "round", color: "#0288d1", accessory: "comb", eye: "star", flavor: "あおくて つめたい、ソーダあじの かきごおりから うまれた。ひとくちで あたまが キーンと するのは、このこの しわざ。", image: "r10.webp" },
  { id: "n15", name: "ふうりんのちりん", rarity: "N", theme: "coolbreeze", shape: "round", color: "#81d4fa", accessory: "tuft", eye: "dot", flavor: "のきさきの ふうりんに すんでいる。かぜが ふくたびに、すずしい おとを ならして みんなを げんきづける。", image: "n15.webp" },
  { id: "r11", name: "すだれかげのひんやり", rarity: "R", theme: "coolbreeze", shape: "oval", color: "#7cb342", accessory: "none", eye: "star", flavor: "すだれの すきまから もれる ひかりの したで、ひるねを している。すずしい かげを つくるのが とくい。", image: "r11.webp" },
  { id: "sr6", name: "ゆうだちのおとずれ", rarity: "SR", theme: "coolbreeze", shape: "egg", color: "#5c9ce6", accessory: "tuft", eye: "star", sparkle: true, flavor: "あつい いちにちの おわりに、さっと やってきて つちの においを はこんでくる。とおりすぎたあと、にじが のこることも。", image: "sr6.webp" },
  { id: "ur3", name: "すずかぜのぬし", rarity: "UR", theme: "coolbreeze", shape: "round", color: "#4dd0e1", accessory: "crown", eye: "star", sparkle: true, flavor: "まちじゅうの あつさを、ひとふきで さらっていく でんせつの かぜの ぬし。すがたを みたものは、しあわせに なれると いわれている。", image: "ur3.webp" },
  { id: "n16", name: "ながれぼしのかけら", rarity: "N", theme: "starrysky", shape: "egg", color: "#ffe082", accessory: "none", eye: "dot", flavor: "よぞらから おちてきた、ちいさな ひかりの かけら。ねがいごとを ひとつだけ きいてくれる、という うわさがある。", image: "n16.webp" },
  { id: "r12", name: "あまのがわのこもりうた", rarity: "R", theme: "starrysky", shape: "round", color: "#7e57c2", accessory: "tuft", eye: "star", flavor: "よるが ふけると、あまのがわの ほとりで やさしい こもりうたを うたう。このうたを きくと、ぐっすり ねむれるらしい。", image: "r12.webp" },
  { id: "sr7", name: "たなばたかざりのふうせん", rarity: "SR", theme: "starrysky", shape: "round", color: "#fff176", accessory: "book", eye: "star", sparkle: true, flavor: "たんざくと いっしょに かざられていた、ちいさな かみの せいれい。みんなの ねがいごとを よみあげるのが しゅみ。", image: "sr7.webp" },
  { id: "sr8", name: "せいざつなぎのはかせ", rarity: "SR", theme: "starrysky", shape: "round", color: "#283593", accessory: "glasses", eye: "star", sparkle: true, flavor: "よぞらの ほしを せんで つないで、いきものの かたちを つくるのが とくい。まだ だれも しらない せいざを さがしている。", image: "sr8.webp" },
  { id: "ur4", name: "つきよのじょうおう", rarity: "UR", theme: "starrysky", shape: "round", color: "#c5cae9", accessory: "crown", eye: "star", sparkle: true, flavor: "まんげつの よるだけ すがたを あらわす、でんせつの おうひ。なつぞらの せいれいおうと ならんで、よるの そらを おさめている。", image: "ur4.webp" },
];

const GACHA_KEY = "gacha_owned";

function getOwnedCards() {
  try {
    return JSON.parse(localStorage.getItem(pk(GACHA_KEY)) || "{}");
  } catch (e) {
    return {};
  }
}

function saveOwnedCards(owned) {
  localStorage.setItem(pk(GACHA_KEY), JSON.stringify(owned));
  markSyncDirty();
}

// かぞくのずかん用：全プロフィールの所持カードを合算する
function getFamilyOwnedCards() {
  const merged = {};
  getProfiles().forEach((profile) => {
    try {
      const owned = JSON.parse(localStorage.getItem(`${profile.id}:${GACHA_KEY}`) || "{}");
      Object.entries(owned).forEach(([id, count]) => {
        merged[id] = (merged[id] || 0) + count;
      });
    } catch {
      // 壊れたデータは無視して他のプロフィールの集計を続ける
    }
  });
  return merged;
}

function getCompendiumInfo() {
  const count = Object.keys(getOwnedCards()).length;
  return compendiumTierFor(count);
}

// 天井：新しいカードが出ないまま PITY_LIMIT 回引くと、次は未所持から必ず出る。
// 重複還元：すでに持っているカードが出たら、レアリティに応じてポイントを返す。
const PITY_LIMIT = 10;
const PITY_KEY = "gacha_pity";
const DUPLICATE_REFUND = { N: 3, R: 4, SR: 6, UR: 8 };

function getPity() {
  return parseInt(localStorage.getItem(pk(PITY_KEY)) || "0", 10);
}

function setPity(n) {
  localStorage.setItem(pk(PITY_KEY), String(n));
  markSyncDirty();
}

// 無料プランではSR・URを除いた上で、残るレアリティの比率をそのまま保って引き直す
// （N60:R28 → N68%:R32%）。「出たのに引けない」を起こさないための設計。
function rollRarity() {
  const pool = isPaidPlan() ? ["N", "R", "SR", "UR"] : FREE_RARITIES;
  const weights = {};
  pool.forEach((r) => { weights[r] = RARITY_INFO[r].weight; });
  const total = Object.values(weights).reduce((sum, w) => sum + w, 0);
  let roll = Math.random() * total;
  for (const rarity of pool) {
    if (roll < weights[rarity]) return rarity;
    roll -= weights[rarity];
  }
  return "N";
}

function drawGachaCard() {
  const owned = getOwnedCards();
  const pool = drawableCardPool();
  const unowned = pool.filter((c) => !owned[c.id]);
  const pityHit = getPity() >= PITY_LIMIT && unowned.length > 0;

  // 天井に達していたら未所持のみから、そうでなければ通常のレアリティ抽選から選ぶ
  const card = pityHit ? pick(unowned) : pick(pool.filter((c) => c.rarity === rollRarity()));

  const isNew = !owned[card.id];
  owned[card.id] = (owned[card.id] || 0) + 1;
  saveOwnedCards(owned);
  setPity(isNew ? 0 : getPity() + 1);

  const refund = isNew ? 0 : (DUPLICATE_REFUND[card.rarity] || 0);
  if (refund) addStamps(refund);

  return { card, isNew, count: owned[card.id], refund, pityHit };
}

function cardArtMarkup(cardDef) {
  if (cardDef.image) {
    return `<img class="card-art" src="assets/cards/${cardDef.image}" alt="${cardDef.name}" loading="lazy">`;
  }
  const cfg = { shape: cardDef.shape, color: cardDef.color, accessory: cardDef.accessory, eye: cardDef.eye, sparkle: !!cardDef.sparkle };
  return renderCreatureHTML(cfg, "creature-slot--card");
}

function renderCardHTML(cardDef, opts) {
  const { isNew = false, locked = false, premium = false, count = 0 } = opts || {};

  // プレミアム限定で、まだ持っていないカード。「？？？」ではなく鍵として見せることで、
  // 「引けなかった」ではなく「まだ開いていない枠がある」と伝わるようにする。
  if (premium) {
    return `
      <div class="card rarity-${cardDef.rarity} locked locked--premium">
        <div class="card-rarity-badge">${cardDef.rarity}</div>
        <div class="creature-slot creature-slot--card"></div>
        <div class="card-premium-lock">🔒</div>
        <div class="card-name">${t("collection.premiumBadge")}</div>
      </div>
    `;
  }

  if (locked) {
    return `
      <div class="card rarity-${cardDef.rarity} locked">
        <div class="card-rarity-badge">${cardDef.rarity}</div>
        <div class="creature-slot creature-slot--card"></div>
        <div class="card-name">？？？</div>
      </div>
    `;
  }

  // 生成済みのカード画像は名前・レアリティ・特徴文をデザインに焼き込み済みのため、
  // HTML側では重ねて表示しない
  if (cardDef.image) {
    return `
      <div class="card card--full-art rarity-${cardDef.rarity}">
        ${isNew ? `<div class="card-new-badge">NEW!</div>` : ""}
        <img class="card-art card-art--full" src="assets/cards/${cardDef.image}" alt="${cardDef.name}" loading="lazy">
        ${count > 1 ? `<div class="card-count">× ${count}</div>` : ""}
      </div>
    `;
  }

  const theme = THEME_INFO[cardDef.theme];
  const nameLine = `${theme ? `<span class="card-theme-icon" title="${theme.label}">${theme.icon}</span> ` : ""}${cardDef.name}`;
  return `
    <div class="card rarity-${cardDef.rarity}">
      <div class="card-rarity-badge">${cardDef.rarity}</div>
      ${isNew ? `<div class="card-new-badge">NEW!</div>` : ""}
      ${cardArtMarkup(cardDef)}
      <div class="card-name">${nameLine}</div>
      ${count > 1 ? `<div class="card-count">× ${count}</div>` : ""}
    </div>
  `;
}

// ===== ガチャ演出（溜め→オーラ→カードフリップ） =====
// 溜めの前半はどのレアリティでも同じ長さにして、何が出るか分からないようにする。
// AURA_MS でオーラの色が出た瞬間がレアリティのヒント、そこから FLIP_MS までが追い溜め。
const GACHA_PHASE_MS = { charge: 0, build: 1400, aura: 2600 };
const GACHA_FLIP_MS = { N: 3300, R: 3300, SR: 4100, UR: 5000 };

// 演出中だけ関数が入る。スキップボタンとステージのタップから呼ばれる。
let skipGachaReveal = null;
// とじるボタンでガチャ画面にカードを残すために、直近の抽選結果を覚えておく
let lastGachaResult = null;

function spawnGachaBurst(rarity) {
  const stage = document.getElementById("gacha-stage");
  if (!stage) return;
  const count = { UR: 16, SR: 10, R: 6, N: 4 }[rarity] || 4;

  const burst = document.createElement("div");
  burst.className = "gacha-burst";
  for (let i = 0; i < count; i++) {
    const spark = document.createElement("span");
    spark.className = "gacha-burst-spark";
    spark.style.setProperty("--angle", `${(360 / count) * i}deg`);
    spark.style.animationDelay = `${Math.random() * 0.15}s`;
    burst.appendChild(spark);
  }
  stage.appendChild(burst);
  setTimeout(() => burst.remove(), 1300);

  if (rarity === "UR") {
    const flash = document.createElement("div");
    flash.className = "gacha-flash";
    document.body.appendChild(flash);
    setTimeout(() => flash.remove(), 700);
  }
}

function playGachaRevealSequence(gachaResult, onComplete) {
  const overlay = document.getElementById("gacha-overlay");
  const stageBox = document.getElementById("gacha-overlay-stage");
  const skipBtn = document.getElementById("btn-skip-gacha");
  const closeBtn = document.getElementById("btn-close-gacha");
  const rarity = gachaResult.card.rarity;
  const frontHTML = renderCardHTML(gachaResult.card, {
    isNew: gachaResult.isNew,
    count: gachaResult.count,
  });

  const converge = Array.from({ length: 16 }, (_, i) =>
    `<span class="gacha-converge-dot" style="--angle:${i * 22.5}deg; animation-delay:${(i % 4) * 0.16}s"></span>`
  ).join("");

  stageBox.innerHTML = `
    <div class="gacha-stage phase-charge" id="gacha-stage">
      <div class="gacha-rays"></div>
      <div class="gacha-converge">${converge}</div>
      <div class="gacha-aura"></div>
      <div class="gacha-flip-card charging" id="gacha-flip-card">
        <div class="gacha-flip-face gacha-flip-face--back">
          <div class="gacha-emblem">🔮</div>
        </div>
        <div class="gacha-flip-face gacha-flip-face--front">${frontHTML}</div>
      </div>
    </div>
  `;

  // 画面いっぱいに演出を出す
  document.getElementById("gacha-refund").textContent = "";
  overlay.classList.remove("hidden");
  overlay.setAttribute("aria-hidden", "false");
  document.body.classList.add("gacha-open");
  closeBtn.classList.add("hidden");
  skipBtn.classList.remove("hidden");

  // 演出のあいだは画面BGMに戻らないようロックし、レアリティに応じた効果音を鳴らす
  bgmLocked = true;
  const seKey = gachaRevealKeyFor(rarity);
  playBgm(seKey, { restart: true });
  getBgmPlayer(seKey).onended = () => playBgm("gachaView");

  const stage = document.getElementById("gacha-stage");
  const timers = [];

  // 溜め → さらに溜め → レアリティのオーラ、と段階的に盛り上げる
  timers.push(setTimeout(() => {
    stage.classList.remove("phase-charge");
    stage.classList.add("phase-build");
  }, GACHA_PHASE_MS.build));

  timers.push(setTimeout(() => {
    stage.classList.remove("phase-build");
    stage.classList.add("phase-aura", `aura-${rarity}`);
  }, GACHA_PHASE_MS.aura));

  let revealed = false;
  const revealCard = () => {
    if (revealed) return;
    revealed = true;
    timers.forEach(clearTimeout);
    stage.classList.remove("phase-charge", "phase-build", "phase-aura");
    stage.classList.add("phase-open");
    const flipCard = document.getElementById("gacha-flip-card");
    if (flipCard) {
      flipCard.classList.remove("charging");
      flipCard.classList.add("is-flipped");
    }
    spawnGachaBurst(rarity);
    const refundLine = document.getElementById("gacha-refund");
    if (gachaResult.isNew) {
      refundLine.textContent = t("gacha.newCard");
      refundLine.className = "gacha-refund is-new";
    } else if (gachaResult.refund) {
      refundLine.textContent = t("gacha.refund", { n: gachaResult.refund });
      refundLine.className = "gacha-refund";
    } else {
      refundLine.textContent = "";
    }
    skipBtn.classList.add("hidden");
    closeBtn.classList.remove("hidden");
    if (onComplete) setTimeout(onComplete, 500);
  };

  timers.push(setTimeout(revealCard, GACHA_FLIP_MS[rarity] || 3300));

  // スキップ：カードを即めくる（効果音はそのまま鳴らしきる）
  skipGachaReveal = () => revealCard();
}

// オーバーレイを閉じ、引いたカードをガチャ画面側に残す
function closeGachaOverlay(gachaResult) {
  const overlay = document.getElementById("gacha-overlay");
  overlay.classList.add("hidden");
  overlay.setAttribute("aria-hidden", "true");
  document.body.classList.remove("gacha-open");
  document.getElementById("gacha-overlay-stage").innerHTML = "";
  document.getElementById("btn-skip-gacha").classList.add("hidden");
  document.getElementById("btn-close-gacha").classList.add("hidden");
  skipGachaReveal = null;

  refreshGachaPointsDisplay();
  if (gachaResult) {
    document.getElementById("gacha-card-slot").innerHTML = renderCardHTML(gachaResult.card, {
      isNew: gachaResult.isNew,
      count: gachaResult.count,
    });
    document.getElementById("gacha-reveal-box").classList.remove("hidden");
  }
}

function openCollectionScreen(returnScreen, scope) {
  if (returnScreen) state.collectionReturnScreen = returnScreen;
  if (scope) state.collectionScope = scope;
  const isFamily = state.collectionScope === "family";

  // かぞく表示は、プロフィールが2人以上いるときだけ意味があるので出し分ける
  const scopeBar = document.getElementById("collection-scope");
  scopeBar.classList.toggle("hidden", getProfiles().length < 2);
  scopeBar.querySelectorAll(".collection-scope-btn").forEach((btn) => {
    btn.classList.toggle("active", (btn.dataset.scope === "family") === isFamily);
  });

  const owned = isFamily ? getFamilyOwnedCards() : getOwnedCards();
  const ownedCount = Object.keys(owned).length;

  // 無料プランのときの分母は「引けるカードの数」。集めきれない枚数を分母に入れると
  // 永久に埋まらないバーになってしまうため。
  const drawableTotal = drawableCardPool().length;
  document.getElementById("collection-count-line").textContent =
    t(isFamily ? "collection.countFamily" : "collection.count", { owned: ownedCount, total: drawableTotal });

  // プレミアム限定のうち、まだ持っていない枚数だけを案内する
  const premiumLockedCount = isPaidPlan()
    ? 0
    : CARD_POOL.filter((c) => isPremiumRarity(c.rarity) && !owned[c.id]).length;
  const premiumNote = document.getElementById("collection-premium-note");
  if (premiumNote) {
    premiumNote.textContent = premiumLockedCount ? t("collection.premiumNote", { n: premiumLockedCount }) : "";
    premiumNote.classList.toggle("hidden", premiumLockedCount === 0);
  }

  const grid = document.getElementById("collection-grid");
  grid.innerHTML = CARD_POOL.map((card) => {
    const count = owned[card.id] || 0;
    // すでに持っているカードは、あとから無料プランになっても取り上げない
    const premium = count === 0 && !isPaidPlan() && isPremiumRarity(card.rarity);
    return `<div class="collection-card-slot" data-card-id="${card.id}">${renderCardHTML(card, { locked: count === 0, premium, count })}</div>`;
  }).join("");

  grid.querySelectorAll(".collection-card-slot").forEach((slot) => {
    const card = CARD_POOL.find((c) => c.id === slot.dataset.cardId);
    const count = owned[card.id] || 0;
    if (count === 0) return;
    slot.addEventListener("click", () => {
      playClickSound();
      openCardDetail(card, count);
    });
  });

  showScreen("screen-collection");
}

function openCardDetail(card, count) {
  const content = document.getElementById("card-detail-content");
  content.innerHTML = renderCardHTML(card, { count });
  document.getElementById("card-detail-overlay").classList.remove("hidden");
}

function closeCardDetail() {
  document.getElementById("card-detail-overlay").classList.add("hidden");
}

document.getElementById("btn-close-card-detail").addEventListener("click", closeCardDetail);
document.getElementById("card-detail-overlay").addEventListener("click", (e) => {
  if (e.target.id === "card-detail-overlay") closeCardDetail();
});

document.getElementById("btn-back-from-collection").addEventListener("click", () => {
  showScreen(state.collectionReturnScreen || "screen-home");
});

document.querySelectorAll("#collection-scope .collection-scope-btn").forEach((btn) => {
  btn.addEventListener("click", () => {
    playClickSound();
    openCollectionScreen(null, btn.dataset.scope);
  });
});

// ===== ガイドキャラのセリフ =====

// 場面名を渡すと、その場面のセリフをランダムに選び、表情もあわせて切り替える
function setGuide(mood) {
  const lines = tList(`guide.${mood}`);
  if (lines.length) document.getElementById("guide-bubble").textContent = pick(lines);

  const pose = GUIDE_MOOD_POSE[mood] || "greet";
  const img = document.getElementById("guide-character-img");
  if (!img) return;
  const src = GUIDE_CHARACTER.poses[pose];
  if (img.getAttribute("src") === src) return;
  img.src = src;
  // 表情が変わったことが分かるように軽くはずませる
  img.classList.remove("guide-pop");
  void img.offsetWidth;
  img.classList.add("guide-pop");
}

// ============================================================
//  ここから下は「日本語版のコンテンツ」
// ------------------------------------------------------------
//  問題文・ヒント・解説は日本語の学習内容そのものなので、
//  英語版では翻訳ではなく、英語圏のカリキュラムに沿った
//  別の生成器・問題バンクを書き下ろすことになる。
//  UI の文言は i18n.js に集約済みで、ここには含めない。
// ============================================================

// ===== 算数（小学1・2年生） =====
function genAdd1() {
  const a = randInt(1, 12), b = randInt(1, Math.min(12, 20 - a));
  const sum = a + b;
  let explain;
  if (a >= 10) {
    const aOnes = a - 10;
    explain = aOnes === 0
      ? `10に ${b}を たすと ${sum}`
      : `${a}は 10と${aOnes}。${aOnes}に ${b}を たすと ${aOnes + b}。10と${aOnes + b}で ${sum}`;
  } else if (sum > 10) {
    const toTen = 10 - a;
    const rest = b - toTen;
    explain = `${a}に ${toTen}たして 10。のこりの ${rest}を たして ${sum}`;
  } else {
    explain = `${a}に ${b}を たすと ${sum}`;
  }
  return { text: `${a} ＋ ${b} = ?`, answer: String(sum), type: "number",
    hint: `${a}に ${b}を たすよ。ゆびで かぞえても いいよ`, explain };
}

function genSub1() {
  const a = randInt(2, 18), b = randInt(1, a - 1);
  const diff = a - b;
  let explain;
  if (a < 10) {
    explain = `${a}から ${b}を ひくと ${diff}`;
  } else {
    const aOnes = a - 10;
    if (aOnes === 0) {
      explain = `10は ちょうど10。10から ${b}を ひくと ${diff}`;
    } else if (b <= aOnes) {
      explain = `${a}は 10と${aOnes}。${aOnes}－${b}＝${aOnes - b}。10と${aOnes - b}で ${diff}`;
    } else {
      const borrow = 10 - b;
      explain = `${a}は 10と${aOnes}。10－${b}＝${borrow}。${borrow}に ${aOnes}を たして ${diff}`;
    }
  }
  return { text: `${a} － ${b} = ?`, answer: String(diff), type: "number",
    hint: `${a}から ${b}を へらすよ`, explain };
}

function genAdd2() {
  const a = randInt(10, 99), b = randInt(10, 99);
  const aOnes = a % 10, bOnes = b % 10;
  const aTens = Math.floor(a / 10), bTens = Math.floor(b / 10);
  const onesSum = aOnes + bOnes;
  const explain = onesSum >= 10
    ? `一の位: ${aOnes}＋${bOnes}＝${onesSum}なので、十の位に1くり上げる。十の位: ${aTens}＋${bTens}＋1＝${aTens + bTens + 1}。あわせて ${a + b}`
    : `一の位: ${aOnes}＋${bOnes}＝${onesSum}。十の位: ${aTens}＋${bTens}＝${aTens + bTens}。あわせて ${a + b}`;
  return { text: `${a} ＋ ${b} = ?`, answer: String(a + b), type: "number",
    hint: "十の位と 一の位に わけて たしてみよう", explain };
}

function genSub2() {
  const a = randInt(20, 99), b = randInt(10, a - 1);
  return { text: `${a} － ${b} = ?`, answer: String(a - b), type: "number",
    hint: "くり下がりに 気をつけよう",
    explain: `${a} － ${b} ＝ ${a - b}。たしかめ算: ${a - b} ＋ ${b} ＝ ${a}` };
}

function genMul2() {
  const a = randInt(2, 9), b = randInt(2, 9);
  const terms = Array(b).fill(a).join("＋");
  return { text: `${a} × ${b} = ?`, answer: String(a * b), type: "number",
    hint: `${a}のだんの 九九を おもいだそう`,
    explain: `${a} × ${b} は ${a}を ${b}回 たすことだから、${terms}＝${a * b}` };
}

// ===== 算数（小学3年生・新しく習う内容）=====
// 参考: 3年生の新出単元は わり算／3〜4桁のたし算ひき算／2桁×1桁のかけ算／
// 小数のたし算ひき算の導入／同分母の分数のたし算ひき算（通分は5年生）
function decompose(n) {
  const thousands = Math.floor(n / 1000) * 1000;
  const hundreds = Math.floor((n % 1000) / 100) * 100;
  const tens = Math.floor((n % 100) / 10) * 10;
  const ones = n % 10;
  return [thousands, hundreds, tens, ones].filter((x) => x > 0).join("＋") || "0";
}

function genAdd3() {
  const a = randInt(100, 9000);
  const b = randInt(100, 9000);
  return {
    text: `${a} ＋ ${b} = ？`,
    answer: `${a + b}`,
    type: "number",
    hint: "位をそろえて、一の位からじゅんばんに たしざんしてみよう",
    explain: `${a} は ${decompose(a)}、${b} は ${decompose(b)}。同じ位どうしを たすと ${a + b} になるよ`,
  };
}

function genSub3() {
  let a = randInt(100, 9000);
  let b = randInt(100, 9000);
  if (b > a) [a, b] = [b, a];
  if (a === b) a += 1;
  return {
    text: `${a} － ${b} = ？`,
    answer: `${a - b}`,
    type: "number",
    hint: "大きい位から順にひき算しよう。くり下がりに注意",
    explain: `${a} － ${b} = ${a - b}。たしかめ算: ${a - b} ＋ ${b} を計算して ${a} に なるか かくにんしよう`,
  };
}

function genMul3() {
  const a = randInt(11, 99);
  const b = randInt(2, 9);
  const tens = Math.floor(a / 10) * 10;
  const ones = a % 10;
  return {
    text: `${a} × ${b} = ？`,
    answer: `${a * b}`,
    type: "number",
    hint: `${a}を 十の位と一の位に分けて、それぞれ ${b}を かけてみよう`,
    explain: `${tens}×${b}＝${tens * b}、${ones}×${b}＝${ones * b}。あわせて ${tens * b}＋${ones * b}＝${a * b}`,
  };
}

function genDiv3() {
  const b = randInt(2, 9);
  const q = randInt(2, 9);
  const a = b * q;
  return {
    text: `${a} ÷ ${b} = ？`,
    answer: `${q}`,
    type: "number",
    hint: `${b}のだんの 九九で こたえが ${a} になる数を さがそう`,
    explain: `${b} × ${q} = ${a} だから、${a} ÷ ${b} の こたえは ${q}`,
  };
}

function genDivRemainder3() {
  const b = randInt(2, 12);
  const q = randInt(2, 12);
  const r = randInt(1, b - 1);
  const a = b * q + r;
  return {
    text: `${a} ÷ ${b} = ？（例のように「〇あまり△」の形で書いてね。例: 5あまり3）`,
    answer: `${q}あまり${r}`,
    accept: [`${q}あまり${r}`, `${q}余り${r}`],
    type: "text",
    hint: `${b}のだんの 九九で ${a}を こえない、いちばん大きい数を さがそう`,
    explain: `${b} × ${q} ＝ ${b * q}。${a} － ${b * q} ＝ ${r} あまる。だから ${q}あまり${r}`,
  };
}

function randNonMultipleOf10(min, max) {
  let n;
  do { n = randInt(min, max); } while (n % 10 === 0);
  return n;
}

function genDecimal3() {
  const na = randNonMultipleOf10(1, 50);
  let nb;
  do { nb = randNonMultipleOf10(1, 50); } while (nb === na);
  const a = na / 10, b = nb / 10;
  const isAdd = Math.random() < 0.5;
  const hint = "小数点の位置を そろえて 計算しよう";
  if (isAdd) {
    const answer = roundedText(a + b);
    const explain = `${a}を 10ばいすると ${na}、${b}を 10ばいすると ${nb}。${na}＋${nb}＝${na + nb}。10で わって もとに もどすと ${answer}`;
    return { text: `${a} ＋ ${b} = ？`, answer, type: "number", hint, explain };
  }
  const hiRaw = Math.max(na, nb), loRaw = Math.min(na, nb);
  const hi = hiRaw / 10, lo = loRaw / 10;
  const answer = roundedText(hi - lo);
  const explain = `${hi}を 10ばいすると ${hiRaw}、${lo}を 10ばいすると ${loRaw}。${hiRaw}－${loRaw}＝${hiRaw - loRaw}。10で わって もとに もどすと ${answer}`;
  return { text: `${hi} － ${lo} = ？`, answer, type: "number", hint, explain };
}

// 約分が起きたときは解説に一手足す。起きなければ何も足さない（S3-2）。
function reduceExplainSuffix(rawNum, d, result) {
  if (result.den === d) return "";
  const g = gcd(rawNum, d);
  return `。${rawNum}と${d}を${g}でわって やくぶんすると ${fractionToText(result)}`;
}

function genFractionSame3() {
  const d = randInt(2, 14);
  const isAdd = Math.random() < 0.5;
  if (isAdd) {
    const n1 = randInt(1, d - 1);
    const n2 = randInt(1, d - n1);
    const sum = n1 + n2;
    const result = reduceFraction(sum, d);
    return {
      text: `${n1}/${d} ＋ ${n2}/${d} = ？`,
      answer: fractionToText(result),
      type: "fraction",
      hint: "分母はそのまま、分子どうしを たしざんしよう",
      explain: `分母はそのままで、分子は ${n1}＋${n2}＝${sum}。だから ${sum}/${d}${reduceExplainSuffix(sum, d, result)}`,
    };
  }
  const n1 = randInt(2, d);
  const n2 = randInt(1, n1 - 1);
  const diff = n1 - n2;
  const result = reduceFraction(diff, d);
  return {
    text: `${n1}/${d} － ${n2}/${d} = ？`,
    answer: fractionToText(result),
    type: "fraction",
    hint: "分母はそのまま、分子どうしを ひきざんしよう",
    explain: `分母はそのままで、分子は ${n1}－${n2}＝${diff}。だから ${diff}/${d}${reduceExplainSuffix(diff, d, result)}`,
  };
}

const WORD_ITEMS = ["りんご", "みかん", "あめ", "えんぴつ", "シール", "クッキー", "おりがみ", "どんぐり"];
const WORD_NAMES = ["ゆうたくん", "さくらさん", "けんとくん", "みおさん", "たろうくん", "はなさん"];

function genWordAdd() {
  const item = pick(WORD_ITEMS);
  const a = randInt(5, 40);
  const b = randInt(2, 30);
  return {
    text: `${item}が ${a}こ ありました。${b}こ もらいました。ぜんぶで なんこ？`,
    answer: `${a + b}`,
    type: "number",
    hint: "「もらった」ということは、数が ふえるね。たしざんを つかおう",
    explain: `はじめに ${a}こ、もらった ${b}こを たすと ${a}＋${b}＝${a + b}こ になるよ`,
  };
}

// 「えんぴつを たべました」のような不自然な文にならないよう、
// 数が減る場面の動詞は、食べ物かどうかで変える。
const WORD_ITEMS_EDIBLE = ["りんご", "みかん", "あめ", "クッキー"];
const WORD_ITEMS_OTHER = ["えんぴつ", "シール", "おりがみ", "どんぐり"];

function pickConsumable() {
  return Math.random() < 0.5
    ? { item: pick(WORD_ITEMS_EDIBLE), past: "たべました", plain: "たべた" }
    : { item: pick(WORD_ITEMS_OTHER), past: "つかいました", plain: "つかった" };
}

function genWordSub() {
  const { item, past, plain } = pickConsumable();
  const b = randInt(2, 30);
  const bigger = randInt(5, 40) + b;
  return {
    text: `${item}が ${bigger}こ ありました。${b}こ ${past}。のこりは なんこ？`,
    answer: `${bigger - b}`,
    type: "number",
    hint: `「${plain}」ということは、数が へるね。ひきざんを つかおう`,
    explain: `はじめに ${bigger}こ あって、${b}こ ${plain}から ${bigger}－${b}＝${bigger - b}こ のこるよ`,
  };
}

function genWordMul() {
  const item = pick(WORD_ITEMS);
  const perBag = randInt(2, 9);
  const bags = randInt(2, 9);
  return {
    text: `1ふくろに ${item}が ${perBag}こずつ 入っています。${bags}ふくろでは ぜんぶで なんこ？`,
    answer: `${perBag * bags}`,
    type: "number",
    hint: "「1ふくろに◯こ」が「△ふくろぶん」あるときは、かけ算を つかおう",
    explain: `1ふくろ ${perBag}こ が ${bags}ふくろぶん あるから ${perBag}×${bags}＝${perBag * bags}こ になるよ`,
  };
}

function genWordDiv() {
  const item = pick(WORD_ITEMS);
  const people = randInt(2, 9);
  const each = randInt(2, 9);
  const total = people * each;
  return {
    text: `${item}が ${total}こ あります。${people}人で おなじ数ずつ わけると、1人ぶんは なんこ？`,
    answer: `${each}`,
    type: "number",
    hint: "「おなじ数ずつ わける」ときは、わり算を つかおう",
    explain: `ぜんぶで ${total}こ を ${people}人で 同じ数ずつ わけるから ${total}÷${people}＝${each}こ になるよ`,
  };
}

function genWordCompare() {
  const [nameA, nameB] = shuffle(WORD_NAMES).slice(0, 2);
  const item = pick(WORD_ITEMS);
  const b = randInt(6, 40);
  // 「すくなく」のとき答えが負や0にならないよう、差は b 未満に収める
  const diff = randInt(2, Math.min(20, b - 1));
  const isMore = Math.random() < 0.5;
  return {
    text: isMore
      ? `${nameA}は ${item}を ${b}こ もっています。${nameB}は ${nameA}より ${diff}こ おおく もっています。${nameB}は なんこ？`
      : `${nameA}は ${item}を ${b}こ もっています。${nameB}は ${nameA}より ${diff}こ すくなく もっています。${nameB}は なんこ？`,
    answer: isMore ? `${b + diff}` : `${b - diff}`,
    type: "number",
    hint: isMore ? "「多い」ということは、たしざんを つかおう" : "「少ない」ということは、ひきざんを つかおう",
    explain: isMore
      ? `${nameA}は${b}こ。${nameB}は${nameA}より${diff}こ多いから、${b}＋${diff}＝${b + diff}こ になるよ`
      : `${nameA}は${b}こ。${nameB}は${nameA}より${diff}こ少ないから、${b}－${diff}＝${b - diff}こ になるよ`,
  };
}

// 合併（「あわせて いくつ」）。genWordAdd の増加（あとから もらう）と同じ たし算だが、
// 文章の型が違う。たし算しか習っていない時期でも、見た目の変化をつけられる。
const WORD_PLACES = ["はこの中", "つくえの上", "かごの中", "ふくろの中"];

function genWordAddCombine() {
  // 種類の違うものを合算すると不自然になるので、同じものが2か所にある形にする
  const item = pick(WORD_ITEMS);
  const [place1, place2] = shuffle(WORD_PLACES).slice(0, 2);
  const a = randInt(3, 30);
  const b = randInt(2, 25);
  return {
    text: `${place1}に ${item}が ${a}こ、${place2}に ${b}こ あります。あわせて なんこ？`,
    answer: `${a + b}`,
    type: "number",
    hint: "「あわせて」と きかれたら、たしざんを つかおう",
    explain: `${place1}に ${a}こ、${place2}に ${b}こ。あわせると ${a}＋${b}＝${a + b}こ だよ`,
  };
}

// 求差（「ちがいは いくつ」）。genWordSub の求残（たべて のこりは）と同じ ひきざんだが、
// 「へらす」のではなく「くらべる」場面なので、考え方の練習になる。
function genWordSubDiff1() {
  const [nameA, nameB] = shuffle(WORD_NAMES).slice(0, 2);
  const item = pick(WORD_ITEMS);
  const a = randInt(6, 40);
  const b = randInt(2, a - 1);
  return {
    text: `${nameA}は ${item}を ${a}こ、${nameB}は ${b}こ もっています。ちがいは なんこ？`,
    answer: `${a - b}`,
    type: "number",
    hint: "「ちがい」を きかれたら、大きいほうから 小さいほうを ひこう",
    explain: `${a}－${b}＝${a - b}。${nameA}のほうが ${a - b}こ おおいよ`,
  };
}

// 3口の計算（たして、ひく）。2つの式を順にたどる練習。
function genWordAddSub1() {
  const { item, past, plain } = pickConsumable();
  const a = randInt(5, 25);
  const b = randInt(2, 15);
  // のこりが0以下にならないようにする（答えが0の問題は学習価値が低い）
  const c = randInt(2, Math.min(12, a + b - 1));
  return {
    text: `${item}が ${a}こ ありました。${b}こ もらって、そのあと ${c}こ ${past}。のこりは なんこ？`,
    answer: `${a + b - c}`,
    type: "number",
    hint: `はじめの数に もらった数を たして、そのあと ${plain}数を ひこう`,
    explain: `${a}＋${b}＝${a + b}こ。そこから ${c}こ ${plain}から ${a + b}－${c}＝${a + b - c}こ のこるよ`,
  };
}

// 長さ（cm）の計算。2年生の1学期に習う単元。たし算・ひき算は同じでも、
// 単位が「こ」から「cm」に変わるので、見た目と場面がはっきり変わる。
function genWordLength2() {
  const isAdd = Math.random() < 0.5;
  const a = randInt(10, 80);
  const b = randInt(3, isAdd ? 40 : a - 2);
  return isAdd
    ? {
        text: `あおい テープが ${a}cm、あかい テープが ${b}cm あります。つなげると なんcm？`,
        answer: `${a + b}`,
        type: "number",
        hint: "つなげた長さは、2本の長さを たすと もとめられるよ",
        explain: `${a}＋${b}＝${a + b}（cm）`,
      }
    : {
        text: `${a}cm の テープから ${b}cm きりとりました。のこりは なんcm？`,
        answer: `${a - b}`,
        type: "number",
        hint: "きりとった長さを ひくと、のこりが もとめられるよ",
        explain: `${a}－${b}＝${a - b}（cm）`,
      };
}

// あまりのあるわり算の文章題（3年）。あまった分にもう1つ必要になるので、
// わり算の答えをそのまま書くと間違いになる。式だけでなく場面を考える練習。
function genWordDivRemainder3() {
  const perCar = randInt(3, 8);
  const cars = randInt(3, 9);
  const rest = randInt(1, perCar - 1);
  const total = perCar * cars + rest;
  return {
    text: `${total}人が 1台に ${perCar}人ずつ 車に のります。ぜんいん のるには 車は なんだい いりますか？`,
    answer: `${cars + 1}`,
    type: "number",
    hint: `${total}÷${perCar} を計算して、あまった人のぶんも 1台 かぞえよう`,
    explain: `${total}÷${perCar}＝${cars}あまり${rest}。あまった${rest}人にも 車が いるので ${cars}＋1＝${cars + 1}台 だよ`,
  };
}

// アレイ図（たて×よこ）。genWordMul の「1ふくろに◯こずつ」と同じ かけ算だが、
// ならんでいる形から数える場面なので、かけ算の意味の理解につながる。
function genWordMulArray2() {
  const rows = randInt(2, 9);
  const cols = randInt(2, 9);
  return {
    text: `シールを たてに ${rows}れつ、よこに ${cols}れつ ならべて はりました。シールは ぜんぶで なんまい？`,
    answer: `${rows * cols}`,
    type: "number",
    hint: "「たて × よこ」で ぜんぶの数が もとめられるよ",
    explain: `たて ${rows}れつ、よこ ${cols}れつ ならんでいるから ${rows}×${cols}＝${rows * cols}まい だよ`,
  };
}

// ===== 算数（小学4年生・新しく習う内容）=====
// わり算の商（2桁）を十の位・一の位に分けて、分配法則で説明する。
// 筆算そのものの再現ではなく簡易版（詳しい方針は hint-explain-audit.md 参照）。
function distributiveDivideExplain(rawDividend, divisor, rawQuotient) {
  const qTens = Math.floor(rawQuotient / 10) * 10;
  const qOnes = rawQuotient % 10;
  const tensPart = divisor * qTens;
  if (qOnes === 0) {
    return `${rawDividend}を ${divisor}で わると、ちょうど ${qTens}になる（${tensPart}÷${divisor}＝${qTens}）`;
  }
  const onesPart = divisor * qOnes;
  return `${rawDividend}を ${tensPart}と${onesPart}に分けると、${tensPart}÷${divisor}＝${qTens}、${onesPart}÷${divisor}＝${qOnes}。あわせて ${rawQuotient}`;
}

function genDivLong4() {
  const b = randInt(3, 9);
  const q = randInt(12, 99);
  const a = b * q;
  return {
    text: `${a} ÷ ${b} = ?`,
    answer: String(q),
    type: "number",
    hint: "大きい位から じゅんばんに わっていく ひっ算で 計算しよう",
    explain: distributiveDivideExplain(a, b, q),
  };
}

function genDecimalAddSub4() {
  const aRaw = randInt(101, 999);
  let bRaw = randInt(101, 999);
  if (bRaw === aRaw) bRaw += 1;
  const a = aRaw / 100, b = bRaw / 100;
  const isAdd = Math.random() < 0.5;
  const bigRaw = Math.max(aRaw, bRaw), smallRaw = Math.min(aRaw, bRaw);
  const big = bigRaw / 100, small = smallRaw / 100;
  const answer = isAdd
    ? String(Math.round((a + b) * 100) / 100)
    : String(Math.round((big - small) * 100) / 100);
  const explain = isAdd
    ? `${a}を 100ばいすると ${aRaw}、${b}を 100ばいすると ${bRaw}。${aRaw}＋${bRaw}＝${aRaw + bRaw}。100で わって もとに もどすと ${answer}`
    : `${big}を 100ばいすると ${bigRaw}、${small}を 100ばいすると ${smallRaw}。${bigRaw}－${smallRaw}＝${bigRaw - smallRaw}。100で わって もとに もどすと ${answer}`;
  return {
    text: isAdd ? `${a} ＋ ${b} = ?` : `${big} － ${small} = ?`,
    answer,
    type: "number",
    hint: "小数点の いちを そろえて、ひっ算で 計算しよう",
    explain,
  };
}

function genRectArea4() {
  const w = randInt(3, 35);
  const h = randInt(3, 35);
  const isSquare = Math.random() < 0.3;
  const side = isSquare ? w : null;
  return {
    text: isSquare
      ? `1辺が ${side}cm の 正方形の 面積は なんcm²？`
      : `たて ${h}cm、よこ ${w}cm の 長方形の 面積は なんcm²？`,
    answer: String(isSquare ? side * side : w * h),
    type: "number",
    hint: isSquare ? "正方形の 面積 ＝ 1辺 × 1辺" : "長方形の 面積 ＝ たて × よこ",
    explain: isSquare
      ? `${side} × ${side} ＝ ${side * side}（cm²）`
      : `${h} × ${w} ＝ ${h * w}（cm²）`,
  };
}

function genRounding4() {
  const n = randInt(1234, 98765);
  const places = [
    { label: "十", unit: 10, lowerLabel: "一" },
    { label: "百", unit: 100, lowerLabel: "十" },
    { label: "千", unit: 1000, lowerLabel: "百" },
  ];
  const place = pick(places);
  const answer = Math.round(n / place.unit) * place.unit;
  const lowerDigit = Math.floor(n / (place.unit / 10)) % 10;
  const decision = lowerDigit >= 5 ? "5以上なので きりあげて" : "4以下なので きりさげて";
  return {
    text: `${n} を 四捨五入して、${place.label}の位までの がい数に すると?`,
    answer: String(answer),
    type: "number",
    hint: `${place.label}の位の 1つ下の 数を 見て、4以下なら きりさげ、5以上なら きりあげ`,
    explain: `${place.label}の位の 1つ下、${place.lowerLabel}の位の 数字は ${lowerDigit}。${decision} ${place.label}の位までの がい数に すると ${answer}`,
  };
}

function genAngle4() {
  const a = randInt(20, 120);
  const b = randInt(20, 170 - a);
  return {
    text: `1つの 直線の 上に 2つの 角が ならんでいます。1つが ${a}度、もう1つが ${b}度の とき、のこりの 角は なん度？`,
    answer: String(180 - a - b),
    type: "number",
    hint: "1つの 直線が つくる 角は ぜんぶで 180度",
    explain: `180 － ${a} － ${b} ＝ ${180 - a - b}（度）`,
  };
}

function genWordUnit4() {
  const m = randInt(2, 9);
  const cm = randInt(10, 99);
  const total = m * 100 + cm;
  return {
    text: `テープが ${total}cm あります。これは なんm なんcm？（cm の 数を 答えてね。${m}m ◯cm）`,
    answer: String(cm),
    type: "number",
    hint: "100cm ＝ 1m だよ。100で わった あまりを かんがえよう",
    explain: `${total}cm ＝ ${m}m ${cm}cm（100cm が ${m}こ ぶんと、あまり ${cm}cm）`,
  };
}

// --- 4年の文章題 ---
// genWordUnit4（単位換算）1つしかなく、4年生の内容がセッションに乗りにくかったので追加した。
// 計算系（genRectArea4 / genRounding4 / genAngle4）と場面が重ならないようにしてある。

// 大きい数（万・億）。4年の1学期最初の単元なので、年度のはじめから出す。
function genWordBigNumber4() {
  const base = randInt(12, 98);
  const times = randInt(2, 9);
  const isMan = Math.random() < 0.6;
  const unit = isMan ? "万" : "億";
  const place = pick(["市", "町", "県"]);
  const what = isMan ? "人口" : "予算";
  const amount = isMan ? "人" : "円";
  return {
    text: `ある${place}の ${what}は ${base}${unit}${amount} です。となりの${place}は その ${times}ばい です。となりの${place}の ${what}は なん${unit}${amount}？（${unit}を のぞいた 数を 答えてね）`,
    answer: String(base * times),
    type: "number",
    hint: `${unit}の いくつぶんか で かんがえよう。${base} × ${times} を 計算するよ`,
    explain: `${base}${unit} の ${times}ばい は ${base}×${times}＝${base * times}。つまり ${base * times}${unit}${amount}`,
  };
}

// がい数で見積もる。正確な計算ではなく「およそいくつか」を考える単元。
function genWordEstimate4() {
  const unit = pick([100, 1000]);
  const label = unit === 100 ? "百" : "千";
  // きりのいい数にならないよう、下の位に必ず端数を作る
  const make = () => randInt(unit * 2, unit * 9) + randInt(1, unit - 1);
  const a = make();
  const b = make();
  const ra = Math.round(a / unit) * unit;
  const rb = Math.round(b / unit) * unit;
  return {
    text: `ある店で 月よう日に ${a}人、火よう日に ${b}人 きました。それぞれ ${label}の位までの がい数に して、2日で およそ なん人か もとめましょう。`,
    answer: String(ra + rb),
    type: "number",
    hint: `先に それぞれを ${label}の位までの がい数に してから たすよ`,
    explain: `${a}は およそ ${ra}、${b}は およそ ${rb}。${ra}＋${rb}＝${ra + rb}（人）`,
  };
}

// 2けたでわるわり算の文章題。あまりをどう扱うかを場面から考える。
function genWordDivLarge4() {
  const perBox = randInt(12, 36);
  const boxes = randInt(4, 15);
  const rest = randInt(1, perBox - 1);
  const total = perBox * boxes + rest;
  const needAll = Math.random() < 0.5;
  return needAll
    ? {
        text: `${total}この ボールを 1はこに ${perBox}こずつ 入れます。ぜんぶ 入れるには はこは なんこ いりますか？`,
        answer: String(boxes + 1),
        type: "number",
        hint: `${total}÷${perBox} を計算して、あまったぶんの はこも かぞえよう`,
        explain: `${total}÷${perBox}＝${boxes}あまり${rest}。あまった ${rest}こにも はこが いるので ${boxes}＋1＝${boxes + 1}こ`,
      }
    : {
        text: `${total}この ボールを 1はこに ${perBox}こずつ 入れます。いっぱいに なる はこは なんこ できますか？`,
        answer: String(boxes),
        type: "number",
        hint: `${total}÷${perBox} の 商が、いっぱいに なった はこの 数だよ`,
        explain: `${total}÷${perBox}＝${boxes}あまり${rest}。いっぱいに なるのは ${boxes}こ（${rest}こ あまる）`,
      };
}

// 面積（m²）の文章題。genRectArea4 は cm² の図形問題なので、単位と場面を変えてある。
function genWordAreaRoom4() {
  const w = randInt(3, 12);
  const h = randInt(3, 12);
  const place = pick(["きょうしつ", "花だん", "にわ", "ちゅう車場"]);
  const isFindSide = Math.random() < 0.4;
  return isFindSide
    ? {
        text: `${place}の 面積は ${w * h}m² です。たての 長さが ${h}m の とき、よこの 長さは なんm？`,
        answer: String(w),
        type: "number",
        hint: "面積 ÷ たて ＝ よこ。かけ算の ぎゃくを かんがえよう",
        explain: `${w * h}÷${h}＝${w}（m）`,
      }
    : {
        text: `たて ${h}m、よこ ${w}m の ${place}が あります。面積は なんm²？`,
        answer: String(w * h),
        type: "number",
        hint: "長方形の 面積 ＝ たて × よこ",
        explain: `${h}×${w}＝${w * h}（m²）`,
      };
}

// 小数のかさ・重さの文章題。式は4年の小数のたし算ひき算だが、場面から式を立てる。
function genWordDecimalAmount4() {
  const aRaw = randInt(15, 95);
  const bRaw = randInt(5, aRaw - 5);
  const a = aRaw / 10, b = bRaw / 10;
  const isAdd = Math.random() < 0.5;
  const item = pick([
    { name: "ジュース", unit: "L" },
    { name: "水", unit: "L" },
    { name: "さとう", unit: "kg" },
  ]);
  return isAdd
    ? {
        text: `${item.name}が 大きい入れものに ${a}${item.unit}、小さい入れものに ${b}${item.unit} あります。あわせて なん${item.unit}？`,
        answer: String(Math.round((a + b) * 10) / 10),
        type: "number",
        hint: "小数点の いちを そろえて たそう",
        explain: `${a}＋${b}＝${Math.round((a + b) * 10) / 10}（${item.unit}）`,
      }
    : {
        text: `${item.name}が ${a}${item.unit} ありました。${b}${item.unit} つかいました。のこりは なん${item.unit}？`,
        answer: String(Math.round((a - b) * 10) / 10),
        type: "number",
        hint: "小数点の いちを そろえて ひこう",
        explain: `${a}－${b}＝${Math.round((a - b) * 10) / 10}（${item.unit}）`,
      };
}

// 変わり方（かんたんな比例）。1あたりの量から、まとまった量を求める。
function genWordProportion4() {
  const n1 = randInt(2, 6);
  const n2 = n1 + randInt(2, 8);
  const item = pick([
    // 1あたりの量は、場面として不自然にならない範囲にする（4mで12円のリボンは安すぎる）
    { name: "はりがね", unit: "m", amount: "g", word: "重さ", per: randInt(3, 25) },
    { name: "リボン", unit: "m", amount: "円", word: "ねだん", per: randInt(4, 30) * 10 },
  ]);
  const per = item.per;
  return {
    text: `${item.name} ${n1}${item.unit} の ${item.word}は ${per * n1}${item.amount} です。同じ ${item.name} ${n2}${item.unit} では なん${item.amount}？`,
    answer: String(per * n2),
    type: "number",
    hint: `まず 1${item.unit} ぶんの ${item.word}を もとめよう`,
    explain: `1${item.unit} ぶんは ${per * n1}÷${n1}＝${per}${item.amount}。${n2}${item.unit} では ${per}×${n2}＝${per * n2}${item.amount}`,
  };
}

// ===== 算数（小学5年生・新しく習う内容）=====
function genDecimalMul5() {
  const a = randInt(11, 99) / 10;
  const b = randInt(2, 9);
  const answer = Math.round(a * b * 10) / 10;
  return {
    text: `${a} × ${b} = ?`,
    answer: String(answer),
    type: "number",
    hint: "小数点が ないものとして かけ算し、あとで 小数点を もどそう",
    explain: `${a * 10} × ${b} ＝ ${a * 10 * b}。小数点を 1つ もどして ${answer}`,
  };
}

function genDecimalDiv5() {
  const b = randInt(2, 9);
  const q10 = randInt(11, 99);
  const q = q10 / 10;
  const a10 = q10 * b;
  const a = a10 / 10;
  return {
    text: `${a} ÷ ${b} = ?`,
    answer: String(q),
    type: "number",
    hint: "わられる数の 小数点の いちを そのまま 商に うつして 計算しよう",
    explain: `${a}を 10ばいすると ${a10}。${distributiveDivideExplain(a10, b, q10)}。10で わって もとに もどすと ${q}`,
  };
}

function genFractionAddDiff5() {
  const d1 = randInt(2, 9);
  let d2 = randInt(2, 12);
  while (d2 === d1) d2 = randInt(2, 12);
  const n1 = randInt(1, d1 - 1);
  const n2 = randInt(1, d2 - 1);
  const num = n1 * d2 + n2 * d1;
  const den = d1 * d2;
  const result = reduceFraction(num, den);
  return {
    text: `${n1}/${d1} ＋ ${n2}/${d2} = ？（やくぶんしてね）`,
    answer: fractionToText(result),
    type: "fraction",
    hint: "分母を そろえて（通分して）から たしざんしよう",
    explain: `通分すると ${n1 * d2}/${den} ＋ ${n2 * d1}/${den} ＝ ${num}/${den}。やくぶんして ${fractionToText(result)}`,
  };
}

function genAverage5() {
  const n = randInt(3, 5);
  const avg = randInt(4, 20);
  const values = [];
  let rest = avg * n;
  for (let i = 0; i < n - 1; i++) {
    const v = randInt(1, Math.min(avg * 2 - 1, rest - (n - 1 - i)));
    values.push(v);
    rest -= v;
  }
  values.push(rest);
  return {
    text: `${values.join("、")} の ${n}つの 数の 平均は いくつ？`,
    answer: String(avg),
    type: "number",
    hint: "平均 ＝ ぜんぶを たした数 ÷ 個数",
    explain: `ぜんぶ たすと ${values.reduce((x, y) => x + y, 0)}。${n}で わって ${avg}`,
  };
}

function genPercent5() {
  const base = pick([20, 25, 30, 40, 50, 60, 70, 80, 90, 100, 120, 150, 200, 250, 300, 400, 500]);
  const pct = pick([5, 10, 15, 20, 25, 30, 40, 50, 60, 70, 75, 80, 90]);
  const answer = Math.round(((base * pct) / 100) * 100) / 100;
  return {
    text: `${base} の ${pct}％ は いくつ？`,
    answer: String(answer),
    type: "number",
    hint: "◯％ は 100で わった わりあい。もとの数 × わりあい で もとまるよ",
    explain: `${pct}％ ＝ ${pct / 100}。${base} × ${pct / 100} ＝ ${answer}`,
  };
}

function genTriangleArea5() {
  const base = randInt(3, 30);
  const height = randInt(1, 15) * 2;
  return {
    text: `そこへんが ${base}cm、たかさが ${height}cm の 三角形の 面積は なんcm²？`,
    answer: String((base * height) / 2),
    type: "number",
    hint: "三角形の 面積 ＝ そこへん × たかさ ÷ 2",
    explain: `${base} × ${height} ÷ 2 ＝ ${(base * height) / 2}（cm²）`,
  };
}

const PER_UNIT_TEMPLATES = [
  { unit: "m", item: "リボン", per: "g", label: "おもさ" },
  { unit: "こ", item: "あめ", per: "円", label: "ねだん" },
  { unit: "L", item: "ペンキ", per: "㎡", label: "ぬれる面積" },
  { unit: "さつ", item: "ノート", per: "円", label: "ねだん" },
  { unit: "本", item: "えんぴつ", per: "円", label: "ねだん" },
];

function genWordPerUnit5() {
  const perUnit = randInt(3, 30);
  const units = randInt(3, 15);
  const total = perUnit * units;
  const t = pick(PER_UNIT_TEMPLATES);
  return {
    text: `${units}${t.unit}の ${t.item}の${t.label}は ${total}${t.per} です。1${t.unit}あたりの${t.label}は なん${t.per}？`,
    answer: String(perUnit),
    type: "number",
    hint: "1あたりの 大きさ ＝ ぜんたい ÷ いくつ分",
    explain: `${total} ÷ ${units} ＝ ${perUnit}（${t.per}）`,
  };
}

// --- 5年の文章題 ---
// genWordPerUnit5 / genWordSpeed の2つしかなく、5年の内容がセッションに乗りにくかった。
// 計算系（genPercent5・genAverage5 は式だけの問題）とは違い、場面から式を立てる形にする。

// 倍数・公倍数の文章題。式ではなく「いつ同時になるか」の場面で考える。
function genWordMultiple5() {
  const a = randInt(3, 12);
  let b = randInt(3, 12);
  if (b === a) b = a === 12 ? 3 : b + 1;
  const gcd = (x, y) => (y === 0 ? x : gcd(y, x % y));
  const lcm = (a * b) / gcd(a, b);
  const kind = pick(["bus", "light"]);
  return kind === "bus"
    ? {
        text: `駅から Aの バスは ${a}分ごと、Bの バスは ${b}分ごとに 出ます。2つが 同時に 出たあと、つぎに 同時に 出るのは なん分後？`,
        answer: String(lcm),
        type: "number",
        hint: `${a}と ${b}の 公倍数の うち、いちばん 小さい数（最小公倍数）を 見つけよう`,
        explain: `${a}の倍数と ${b}の倍数に 共通する いちばん小さい数は ${lcm}。だから ${lcm}分後`,
      }
    : {
        text: `たて ${a}cm、よこ ${b}cm の カードを すきまなく ならべて 正方形を つくります。いちばん 小さい 正方形の 1辺は なんcm？`,
        answer: String(lcm),
        type: "number",
        hint: `たてにも よこにも きっちり ならぶ長さ＝${a}と ${b}の 最小公倍数`,
        explain: `${a}と ${b}の 最小公倍数は ${lcm}。だから 1辺 ${lcm}cm`,
      };
}

// 約数・公約数の文章題。「あまりなく分ける」場面で考える。
function genWordDivisor5() {
  const gcdVal = randInt(3, 12);
  const m = randInt(2, 8);
  let n = randInt(2, 8);
  if (n === m) n = m === 8 ? 2 : n + 1;
  const a = gcdVal * m;
  const b = gcdVal * n;
  return {
    text: `あめが ${a}こ、クッキーが ${b}こ あります。どちらも あまりが 出ないように 同じ数ずつ 分けます。いちばん 多くて なん人に 分けられますか？`,
    answer: String(gcdVal),
    type: "number",
    hint: `${a}と ${b}の 両方を わりきれる数の うち、いちばん 大きい数（最大公約数）だよ`,
    explain: `${a}÷${gcdVal}＝${m}、${b}÷${gcdVal}＝${n} で どちらも わりきれる。${gcdVal}より大きい数では わりきれないので ${gcdVal}人`,
  };
}

// 割合（百分率）の文章題。genPercent5 は「◯の△％はいくつ」という式だけの問題なので、
// こちらは値引き・増量といった場面から立式させる。
function genWordPercent5() {
  const price = randInt(4, 30) * 100;
  const pct = pick([10, 15, 20, 25, 30, 40, 50]);
  const isDiscount = Math.random() < 0.6;
  const diff = (price * pct) / 100;
  return isDiscount
    ? {
        text: `定価 ${price}円の 品物が ${pct}％引きに なりました。ねだんは いくらに なりますか？`,
        answer: String(price - diff),
        type: "number",
        hint: `${pct}％引き ＝ 定価の (100－${pct})％ を はらうということ`,
        explain: `ひく分は ${price}×${pct / 100}＝${diff}円。${price}－${diff}＝${price - diff}円`,
      }
    : {
        text: `もとの ねだんが ${price}円の 品物が ${pct}％ ねあがりしました。いまの ねだんは いくら？`,
        answer: String(price + diff),
        type: "number",
        hint: `ふえる分は もとの ねだんの ${pct}％。それを もとの ねだんに たすよ`,
        explain: `ふえる分は ${price}×${pct / 100}＝${diff}円。${price}＋${diff}＝${price + diff}円`,
      };
}

// 平均の文章題。genAverage5 は数を並べて平均を出す式の問題なので、
// こちらは「あと何点とれば平均が◯になるか」という逆向きの場面にする。
function genWordAverage5() {
  const n = randInt(3, 5);
  const avgSoFar = randInt(60, 85);
  const targetAvg = avgSoFar + randInt(2, 8);
  const need = targetAvg * (n + 1) - avgSoFar * n;
  return {
    text: `テストを ${n}回 うけて、平均は ${avgSoFar}点でした。つぎの テストで なん点 とれば、${n + 1}回の 平均が ${targetAvg}点に なりますか？`,
    answer: String(need),
    type: "number",
    hint: `${n + 1}回ぶんの 合計が いくつ 必要か を 先に もとめよう`,
    explain: `いまの合計は ${avgSoFar}×${n}＝${avgSoFar * n}点。ほしい合計は ${targetAvg}×${n + 1}＝${targetAvg * (n + 1)}点。差の ${need}点が 必要`,
  };
}

// こみぐあい（単位量あたりの大きさ）。2つをくらべて どちらが混んでいるかを判断する。
function genWordDensity5() {
  // 「10m²に120人」のような非現実的な混みぐあいにならないよう、
  // 教科書と同じ「うさぎ小屋」の場面にして1m²あたりの数を小さく保つ
  const areaA = randInt(4, 12);
  const areaB = randInt(4, 12);
  const perA = randInt(2, 6);
  let perB = randInt(2, 6);
  if (perB === perA) perB = perA === 6 ? 2 : perB + 1;
  const totalA = areaA * perA;
  const totalB = areaB * perB;
  const denser = perA > perB ? "A" : "B";
  const dense = Math.max(perA, perB);
  return {
    text: `Aの うさぎ小屋は ${areaA}m²に ${totalA}ひき、Bの うさぎ小屋は ${areaB}m²に ${totalB}ひき います。こんでいる ほうの 小屋の 1m²あたりの 数は なんひき？`,
    answer: String(dense),
    type: "number",
    hint: "どちらも 1m²あたり なんひきか を もとめて くらべよう",
    explain: `Aは ${totalA}÷${areaA}＝${perA}ひき、Bは ${totalB}÷${areaB}＝${perB}ひき。こんでいるのは ${denser}で ${dense}ひき`,
  };
}

// ===== 算数（小学6年生・新しく習う内容）=====
// 参考: 6年生の新出単元は 分数のかけ算わり算／円の面積／角柱・円柱の体積／
// 比／比例・反比例／並べ方と組み合わせ方／速さ
function roundedText(n) {
  return (Math.round(n * 100) / 100).toString();
}

function genFractionMul6() {
  const b = randInt(2, 9);
  const d = randInt(2, 9);
  const a = randInt(1, b - 1);
  const c = randInt(1, d - 1);
  const rawNum = a * c, rawDen = b * d;
  const result = reduceFraction(rawNum, rawDen);
  return {
    text: `${a}/${b} × ${c}/${d} = ？（やくぶんしてね）`,
    answer: fractionToText(result),
    type: "fraction",
    hint: "分子どうし、分母どうしを かけてから やくぶんしよう",
    explain: `分子: ${a}×${c}＝${rawNum}、分母: ${b}×${d}＝${rawDen}。だから ${rawNum}/${rawDen}${reduceExplainSuffix(rawNum, rawDen, result)}`,
  };
}

function genFractionDiv6() {
  const d1 = randInt(2, 9);
  const d2 = randInt(2, 9);
  const n1 = randInt(1, d1 - 1);
  const n2 = randInt(1, d2 - 1);
  const rawNum = n1 * d2, rawDen = d1 * n2;
  const result = reduceFraction(rawNum, rawDen);
  return {
    text: `${n1}/${d1} ÷ ${n2}/${d2} = ？（やくぶんしてね）`,
    answer: fractionToText(result),
    type: "fraction",
    hint: "わる数の分数をひっくり返して、かけ算にしよう",
    explain: `${n2}/${d2} を ひっくり返すと ${d2}/${n2}。${n1}/${d1} × ${d2}/${n2} ＝ ${rawNum}/${rawDen}${reduceExplainSuffix(rawNum, rawDen, result)}`,
  };
}

function genCircleArea6() {
  const r = randInt(2, 40);
  const area = Math.round(r * r * 3.14 * 100) / 100;
  return {
    text: `半径 ${r}cm の円の面積は？（cm²、円周率は3.14）`,
    answer: `${area}`,
    type: "number",
    hint: "円の面積 ＝ 半径 × 半径 × 3.14 の公式を つかおう",
    explain: `${r} × ${r} × 3.14 ＝ ${area}`,
  };
}

function genVolume6() {
  const l = randInt(2, 12);
  const w = randInt(2, 12);
  const h = randInt(2, 12);
  return {
    text: `たて${w}cm、よこ${l}cm、たかさ${h}cm の 直方体の体積は？（cm³）`,
    answer: `${l * w * h}`,
    type: "number",
    hint: "直方体の体積 ＝ たて × よこ × たかさ の公式を つかおう",
    explain: `${w} × ${l} × ${h} ＝ ${l * w * h}`,
  };
}

function genRatio6() {
  const factor = randInt(2, 12);
  const sx = randInt(1, 12);
  const sy = randInt(1, 12);
  const g = gcd(sx, sy);
  const simpleX = sx / g;
  const simpleY = sy / g;
  const a = simpleX * factor;
  const b = simpleY * factor;
  return {
    text: `${a} : ${b} を いちばん かんたんな 比に すると？`,
    answer: `${simpleX}:${simpleY}`,
    accept: [`${simpleX}:${simpleY}`, `${simpleX}：${simpleY}`],
    type: "text",
    hint: "公約数で わって、これ以上われない形にしよう",
    explain: `${a}と${b}の 最大公約数は ${factor}。両方を それで わると ${simpleX}:${simpleY}`,
  };
}

function genWordSpeed() {
  const speed = randInt(2, 24) * 5;
  const hours = randInt(2, 9);
  const dist = speed * hours;
  const kind = pick(["distance", "time", "speed"]);
  if (kind === "time") {
    return {
      text: `時速 ${speed}kmで はしる 車が ${dist}km すすむのに かかる時間は なん時間？`,
      answer: `${hours}`,
      type: "number",
      hint: "時間 ＝ 道のり ÷ 速さ の公式を つかおう",
      explain: `${dist} ÷ ${speed} ＝ ${hours}（時間）`,
    };
  }
  if (kind === "speed") {
    return {
      text: `車が ${hours}時間で ${dist}km すすみました。時速は なんkm？`,
      answer: `${speed}`,
      type: "number",
      hint: "速さ ＝ 道のり ÷ 時間 の公式を つかおう",
      explain: `${dist} ÷ ${hours} ＝ ${speed}（km）`,
    };
  }
  return {
    text: `時速 ${speed}kmで はしる 車が ${hours}時間 はしると、なんkm すすむ？`,
    answer: `${dist}`,
    type: "number",
    hint: "道のり ＝ 速さ × 時間 の公式を つかおう",
    explain: `時速${speed}km × ${hours}時間 ＝ ${dist}km`,
  };
}

function genProportion6() {
  const k = randInt(2, 9);
  const x1 = randInt(1, 9);
  const y1 = k * x1;
  let x2 = randInt(1, 9);
  if (x2 === x1) x2 = x1 === 9 ? 1 : x1 + 1;
  const y2 = k * x2;
  return {
    text: `yはxに比例します。x＝${x1}のとき y＝${y1}です。x＝${x2}のとき yはいくつ？`,
    answer: `${y2}`,
    type: "number",
    hint: "比例の関係では、yはいつも「xに決まった数をかけた形」になっているよ",
    explain: `x＝${x1}のとき y＝${y1}だから、決まった数は ${y1}÷${x1}＝${k}。x＝${x2}のとき y ＝ ${x2} × ${k} ＝ ${y2}`,
  };
}

const COMBINATION_ITEM_POOL = ["あか", "あお", "きいろ", "みどり", "むらさき", "オレンジ", "ピンク", "みずいろ"];

function genCombination6() {
  const n = randInt(3, 5);
  const fact = Array.from({ length: n }, (_, i) => i + 1).reduce((p, c) => p * c, 1);
  const items = shuffle(COMBINATION_ITEM_POOL).slice(0, n);
  return {
    text: `${items.join("・")}の ${n}まいの カードを 横一列に ならべます。ならべ方は 何通り？`,
    answer: `${fact}`,
    type: "number",
    hint: `さいしょの1まいの えらび方は${n}通り、つぎは${n - 1}通り…と かけ算していこう`,
    explain: `${Array.from({ length: n }, (_, i) => n - i).join("×")}＝${fact}通り`,
  };
}

function genWordRatioSplit6() {
  const rx = randInt(1, 6);
  let ry = randInt(1, 6);
  if (ry === rx) ry = rx === 6 ? 1 : rx + 1;
  const totalUnits = rx + ry;
  const perUnit = randInt(2, 20);
  const total = totalUnits * perUnit;
  const answer = Math.max(rx, ry) * perUnit;
  return {
    text: `${total}円を ${rx}:${ry}の 比で 2人に わけます。おおい方は いくら？`,
    answer: `${answer}`,
    type: "number",
    hint: "比の合計にあわせて、全体をいくつ分にわけるか考えよう",
    explain: `比の合計は ${rx}＋${ry}＝${totalUnits}。${total}÷${totalUnits}＝${perUnit}円が1あたり。おおい方は ${Math.max(rx, ry)}×${perUnit}＝${answer}円`,
  };
}

// --- 6年の文章題 ---
// genProportion6（比例）/ genCombination6（並べ方）/ genWordRatioSplit6（比で分ける）の
// 3つしかなかったので追加する。計算系（genFractionMul6・genFractionDiv6・genCircleArea6）は
// 式だけの問題なので、こちらは場面から立式させる形にする。

// 分数のかけ算の文章題。「1mあたり」から「◯mぶん」を求める。
function genWordFractionMul6() {
  const gcd = (x, y) => (y === 0 ? x : gcd(y, x % y));
  const den = pick([2, 3, 4, 5, 6, 8]);
  let num = randInt(1, den - 1);
  // 6/8 のような約分できる分数を問題文に出さない（6年生は約分を習っている）
  while (gcd(num, den) !== 1) num = randInt(1, den - 1);
  // 答えが整数になる長さを選ぶ（分数どうしの計算は genFractionMul6 の担当）
  const len = den * randInt(1, 4);
  const answer = (num / den) * len;
  return {
    text: `1mの 重さが ${num}/${den}kg の ぼうが あります。この ぼう ${len}m の 重さは なんkg？`,
    answer: String(answer),
    type: "number",
    hint: "1mあたりの 重さ × 長さ で もとめられるよ",
    explain: `${num}/${den} × ${len} ＝ ${num}×${len}/${den} ＝ ${num * len}/${den} ＝ ${answer}（kg）`,
  };
}

// 組み合わせ。genCombination6 は「ならべ方（順列）」なので、こちらは
// 順番を区別しない「えらび方（組み合わせ）」にする。混同しやすい対比が練習になる。
function genWordCombinationPick6() {
  const n = randInt(4, 8);
  const answer = (n * (n - 1)) / 2;
  const kind = pick(["team", "handshake"]);
  return kind === "team"
    ? {
        text: `${n}つの チームが、どのチームとも 1回ずつ 試合を します。試合は ぜんぶで なん試合？`,
        answer: String(answer),
        type: "number",
        hint: `${n}チームから 2チームを えらぶ 組み合わせの 数だよ。順番は 区別しない`,
        explain: `${n}×(${n}－1)÷2 ＝ ${n}×${n - 1}÷2 ＝ ${answer}試合（AとBの試合は 1回と数える）`,
      }
    : {
        text: `${n}人が、おたがいに 1回ずつ あくしゅを します。あくしゅは ぜんぶで なん回？`,
        answer: String(answer),
        type: "number",
        hint: `${n}人から 2人を えらぶ 組み合わせの 数だよ`,
        explain: `${n}×(${n}－1)÷2 ＝ ${n}×${n - 1}÷2 ＝ ${answer}回`,
      };
}

// 反比例の文章題。genProportion6（比例）と対になる単元。
function genWordInverse6() {
  const total = pick([24, 36, 48, 60, 72, 120]);
  const divisors = [];
  for (let i = 2; i <= total / 2; i++) if (total % i === 0) divisors.push(i);
  const x1 = pick(divisors);
  let x2 = pick(divisors);
  if (x2 === x1) x2 = divisors[(divisors.indexOf(x1) + 1) % divisors.length];
  return {
    text: `面積が ${total}cm²の 長方形が あります。たての 長さが ${x1}cm の とき よこは ${total / x1}cm でした。たてを ${x2}cm に すると、よこは なんcm？`,
    answer: String(total / x2),
    type: "number",
    hint: "たて × よこ が いつも 同じ数（面積）に なる。これが 反比例の 関係だよ",
    explain: `たて×よこ＝${total} で いつも 同じ。${total}÷${x2}＝${total / x2}（cm）`,
  };
}

// 円の面積の文章題。genCircleArea6 は「半径◯cmの円の面積は？」という式だけの問題なので、
// こちらは半径が直接与えられない場面（直径から求める・まわりの長さから考える）にする。
function genWordCircle6() {
  const r = randInt(2, 20);
  const d = r * 2;
  const area = Math.round(r * r * 3.14 * 100) / 100;
  return {
    text: `直径 ${d}m の まるい 花だんが あります。この 花だんの 面積は なんm²？（円周率は3.14）`,
    answer: String(area),
    type: "number",
    hint: "先に 半径を もとめよう。半径 ＝ 直径 ÷ 2",
    explain: `半径は ${d}÷2＝${r}m。${r}×${r}×3.14＝${area}（m²）`,
  };
}

// 比の文章題。genWordRatioSplit6 は「全体を比で分ける」なので、
// こちらは「一方の量から もう一方を求める」形にする。
function genWordRatioFind6() {
  const rx = randInt(2, 8);
  let ry = randInt(2, 8);
  if (ry === rx) ry = rx === 8 ? 2 : ry + 1;
  const unit = randInt(2, 15);
  const known = rx * unit;
  const answer = ry * unit;
  return {
    text: `すと あぶらを ${rx}:${ry} の 比で まぜます。すを ${known}mL つかうとき、あぶらは なんmL？`,
    answer: String(answer),
    type: "number",
    hint: `すの ${rx} が ${known}mL なので、比の 1あたりが いくつかを もとめよう`,
    explain: `比の1あたりは ${known}÷${rx}＝${unit}mL。あぶらは ${ry}×${unit}＝${answer}mL`,
  };
}

// ===== 分野（カテゴリー）ごとの出題プール =====
// 生成器を「習う学年」で束ねる。設定学年以下をすべて使うので、
// 6年を選ぶと1〜6年の内容から出題される。
// 要素は「関数そのまま」か「{ fn, from }」のどちらでも書ける。
// from は年度の何ヶ月目から出すか（1〜12）。省略すると年度のはじめから出る。
// 時期でしぼるのは「いま設定している学年」で新しく習う内容だけで、
// 下の学年ぶんは去年までに習い終わっているので常に出る（mathGensFor 参照）。
//
// 1・2年の bunsho だけ先行導入。生成器が2〜3種類しかなく、10問中4問以上が
// 同じ型になるセッションが100%発生していたため（2026-08-07の日次チェック）。
const MATH_GENS_BY_GRADE = {
  1: {
    keisan: [genAdd1, genSub1],
    bunsho: [
      genWordAdd,                            // 増加（もらって ふえる）
      genWordAddCombine,                     // 合併（あわせて いくつ）
      { fn: genWordSub, from: 3 },           // 求残（たべて のこりは）
      { fn: genWordSubDiff1, from: 5 },      // 求差（ちがいは いくつ）
      { fn: genWordAddSub1, from: 9 },       // 3口（たして、ひく）
    ],
  },
  2: {
    keisan: [genAdd2, genSub2, genMul2],
    bunsho: [
      { fn: genWordCompare, from: 2 },       // 求大・求小（◯より△こ おおい/すくない）
      { fn: genWordLength2, from: 2 },       // 長さ（cm）のたし算・ひき算
      { fn: genWordMul, from: 6 },           // かけ算（1ふくろに◯こずつ）
      { fn: genWordMulArray2, from: 7 },     // かけ算（たて×よこ）
    ],
  },
  3: {
    keisan: [genAdd3, genSub3, genMul3, genDiv3, genDivRemainder3, genDecimal3, genFractionSame3],
    // genWordCompare は2年へ移した（3年でも下の学年ぶんとして引き続き出る）。
    // そのぶん3年じしんの文章題が genWordDiv だけになり、その1つに偏るので
    // あまりのあるわり算の文章題を足してある。
    bunsho: [genWordDiv, genWordDivRemainder3],
  },
  4: {
    keisan: [genDivLong4, genDecimalAddSub4, genRectArea4, genRounding4, genAngle4],
    // 4年の文章題は genWordUnit4 の1つだけで、その1つに全体の2/3が集中していた。
    // 新しく足したぶんは、学校で習うおおよその時期に合わせて解禁する。
    // 既存の genWordUnit4 は挙動を変えないよう解禁月なしのまま。
    bunsho: [
      genWordUnit4,                             // 単位換算（cm↔m）
      genWordBigNumber4,                        // 大きい数（万・億）。4年の1学期最初の単元
      { fn: genWordDivLarge4, from: 3 },        // 2けたでわるわり算（あまりの処理）
      { fn: genWordDecimalAmount4, from: 5 },   // 小数のかさ・重さ
      { fn: genWordAreaRoom4, from: 6 },        // 面積（m²）
      { fn: genWordEstimate4, from: 7 },        // がい数で見積もる
      { fn: genWordProportion4, from: 9 },      // 変わり方（かんたんな比例）
    ],
  },
  5: {
    // 体積と速さは5年で習う内容なので、ここに置く
    keisan: [genDecimalMul5, genDecimalDiv5, genFractionAddDiff5, genAverage5, genPercent5, genTriangleArea5, genVolume6],
    // 5年の文章題は2種類しかなく、5年の内容がセッションに乗りにくかったので拡充した。
    // 既存2つは挙動を変えないよう解禁月なしのまま。
    bunsho: [
      genWordPerUnit5,                          // 単位量あたり
      genWordSpeed,                             // 速さ
      { fn: genWordMultiple5, from: 4 },        // 倍数・公倍数
      { fn: genWordDivisor5, from: 4 },         // 約数・公約数
      { fn: genWordAverage5, from: 6 },         // 平均（何点とれば平均が◯になるか）
      { fn: genWordDensity5, from: 7 },         // こみぐあい（単位量あたり）
      { fn: genWordPercent5, from: 9 },         // 割合（値引き・値上がり）
    ],
  },
  6: {
    keisan: [genFractionMul6, genFractionDiv6, genCircleArea6, genRatio6],
    // 6年の文章題は3種類しかなかったので拡充した。既存3つは解禁月なしのまま。
    bunsho: [
      genProportion6,                           // 比例
      genCombination6,                          // 並べ方（順列）
      genWordRatioSplit6,                       // 比で分ける
      { fn: genWordFractionMul6, from: 3 },     // 分数のかけ算（1mあたりから）
      { fn: genWordCircle6, from: 5 },          // 円の面積（直径から）
      { fn: genWordRatioFind6, from: 6 },       // 比（一方から他方を求める）
      { fn: genWordInverse6, from: 8 },         // 反比例
      { fn: genWordCombinationPick6, from: 9 }, // 組み合わせ（えらび方）
    ],
  },
};

// MATH_GENS_BY_GRADE の要素を { fn, from } の形にそろえる
function normalizeMathGen(entry) {
  if (typeof entry === "function") return { fn: entry, from: 1 };
  return { fn: entry.fn, from: entry.from || 1 };
}

function mathGensFor(grade, category, schoolMonth) {
  const month = schoolMonth || currentSchoolMonth();
  const collect = (fromGrade, applyTimeGate) => {
    const gens = [];
    for (let g = fromGrade; g <= grade; g++) {
      const set = MATH_GENS_BY_GRADE[g];
      if (!set || !set[category]) continue;
      set[category].forEach((entry) => {
        const { fn, from } = normalizeMathGen(entry);
        // 下の学年ぶんは去年までに習い終わっているので、時期に関係なく出す。
        // 時期でしぼるのは、いまの学年で新しく習う内容だけ。
        if (applyTimeGate && g === grade && month < from) return;
        gens.push({ fn, grade: g });
      });
    }
    return gens;
  };

  const floor = gradeFloor(grade, category);
  const gated = collect(floor, true);
  if (gated.length > 0) return gated;
  // 各学年・各分野に from なしを必ず1つ置いてあるのでここには来ない想定だが、
  // 設定を足したときに出題不能になるのを防ぐため、時期を無視して埋める
  const ungated = collect(floor, false);
  return ungated.length > 0 ? ungated : collect(1, false);
}

// 1セッション内で同じ生成器（＝同じ型の問題）が続いたら、その生成器の重みを下げる。
//
// tieredWeights は「今の学年の内容を中心に出す」ため、今の学年のグループに
// 全体の 8/(8+4+2) を配分する。ところがその学年の生成器が1つしかないと、
// その1つに全体の2/3が集中し、10問中6〜7問が同じ型になってしまう。
// 学年の重みづけは保ったまま、同じ型の連続だけを抑える。
const SESSION_GEN_PENALTY = 0.4;

function generateMathProblem(grade, category, usedGenCounts) {
  const gens = mathGensFor(grade, category);
  let weights = tieredWeights(gens, grade);
  if (usedGenCounts) {
    weights = weights.map((w, i) => {
      const used = usedGenCounts.get(gens[i].fn.name) || 0;
      return used > 0 ? w * Math.pow(SESSION_GEN_PENALTY, used) : w;
    });
  }
  const chosen = weightedSample(gens, weights, 1)[0];
  const problem = chosen.fn();
  // どの生成器から出たかを覚えておく（セッション内の偏りを見るためだけに使う）
  problem.genName = chosen.fn.name;
  return problem;
}

// 国語のデータ本体は content-ja.js（JA_KANJI / JA_ANTONYM / JA_PROVERB / JA_IDIOM / JA_READING）。
// ここでは設定学年以下のものだけを取り出す。
function upTo(items, grade, category) {
  const all = items.filter((item) => item.grade <= grade);
  const floor = gradeFloor(grade, category);
  const withinSpan = all.filter((item) => item.grade >= floor);
  // 下限を当てると1セッション分に足りなくなる分野では、下限を外して従来どおりにする。
  // コンテンツを増やす前に「問題が出せない」状態になるのを防ぐための保険。
  return withinSpan.length >= SESSION_SIZE ? withinSpan : all;
}

// バンクの値は文字列でも配列でもよい。配列の先頭が代表の答え。
function answerList(value) {
  return Array.isArray(value) ? value : [value];
}

// ===== 最近出た問題を避ける（既視感を減らす） =====
// セッションをまたいで「昨日と同じ問題」が出るのを防ぐため、分野ごとに直近の出題履歴を覚えておく。
// 除外はせず重みを大きく下げるだけなので、プールが小さい分野でも10問は必ず埋まる。
const SEEN_HISTORY_LIMIT = 60;
const RECENCY_PENALTY = 0.03;

function historyKey(subject, category) {
  return pk(`seen_history_${subject}_${category}`);
}

function getRecentTexts(subject, category) {
  try {
    return JSON.parse(localStorage.getItem(historyKey(subject, category)) || "[]");
  } catch {
    return [];
  }
}

function recordSeenTexts(subject, category, texts) {
  const merged = getRecentTexts(subject, category).concat(texts);
  localStorage.setItem(historyKey(subject, category), JSON.stringify(merged.slice(-SEEN_HISTORY_LIMIT)));
  markSyncDirty();
}

// 設定学年に近い内容ほど多く出す。「学年」単位で出現の割合を決め、
// 同じ学年の中で問題を均等に分け合う（1問あたりの重みではなく、学年グループ単位の配分）。
// こうしないと、語数が多い学年（例：漢字の1・2年）が下の学年でも合計で重くなり、
// 復習のつもりが「よく出る」内容になってしまう。
// [同じ学年, 1つ下, 2つ下] の順。それより前は GRADE_TIER_OLDER にまとめて割り当てる。
const GRADE_TIER_SHARE = [8, 4, 2];
const GRADE_TIER_OLDER = 1;

// ===== 出題する学年の下限 =====
// 設定学年から2学年下まで（同学年・1つ下・2つ下の3学年分）に限定する。
// 重みを下げるだけでは低学年の内容が出る余地が残り、
// 6年生に1年生向けの問題が出てしまう。学習内容として合わないので範囲から外す。
const GRADE_SPAN = GRADE_TIER_SHARE.length;

// ことわざ（3年）・四字熟語（6年）は、学年ごとに分けず単一の学年にまとめたバンク。
// 「その学年から解禁される」という意味づけなので、下限を当てるとプールが空になる。
// この2分野だけは下限の対象外にする。
const SINGLE_GRADE_BANK_CATEGORIES = new Set(["kotowaza", "yojijukugo"]);

function gradeFloor(grade, category) {
  if (SINGLE_GRADE_BANK_CATEGORIES.has(category)) return 1;
  return Math.max(1, grade - (GRADE_SPAN - 1));
}

// items（各要素は grade を持つ）を、設定学年からの距離でグループ分けし、
// グループ全体の重みをそのグループの件数で均等に割った「1件あたりの重み」を返す。
function tieredWeights(items, selectedGrade, recentSet) {
  const tierOf = (itemGrade) => Math.min(selectedGrade - itemGrade, GRADE_TIER_SHARE.length);
  const countByTier = {};
  items.forEach((it) => {
    const tier = tierOf(it.grade ?? selectedGrade);
    countByTier[tier] = (countByTier[tier] || 0) + 1;
  });
  return items.map((it) => {
    const tier = tierOf(it.grade ?? selectedGrade);
    const tierShare = tier < GRADE_TIER_SHARE.length ? GRADE_TIER_SHARE[tier] : GRADE_TIER_OLDER;
    const weight = tierShare / countByTier[tier];
    return recentSet && recentSet.has(it.text) ? weight * RECENCY_PENALTY : weight;
  });
}

// 重みつきで、重複なく count 件選ぶ
function weightedSample(items, weights, count) {
  const pool = items.slice();
  const w = weights.slice();
  const picked = [];
  while (picked.length < count && pool.length) {
    const total = w.reduce((sum, x) => sum + x, 0);
    let roll = Math.random() * total;
    let idx = w.length - 1;
    for (let i = 0; i < w.length; i++) {
      if (roll < w[i]) { idx = i; break; }
      roll -= w[i];
    }
    const chosen = pool[idx];
    picked.push(chosen);
    // 表裏や日→英・英→日など、同じ元項目から作った問題は同じセッションで二度使わない（S2-3）
    for (let i = pool.length - 1; i >= 0; i--) {
      if (pool[i] === chosen || (chosen.pairKey !== undefined && pool[i].pairKey === chosen.pairKey)) {
        pool.splice(i, 1);
        w.splice(i, 1);
      }
    }
  }
  return picked;
}

// ===== 学年ラベル・ぶんや（カテゴリー）定義 =====
function gradeLabel(level) {
  return t(`grade.${level}`);
}

// name / desc は表示のたびに t() で引く（言語切り替えに追従させるため）
function category(id, emoji, nameKey, descKey) {
  return {
    id, emoji,
    get name() { return t(nameKey); },
    get desc() { return t(descKey); },
  };
}

// 分野は「その学年で出せる問題があるか」で決まる。
// 例: ことわざは3年から、四字熟語は6年から出る。
const CATEGORY_DEFS = {
  math: [
    { def: category("keisan", "➕", "cat.keisan", "cat.keisanDesc"), minGrade: 1 },
    { def: category("bunsho", "📝", "cat.bunshoMath", "cat.bunshoMathDesc"), minGrade: 1 },
  ],
  english: [
    { def: category("tango", "🔤", "cat.tango", "cat.tangoDesc"), minGrade: 3 },
    { def: category("kaiwa", "💬", "cat.kaiwa", "cat.kaiwaDesc"), minGrade: 3 },
  ],
  japanese: [
    { def: category("kanji", "🈶", "cat.kanji", "cat.kanjiDesc"), minGrade: 1 },
    { def: category("kotoba", "💬", "cat.kotoba", "cat.kotobaDesc"), minGrade: 1 },
    { def: category("kotowaza", "📜", "cat.kotowaza", "cat.kotowazaDesc"), minGrade: 3 },
    { def: category("yojijukugo", "🎴", "cat.yojijukugo", "cat.yojijukugoDesc"), minGrade: 6 },
    { def: category("bunsho", "📖", "cat.bunshoJa", "cat.bunshoJaDesc"), minGrade: 1 },
  ],
};

function categoriesFor(grade, subject) {
  return CATEGORY_DEFS[subject].filter((c) => grade >= c.minGrade).map((c) => c.def);
}

// idx は出題する語の位置。呼ぶたびにランダムに選ぶと同じ語が何度も出るため、
// 出題側が語を1つずつ指定する。まぎらわしい選択肢だけをランダムにする。
function buildChoiceProblemFromMeaningBank(bank, idx) {
  const { a: word, b: meaning, grade } = bank[idx];
  const distractors = shuffle(bank.filter((_, i) => i !== idx).map((x) => x.b)).slice(0, 3);
  return {
    grade,
    text: t("q.meaning", { word }),
    type: "choice",
    options: shuffle([meaning, ...distractors]),
    answer: meaning,
    hint: t("q.choiceHint"),
    explain: t("q.meaningExplain", { word, meaning }),
    pairKey: `meaning:${word}`,
  };
}

// 「この意味になることばはどれ？」の逆引き問題
function buildReverseMeaningProblem(bank, idx) {
  const { a: word, b: meaning, grade } = bank[idx];
  const distractors = shuffle(bank.filter((_, i) => i !== idx).map((x) => x.a)).slice(0, 3);
  return {
    grade,
    text: t("q.meaningReverse", { meaning }),
    type: "choice",
    options: shuffle([word, ...distractors]),
    answer: word,
    hint: t("q.choiceHint"),
    explain: t("q.meaningExplain", { word, meaning }),
    pairKey: `meaning:${word}`,
  };
}

// 英語（外国語）。単語は日→英・英→日の両方向、表現は空所補充。
function buildEnglishPool(grade, category) {
  const pool = [];

  if (category === "tango") {
    const bank = upTo(EN_WORDS, grade, category);
    bank.forEach((item, idx) => {
      const { word, ja } = item;
      const others = shuffle(bank.filter((_, i) => i !== idx));
      const enOptions = others.slice(0, 3).map((x) => x.word);
      const jaOptions = others.slice(0, 3).map((x) => x.ja);
      if (enOptions.length < 3) return;
      pool.push({
        grade: item.grade,
        text: t("q.enToJa", { word }),
        type: "choice",
        options: shuffle([ja, ...jaOptions]),
        answer: ja,
        hint: t("q.choiceHint"),
        explain: t("q.enExplain", { word, ja }),
        pairKey: `tango:${word}`,
      });
      pool.push({
        grade: item.grade,
        text: t("q.jaToEn", { ja }),
        type: "choice",
        options: shuffle([word, ...enOptions]),
        answer: word,
        hint: t("q.choiceHint"),
        explain: t("q.enExplain", { word, ja }),
        pairKey: `tango:${word}`,
      });
    });
  }

  if (category === "kaiwa") {
    upTo(EN_PHRASES, grade, category).forEach((item) => {
      pool.push({
        grade: item.grade,
        text: t("q.enPhrase", { sentence: item.text }),
        type: "choice",
        options: shuffle([...item.options]),
        answer: item.answer,
        hint: t("q.choiceHint"),
        explain: t("q.enPhraseExplain", { sentence: item.text.replace("___", item.answer), ja: item.ja }),
      });
    });
  }

  return pool;
}

// 読解のヒント。why の「」引用部分が本文のどのあたりにあるかだけを示し、
// 答えの中身には触れない（新規コンテンツを追加せず、既存の why/text から機械生成）。
function readingPositionHint(passage) {
  const text = passage.text;
  const why = passage.why || "";
  const match = why.match(/「([^」]+)」/);
  if (!match) return t("q.choiceHint");
  const parts = match[1].split("…").filter(Boolean);
  let pos = -1;
  for (const part of parts) {
    let idx = text.indexOf(part);
    let candidate = part;
    while (idx === -1 && candidate.length > 6) {
      candidate = candidate.slice(0, -1);
      idx = text.indexOf(candidate);
    }
    if (idx !== -1) { pos = idx; break; }
  }
  if (pos === -1) return t("q.choiceHint");
  const ratio = pos / text.length;
  const zone = ratio < 0.34 ? "前半" : ratio < 0.67 ? "中盤" : "後半";
  return t("q.readingPositionHint", { zone });
}

function buildJapanesePool(grade, category) {
  const pool = [];

  if (category === "kanji") {
    // 1語から「読み」と「意味に合う語を選ぶ」の2通りを作り、問題数を稼ぐ
    const bank = upTo(JA_KANJI, grade, category);
    bank.forEach((item) => {
      const word = item.a;
      const readings = answerList(item.b);
      const reading = readings[0];
      pool.push({
        grade: item.grade,
        text: t("q.kanjiRead", { kanji: word }),
        answer: reading,
        accept: readings,
        type: "text",
        hint: reading.length >= 3 ? t("q.kanjiReadHint", { first: reading[0] }) : t("q.shortAnswerHint"),
        explain: t("q.kanjiReadExplain", { kanji: word, reading: readings.join("・") }),
        pairKey: `kanji:${word}`,
      });
    });
    bank.forEach((item, idx) => {
      const word = item.a;
      const reading = answerList(item.b)[0];
      const others = shuffle(bank.filter((_, i) => i !== idx)).slice(0, 3).map((x) => x.a);
      if (others.length < 3) return;
      pool.push({
        grade: item.grade,
        text: t("q.kanjiWrite", { reading }),
        type: "choice",
        options: shuffle([word, ...others]),
        answer: word,
        hint: t("q.choiceHint"),
        explain: t("q.kanjiReadExplain", { kanji: word, reading }),
        pairKey: `kanji:${word}`,
      });
    });
  }

  if (category === "kotoba") {
    // 反対語は「AのはんたいはB」と「BのはんたいはA」の両方向を出す
    upTo(JA_ANTONYM, grade, category).forEach((item, idx) => {
      const left = answerList(item.a);
      const right = answerList(item.b);
      [[left, right], [right, left]].forEach(([fromList, toList]) => {
        pool.push({
          grade: item.grade,
          text: t("q.antonym", { word: fromList[0] }),
          answer: toList[0],
          accept: toList,
          type: "text",
          hint: toList[0].length >= 3 ? t("q.antonymHint", { first: toList[0][0] }) : t("q.shortAnswerHint"),
          explain: t("q.antonymExplain", { word: fromList[0], opposite: toList[0] }),
          pairKey: `antonym:${idx}`,
        });
      });
    });
  }

  if (category === "kotowaza") {
    const bank = upTo(JA_PROVERB, grade, category);
    bank.forEach((_, i) => pool.push(buildChoiceProblemFromMeaningBank(bank, i)));
    bank.forEach((_, i) => pool.push(buildReverseMeaningProblem(bank, i)));
  }

  if (category === "yojijukugo") {
    const bank = upTo(JA_IDIOM, grade, category);
    bank.forEach((_, i) => pool.push(buildChoiceProblemFromMeaningBank(bank, i)));
    bank.forEach((_, i) => pool.push(buildReverseMeaningProblem(bank, i)));
  }

  if (category === "bunsho") {
    upTo(JA_READING, grade, category).forEach((passage) => {
      pool.push({
        grade: passage.grade,
        text: t("q.reading", { passage: passage.text, question: passage.question }),
        type: "choice",
        options: shuffle(passage.options),
        answer: passage.answer,
        hint: readingPositionHint(passage),
        explain: t("q.readingExplain", { why: passage.why }),
        pairKey: `bunsho:${passage.text}`,
      });
    });
  }

  return pool;
}

// pool の各問題は grade を持つ。設定学年に近いものを優先し、直近に出たものは避けつつ選ぶ。
function pickSessionQuestions(pool, count, grade, recentSet) {
  if (pool.length === 0) return [];
  const weights = tieredWeights(pool, grade, recentSet);
  const result = weightedSample(pool, weights, Math.min(count, pool.length));
  // 種類が足りないぶんは重複を許して埋める
  while (result.length < count) result.push(...shuffle(pool).slice(0, count - result.length));
  const sliced = result.slice(0, count);
  sliced.forEach((q) => { q.isRepeat = recentSet ? recentSet.has(q.text) : false; });
  return sliced;
}

// 1セッション分の問題を作る。算数は毎回ランダム生成するため、
// そのままだと同じ問題が並ぶことがある。問題文で重複を除く。
function buildSessionProblems(grade, subject, category, count) {
  if (subject === "japanese" || subject === "english") {
    const pool = subject === "japanese" ? buildJapanesePool(grade, category) : buildEnglishPool(grade, category);
    const recentSet = new Set(getRecentTexts(subject, category));
    const result = pickSessionQuestions(pool, count, grade, recentSet);
    recordSeenTexts(subject, category, result.map((q) => q.text));
    return result;
  }

  const recentSet = new Set(getRecentTexts(subject, category));
  const seen = new Set();
  const result = [];
  // 同じ型の問題ばかりにならないよう、採用できた問題の生成器だけを数えて重みを下げる
  const usedGenCounts = new Map();
  const accept = (problem) => {
    usedGenCounts.set(problem.genName, (usedGenCounts.get(problem.genName) || 0) + 1);
    result.push(problem);
  };
  // 直近に出た問題は避けつつ生成する。生成器の出力の幅が狭い分野では
  // 除外条件で埋まりきらないことがあるため、まずは避けて集め、
  // 足りない分だけ「直近OK」に条件をゆるめて埋める。
  const maxTries = count * 60;
  for (let tries = 0; tries < maxTries && result.length < count; tries++) {
    const problem = generateMathProblem(grade, category, usedGenCounts);
    if (seen.has(problem.text) || recentSet.has(problem.text)) continue;
    seen.add(problem.text);
    problem.isRepeat = false;
    accept(problem);
  }
  for (let tries = 0; tries < maxTries && result.length < count; tries++) {
    const problem = generateMathProblem(grade, category, usedGenCounts);
    if (seen.has(problem.text)) continue;
    seen.add(problem.text);
    problem.isRepeat = recentSet.has(problem.text);
    accept(problem);
  }
  // それでも足りない分野では、最後だけ重複を許して埋める
  while (result.length < count) {
    const problem = generateMathProblem(grade, category, usedGenCounts);
    problem.isRepeat = recentSet.has(problem.text);
    accept(problem);
  }
  recordSeenTexts(subject, category, result.map((q) => q.text));
  return result;
}

// ===== 採点 =====
function checkAnswer(userInput, problem) {
  const trimmed = (userInput ?? "").toString().trim();
  if (trimmed === "") return false;

  if (problem.type === "fraction") {
    const userFrac = parseFractionInput(trimmed);
    const correctFrac = parseFractionInput(problem.answer);
    if (!userFrac || !correctFrac) return false;
    return userFrac.num === correctFrac.num && userFrac.den === correctFrac.den;
  }

  if (problem.type === "number") {
    const userNum = parseFloat(trimmed.replace(/[^\d.\-]/g, ""));
    const correctNum = parseFloat(problem.answer);
    if (!Number.isFinite(userNum)) return false;
    return Math.abs(userNum - correctNum) < 0.001;
  }

  // text または choice。余分なスペースは無視する。
  // problem.accept があれば、そのどれかに一致すれば正解にする
  // （漢字の複数の読み、漢字表記とひらがな表記、複数ある反対語などを取りこぼさないため）。
  const normalize = (str) => str.replace(/[\s　]/g, "");
  const accepted = problem.accept || [problem.answer];
  return accepted.some((a) => normalize(trimmed) === normalize(a));
}

// ===== 画面切り替え =====
const SCREEN_TO_TAB = {
  "screen-home": "home",
  "screen-settings": "settings",
  "screen-subject": "study",
  "screen-category": "study",
  "screen-start": "study",
  "screen-quiz": "study",
  "screen-result": "study",
  "screen-gacha": "gacha",
  "screen-collection": "collection",
};

function updateActiveTab(id) {
  const tab = SCREEN_TO_TAB[id];
  document.querySelectorAll("#tab-bar [data-tab]").forEach((btn) => {
    btn.classList.toggle("active", btn.dataset.tab === tab);
  });
}

function updateStatusBar() {
  const grade = getGrade();
  const info = getCompendiumInfo();
  document.getElementById("status-bar-grade").textContent = gradeLabel(grade);
  document.getElementById("status-bar-lv").textContent = `Lv.${info.count}`;
  document.getElementById("status-bar-points-value").textContent = getTotalStamps();
}

// プロフィールを選ぶ前は学年もポイントも決まらないので、
// ステータスバー・ガイド・タブバーはまとめて隠す
const PROFILE_SCREENS = ["screen-login", "screen-signup", "screen-profile-select", "screen-profile-create"];

function showScreen(id) {
  document.querySelectorAll(".screen").forEach((el) => el.classList.remove("active"));
  document.getElementById(id).classList.add("active");

  const chromeHidden = PROFILE_SCREENS.includes(id);
  document.getElementById("status-bar").classList.toggle("hidden", chromeHidden);
  document.querySelector(".guide-box").classList.toggle("hidden", chromeHidden);
  document.getElementById("tab-bar").classList.toggle("hidden", chromeHidden);

  updateActiveTab(id);
  if (!chromeHidden) updateStatusBar();
  updateBgmForScreen(id);
}

// ===== ホーム画面 =====
function refreshHeroDate() {
  const now = new Date();
  document.getElementById("hero-date").textContent = t("home.heroDate", {
    month: now.getMonth() + 1,
    day: now.getDate(),
    weekday: tList("weekdays")[now.getDay()],
  });
}

function refreshWeekChart() {
  const log = getDailyPoints();
  const days = [];
  for (let i = 6; i >= 0; i--) {
    const date = new Date();
    date.setDate(date.getDate() - i);
    days.push({ date, points: log[dayKey(date)] || 0 });
  }

  const max = Math.max(10, ...days.map((d) => d.points));
  document.getElementById("week-chart-total").textContent =
    `${days.reduce((sum, d) => sum + d.points, 0)}pt`;

  document.getElementById("week-chart").innerHTML = days
    .map((d, i) => {
      const height = Math.round((d.points / max) * 100);
      const todayClass = i === days.length - 1 ? " is-today" : "";
      return `<div class="week-bar-col${todayClass}">
        <div class="week-bar-track"><div class="week-bar-fill" style="height:${height}%"></div></div>
        <span class="week-bar-label">${tList("weekdays")[d.date.getDay()]}</span>
      </div>`;
    })
    .join("");
}

function refreshHome() {
  const info = getCompendiumInfo();
  document.getElementById("home-stamps").textContent = getTotalStamps();
  document.getElementById("home-rank-badge").innerHTML = `<div class="level-badge">Lv.${info.count}</div>`;
  document.getElementById("home-status-grade").textContent = gradeLabel(getGrade());
  document.getElementById("home-status-rank").textContent = info.title;
  refreshHeroDate();
  refreshWeekChart();
  setGuide("home");
}

function openSubjectScreen() {
  document.getElementById("subject-title").textContent = t("grade.course", { grade: gradeLabel(getGrade()) });

  // 英語は3年から。それ未満の学年では選べないことを示す
  const english = document.getElementById("subject-english");
  const enabled = categoriesFor(getGrade(), "english").length > 0;
  english.disabled = !enabled;
  english.classList.toggle("is-locked", !enabled);
  english.querySelector(".level-desc").textContent =
    enabled ? t("subject.englishDesc") : t("subject.englishLocked");
  setGuide("subject");
  showScreen("screen-subject");
}

document.getElementById("btn-start-study").addEventListener("click", () => {
  playClickSound();
  openSubjectScreen();
});

document.getElementById("btn-gacha-home").addEventListener("click", () => {
  playClickSound();
  openGachaScreen();
});

// ===== ガチャ画面 =====
function openGachaScreen() {
  document.getElementById("gacha-screen-title").textContent = t("gacha.title");
  document.getElementById("gacha-reveal-box").classList.add("hidden");
  document.getElementById("gacha-card-slot").innerHTML = "";
  document.getElementById("btn-skip-gacha").classList.add("hidden");
  skipGachaReveal = null;
  document.getElementById("gacha-levelup-box").classList.add("hidden");
  document.getElementById("gacha-insufficient-msg").classList.add("hidden");
  refreshGachaPointsDisplay();
  setGuide("start");
  showScreen("screen-gacha");
}

function refreshGachaPointsDisplay() {
  const points = getTotalStamps();
  document.getElementById("gacha-points-value").textContent = points;
  document.getElementById("btn-pull-gacha").disabled = points < GACHA_PULL_COST;

  // 「ぜんぶ あつめた」の判定は、いま引ける母集団を基準にする。
  // 無料プランでSR・URが残っていても、引けない以上は集めきったと言ってよい。
  const owned = getOwnedCards();
  const allDrawableOwned = drawableCardPool().every((c) => owned[c.id]);
  const remaining = allDrawableOwned ? null : Math.max(0, PITY_LIMIT - getPity());
  const hint = document.getElementById("gacha-pity-hint");
  if (remaining === null) hint.textContent = t("gacha.pityDone");
  else if (remaining === 0) hint.textContent = t("gacha.pityReady");
  else hint.textContent = t("gacha.pityHint", { n: remaining });

  updateStatusBar();
}

document.getElementById("btn-pull-gacha").addEventListener("click", () => {
  const points = getTotalStamps();
  if (points < GACHA_PULL_COST) {
    playWrongSound();
    document.getElementById("gacha-insufficient-msg").classList.remove("hidden");
    return;
  }
  document.getElementById("gacha-insufficient-msg").classList.add("hidden");
  spendStamps(GACHA_PULL_COST);
  refreshGachaPointsDisplay();

  const compendiumBefore = getCompendiumInfo();
  const gachaResult = drawGachaCard();
  lastGachaResult = gachaResult;
  document.getElementById("gacha-levelup-box").classList.add("hidden");

  playGachaRevealSequence(gachaResult, () => {
    const compendiumAfter = getCompendiumInfo();
    if (compendiumAfter.idx > compendiumBefore.idx) {
      document.getElementById("gacha-levelup-box").classList.remove("hidden");
      document.getElementById("gacha-levelup-emoji").innerHTML = `<div class="level-badge-large">Lv.${compendiumAfter.count}</div>`;
      document.getElementById("gacha-levelup-title").textContent = compendiumAfter.title;
      playLevelUpSound();
    }
    refreshHome();
  });
});

document.getElementById("btn-skip-gacha").addEventListener("click", () => {
  if (skipGachaReveal) skipGachaReveal();
});

// 演出中の画面をタップしてもスキップできる
document.getElementById("gacha-overlay-stage").addEventListener("click", () => {
  if (skipGachaReveal) skipGachaReveal();
});

document.getElementById("btn-close-gacha").addEventListener("click", () => {
  playClickSound();
  closeGachaOverlay(lastGachaResult);
});

function refreshSoundToggleLabel() {
  document.getElementById("btn-sound-toggle").textContent = isSoundEnabled() ? "🔊" : "🔇";
}

document.getElementById("btn-sound-toggle").addEventListener("click", () => {
  const enabled = !isSoundEnabled();
  setSoundEnabled(enabled);
  refreshSoundToggleLabel();
  if (enabled) {
    playClickSound();
    playBgm(currentBgmKey || "home", { restart: true });
  } else {
    stopAllBgm();
  }
});
refreshSoundToggleLabel();

// ===== せってい画面（学年） =====
function openSettingsScreen() {
  const list = document.getElementById("settings-grade-list");
  const current = getGrade();
  list.innerHTML = GRADES.map((g) => `
    <button type="button" class="grade-option${g === current ? " active" : ""}" data-grade="${g}">
      ${gradeLabel(g)}
      <span class="grade-option-range">${g === 1 ? t("settings.gradeRange1") : t("settings.gradeRange", { lo: gradeFloor(g), n: g })}</span>
    </button>
  `).join("");

  list.querySelectorAll(".grade-option").forEach((btn) => {
    btn.addEventListener("click", () => {
      playClickSound();
      setGrade(parseInt(btn.dataset.grade, 10));
      openSettingsScreen();
      updateStatusBar();
    });
  });

  renderYearStartSetting();

  const profile = getActiveProfile();
  document.getElementById("profile-current-line").textContent = profile
    ? t("profile.currentLine", { avatar: profile.avatar, name: profile.name })
    : "";

  showScreen("screen-settings");
}

// 年度の開始月。よく使う3つ（4月=日本、9月=米国・欧州、3月=韓国・南半球）を
// ボタンで、それ以外は12ヶ月から選べるようにする。
function renderYearStartSetting() {
  const box = document.getElementById("settings-year-start");
  if (!box) return;
  const current = getSchoolYearStart();

  const quick = SCHOOL_YEAR_START_QUICK.map((m) => `
    <button type="button" class="grade-option${m === current ? " active" : ""}" data-year-start="${m}">
      ${t("settings.yearStartMonth", { n: m })}
    </button>
  `).join("");

  const options = Array.from({ length: 12 }, (_, i) => i + 1)
    .map((m) => `<option value="${m}"${m === current ? " selected" : ""}>${t("settings.yearStartMonth", { n: m })}</option>`)
    .join("");

  box.innerHTML = `${quick}
    <label class="year-start-other">
      <span>${t("settings.yearStartOther")}</span>
      <select id="year-start-select">${options}</select>
    </label>`;

  box.querySelectorAll("[data-year-start]").forEach((btn) => {
    btn.addEventListener("click", () => {
      playClickSound();
      setSchoolYearStart(parseInt(btn.dataset.yearStart, 10));
      renderYearStartSetting();
    });
  });

  const select = document.getElementById("year-start-select");
  select.addEventListener("change", () => {
    setSchoolYearStart(parseInt(select.value, 10));
    renderYearStartSetting();
  });
}

// ===== プロフィール画面 =====
// state.profileMode が "manage" のときは、選ぶかわりに消す操作になる
function openProfileSelectScreen(mode) {
  state.profileMode = mode === "manage" ? "manage" : "select";
  const list = document.getElementById("profile-list");
  const profiles = getProfiles();

  list.innerHTML = profiles.map((p) => `
    <button type="button" class="profile-card" data-profile-id="${p.id}">
      <span class="profile-card-avatar">${p.avatar}</span>
      <span class="profile-card-name"></span>
      ${state.profileMode === "manage" ? `<span class="profile-card-delete">${t("profile.deleteBtn")}</span>` : ""}
    </button>
  `).join("") + (state.profileMode === "select" && profiles.length < profileLimit() ? `
    <button type="button" class="profile-card profile-card--new" id="btn-profile-new">
      <span class="profile-card-avatar">＋</span>
      <span class="profile-card-name">${t("profile.createNew")}</span>
    </button>
  ` : "");

  // 上限に達しているときは「＋」を出さず、なぜ増やせないかを書く
  const limitNote = document.getElementById("profile-limit-note");
  const atLimit = state.profileMode === "select" && profiles.length >= profileLimit();
  limitNote.textContent = atLimit && !isPaidPlan() ? t("profile.freeLimit", { n: PROFILE_MAX }) : "";
  limitNote.classList.toggle("hidden", !limitNote.textContent);

  // なまえはユーザー入力なので、HTMLに混ぜずtextContentで入れる
  list.querySelectorAll(".profile-card[data-profile-id]").forEach((btn) => {
    const profile = profiles.find((p) => p.id === btn.dataset.profileId);
    btn.querySelector(".profile-card-name").textContent = profile.name;
    btn.addEventListener("click", () => {
      playClickSound();
      if (state.profileMode === "manage") {
        requestProfileDelete(profile);
      } else {
        setActiveProfileId(profile.id);
        enterAppWithActiveProfile();
      }
    });
  });

  const newBtn = document.getElementById("btn-profile-new");
  if (newBtn) {
    newBtn.addEventListener("click", () => {
      playClickSound();
      if (getProfiles().length >= profileLimit()) return;
      openProfileCreateScreen();
    });
  }

  showScreen("screen-profile-select");
}

function requestProfileDelete(profile) {
  if (!window.confirm(t("profile.deleteConfirm", { name: profile.name }))) return;
  deleteProfile(profile.id);
  const remaining = getProfiles();
  if (remaining.length === 0) {
    openProfileCreateScreen();
  } else {
    if (!getActiveProfileId()) setActiveProfileId(remaining[0].id);
    openProfileSelectScreen("manage");
  }
}

function openProfileCreateScreen() {
  document.getElementById("profile-name-input").value = "";
  document.getElementById("profile-create-feedback").textContent = "";
  state.profileAvatar = PROFILE_AVATARS[0];

  const picker = document.getElementById("profile-avatar-picker");
  picker.innerHTML = PROFILE_AVATARS.map((a, i) => `
    <button type="button" class="profile-avatar-option${i === 0 ? " active" : ""}" data-avatar="${a}">${a}</button>
  `).join("");
  picker.querySelectorAll(".profile-avatar-option").forEach((btn) => {
    btn.addEventListener("click", () => {
      playClickSound();
      state.profileAvatar = btn.dataset.avatar;
      picker.querySelectorAll(".profile-avatar-option").forEach((b) => b.classList.remove("active"));
      btn.classList.add("active");
    });
  });

  // プロフィールが1つも無いとき（初回起動）は戻る先がないので隠す
  document.getElementById("btn-profile-create-cancel").classList.toggle("hidden", getProfiles().length === 0);
  showScreen("screen-profile-create");
}

document.getElementById("btn-profile-create-ok").addEventListener("click", () => {
  playClickSound();
  const name = document.getElementById("profile-name-input").value.trim();
  if (!name) {
    document.getElementById("profile-create-feedback").textContent = t("profile.nameRequired");
    document.getElementById("profile-create-feedback").className = "backup-feedback error";
    return;
  }
  const profile = createProfile(name, state.profileAvatar);
  if (!profile) {
    document.getElementById("profile-create-feedback").textContent = isPaidPlan()
      ? t("profile.full", { n: PROFILE_MAX })
      : t("profile.freeLimit", { n: PROFILE_MAX });
    document.getElementById("profile-create-feedback").className = "backup-feedback error";
    return;
  }
  setActiveProfileId(profile.id);
  enterAppWithActiveProfile();
});

document.getElementById("btn-profile-create-cancel").addEventListener("click", () => {
  playClickSound();
  openProfileSelectScreen("select");
});

document.getElementById("btn-profile-switch").addEventListener("click", () => {
  playClickSound();
  openProfileSelectScreen("select");
});

document.getElementById("btn-profile-manage").addEventListener("click", () => {
  playClickSound();
  openProfileSelectScreen("manage");
});

// プロフィールが決まった状態でアプリ本体に入る。
// 学年・ポイント・カードはプロフィールごとに違うので、表示を作り直してから入る。
// ログイン済みの場合はバックグラウンドでサーバからプルし、完了後にUIを再描画する（ローカルファースト）。
function enterAppWithActiveProfile() {
  refreshHome();
  updateStatusBar();
  showScreen("screen-home");
  if (fbCurrentUser && getActiveProfileId()) {
    pullProfileFromFirestore(getActiveProfileId()).then(() => {
      refreshHome();
      updateStatusBar();
    }).catch(() => {});
  }
}

// ===== バックアップ（書き出し・読み込み） =====
// アカウント基盤ができるまでのつなぎ。端末が変わる／データが消えるリスクに備えて、
// localStorage の中身を丸ごとJSONファイルに書き出し・読み込みできるようにする。
const BACKUP_APP_ID = "manabimeguru";
const BACKUP_FORMAT_VERSION = 1;

function collectBackupData() {
  const data = {};
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    data[key] = localStorage.getItem(key);
  }
  return data;
}

// 書き出しは localStorage を丸ごと入れているので、全プロフィールぶんが入っている。
// 読み込み前の確認文も、全プロフィールを横断して要約する。
function backupSummaryFromData(data) {
  let profiles = [];
  try {
    const parsed = JSON.parse(data[PROFILES_KEY] || "[]");
    if (Array.isArray(parsed)) profiles = parsed.filter((p) => p && p.id);
  } catch {
    profiles = [];
  }

  // プロフィール制より前に書き出したファイルは、接頭辞なしのキーが1人ぶんとして入っている
  const prefixes = profiles.length > 0 ? profiles.map((p) => `${p.id}:`) : [""];

  const cardIds = new Set();
  let points = 0;
  prefixes.forEach((prefix) => {
    try {
      Object.keys(JSON.parse(data[`${prefix}${GACHA_KEY}`] || "{}")).forEach((id) => cardIds.add(id));
    } catch {
      // 壊れたデータは無視して集計を続ける
    }
    points += parseInt(data[`${prefix}${STORAGE_KEY}`] || "0", 10) || 0;
  });

  return { profiles: Math.max(1, profiles.length), cards: cardIds.size, points };
}

function setBackupFeedback(text, cls) {
  const el = document.getElementById("backup-feedback");
  el.textContent = text;
  el.className = `backup-feedback${cls ? ` ${cls}` : ""}`;
}

function backupFilename() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, "0");
  return `manabimeguru-backup-${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}.json`;
}

async function exportBackup() {
  const payload = {
    app: BACKUP_APP_ID,
    formatVersion: BACKUP_FORMAT_VERSION,
    exportedAt: new Date().toISOString(),
    data: collectBackupData(),
  };
  const filename = backupFilename();
  const file = new File([JSON.stringify(payload, null, 2)], filename, { type: "application/json" });

  // iPadなど共有シートが使える端末では、AirDrop・メール等にそのまま渡せる方が扱いやすい
  if (navigator.canShare && navigator.canShare({ files: [file] })) {
    try {
      await navigator.share({ files: [file], title: filename });
      setBackupFeedback(t("settings.backupExportOk"), "ok");
      return;
    } catch (err) {
      if (err.name === "AbortError") return; // 共有をキャンセルしただけなので何もしない
      // それ以外のエラーはダウンロード方式にフォールバック
    }
  }

  try {
    const url = URL.createObjectURL(file);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
    setBackupFeedback(t("settings.backupExportOk"), "ok");
  } catch (err) {
    setBackupFeedback(t("settings.backupExportFailed"), "error");
  }
}

document.getElementById("btn-backup-export").addEventListener("click", () => {
  playClickSound();
  exportBackup();
});

let pendingBackupData = null;

document.getElementById("btn-backup-import").addEventListener("click", () => {
  playClickSound();
  document.getElementById("backup-file-input").click();
});

document.getElementById("backup-file-input").addEventListener("change", async (e) => {
  const file = e.target.files && e.target.files[0];
  e.target.value = ""; // 同じファイルを選び直しても change が発火するようにリセットしておく
  if (!file) return;

  try {
    const parsed = JSON.parse(await file.text());
    if (parsed.app !== BACKUP_APP_ID || typeof parsed.data !== "object" || !parsed.data) {
      throw new Error("invalid backup file");
    }
    pendingBackupData = parsed.data;
    document.getElementById("backup-confirm-text").textContent =
      t("settings.backupImportConfirm", backupSummaryFromData(parsed.data));
    document.getElementById("backup-confirm-box").classList.remove("hidden");
    setBackupFeedback("", "");
  } catch (err) {
    pendingBackupData = null;
    setBackupFeedback(t("settings.backupImportInvalid"), "error");
  }
});

document.getElementById("btn-backup-confirm-no").addEventListener("click", () => {
  playClickSound();
  pendingBackupData = null;
  document.getElementById("backup-confirm-box").classList.add("hidden");
});

document.getElementById("btn-backup-confirm-yes").addEventListener("click", () => {
  playClickSound();
  if (!pendingBackupData) return;
  try {
    localStorage.clear();
    Object.entries(pendingBackupData).forEach(([key, value]) => localStorage.setItem(key, value));
    document.getElementById("backup-confirm-box").classList.add("hidden");
    setBackupFeedback(t("settings.backupImportOk"), "ok");
    setTimeout(() => location.reload(), 600);
  } catch (err) {
    setBackupFeedback(t("settings.backupImportFailed"), "error");
  }
  pendingBackupData = null;
});

// ===== 科目選択 =====
document.querySelectorAll(".level-card[data-subject]").forEach((btn) => {
  btn.addEventListener("click", () => {
    playClickSound();
    state.subject = btn.dataset.subject;
    openCategoryScreen();
  });
});

// ===== ぶんや選択画面 =====
function openCategoryScreen() {
  const subjectLabel = t(`subject.${state.subject}`);
  document.getElementById("category-title").textContent = t("cat.titleFor", { grade: gradeLabel(getGrade()), subject: subjectLabel });

  const list = document.getElementById("category-list");
  list.innerHTML = "";
  categoriesFor(getGrade(), state.subject).forEach((cat) => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "category-card";
    btn.innerHTML = `
      <div class="emoji">${cat.emoji}</div>
      <div>
        <div class="category-name">${cat.name}</div>
        <div class="category-desc">${cat.desc}</div>
      </div>
    `;
    btn.addEventListener("click", () => {
      playClickSound();
      state.category = cat.id;
      openStartScreen();
    });
    list.appendChild(btn);
  });

  showScreen("screen-category");
}

document.getElementById("btn-back-category").addEventListener("click", () => {
  showScreen("screen-subject");
});

// ===== スタート画面 =====
function openStartScreen() {
  const subjectLabel = t(`subject.${state.subject}`);
  const categoryInfo = categoriesFor(getGrade(), state.subject).find((c) => c.id === state.category);
  const emojiPrefix = getGrade() <= 3 ? "🐣" : "🦉";
  document.getElementById("start-title").textContent =
    `${emojiPrefix} ${gradeLabel(getGrade())} - ${subjectLabel} - ${categoryInfo.name}`;
  renderStampCard();
  renderCharacterBox();
  setGuide("start");
  showScreen("screen-start");
}

function renderStampCard() {
  const total = getTotalStamps();
  const inRow = total % 10;
  const badges = Math.floor(total / 10);
  const card = document.getElementById("stamp-card");
  card.innerHTML = "";
  for (let i = 0; i < 10; i++) {
    const slot = document.createElement("div");
    slot.className = "stamp-slot" + (i < inRow ? " filled" : "");
    slot.textContent = i < inRow ? "⭐" : "";
    card.appendChild(slot);
  }
  document.getElementById("badge-line").textContent = t("quiz.badges", { n: badges });
}

function renderCharacterBox() {
  const info = getCompendiumInfo();
  document.getElementById("start-char-emoji").innerHTML = `<div class="level-badge-large">Lv.${info.count}</div>`;
  document.getElementById("start-char-title").textContent = info.title;

  const bar = document.getElementById("start-char-progress");
  const label = document.getElementById("start-char-progress-label");
  if (info.next) {
    const progress = Math.min(100, Math.round(((info.count - info.tierMin) / (info.next.min - info.tierMin)) * 100));
    bar.style.width = `${progress}%`;
    label.textContent = t("rank.nextIn", { n: info.next.min - info.count });
  } else {
    bar.style.width = "100%";
    label.textContent = t("rank.max");
  }
}

document.getElementById("btn-begin").addEventListener("click", startSession);
document.getElementById("btn-back-home-1").addEventListener("click", () => {
  openCategoryScreen();
});

// ===== クイズ画面 =====
function startSession() {
  state.problems = buildSessionProblems(getGrade(), state.subject, state.category, SESSION_SIZE);
  state.index = 0;
  state.correctCount = 0;
  state.sessionStamps = 0;
  state.sessionStampsExact = 0;
  state.stampsBeforeSession = getTotalStamps();
  renderProblem();
  showScreen("screen-quiz");
}

function renderProblem() {
  const p = state.problems[state.index];
  document.getElementById("quiz-progress").textContent = t("quiz.progress", { current: state.index + 1, total: state.problems.length });
  document.getElementById("quiz-stamps").textContent = t("quiz.stamps", { n: state.sessionStamps });

  const problemTextEl = document.getElementById("problem-text");
  problemTextEl.textContent = p.text;
  problemTextEl.classList.toggle("long-text", p.text.length > 40);

  const badgeEl = document.getElementById("problem-badge");
  badgeEl.textContent = p.isRepeat ? t("quiz.badgeRepeat") : t("quiz.badgeNew");
  badgeEl.classList.toggle("is-repeat", !!p.isRepeat);

  document.getElementById("feedback").textContent = "";
  document.getElementById("feedback").className = "feedback";
  document.getElementById("btn-next").classList.add("hidden");

  document.getElementById("hint-box").classList.add("hidden");
  document.getElementById("hint-box").textContent = "";
  document.getElementById("btn-hint").disabled = false;
  document.getElementById("explain-box").classList.add("hidden");
  document.getElementById("explain-box").textContent = "";

  const form = document.getElementById("answer-form");
  const choiceBox = document.getElementById("choice-buttons");

  if (p.type === "choice") {
    form.classList.add("hidden");
    choiceBox.classList.remove("hidden");
    choiceBox.innerHTML = "";
    p.options.forEach((opt) => {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "choice-btn";
      btn.textContent = opt;
      btn.addEventListener("click", () => handleChoiceAnswer(btn, p));
      choiceBox.appendChild(btn);
    });
  } else {
    form.classList.remove("hidden");
    choiceBox.classList.add("hidden");
    document.getElementById("answer-input").value = "";
    document.getElementById("answer-input").disabled = false;
    form.querySelector("button").disabled = false;
    document.getElementById("answer-input").focus();
  }
}

function applyAnswerResult(isCorrect, feedbackWrongText, problem) {
  const feedback = document.getElementById("feedback");
  document.getElementById("btn-hint").disabled = true;

  if (isCorrect) {
    playCorrectSound();
    state.correctCount++;
    const gained = problem && problem.isRepeat ? REPEAT_STAMP_RATIO : 1;
    state.sessionStampsExact += gained;
    state.sessionStamps = Math.round(state.sessionStampsExact);
    feedback.textContent = pick(tList("guide.correct"));
    feedback.className = "feedback correct";
    if (problem && problem.isRepeat) {
      feedback.textContent += " " + t("quiz.repeatNote");
    }
    setGuide("correct");
  } else {
    playWrongSound();
    feedback.textContent = feedbackWrongText;
    feedback.className = "feedback wrong";
    setGuide("wrong");

    if (problem && problem.explain) {
      const explainBox = document.getElementById("explain-box");
      explainBox.textContent = t("quiz.explainPrefix", { text: problem.explain });
      explainBox.classList.remove("hidden");
    }
  }
  document.getElementById("quiz-stamps").textContent = t("quiz.stamps", { n: state.sessionStamps });

  const isLast = state.index === state.problems.length - 1;
  const nextBtn = document.getElementById("btn-next");
  nextBtn.textContent = isLast ? t("quiz.seeResult") : t("quiz.next");
  nextBtn.classList.remove("hidden");
}

document.getElementById("answer-form").addEventListener("submit", (e) => {
  e.preventDefault();
  const input = document.getElementById("answer-input");
  const p = state.problems[state.index];
  const isCorrect = checkAnswer(input.value, p);

  input.disabled = true;
  e.target.querySelector("button").disabled = true;
  applyAnswerResult(isCorrect, t("quiz.wrongText", { answer: p.answer }), p);
});

function handleChoiceAnswer(clickedBtn, problem) {
  const choiceBox = document.getElementById("choice-buttons");
  const buttons = Array.from(choiceBox.querySelectorAll(".choice-btn"));
  const isCorrect = clickedBtn.textContent === problem.answer;

  buttons.forEach((btn) => {
    btn.disabled = true;
    if (btn.textContent === problem.answer) btn.classList.add("correct");
    else if (btn === clickedBtn) btn.classList.add("wrong");
  });

  applyAnswerResult(isCorrect, t("quiz.wrongChoice", { answer: problem.answer }), problem);
}

document.getElementById("btn-hint").addEventListener("click", () => {
  playClickSound();
  const p = state.problems[state.index];
  const hintBox = document.getElementById("hint-box");

  if (p.type === "choice") {
    const wrongButtons = Array.from(document.querySelectorAll(".choice-btn:not(:disabled)"))
      .filter((btn) => btn.textContent !== p.answer);
    if (wrongButtons.length > 0) {
      const toEliminate = pick(wrongButtons);
      toEliminate.disabled = true;
      toEliminate.classList.add("eliminated");
    }
  }

  hintBox.textContent = t("quiz.hintPrefix", { text: p.hint || t("quiz.hintFallback") });
  hintBox.classList.remove("hidden");
  document.getElementById("btn-hint").disabled = true;
});

document.getElementById("btn-next").addEventListener("click", () => {
  state.index++;
  if (state.index >= state.problems.length) {
    finishSession();
  } else {
    renderProblem();
  }
});

// ===== 結果画面 =====
function finishSession() {
  const totalAfter = addStamps(state.sessionStamps);
  recordDailyPoints(state.sessionStamps);

  document.getElementById("result-score").textContent =
    t("result.score", { correct: state.correctCount, total: state.problems.length });
  const rate = Math.round((state.correctCount / state.problems.length) * 100);
  document.getElementById("result-rate").textContent = t("result.rate", { rate });
  document.getElementById("stamp-anim").textContent = "⭐".repeat(state.sessionStamps);
  document.getElementById("points-earned-line").textContent =
    `🎰 ガチャポイント ＋${state.sessionStamps}pt（るいけい ${totalAfter}pt）`;

  if (rate >= 80) setGuide("resultHigh");
  else if (rate >= 50) setGuide("resultMid");
  else setGuide("resultLow");

  state.lastResult = {
    grade: getGrade(),
    subject: state.subject,
    correctCount: state.correctCount,
    total: state.problems.length,
    rate,
    sessionStamps: state.sessionStamps,
    totalStampsAfter: totalAfter,
  };
  document.getElementById("result-action-feedback").textContent = "";
  document.getElementById("result-action-feedback").className = "action-feedback";
  document.getElementById("manual-copy-box").classList.add("hidden");

  showScreen("screen-result");
}

function buildResultSummary(r) {
  const grade = gradeLabel(r.level);
  const subjectLabel = t(`subject.${r.subject}`);
  const date = new Date().toLocaleDateString(t("locale.dateFormat"), {
    year: "numeric", month: "long", day: "numeric",
  });

  const bodyLines = [
    t("summary.intro", { date }),
    "",
    t("summary.course", { grade, subject: subjectLabel }),
    t("summary.result", { total: r.total, correct: r.correctCount, rate: r.rate }),
    t("summary.earned", { pt: r.sessionStamps }),
    t("summary.total", { grade, total: r.totalStampsAfter }),
  ];

  return { subject: t("summary.subject", { date }), body: bodyLines.join("\n") };
}

document.getElementById("btn-share-result").addEventListener("click", shareResult);

async function shareResult() {
  const feedback = document.getElementById("result-action-feedback");
  const copyBox = document.getElementById("manual-copy-box");
  copyBox.classList.add("hidden");

  const { subject, body } = buildResultSummary(state.lastResult);
  const fullText = `${subject}\n\n${body}`;

  if (navigator.share) {
    try {
      await navigator.share({ title: subject, text: body });
      feedback.textContent = t("share.done");
      feedback.className = "action-feedback ok";
    } catch (err) {
      if (err.name !== "AbortError") {
        feedback.textContent = t("share.failed");
        feedback.className = "action-feedback error";
      }
    }
    return;
  }

  if (navigator.clipboard && navigator.clipboard.writeText) {
    try {
      await navigator.clipboard.writeText(fullText);
      feedback.textContent = t("share.copied");
      feedback.className = "action-feedback ok";
      return;
    } catch (err) {
      // クリップボードが使えない場合は手動コピー欄を表示
    }
  }

  document.getElementById("manual-copy-text").value = fullText;
  copyBox.classList.remove("hidden");
  feedback.textContent = t("share.copyPrompt");
  feedback.className = "action-feedback ok";
  document.getElementById("manual-copy-text").select();
}

document.getElementById("btn-retry").addEventListener("click", startSession);

// ===== 下部タブナビゲーション =====
document.querySelectorAll("#tab-bar [data-tab]").forEach((btn) => {
  btn.addEventListener("click", () => {
    playClickSound();
    const tab = btn.dataset.tab;
    if (tab === "home") {
      refreshHome();
      showScreen("screen-home");
    } else if (tab === "study") {
      openSubjectScreen();
    } else if (tab === "gacha") {
      openGachaScreen();
    } else if (tab === "collection") {
      openCollectionScreen("screen-home", "self");
    } else if (tab === "settings") {
      openSettingsScreen();
    }
  });
});

// ===== 初期化 =====
document.documentElement.lang = getLocale();
document.title = t("home.title");
applyTranslations();
// 文言（t）を使うので、翻訳を読み込んだあとに移行する
migrateLegacyDataIfNeeded();
// 改行を含むためテキスト代入ではなく <br> に変換して入れる
document.getElementById("hero-title").innerHTML = t("home.heroGreeting")
  .split("\n")
  .map((line) => line.replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c])))
  .join("<br>");
document.getElementById("guide-character").innerHTML = renderGuideCharacterHTML();
document.getElementById("status-bar-avatar").innerHTML = renderGuideFaceHTML("creature-slot--mini");

// 起動時にどの画面から始めるかを決める。
// 0人 → 作成画面、1人 → そのまま入る（毎回選ばせない）、2人以上 → だれがあそぶ？
function startInitialScreen() {
  const profiles = getProfiles();
  if (profiles.length === 0) {
    openProfileCreateScreen();
    return;
  }
  if (profiles.length === 1) {
    setActiveProfileId(profiles[0].id);
    enterAppWithActiveProfile();
    return;
  }
  if (!getProfiles().some((p) => p.id === getActiveProfileId())) {
    localStorage.removeItem(ACTIVE_PROFILE_KEY);
  }
  openProfileSelectScreen("select");
}
// startInitialScreen() はここでは直接呼ばない。
// Firebase の onAuthStateChanged（下の Firebase セクション）がログイン状態を確認してから呼ぶ。

// ===== オープニング =====
// タップ／タッチするまで消えない。自動では消さず、しっかり見てもらう。

function dismissSplash() {
  const splash = document.getElementById("splash");
  if (!splash || splash.classList.contains("is-leaving")) return;
  splash.classList.add("is-leaving");
  setTimeout(() => splash.classList.add("is-gone"), 600);
}

document.getElementById("splash").addEventListener("click", () => {
  unlockAudioOnFirstGesture();
  dismissSplash();
});

// ===== Firebase認証・同期 =====
// account-design.md §3・§4・§7・§10-6 段階1の実装。
// 認証はメール/パスワードのみ。同期はローカルファーストで、localStorageへの書き込みは
// 同期のまま維持し、Firestoreへはバックグラウンドでまとめてプッシュする（ダーティフラグ＋デバウンス）。

// ------- seenHistoryのlocalStorage↔Firestoreシリアライズ -------

function collectSeenHistory(profileId) {
  const result = {};
  const prefix = `${profileId}:seen_history_`;
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    if (key && key.startsWith(prefix)) {
      const subKey = key.slice(prefix.length);
      try { result[subKey] = JSON.parse(localStorage.getItem(key) || "[]"); } catch {}
    }
  }
  return result;
}

function applySeenHistory(profileId, seenHistory) {
  if (!seenHistory || typeof seenHistory !== "object") return;
  const prefix = `${profileId}:seen_history_`;
  Object.entries(seenHistory).forEach(([subKey, texts]) => {
    if (Array.isArray(texts)) {
      localStorage.setItem(prefix + subKey, JSON.stringify(texts));
    }
  });
}

// ------- プッシュ -------

// localStorageの現在の進捗をFirestore書き込み用オブジェクトに変換する
function buildProgressDoc(profileId) {
  const r = (key) => localStorage.getItem(`${profileId}:${key}`);
  return {
    stampsTotal: parseInt(r(STORAGE_KEY) || "0", 10) || 0,
    ownedCards: (function () { try { return JSON.parse(r(GACHA_KEY) || "{}"); } catch { return {}; } })(),
    pity: parseInt(r(PITY_KEY) || "0", 10) || 0,
    dailyPoints: (function () { try { return JSON.parse(r(DAILY_POINTS_KEY) || "{}"); } catch { return {}; } })(),
    seenHistory: collectSeenHistory(profileId),
    grade: parseInt(r(GRADE_KEY) || String(DEFAULT_GRADE), 10) || DEFAULT_GRADE,
    schoolYearStart: parseInt(r(SCHOOL_YEAR_START_KEY) || "", 10) || defaultSchoolYearStart(),
    updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
  };
}

async function pushProfileToFirestore(profileId) {
  if (!fbCurrentUser || !profileId) return;
  const uid = fbCurrentUser.uid;
  const profile = getProfiles().find((p) => p.id === profileId);
  if (!profile) return;

  const progressDoc = buildProgressDoc(profileId);
  const profileRef = fbDb.collection("households").doc(uid).collection("profiles").doc(profileId);

  try {
    const batch = fbDb.batch();
    batch.set(profileRef, {
      name: profile.name,
      avatar: profile.avatar,
      createdAt: profile.createdAt || new Date().toISOString(),
    }, { merge: true });
    batch.set(profileRef.collection("progress").doc("main"), progressDoc);
    await batch.commit();
    localStorage.setItem(`${profileId}:updatedAt`, new Date().toISOString());
    setAuthSyncFeedback(t("auth.syncDone"), "ok");
    setTimeout(() => setAuthSyncFeedback("", ""), 3000);
  } catch (e) {
    console.warn("[sync] push failed:", e.message);
    setAuthSyncFeedback(t("auth.syncFailed"), "error");
  }
}

async function pushCurrentProfileToFirestore() {
  const profileId = getActiveProfileId();
  if (!profileId || !fbCurrentUser) return;
  await pushProfileToFirestore(profileId);
}

// ダーティフラグ：localStorageへの書き込み後に呼ぶと、5秒後にまとめてプッシュする
function markSyncDirty() {
  if (!fbCurrentUser || !getActiveProfileId()) return;
  clearTimeout(_syncDirtyTimer);
  _syncDirtyTimer = setTimeout(pushCurrentProfileToFirestore, 5000);
}

// ページがバックグラウンドに切り替わるタイミングでも即時プッシュ
document.addEventListener("visibilitychange", () => {
  if (document.hidden && fbCurrentUser && getActiveProfileId()) {
    clearTimeout(_syncDirtyTimer);
    pushCurrentProfileToFirestore();
  }
});

// ------- プル -------

async function pullProfileFromFirestore(profileId) {
  if (!fbCurrentUser || !profileId) return;
  const uid = fbCurrentUser.uid;

  const progressRef = fbDb.collection("households").doc(uid)
    .collection("profiles").doc(profileId)
    .collection("progress").doc("main");

  let doc;
  try {
    doc = await progressRef.get();
  } catch (e) {
    console.warn("[sync] pull failed:", e.message);
    return;
  }

  if (!doc.exists) return;
  const server = doc.data();
  if (!server || !server.updatedAt) return;

  const serverTs = server.updatedAt.toDate ? server.updatedAt.toDate().toISOString() : String(server.updatedAt);
  const localTs = localStorage.getItem(`${profileId}:updatedAt`) || "";
  if (localTs && serverTs <= localTs) return; // ローカルが新しい or 同じ

  // サーバが新しい → conflict-resolution ルールに従ってマージ
  const pre = (key) => `${profileId}:${key}`;

  // ownedCards: 和集合（枚数は大きい方を採用）
  const localOwned = (function () { try { return JSON.parse(localStorage.getItem(pre(GACHA_KEY)) || "{}"); } catch { return {}; } })();
  const serverOwned = (server.ownedCards && typeof server.ownedCards === "object") ? server.ownedCards : {};
  const mergedOwned = { ...localOwned };
  Object.entries(serverOwned).forEach(([id, count]) => {
    mergedOwned[id] = Math.max(mergedOwned[id] || 0, Number(count) || 0);
  });
  localStorage.setItem(pre(GACHA_KEY), JSON.stringify(mergedOwned));

  // 以下は last-write-wins（サーバが新しいので上書き）
  if (server.stampsTotal !== undefined) localStorage.setItem(pre(STORAGE_KEY), String(server.stampsTotal));
  if (server.grade !== undefined && GRADES.includes(Number(server.grade))) {
    localStorage.setItem(pre(GRADE_KEY), String(server.grade));
  }
  if (server.schoolYearStart !== undefined) {
    const m = Number(server.schoolYearStart);
    if (m >= 1 && m <= 12) localStorage.setItem(pre(SCHOOL_YEAR_START_KEY), String(m));
  }
  if (server.pity !== undefined) localStorage.setItem(pre(PITY_KEY), String(server.pity));
  if (server.dailyPoints && typeof server.dailyPoints === "object") {
    localStorage.setItem(pre(DAILY_POINTS_KEY), JSON.stringify(server.dailyPoints));
  }
  if (server.seenHistory) applySeenHistory(profileId, server.seenHistory);

  localStorage.setItem(pre("updatedAt"), serverTs);
}

// ------- 移行：ローカルのプロフィールをFirestoreのhouseholdに引き取る -------
// 初回ログイン/新規登録時、householdドキュメントが存在しなければ実行する。

async function migrateLocalProfilesToFirestore() {
  if (!fbCurrentUser) return;
  const uid = fbCurrentUser.uid;
  const householdRef = fbDb.collection("households").doc(uid);

  const snap = await householdRef.get();
  if (snap.exists) {
    // すでに世帯が存在する → 移行済み。プランだけ読み取る。
    fbPlan = snap.data().plan === "paid" ? "paid" : "free";
    return;
  }

  // 世帯ドキュメントを作成（新規登録の既定は無料プラン）
  fbPlan = "free";
  await householdRef.set({
    email: fbCurrentUser.email,
    plan: "free",
    createdAt: new Date().toISOString(),
  });

  // 既存のローカルプロフィールを Firestore に書き出す
  for (const profile of getProfiles()) {
    await pushProfileToFirestore(profile.id);
  }
}

// ------- ログイン・新規登録 UI -------

function openLoginScreen() {
  document.getElementById("login-email-input").value = "";
  document.getElementById("login-password-input").value = "";
  setLoginFeedback("", "");
  showScreen("screen-login");
}

function openSignupScreen() {
  document.getElementById("signup-email-input").value = "";
  document.getElementById("signup-password-input").value = "";
  setSignupFeedback("", "");
  showScreen("screen-signup");
}

function setLoginFeedback(text, cls) {
  const el = document.getElementById("login-feedback");
  el.textContent = text;
  el.className = `backup-feedback${cls ? ` ${cls}` : ""}`;
}

function setSignupFeedback(text, cls) {
  const el = document.getElementById("signup-feedback");
  el.textContent = text;
  el.className = `backup-feedback${cls ? ` ${cls}` : ""}`;
}

function setAuthSyncFeedback(text, cls) {
  const el = document.getElementById("auth-sync-feedback");
  if (!el) return;
  el.textContent = text;
  el.className = `backup-feedback${cls ? ` ${cls}` : ""}`;
}

function authErrorMessage(code) {
  const map = {
    "auth/invalid-email": t("auth.errorInvalidEmail"),
    "auth/weak-password": t("auth.errorWeakPassword"),
    "auth/email-already-in-use": t("auth.errorEmailInUse"),
    "auth/wrong-password": t("auth.errorWrongPassword"),
    "auth/invalid-credential": t("auth.errorWrongPassword"),
    "auth/user-not-found": t("auth.errorUserNotFound"),
  };
  return map[code] || t("auth.errorGeneric");
}

document.getElementById("btn-login-submit").addEventListener("click", async () => {
  playClickSound();
  const email = document.getElementById("login-email-input").value.trim();
  const password = document.getElementById("login-password-input").value;
  if (!email || !password) { setLoginFeedback(t("auth.fieldsRequired"), "error"); return; }
  setLoginFeedback(t("auth.working"), "");
  document.getElementById("btn-login-submit").disabled = true;
  try {
    await fbAuth.signInWithEmailAndPassword(email, password);
    // onAuthStateChanged が残りを処理する
  } catch (e) {
    setLoginFeedback(authErrorMessage(e.code), "error");
    document.getElementById("btn-login-submit").disabled = false;
  }
});

document.getElementById("btn-login-to-signup").addEventListener("click", () => {
  playClickSound();
  openSignupScreen();
});

document.getElementById("btn-login-forgot").addEventListener("click", async () => {
  const email = document.getElementById("login-email-input").value.trim();
  if (!email) { setLoginFeedback(t("auth.emailRequired"), "error"); return; }
  try {
    await fbAuth.sendPasswordResetEmail(email);
    setLoginFeedback(t("auth.forgotSent"), "ok");
  } catch (e) {
    setLoginFeedback(authErrorMessage(e.code), "error");
  }
});

document.getElementById("btn-signup-submit").addEventListener("click", async () => {
  playClickSound();
  const email = document.getElementById("signup-email-input").value.trim();
  const password = document.getElementById("signup-password-input").value;
  if (!email || !password) { setSignupFeedback(t("auth.fieldsRequired"), "error"); return; }
  setSignupFeedback(t("auth.working"), "");
  document.getElementById("btn-signup-submit").disabled = true;
  try {
    await fbAuth.createUserWithEmailAndPassword(email, password);
    // onAuthStateChanged が残りを処理する
  } catch (e) {
    setSignupFeedback(authErrorMessage(e.code), "error");
    document.getElementById("btn-signup-submit").disabled = false;
  }
});

document.getElementById("btn-signup-to-login").addEventListener("click", () => {
  playClickSound();
  openLoginScreen();
});

document.getElementById("btn-account-logout").addEventListener("click", async () => {
  playClickSound();
  clearTimeout(_syncDirtyTimer);
  if (fbCurrentUser && getActiveProfileId()) {
    await pushCurrentProfileToFirestore().catch(() => {});
  }
  await fbAuth.signOut();
  // onAuthStateChanged がログイン画面に遷移させる
});

function refreshAuthAccountLine() {
  const el = document.getElementById("auth-account-line");
  if (!el) return;
  const guest = !fbCurrentUser;
  el.textContent = guest ? t("auth.guestAccountLine") : t("auth.accountLine", { email: fbCurrentUser.email });

  // おためし中は「登録する／ログインする」、ログイン後は「ログアウト」を出す
  document.getElementById("auth-guest-prompt").classList.toggle("hidden", !guest);
  document.getElementById("btn-guest-signup").classList.toggle("hidden", !guest);
  document.getElementById("btn-guest-login").classList.toggle("hidden", !guest);
  document.getElementById("btn-account-logout").classList.toggle("hidden", guest);
}

// おためし中からログイン／新規登録に進んだときだけ「もどる」を出す。
// 未登録の初回起動では戻る先がないので隠しておく。
function setAuthBackToGuestVisible(visible) {
  document.getElementById("btn-login-back-to-guest").classList.toggle("hidden", !visible);
  document.getElementById("btn-signup-back-to-guest").classList.toggle("hidden", !visible);
}

document.getElementById("btn-login-guest").addEventListener("click", () => {
  playClickSound();
  setGuestMode(true);
  setAuthBackToGuestVisible(false);
  refreshAuthAccountLine();
  startInitialScreen();
});

document.getElementById("btn-guest-signup").addEventListener("click", () => {
  playClickSound();
  setAuthBackToGuestVisible(true);
  openSignupScreen();
});

document.getElementById("btn-guest-login").addEventListener("click", () => {
  playClickSound();
  setAuthBackToGuestVisible(true);
  openLoginScreen();
});

[["btn-login-back-to-guest"], ["btn-signup-back-to-guest"]].forEach(([id]) => {
  document.getElementById(id).addEventListener("click", () => {
    playClickSound();
    setAuthBackToGuestVisible(false);
    startInitialScreen();
  });
});

// ------- 認証状態の監視（起動フローの入り口） -------
// onAuthStateChanged は Firebase がキャッシュした認証情報をもとにほぼ即座に発火する。
// ログイン済みであれば移行確認 → startInitialScreen()、未ログインならログイン画面へ。

fbAuth.onAuthStateChanged(async (user) => {
  fbCurrentUser = user;
  document.getElementById("btn-login-submit").disabled = false;
  document.getElementById("btn-signup-submit").disabled = false;

  if (!user) {
    // 未ログインでも、おためし中ならそのままアプリに入る
    fbPlan = "free";
    refreshAuthAccountLine();
    if (isGuestMode()) startInitialScreen();
    else openLoginScreen();
    return;
  }

  // 登録・ログインできたらおためしは終了（ローカルのデータは移行で引き継がれる）
  setGuestMode(false);

  try {
    await migrateLocalProfilesToFirestore();
  } catch (e) {
    console.warn("[sync] migration failed:", e.message);
  }

  refreshAuthAccountLine();
  startInitialScreen();
});
