// ===== Firebase認証・同期の状態 =====
// fbCurrentUser と _syncDirtyTimer は script.js 全体から参照されるため、
// ファイル冒頭で宣言しておく（Firebase セクションで初期化）。
let fbCurrentUser = null;
let _syncDirtyTimer = null;

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
  if (list.length >= PROFILE_MAX) return null;
  const profile = {
    id: newProfileId(list),
    name: String(name || "").slice(0, PROFILE_NAME_MAX) || t("profile.defaultName"),
    avatar: PROFILE_AVATARS.includes(avatar) ? avatar : PROFILE_AVATARS[0],
    createdAt: new Date().toISOString(),
  };
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

function rollRarity() {
  const weights = { N: RARITY_INFO.N.weight, R: RARITY_INFO.R.weight, SR: RARITY_INFO.SR.weight, UR: RARITY_INFO.UR.weight };
  const total = Object.values(weights).reduce((sum, w) => sum + w, 0);
  let roll = Math.random() * total;
  for (const rarity of Object.keys(weights)) {
    if (roll < weights[rarity]) return rarity;
    roll -= weights[rarity];
  }
  return "N";
}

function drawGachaCard() {
  const owned = getOwnedCards();
  const unowned = CARD_POOL.filter((c) => !owned[c.id]);
  const pityHit = getPity() >= PITY_LIMIT && unowned.length > 0;

  // 天井に達していたら未所持のみから、そうでなければ通常のレアリティ抽選から選ぶ
  const card = pityHit ? pick(unowned) : pick(CARD_POOL.filter((c) => c.rarity === rollRarity()));

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
  const { isNew = false, locked = false, count = 0 } = opts || {};

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

  document.getElementById("collection-count-line").textContent =
    t(isFamily ? "collection.countFamily" : "collection.count", { owned: ownedCount, total: CARD_POOL.length });

  const grid = document.getElementById("collection-grid");
  grid.innerHTML = CARD_POOL.map((card) => {
    const count = owned[card.id] || 0;
    return `<div class="collection-card-slot" data-card-id="${card.id}">${renderCardHTML(card, { locked: count === 0, count })}</div>`;
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

function genWordSub() {
  const item = pick(WORD_ITEMS);
  const b = randInt(2, 30);
  const bigger = randInt(5, 40) + b;
  return {
    text: `${item}が ${bigger}こ ありました。${b}こ たべました。のこりは なんこ？`,
    answer: `${bigger - b}`,
    type: "number",
    hint: "「たべた」ということは、数が へるね。ひきざんを つかおう",
    explain: `はじめに ${bigger}こ あって、${b}こ たべたから ${bigger}－${b}＝${bigger - b}こ のこるよ`,
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
  const aRaw = randInt(101, 999), bRaw = randInt(101, 999);
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

// ===== 分野（カテゴリー）ごとの出題プール =====
// 生成器を「習う学年」で束ねる。設定学年以下をすべて使うので、
// 6年を選ぶと1〜6年の内容から出題される。
const MATH_GENS_BY_GRADE = {
  1: { keisan: [genAdd1, genSub1], bunsho: [genWordAdd, genWordSub] },
  2: { keisan: [genAdd2, genSub2, genMul2], bunsho: [genWordMul] },
  3: {
    keisan: [genAdd3, genSub3, genMul3, genDiv3, genDivRemainder3, genDecimal3, genFractionSame3],
    bunsho: [genWordDiv, genWordCompare],
  },
  4: {
    keisan: [genDivLong4, genDecimalAddSub4, genRectArea4, genRounding4, genAngle4],
    bunsho: [genWordUnit4],
  },
  5: {
    // 体積と速さは5年で習う内容なので、ここに置く
    keisan: [genDecimalMul5, genDecimalDiv5, genFractionAddDiff5, genAverage5, genPercent5, genTriangleArea5, genVolume6],
    bunsho: [genWordPerUnit5, genWordSpeed],
  },
  6: {
    keisan: [genFractionMul6, genFractionDiv6, genCircleArea6, genRatio6],
    bunsho: [genProportion6, genCombination6, genWordRatioSplit6],
  },
};

function mathGensFor(grade, category) {
  const collect = (from) => {
    const gens = [];
    for (let g = from; g <= grade; g++) {
      const set = MATH_GENS_BY_GRADE[g];
      if (set && set[category]) set[category].forEach((fn) => gens.push({ fn, grade: g }));
    }
    return gens;
  };
  const withinSpan = collect(gradeFloor(grade, category));
  return withinSpan.length > 0 ? withinSpan : collect(1);
}

function generateMathProblem(grade, category) {
  const gens = mathGensFor(grade, category);
  const weights = tieredWeights(gens, grade);
  return weightedSample(gens, weights, 1)[0].fn();
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
  // 直近に出た問題は避けつつ生成する。生成器の出力の幅が狭い分野では
  // 除外条件で埋まりきらないことがあるため、まずは避けて集め、
  // 足りない分だけ「直近OK」に条件をゆるめて埋める。
  const maxTries = count * 60;
  for (let tries = 0; tries < maxTries && result.length < count; tries++) {
    const problem = generateMathProblem(grade, category);
    if (seen.has(problem.text) || recentSet.has(problem.text)) continue;
    seen.add(problem.text);
    problem.isRepeat = false;
    result.push(problem);
  }
  for (let tries = 0; tries < maxTries && result.length < count; tries++) {
    const problem = generateMathProblem(grade, category);
    if (seen.has(problem.text)) continue;
    seen.add(problem.text);
    problem.isRepeat = recentSet.has(problem.text);
    result.push(problem);
  }
  // それでも足りない分野では、最後だけ重複を許して埋める
  while (result.length < count) {
    const problem = generateMathProblem(grade, category);
    problem.isRepeat = recentSet.has(problem.text);
    result.push(problem);
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

  const remaining = Object.keys(getOwnedCards()).length >= CARD_POOL.length
    ? null
    : Math.max(0, PITY_LIMIT - getPity());
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
      <span class="grade-option-range">${g === 1 ? t("settings.gradeRange1") : t("settings.gradeRange", { n: g })}</span>
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

  const profile = getActiveProfile();
  document.getElementById("profile-current-line").textContent = profile
    ? t("profile.currentLine", { avatar: profile.avatar, name: profile.name })
    : "";

  showScreen("screen-settings");
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
  `).join("") + (state.profileMode === "select" ? `
    <button type="button" class="profile-card profile-card--new" id="btn-profile-new">
      <span class="profile-card-avatar">＋</span>
      <span class="profile-card-name">${t("profile.createNew")}</span>
    </button>
  ` : "");

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
      if (getProfiles().length >= PROFILE_MAX) return;
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
    document.getElementById("profile-create-feedback").textContent = t("profile.full", { n: PROFILE_MAX });
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
  if (snap.exists) return; // すでに世帯が存在する → 移行済み

  // 世帯ドキュメントを作成（plan は Stage1 では free 固定）
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
  el.textContent = fbCurrentUser ? t("auth.accountLine", { email: fbCurrentUser.email }) : "";
}

// ------- 認証状態の監視（起動フローの入り口） -------
// onAuthStateChanged は Firebase がキャッシュした認証情報をもとにほぼ即座に発火する。
// ログイン済みであれば移行確認 → startInitialScreen()、未ログインならログイン画面へ。

fbAuth.onAuthStateChanged(async (user) => {
  fbCurrentUser = user;
  document.getElementById("btn-login-submit").disabled = false;
  document.getElementById("btn-signup-submit").disabled = false;

  if (!user) {
    openLoginScreen();
    return;
  }

  try {
    await migrateLocalProfilesToFirestore();
  } catch (e) {
    console.warn("[sync] migration failed:", e.message);
  }

  refreshAuthAccountLine();
  startInitialScreen();
});
