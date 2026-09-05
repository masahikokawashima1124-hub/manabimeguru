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
  return isPaidPlan() ? RELEASED_CARD_POOL : RELEASED_CARD_POOL.filter((c) => !isPremiumRarity(c.rarity));
}

// 無料プランのプロフィール上限。プレミアムで PROFILE_MAX 人まで増える。
const FREE_PROFILE_MAX = 1;

function profileLimit() {
  return isPaidPlan() ? PROFILE_MAX : FREE_PROFILE_MAX;
}

// ===== 有料への切り替え（Stripe Payment Links） =====
// account-design.md §10-9。Stripe ダッシュボードで Payment Link を作り、
// そのURLをここに貼る（手順は functions/README.md）。
// 空の間は、せっていの「プラン」に「準備中」と出るだけで、購入ボタンは動かない。
// 【2026-08-13 本番モードに切り替え済み】webhookエンドポイント・シークレットキーも
// 本番用に差し替え済み（HANDOFF.md参照）。
//
// ⚠️ **ロケールごとに分けてある。** 1つの定数を全言語で共有してはいけない。
//    Payment Link は通貨と価格が焼き付いているので、日本語版のリンクをスペイン語版に
//    出すと「Mensual: 1.480 JPY」という円建ての購入ボタンをスペイン語圏の保護者に
//    見せることになる（es-handoff.md §6 が明確に避けるとしている状態）。
//    価格が決まっていない言語は空のままにしておけば「準備中」が出る。
const STRIPE_PAYMENT_LINKS_BY_LOCALE = {
  ja: {
    monthly: "https://buy.stripe.com/fZudRaeqC067gwq9tK7kc00", // 月払い ¥1,480
    yearly: "https://buy.stripe.com/cNi9AU0zM4mn1BwaxO7kc01", // 年払い ¥14,800（2か月ぶん無料）
  },
  // スペイン語圏の価格は未定（account-design.md §8-2 のPPP調整が前提）。
  // 対象国・通貨・現地の表示義務が決まるまでは空のままにする。
  es: { monthly: "", yearly: "" },
};

function stripePaymentLinks() {
  return STRIPE_PAYMENT_LINKS_BY_LOCALE[getLocale()] || { monthly: "", yearly: "" };
}

// 法的情報のページを配っている言語かどうか。
// tokusho.html は日本の特定商取引法の表示なので、日本語版にしか配布していない
// （tools/sync-public.sh の --locale es は配布対象から外す）。
// リンクだけ出すと404になるので、配っている言語でのみ出す。
function hasLegalPage() {
  return getLocale() === "ja";
}

function legalLinkHTML() {
  if (!hasLegalPage()) return "";
  return `<p class="plan-legal"><a href="tokusho.html" target="_blank" rel="noopener">${t("plan.legalLink")}</a></p>`;
}

// 契約の管理（解約・お支払い方法の変更）。Stripe カスタマーポータルのURL。
// ダッシュボード →「設定」→「Billing」→「カスタマーポータル」で有効化すると発行される。
// ⚠️ 空のままでも解約手段は下の SUPPORT_EMAIL で案内されるが、本番課金を始める前に
//    必ず設定すること（tokusho.html で「せっていのプランから解約できる」と表示しているため）。
// ⚠️ これは本番モードのポータル。テストモードの契約はここには出ない。
//    Payment Link を本番に差し替えるまでは、テスト購入分の管理には使えない。
const STRIPE_CUSTOMER_PORTAL_URL = "https://billing.stripe.com/p/login/fZudRaeqC067gwq9tK7kc00";

// 解約や問い合わせの受け口。tokusho.html に載せているアドレスと必ず揃えること。
const SUPPORT_EMAIL = "manabimeguru@comagoto.com";

// ===== おしらせ（せってい画面・保護者向け） =====
// 新カードの実装予告・実装報告、新しいYouTube動画のアップロード情報などを載せる。
// Firestoreではなく、この静的配列を直接編集してpushする（CARD_POOLと同じ運用）。
// 新しい項目を足すときは、事実だけを書くこと（lp-plan.md §4「作り話の希少性で煽らない」と同じ方針）。
//
// 各項目の形:
//   id:   一意な文字列（日付+内容がわかる名前にする。例: "2026-09-10-new-card"）
//   date: "YYYY-MM-DD"（新しい順に自動で並ぶ）
//   title / body: { ja, es } の両方を必ず書く（check_i18n_keys.js の対象外なので漏れても検出されない）
//   cta:  任意。省略すると本文だけのカードになる
//     { label: {ja, es}, url: "https://..." }        … 外部リンク（特定の動画など）を新規タブで開く
//     { label: {ja, es}, action: "plan" }             … せってい内の「プラン」節へスクロールする
//     { label: {ja, es}, action: "youtube" }          … 公式YouTubeチャンネル（t("youtube.url")、
//                                                        ja/esで別チャンネル）を新規タブで開く
//   modalFrom / modalUntil: 任意。両方書くと、その期間だけメイン画面が出る前にポップアップでも見せる
//     "YYYY-MM-DD"（当日を含む）。省略するとせってい画面の一覧だけに載る（今までの動作）。
//     複数の項目が同時に該当する期間だと、配列の先頭にある項目を優先して1つだけ出す。
const ANNOUNCEMENTS = [
  {
    id: "2026-09-05-autumn-spirits",
    date: "2026-09-05",
    title: {
      ja: "新登場！秋の精霊たち",
      es: "¡Nuevos espíritus de otoño!",
    },
    body: {
      ja: "近日中に秋の精霊カードが追加されます。ひとあし先にYouTube動画に秋の精霊たちが登場しています。ぜひご覧ください。",
      es: "Muy pronto se añadirán las cartas de los espíritus de otoño. Ya puedes verlos por adelantado en nuestro canal de YouTube. ¡No te lo pierdas!",
    },
    cta: {
      label: { ja: "YouTubeを見る", es: "Ver YouTube" },
      action: "youtube",
    },
    modalFrom: "2026-09-05",
    modalUntil: "2026-09-14",
  },
];

const ANNOUNCE_READ_KEY = "announce_read_ids";

function getAnnounceReadIds() {
  try {
    return new Set(JSON.parse(localStorage.getItem(ANNOUNCE_READ_KEY) || "[]"));
  } catch {
    return new Set();
  }
}

function markAnnouncementsRead(ids) {
  const read = getAnnounceReadIds();
  ids.forEach((id) => read.add(id));
  localStorage.setItem(ANNOUNCE_READ_KEY, JSON.stringify([...read]));
}

function hasUnreadAnnouncements() {
  const read = getAnnounceReadIds();
  return ANNOUNCEMENTS.some((a) => !read.has(a.id));
}

// せっていタブの未読バッジ。起動時と、せってい画面を開いて既読にしたあとの両方で呼ぶ
function updateSettingsTabBadge() {
  const badge = document.getElementById("tab-settings-badge");
  if (!badge) return;
  badge.classList.toggle("hidden", !hasUnreadAnnouncements());
}

// メイン画面が出る前にポップアップで見せる項目。期間内・未読のものを配列の先頭優先で1つ返す
function getEligibleModalAnnouncement() {
  const today = new Date().toISOString().slice(0, 10);
  const read = getAnnounceReadIds();
  return ANNOUNCEMENTS.find((a) => (
    a.modalFrom && a.modalUntil && !read.has(a.id) && a.modalFrom <= today && today <= a.modalUntil
  )) || null;
}

// enterAppWithActiveProfile() から呼ぶ。該当項目があればポップアップを出し、無ければ何もしない
function maybeShowAnnounceModal() {
  const item = getEligibleModalAnnouncement();
  if (!item) return;

  const locale = getLocale();
  const overlay = document.getElementById("announce-modal-overlay");
  overlay.dataset.itemId = item.id;
  document.getElementById("announce-modal-title").textContent = item.title[locale] || item.title.ja;
  document.getElementById("announce-modal-body").textContent = item.body[locale] || item.body.ja;

  const ctaBtn = document.getElementById("announce-modal-cta");
  if (item.cta) {
    ctaBtn.textContent = item.cta.label[locale] || item.cta.label.ja;
    ctaBtn.classList.remove("hidden");
    ctaBtn.onclick = () => {
      playClickSound();
      dismissAnnounceModal(item.id);
      if (item.cta.action === "plan") {
        openSettingsScreen();
        document.getElementById("settings-plan").scrollIntoView({ behavior: "smooth", block: "start" });
      } else if (item.cta.action === "youtube") {
        window.open(t("youtube.url"), "_blank", "noopener,noreferrer");
      } else if (item.cta.url) {
        window.open(item.cta.url, "_blank", "noopener,noreferrer");
      }
    };
  } else {
    ctaBtn.classList.add("hidden");
    ctaBtn.onclick = null;
  }

  overlay.classList.remove("hidden");
}

function dismissAnnounceModal(id) {
  markAnnouncementsRead([id]);
  updateSettingsTabBadge();
  document.getElementById("announce-modal-overlay").classList.add("hidden");
}

document.getElementById("btn-close-announce-modal").addEventListener("click", () => {
  playClickSound();
  dismissAnnounceModal(document.getElementById("announce-modal-overlay").dataset.itemId);
});
document.getElementById("announce-modal-overlay").addEventListener("click", (e) => {
  if (e.target.id !== "announce-modal-overlay") return;
  dismissAnnounceModal(document.getElementById("announce-modal-overlay").dataset.itemId);
});

// Payment Link に「どの世帯の支払いか」を伝えるURLを組み立てる。
// client_reference_id が webhook（functions/index.js）で世帯の特定に使われる。
function buildUpgradeUrl(link) {
  if (!link || !fbCurrentUser) return null;
  const sep = link.includes("?") ? "&" : "?";
  let url = `${link}${sep}client_reference_id=${encodeURIComponent(fbCurrentUser.uid)}`;
  if (fbCurrentUser.email) url += `&prefilled_email=${encodeURIComponent(fbCurrentUser.email)}`;
  return url;
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

function createProfile(name) {
  const list = getProfiles();
  if (list.length >= profileLimit()) return null;
  const profile = {
    id: newProfileId(list),
    name: String(name || "").slice(0, PROFILE_NAME_MAX) || t("profile.defaultName"),
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
const SCHOOL_YEAR_START_BY_LOCALE = { ja: 4, en: 9, es: 9 };

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
  str = str.trim().replace(/／/g, "/"); // 全角スラッシュも受理する
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
    // 100%正解専用ポーズ。他は元PNGのままだが、この1枚はwebpのみ用意されている
    // （52KB。他もいずれ同じ変換をすると配信サイズを削減できる。ASSETS.md参照）。
    perfect: "assets/characters/hanabi-perfect.webp",
  },
};

// 場面ごとに、どの表情で話すか
const GUIDE_MOOD_POSE = {
  home: "greet",
  subject: "happy",
  category: "greet",
  start: "happy",
  gacha: "cheer",
  collection: "happy",
  settings: "greet",
  correct: "cheer",
  wrong: "think",
  resultPerfect: "perfect",
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
  // ─── 秋冬春120体（2026-08-12・No.041〜160／released:false で当面は非公開） ───
  { id: "aki-n1", name: "もみじのちいさなて", rarity: "N", theme: "momiji", shape: "round", color: "#e53935", accessory: "none", eye: "dot", flavor: "ちいさな てのひらの かたちで、かぜに ひらひら てを ふっている", image: "aki-n1.webp", released: false },
  { id: "aki-n2", name: "いちょうのきんいろ", rarity: "N", theme: "momiji", shape: "round", color: "#fdd835", accessory: "ear-tufts", eye: "dot", flavor: "きんいろに ひかる はっぱ。あしもとを まっきんきんに してしまう", image: "aki-n2.webp", released: false },
  { id: "aki-r1", name: "おちばのやま", rarity: "R", theme: "momiji", shape: "round", color: "#8d6e63", accessory: "none", eye: "sleepy", flavor: "みんなが とびこんでくる、ふかふかの おちばの やま", image: "aki-r1.webp", released: false },
  { id: "aki-r2", name: "かぜまかせのひとひら", rarity: "R", theme: "momiji", shape: "egg", color: "#ff7043", accessory: "tuft", eye: "dot", flavor: "かぜが ふくほうへ、どこまでも とんでいく", image: "aki-r2.webp", released: false },
  { id: "aki-sr1", name: "にしきのおりひめ", rarity: "SR", theme: "momiji", shape: "oval", color: "#ad1457", accessory: "none", eye: "star", sparkle: true, flavor: "やまぜんたいを あかや きいろに そめあげる、あきの ぬのおり", image: "aki-sr1.webp", released: false },
  { id: "aki-sr2", name: "やまぞめのふであるじ", rarity: "SR", theme: "momiji", shape: "oval", color: "#5d4037", accessory: "none", eye: "star", sparkle: true, flavor: "ふでを ひとふりすると、きの てっぺんから いろが おりてくる", image: "aki-sr2.webp", released: false },
  { id: "aki-n3", name: "どんぐりぼうや", rarity: "N", theme: "nuts", shape: "egg", color: "#a1887f", accessory: "none", eye: "dot", flavor: "ぼうしが ぬげないか いつも きにしている、ちいさな どんぐり", image: "aki-n3.webp", released: false },
  { id: "aki-n4", name: "まつぼっくりのかさや", rarity: "N", theme: "nuts", shape: "oval", color: "#795548", accessory: "none", eye: "dot", flavor: "あめの ひは かさを とじ、はれた ひは ぱっと ひらく", image: "aki-n4.webp", released: false },
  { id: "aki-n5", name: "くりのいがぼうず", rarity: "N", theme: "nuts", shape: "round", color: "#689f38", accessory: "none", eye: "dot", flavor: "とげとげの いがの なかに、あまい なかみを かくしている", image: "aki-n5.webp", released: false },
  { id: "aki-r3", name: "かきのみあかね", rarity: "R", theme: "nuts", shape: "round", color: "#fb8c00", accessory: "none", eye: "dot", flavor: "えだの さきで、ひとつだけ のこって あかく なっている", image: "aki-r3.webp", released: false },
  { id: "aki-r4", name: "くるみのかたいこ", rarity: "R", theme: "nuts", shape: "round", color: "#4e342e", accessory: "none", eye: "dot", flavor: "だれにも わってもらえない、いちばん かたい からの もちぬし", image: "aki-r4.webp", released: false },
  { id: "aki-sr3", name: "みのりのかごもち", rarity: "SR", theme: "nuts", shape: "oval", color: "#d7ccc8", accessory: "none", eye: "star", sparkle: true, flavor: "あきの みのりを ぜんぶ かごに いれて はこんでくる", image: "aki-sr3.webp", released: false },
  { id: "aki-n6", name: "おだんごつみっこ", rarity: "N", theme: "moonviewing", shape: "round", color: "#fff8e1", accessory: "none", eye: "dot", flavor: "だんごを たかく つみあげるのが しごと。ときどき くずれる", image: "aki-n6.webp", released: false },
  { id: "aki-n7", name: "すすきのほさき", rarity: "N", theme: "moonviewing", shape: "egg", color: "#bcaaa4", accessory: "none", eye: "sleepy", flavor: "かぜが ふくと いっせいに おなじ ほうへ おじぎする", image: "aki-n7.webp", released: false },
  { id: "aki-r5", name: "つきみうさぎのつきたて", rarity: "R", theme: "moonviewing", shape: "round", color: "#fafafa", accessory: "ear-tufts", eye: "dot", flavor: "つきの うえで、いちねんじゅう もちを ついている", image: "aki-r5.webp", released: false },
  { id: "aki-r6", name: "くもがくれのいたずら", rarity: "R", theme: "moonviewing", shape: "round", color: "#b0bec5", accessory: "none", eye: "dot", flavor: "いちばん いい ところで つきを かくしてしまう", image: "aki-r6.webp", released: false },
  { id: "aki-sr4", name: "まんげつのおおきなめ", rarity: "SR", theme: "moonviewing", shape: "round", color: "#ffd54f", accessory: "none", eye: "star", sparkle: true, flavor: "よぞらの まんなかで、まちを ぜんぶ みおろしている", image: "aki-sr4.webp", released: false },
  { id: "aki-ur1", name: "あきのよのせいれいおうひ", rarity: "UR", theme: "moonviewing", shape: "round", color: "#9575cd", accessory: "crown", eye: "star", sparkle: true, flavor: "あきの よぞらを おさめる、しずかな おうひ", image: "aki-ur1.webp", released: false },
  { id: "aki-n8", name: "きのこのかさっこ", rarity: "N", theme: "mushroom", shape: "round", color: "#d84315", accessory: "none", eye: "dot", flavor: "あめあがりに ぽこっと あらわれる、ちいさな きのこ", image: "aki-n8.webp", released: false },
  { id: "aki-n9", name: "しめじのむれっこ", rarity: "N", theme: "mushroom", shape: "round", color: "#bf8f6f", accessory: "none", eye: "dot", flavor: "いつも なかまと かたまって いる。ひとりだと おちつかない", image: "aki-n9.webp", released: false },
  { id: "aki-n10", name: "まいたけのおどりや", rarity: "N", theme: "mushroom", shape: "oval", color: "#6f4e37", accessory: "none", eye: "dot", flavor: "みつけると おもわず まいたく なるほど うれしい きのこ", image: "aki-n10.webp", released: false },
  { id: "aki-r7", name: "どくきのこのはでこ", rarity: "R", theme: "mushroom", shape: "round", color: "#e91e63", accessory: "none", eye: "star", flavor: "だれよりも きれいな いろ。でも さわっては いけない", image: "aki-r7.webp", released: false },
  { id: "aki-sr5", name: "もりのきのこはかせ", rarity: "SR", theme: "mushroom", shape: "oval", color: "#455a64", accessory: "glasses", eye: "star", sparkle: true, flavor: "どの きのこが たべられるか、ぜんぶ しっている", image: "aki-sr5.webp", released: false },
  { id: "aki-n11", name: "こおろぎのねいろ", rarity: "N", theme: "insects", shape: "oval", color: "#2e7d32", accessory: "tuft", eye: "dot", flavor: "くさむらの したから、りりりと すきとおる おとを ならす", image: "aki-n11.webp", released: false },
  { id: "aki-n12", name: "すずむしのりんりん", rarity: "N", theme: "insects", shape: "oval", color: "#558b2f", accessory: "none", eye: "dot", flavor: "ちいさな すずを ふるような おとで、あきを しらせる", image: "aki-n12.webp", released: false },
  { id: "aki-n13", name: "きりぎりすのぎいこ", rarity: "N", theme: "insects", shape: "oval", color: "#9e9d24", accessory: "none", eye: "dot", flavor: "ぎーっちょん、と かたい おとで きざむ", image: "aki-n13.webp", released: false },
  { id: "aki-r8", name: "むしのねのしきしゃ", rarity: "R", theme: "insects", shape: "egg", color: "#37474f", accessory: "none", eye: "dot", flavor: "くさむら ぜんたいの ねいろを そろえる、よるの しきしゃ", image: "aki-r8.webp", released: false },
  { id: "aki-r9", name: "あきのねのうたひめ", rarity: "R", theme: "insects", shape: "oval", color: "#880e4f", accessory: "book", eye: "star", flavor: "いちばん とおくまで とどく こえで、あきの おわりを うたう", image: "aki-r9.webp", released: false },
  { id: "aki-n14", name: "やきいもホカホカ", rarity: "N", theme: "autumnfood", shape: "oval", color: "#8e24aa", accessory: "none", eye: "dot", flavor: "おちばの したで じっくり やかれた、あつあつの やきいも", image: "aki-n14.webp", released: false },
  { id: "aki-n15", name: "さつまのほりだしっこ", rarity: "N", theme: "autumnfood", shape: "egg", color: "#ce93d8", accessory: "none", eye: "closed", flavor: "つちの なかから、ずぼっと ひきぬかれるのが すき", image: "aki-n15.webp", released: false },
  { id: "aki-n16", name: "ぎんなんのにおいや", rarity: "N", theme: "autumnfood", shape: "egg", color: "#f9a825", accessory: "tuft", eye: "dot", flavor: "きんいろで きれいなのに、においで おぼえられている", image: "aki-n16.webp", released: false },
  { id: "aki-r10", name: "あきざけのつきあかり", rarity: "R", theme: "autumnfood", shape: "round", color: "#ffcc80", accessory: "none", eye: "sleepy", flavor: "つきを うつした さかずきの なかに すんでいる", image: "aki-r10.webp", released: false },
  { id: "aki-r11", name: "さんまのけむりもく", rarity: "R", theme: "autumnfood", shape: "egg", color: "#78909c", accessory: "none", eye: "dot", flavor: "やくと けむりで あたりが まっしろに なる", image: "aki-r11.webp", released: false },
  { id: "aki-sr6", name: "みのりのしょくたくぬし", rarity: "SR", theme: "autumnfood", shape: "oval", color: "#bf360c", accessory: "none", eye: "star", sparkle: true, flavor: "あきの たべものを ぜんぶ ならべた しょくたくの ぬし", image: "aki-sr6.webp", released: false },
  { id: "aki-r12", name: "かかしのみはりばん", rarity: "R", theme: "harvest", shape: "egg", color: "#d4a373", accessory: "book", eye: "dot", flavor: "いちねんじゅう おなじ ばしょで、たんぼを みまもっている", image: "aki-r12.webp", released: false },
  { id: "aki-sr7", name: "いねほのこうべたれ", rarity: "SR", theme: "harvest", shape: "egg", color: "#f0d264", accessory: "none", eye: "closed", sparkle: true, flavor: "みのるほど あたまを さげる、たんぼの おてほん", image: "aki-sr7.webp", released: false },
  { id: "aki-sr8", name: "とりでのわたりどり", rarity: "SR", theme: "harvest", shape: "oval", color: "#607d8b", accessory: "none", eye: "star", sparkle: true, flavor: "さむく なるまえに、みんなを つれて とおくへ とんでいく", image: "aki-sr8.webp", released: false },
  { id: "aki-ur2", name: "みのりのおおかまど", rarity: "UR", theme: "harvest", shape: "round", color: "#e64a19", accessory: "none", eye: "star", sparkle: true, flavor: "いちねんの みのりを ぜんぶ たきあげる、でんせつの かまど", image: "aki-ur2.webp", released: false },
  { id: "aki-ur3", name: "からっかぜのはしりや", rarity: "UR", theme: "harvest", shape: "egg", color: "#90a4ae", accessory: "none", eye: "dot", sparkle: true, flavor: "やまから いっきに ふきおろして、ふゆを つれてくる", image: "aki-ur3.webp", released: false },
  { id: "aki-ur4", name: "あきぞらのせいれいおう", rarity: "UR", theme: "harvest", shape: "round", color: "#ef6c00", accessory: "crown", eye: "star", sparkle: true, flavor: "あきの すべての せいれいたちを まとめる、みのりの おうさま", image: "aki-ur4.webp", released: false },
  { id: "fuyu-n1", name: "ゆきのひとひら", rarity: "N", theme: "snow", shape: "round", color: "#e1f5fe", accessory: "tuft", eye: "dot", flavor: "おなじ かたちが ふたつと ない、ちいさな ゆきの けっしょう", image: "fuyu-n1.webp", released: false },
  { id: "fuyu-n2", name: "こなゆきのさらさら", rarity: "N", theme: "snow", shape: "round", color: "#f5f5f5", accessory: "none", eye: "sleepy", flavor: "さわると さらさら くずれて、かたちに ならない", image: "fuyu-n2.webp", released: false },
  { id: "fuyu-r1", name: "ぼたゆきのおおつぶ", rarity: "R", theme: "snow", shape: "round", color: "#eceff1", accessory: "none", eye: "dot", flavor: "おおきくて ゆっくり、まうように おちてくる", image: "fuyu-r1.webp", released: false },
  { id: "fuyu-r2", name: "つららのさかさぼう", rarity: "R", theme: "snow", shape: "egg", color: "#b3e5fc", accessory: "none", eye: "dot", flavor: "のきさきに さかさまに のびる、すきとおった ぼう", image: "fuyu-r2.webp", released: false },
  { id: "fuyu-sr1", name: "しもばしらのあしおと", rarity: "SR", theme: "snow", shape: "egg", color: "#9fd8df", accessory: "none", eye: "star", sparkle: true, flavor: "あさ いちばんに ふむと、さくさくと おとが なる", image: "fuyu-sr1.webp", released: false },
  { id: "fuyu-ur1", name: "ゆきげしきのえかき", rarity: "UR", theme: "snow", shape: "oval", color: "#f0f4f8", accessory: "none", eye: "star", sparkle: true, flavor: "ひとばんで まちを まっしろに ぬりかえる", image: "fuyu-ur1.webp", released: false },
  { id: "fuyu-n3", name: "ゆきだるまのまるこ", rarity: "N", theme: "snowplay", shape: "round", color: "#fcfcfc", accessory: "none", eye: "dot", flavor: "あたまと からだ、ふたつの たまで できている", image: "fuyu-n3.webp", released: false },
  { id: "fuyu-n4", name: "ゆきがっせんのたまや", rarity: "N", theme: "snowplay", shape: "round", color: "#e3f2fd", accessory: "ear-tufts", eye: "dot", flavor: "いちばん まるい ゆきだまを つくる めいじん", image: "fuyu-n4.webp", released: false },
  { id: "fuyu-n5", name: "そりのすべりんこ", rarity: "N", theme: "snowplay", shape: "oval", color: "#ef5350", accessory: "none", eye: "star", flavor: "さかを いっきに すべりおりるのが なにより すき", image: "fuyu-n5.webp", released: false },
  { id: "fuyu-r3", name: "かまくらのなかっこ", rarity: "R", theme: "snowplay", shape: "round", color: "#ffe0b2", accessory: "none", eye: "dot", flavor: "ゆきの いえの なかで、ろうそくを ともして まっている", image: "fuyu-r3.webp", released: false },
  { id: "fuyu-r4", name: "あしあとのついてくる", rarity: "R", theme: "snowplay", shape: "round", color: "#90caf9", accessory: "none", eye: "dot", flavor: "だれかの あしあとを、そっと ついて あるく", image: "fuyu-r4.webp", released: false },
  { id: "fuyu-sr2", name: "ゆきやまのちょうじょう", rarity: "SR", theme: "snowplay", shape: "round", color: "#e8eaf6", accessory: "crown", eye: "closed", sparkle: true, flavor: "だれも のぼったことのない、まっしろな やまの てっぺん", image: "fuyu-sr2.webp", released: false },
  { id: "fuyu-n6", name: "かがみもちのかさねっこ", rarity: "N", theme: "newyear", shape: "round", color: "#fff3e0", accessory: "none", eye: "dot", flavor: "おおきいのと ちいさいの、ふたつ かさなって すわっている", image: "fuyu-n6.webp", released: false },
  { id: "fuyu-n7", name: "こまのまわりんぼ", rarity: "N", theme: "newyear", shape: "egg", color: "#d81b60", accessory: "none", eye: "star", flavor: "まわっている あいだだけ、まっすぐ たっていられる", image: "fuyu-n7.webp", released: false },
  { id: "fuyu-n8", name: "たこあげのいととり", rarity: "N", theme: "newyear", shape: "oval", color: "#29b6f6", accessory: "tuft", eye: "dot", flavor: "そらの たかいところまで あがるのが ゆめ", image: "fuyu-n8.webp", released: false },
  { id: "fuyu-r5", name: "おとしだまのぽちぶくろ", rarity: "R", theme: "newyear", shape: "oval", color: "#d32f2f", accessory: "none", eye: "dot", flavor: "なかみを あけるまで、だれにも わからない", image: "fuyu-r5.webp", released: false },
  { id: "fuyu-r6", name: "はつもうでのぎょうれつ", rarity: "R", theme: "newyear", shape: "round", color: "#616161", accessory: "none", eye: "dot", flavor: "ながい ながい れつの いちばん うしろに いる", image: "fuyu-r6.webp", released: false },
  { id: "fuyu-sr3", name: "はつひのでのいちばんぼし", rarity: "SR", theme: "newyear", shape: "egg", color: "#ff8f00", accessory: "comb-gold", eye: "star", sparkle: true, flavor: "いちねんで いちばん さいしょの ひかりを つれてくる", image: "fuyu-sr3.webp", released: false },
  { id: "fuyu-n9", name: "こたつのもぐりんこ", rarity: "N", theme: "warmth", shape: "round", color: "#f4511e", accessory: "none", eye: "sleepy", flavor: "いちど はいると、にどと でてこられない", image: "fuyu-n9.webp", released: false },
  { id: "fuyu-n10", name: "みかんのむきじょうず", rarity: "N", theme: "warmth", shape: "round", color: "#ffa726", accessory: "none", eye: "dot", flavor: "かわを ひとつづきで むくのが じまん", image: "fuyu-n10.webp", released: false },
  { id: "fuyu-n11", name: "なべのぐつぐつ", rarity: "N", theme: "warmth", shape: "round", color: "#6d4c41", accessory: "none", eye: "dot", flavor: "みんなが かこむと、いちばん げんきに なる", image: "fuyu-n11.webp", released: false },
  { id: "fuyu-r7", name: "ゆたんぽのあしもと", rarity: "R", theme: "warmth", shape: "oval", color: "#ef9a9a", accessory: "none", eye: "closed", flavor: "ふとんの いちばん したで、あさまで あたためる", image: "fuyu-r7.webp", released: false },
  { id: "fuyu-r8", name: "おでんのしみしみ", rarity: "R", theme: "warmth", shape: "round", color: "#a97142", accessory: "none", eye: "sleepy", flavor: "じかんを かけるほど、あじが しみて おいしくなる", image: "fuyu-r8.webp", released: false },
  { id: "fuyu-sr4", name: "ふゆのだんろばん", rarity: "SR", theme: "warmth", shape: "oval", color: "#b71c1c", accessory: "none", eye: "star", sparkle: true, flavor: "いえの まんなかで、ひとばんじゅう ひを まもっている", image: "fuyu-sr4.webp", released: false },
  { id: "fuyu-n12", name: "ろうそくのちいさなひ", rarity: "N", theme: "winterlights", shape: "egg", color: "#fff59d", accessory: "none", eye: "dot", flavor: "ふけば きえてしまう、ちいさくて まっすぐな ひ", image: "fuyu-n12.webp", released: false },
  { id: "fuyu-n13", name: "まちのイルミネーション", rarity: "N", theme: "winterlights", shape: "round", color: "#7c4dff", accessory: "none", eye: "star", flavor: "まちじゅうを いっせいに きらきらさせる", image: "fuyu-n13.webp", released: false },
  { id: "fuyu-r9", name: "まどのゆげもよう", rarity: "R", theme: "winterlights", shape: "round", color: "#cfd8dc", accessory: "none", eye: "dot", flavor: "くもった まどに、ゆびで えを かける", image: "fuyu-r9.webp", released: false },
  { id: "fuyu-r10", name: "ほしぞらのふゆのおおいぬ", rarity: "R", theme: "winterlights", shape: "oval", color: "#1b2a80", accessory: "none", eye: "star", flavor: "ふゆの よぞらで、いちばん あかるく ひかる", image: "fuyu-r10.webp", released: false },
  { id: "fuyu-sr5", name: "ゆきあかりのしずけさ", rarity: "SR", theme: "winterlights", shape: "round", color: "#e0f7fa", accessory: "none", eye: "closed", sparkle: true, flavor: "ゆきが つもった よるだけ、まちが ほんのり あかるくなる", image: "fuyu-sr5.webp", released: false },
  { id: "fuyu-n14", name: "くまのねぼすけどん", rarity: "N", theme: "hibernation", shape: "round", color: "#7f5539", accessory: "none", eye: "closed", flavor: "はるまで ずっと ねている。おこしても おきない", image: "fuyu-n14.webp", released: false },
  { id: "fuyu-n15", name: "りすのためこみや", rarity: "N", theme: "hibernation", shape: "egg", color: "#d2691e", accessory: "tuft", eye: "dot", flavor: "どこに かくしたか、いつも わすれてしまう", image: "fuyu-n15.webp", released: false },
  { id: "fuyu-n16", name: "かえるのつちのなか", rarity: "N", theme: "hibernation", shape: "round", color: "#4caf50", accessory: "none", eye: "closed", flavor: "つちの したで、まるくなって はるを まつ", image: "fuyu-n16.webp", released: false },
  { id: "fuyu-r11", name: "ふゆごしのたねつぶ", rarity: "R", theme: "hibernation", shape: "egg", color: "#3e2723", accessory: "none", eye: "closed", flavor: "つちの したで、いちばん ちいさく なって まっている", image: "fuyu-r11.webp", released: false },
  { id: "fuyu-sr6", name: "ねむりのこもりうた", rarity: "SR", theme: "hibernation", shape: "oval", color: "#5e35b1", accessory: "book", eye: "closed", sparkle: true, flavor: "ふゆじゅう、つちの したの みんなに うたっている", image: "fuyu-sr6.webp", released: false },
  { id: "fuyu-sr7", name: "きたかぜのふきぬけ", rarity: "SR", theme: "wintersky", shape: "egg", color: "#546e7a", accessory: "none", eye: "dot", sparkle: true, flavor: "まちを いっきに ふきぬけて、みんなを ちぢこませる", image: "fuyu-sr7.webp", released: false },
  { id: "fuyu-r12", name: "しばれるあさのしろいき", rarity: "R", theme: "wintersky", shape: "round", color: "#edf3f7", accessory: "none", eye: "dot", flavor: "いきを はくと、しろく かたちに なる", image: "fuyu-r12.webp", released: false },
  { id: "fuyu-ur2", name: "オーロラのゆらめきひめ", rarity: "UR", theme: "wintersky", shape: "oval", color: "#69f0ae", accessory: "none", eye: "star", sparkle: true, flavor: "よぞらに みどりの ぬのを ひろげて ゆらめく", image: "fuyu-ur2.webp", released: false },
  { id: "fuyu-sr8", name: "ふゆのだいさんかく", rarity: "SR", theme: "wintersky", shape: "round", color: "#3949ab", accessory: "crown", eye: "star", sparkle: true, flavor: "みっつの ほしを むすんで、ふゆの よぞらを ささえる", image: "fuyu-sr8.webp", released: false },
  { id: "fuyu-ur3", name: "こおりのおおとりで", rarity: "UR", theme: "wintersky", shape: "oval", color: "#0097a7", accessory: "none", eye: "star", sparkle: true, flavor: "かわも うみも いっしゅんで こおらせる、でんせつの ふゆの ぬし", image: "fuyu-ur3.webp", released: false },
  { id: "fuyu-ur4", name: "ふゆぞらのせいれいおう", rarity: "UR", theme: "wintersky", shape: "round", color: "#bbdefb", accessory: "crown", eye: "closed", sparkle: true, flavor: "ふゆの すべての せいれいたちを まもる、しずかな おうさま", image: "fuyu-ur4.webp", released: false },
  { id: "haru-n1", name: "さくらのはつひとえ", rarity: "N", theme: "sakura", shape: "round", color: "#f8bbd0", accessory: "none", eye: "dot", flavor: "いちばん さいしょに ひらく、たったひとつの はなびら", image: "haru-n1.webp", released: false },
  { id: "haru-n2", name: "はなびらのまいおち", rarity: "N", theme: "sakura", shape: "egg", color: "#fce4ec", accessory: "tuft", eye: "closed", flavor: "ちった あとの ほうが、いちばん きれいに まう", image: "haru-n2.webp", released: false },
  { id: "haru-r1", name: "はざくらのみどりっこ", rarity: "R", theme: "sakura", shape: "round", color: "#81c784", accessory: "none", eye: "dot", flavor: "はなが おわった あとに、そっと でてくる みどりの は", image: "haru-r1.webp", released: false },
  { id: "haru-r2", name: "よざくらのぼんぼり", rarity: "R", theme: "sakura", shape: "round", color: "#ffecb3", accessory: "none", eye: "dot", flavor: "よるの さくらを したから てらす、ちいさな あかり", image: "haru-r2.webp", released: false },
  { id: "haru-ur1", name: "さくらふぶきのまいひめ", rarity: "UR", theme: "sakura", shape: "oval", color: "#ff80ab", accessory: "none", eye: "star", sparkle: true, flavor: "かぜが ふくと、はなびらを ぜんぶ まいあげて おどる", image: "haru-ur1.webp", released: false },
  { id: "haru-sr1", name: "いちりんのおくれざき", rarity: "SR", theme: "sakura", shape: "round", color: "#f06292", accessory: "none", eye: "dot", sparkle: true, flavor: "みんなが ちった あとに、ひとつだけ おそく さく", image: "haru-sr1.webp", released: false },
  { id: "haru-n3", name: "つくしのぼうやたち", rarity: "N", theme: "sprout", shape: "egg", color: "#aed581", accessory: "none", eye: "dot", flavor: "つちから いっせいに、せのびして あたまを だす", image: "haru-n3.webp", released: false },
  { id: "haru-n4", name: "たんぽぽのわたげとび", rarity: "N", theme: "sprout", shape: "round", color: "#fffde7", accessory: "none", eye: "dot", flavor: "かぜが ふいたら、みんな ばらばらに とんでいく", image: "haru-n4.webp", released: false },
  { id: "haru-n5", name: "ふきのとうのにがみくん", rarity: "N", theme: "sprout", shape: "round", color: "#8bc34a", accessory: "none", eye: "dot", flavor: "はるいちばんに でてくる。ちょっと にがい", image: "haru-n5.webp", released: false },
  { id: "haru-n6", name: "しんめのちいさなて", rarity: "N", theme: "sprout", shape: "egg", color: "#c5e1a5", accessory: "none", eye: "closed", flavor: "えだの さきで、まだ ひらいていない ちいさな め", image: "haru-n6.webp", released: false },
  { id: "haru-r3", name: "ねっこのしたばたらき", rarity: "R", theme: "sprout", shape: "egg", color: "#6b4f3a", accessory: "none", eye: "dot", flavor: "つちの したで、だれにも みられずに みずを はこぶ", image: "haru-r3.webp", released: false },
  { id: "haru-sr2", name: "めばえのめざましや", rarity: "SR", theme: "sprout", shape: "round", color: "#ffd740", accessory: "none", eye: "star", sparkle: true, flavor: "つちの したの みんなを、ひとりずつ おこして まわる", image: "haru-sr2.webp", released: false },
  { id: "haru-n7", name: "もんしろちょうのふらり", rarity: "N", theme: "springlife", shape: "round", color: "#f7f7f2", accessory: "tuft", eye: "dot", flavor: "まっすぐ とべない。いつも ふらふら している", image: "haru-n7.webp", released: false },
  { id: "haru-r4", name: "つばめのおかえり", rarity: "R", theme: "springlife", shape: "oval", color: "#263238", accessory: "tuft", eye: "dot", flavor: "とおい くにから、まいとし おなじ のきさきに もどってくる", image: "haru-r4.webp", released: false },
  { id: "haru-n8", name: "おたまじゃくしのあしはえ", rarity: "N", theme: "springlife", shape: "round", color: "#26c6da", accessory: "none", eye: "dot", flavor: "ある あさ、きゅうに あしが はえて びっくりする", image: "haru-n8.webp", released: false },
  { id: "haru-r5", name: "みつばちのはこびや", rarity: "R", theme: "springlife", shape: "round", color: "#fbc02d", accessory: "none", eye: "dot", flavor: "はなから はなへ、いちにちじゅう はたらいている", image: "haru-r5.webp", released: false },
  { id: "haru-r6", name: "はるのうぐいすこえならし", rarity: "R", theme: "springlife", shape: "oval", color: "#827717", accessory: "book", eye: "dot", flavor: "まだ うまく なけない。まいにち れんしゅうしている", image: "haru-r6.webp", released: false },
  { id: "haru-sr3", name: "ちょうのむれのみちしるべ", rarity: "SR", theme: "springlife", shape: "oval", color: "#ffb300", accessory: "comb-gold", eye: "star", sparkle: true, flavor: "むれの せんとうを とんで、みんなを はなばたけへ みちびく", image: "haru-sr3.webp", released: false },
  { id: "haru-n9", name: "なのはなのきいろばたけ", rarity: "N", theme: "flowerfield", shape: "round", color: "#ffee58", accessory: "crown", eye: "dot", flavor: "みわたす かぎり、いちめんの きいろ", image: "haru-n9.webp", released: false },
  { id: "haru-n10", name: "チューリップのならびっこ", rarity: "N", theme: "flowerfield", shape: "egg", color: "#ff5252", accessory: "none", eye: "dot", flavor: "いろちがいで きれいに ならんで さいている", image: "haru-n10.webp", released: false },
  { id: "haru-n11", name: "すみれのすみっこ", rarity: "N", theme: "flowerfield", shape: "round", color: "#673ab7", accessory: "none", eye: "dot", flavor: "みちの すみで、だれにも きづかれずに さいている", image: "haru-n11.webp", released: false },
  { id: "haru-r7", name: "はなつみのかごもち", rarity: "R", theme: "flowerfield", shape: "round", color: "#dce775", accessory: "none", eye: "dot", flavor: "つんだ はなを かごに いれて、まちじゅうに くばる", image: "haru-r7.webp", released: false },
  { id: "haru-sr4", name: "はなばたけのおうひ", rarity: "SR", theme: "flowerfield", shape: "oval", color: "#ba68c8", accessory: "none", eye: "star", sparkle: true, flavor: "はなばたけ ぜんたいの さくじゅんを きめる", image: "haru-sr4.webp", released: false },
  { id: "haru-n12", name: "はるさめのしとしと", rarity: "N", theme: "springrain", shape: "egg", color: "#aed9e0", accessory: "none", eye: "closed", flavor: "おとを たてずに、しずかに いちにちじゅう ふる", image: "haru-n12.webp", released: false },
  { id: "haru-n13", name: "かすみのぼんやり", rarity: "N", theme: "springrain", shape: "round", color: "#e6e0ec", accessory: "none", eye: "sleepy", flavor: "まちを ぼんやり かすませて、とおくを かくす", image: "haru-n13.webp", released: false },
  { id: "haru-r8", name: "はるかぜのいたずら", rarity: "R", theme: "springrain", shape: "egg", color: "#40c4ff", accessory: "tuft", eye: "star", flavor: "ぼうしや せんたくものを、ふわっと さらっていく", image: "haru-r8.webp", released: false },
  { id: "haru-sr5", name: "にじのかけはし", rarity: "SR", theme: "springrain", shape: "round", color: "#f5f0ff", accessory: "comb-gold", eye: "star", sparkle: true, flavor: "あめが あがると、そらに はしを かける", image: "haru-sr5.webp", released: false },
  { id: "haru-sr6", name: "はなぐもりのそらもよう", rarity: "SR", theme: "springrain", shape: "round", color: "#d1c4e9", accessory: "none", eye: "sleepy", sparkle: true, flavor: "さくらの ころだけ、そらが うすぐもりに なる", image: "haru-sr6.webp", released: false },
  { id: "haru-n14", name: "ひなにんぎょうのだんかざり", rarity: "N", theme: "springevents", shape: "round", color: "#e57373", accessory: "tuft", eye: "dot", flavor: "いちねんに いちにちだけ、ならんで かざられる", image: "haru-n14.webp", released: false },
  { id: "haru-n15", name: "こいのぼりのおよぎや", rarity: "N", theme: "springevents", shape: "oval", color: "#1e88e5", accessory: "tuft", eye: "star", flavor: "かぜが ふいたときだけ、そらを およげる", image: "haru-n15.webp", released: false },
  { id: "haru-n16", name: "さくらもちのはっぱごと", rarity: "N", theme: "springevents", shape: "round", color: "#ffc1d8", accessory: "none", eye: "dot", flavor: "はっぱごと たべるか、のこすかで いつも もめる", image: "haru-n16.webp", released: false },
  { id: "haru-r9", name: "いちごのつぶつぶ", rarity: "R", theme: "springevents", shape: "round", color: "#f44336", accessory: "none", eye: "star", flavor: "あかくて あまい。はるの いちばん にんきもの", image: "haru-r9.webp", released: false },
  { id: "haru-r10", name: "よもぎのくさもち", rarity: "R", theme: "springevents", shape: "round", color: "#388e3c", accessory: "none", eye: "dot", flavor: "のはらの かおりを、そのまま もちに とじこめた", image: "haru-r10.webp", released: false },
  { id: "haru-sr7", name: "はるのしんがくぼう", rarity: "SR", theme: "springevents", shape: "egg", color: "#303f9f", accessory: "none", eye: "star", sparkle: true, flavor: "まっさらな かばんを もって、あたらしい みちを あるきだす", image: "haru-sr7.webp", released: false },
  { id: "haru-r11", name: "ひばりのたかのぼり", rarity: "R", theme: "springsky", shape: "oval", color: "#ab9080", accessory: "none", eye: "dot", flavor: "そらの たかいところで、とまったまま さえずる", image: "haru-r11.webp", released: false },
  { id: "haru-r12", name: "かげろうのゆらゆら", rarity: "R", theme: "springsky", shape: "egg", color: "#ffd8a8", accessory: "none", eye: "sleepy", flavor: "あたたかい ひに、じめんが ゆらゆら ゆれてみえる", image: "haru-r12.webp", released: false },
  { id: "haru-ur2", name: "はるのおぼろづき", rarity: "UR", theme: "springsky", shape: "round", color: "#fff9c4", accessory: "none", eye: "closed", sparkle: true, flavor: "かすんで、ぼんやり やさしく ひかる つき", image: "haru-ur2.webp", released: false },
  { id: "haru-sr8", name: "はるいちばんのかけぬけ", rarity: "SR", theme: "springsky", shape: "egg", color: "#4fc3f7", accessory: "none", eye: "star", sparkle: true, flavor: "いちねんで さいしょの つよい みなみかぜ", image: "haru-sr8.webp", released: false },
  { id: "haru-ur3", name: "めざめのおおとりで", rarity: "UR", theme: "springsky", shape: "oval", color: "#43a047", accessory: "none", eye: "star", sparkle: true, flavor: "つちの したの すべてを いっせいに めざめさせる、はるの ぬし", image: "haru-ur3.webp", released: false },
  { id: "haru-ur4", name: "はるぞらのせいれいおう", rarity: "UR", theme: "springsky", shape: "round", color: "#ffca28", accessory: "crown", eye: "star", sparkle: true, flavor: "はるの すべての せいれいたちを おこす、あかるい おうさま", image: "haru-ur4.webp", released: false },
];

// 秋冬春120体は追加コンテンツとして温存中（released:false）。公開までは
// ガチャ・図鑑・カード総数表示のいずれからも見えない（夏40体のみ運用）。
const RELEASED_CARD_POOL = CARD_POOL.filter((c) => c.released !== false);

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
    return `<img class="card-art" src="${cardImageDir()}/${cardDef.image}" alt="${cardName(cardDef)}" loading="lazy">`;
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
        <img class="card-art card-art--full" src="${cardImageDir()}/${cardDef.image}" alt="${cardName(cardDef)}" loading="lazy">
        ${count > 1 ? `<div class="card-count">× ${count}</div>` : ""}
      </div>
    `;
  }

  const theme = THEME_INFO[cardDef.theme];
  const nameLine = `${theme ? `<span class="card-theme-icon" title="${theme.label}">${theme.icon}</span> ` : ""}${cardName(cardDef)}`;
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

  // ランクアップ演出は、オーバーレイを閉じて body の overflow:hidden が外れたあとで
  // スクロールしないと無効化される（閉じる前はスクロールしても画面に反映されない）。
  const levelupBox = document.getElementById("gacha-levelup-box");
  if (!levelupBox.classList.contains("hidden")) {
    levelupBox.scrollIntoView({ behavior: "smooth", block: "center" });
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

  // 無料プランのときの分母は「引けるカードの数」。集めきれない枚数を分母に入れると
  // 永久に埋まらないバーになってしまうため。
  const drawable = drawableCardPool();
  const drawableTotal = drawable.length;

  // 🔴 分子は分母と同じ母集団だけを数える。
  //    所持カード全部を数えると「30 / 28」のように分子が分母を超える。
  //    有料をやめた人は SR・UR を取り上げられない仕様なので、無料に戻ると必ずこうなった。
  //    持っているプレミアムは図鑑に通常表示され、下の premiumNote でも案内される。
  const ownedCount = drawable.filter((c) => owned[c.id]).length;

  document.getElementById("collection-count-line").textContent =
    t(isFamily ? "collection.countFamily" : "collection.count", { owned: ownedCount, total: drawableTotal });

  // プレミアム限定のうち、まだ持っていない枚数だけを案内する
  const premiumLockedCount = isPaidPlan()
    ? 0
    : RELEASED_CARD_POOL.filter((c) => isPremiumRarity(c.rarity) && !owned[c.id]).length;
  const premiumNote = document.getElementById("collection-premium-note");
  if (premiumNote) {
    premiumNote.textContent = premiumLockedCount ? t("collection.premiumNote", { n: premiumLockedCount }) : "";
    premiumNote.classList.toggle("hidden", premiumLockedCount === 0);
  }

  const grid = document.getElementById("collection-grid");
  grid.innerHTML = RELEASED_CARD_POOL.map((card) => {
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

  setGuide("collection");
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
      ? t("math.add1.explainTen", { b, sum })
      : t("math.add1.explainSplit", { a, aOnes, b, part: aOnes + b, sum });
  } else if (sum > 10) {
    const toTen = 10 - a;
    const rest = b - toTen;
    explain = t("math.add1.explainMakeTen", { a, toTen, rest, sum });
  } else {
    explain = t("math.add1.explainPlain", { a, b, sum });
  }
  return { text: `${a} ＋ ${b} = ?`, answer: String(sum), type: "number",
    hint: t("math.add1.hint", { a, b }), explain };
}

function genSub1() {
  const a = randInt(2, 18), b = randInt(1, a - 1);
  const diff = a - b;
  let explain;
  if (a < 10) {
    explain = t("math.sub1.explainPlain", { a, b, diff });
  } else {
    const aOnes = a - 10;
    if (aOnes === 0) {
      explain = t("math.sub1.explainFromTen", { b, diff });
    } else if (b <= aOnes) {
      explain = t("math.sub1.explainSplit", { a, aOnes, b, part: aOnes - b, diff });
    } else {
      const borrow = 10 - b;
      explain = t("math.sub1.explainBorrow", { a, aOnes, b, borrow, diff });
    }
  }
  return { text: `${a} － ${b} = ?`, answer: String(diff), type: "number",
    hint: t("math.sub1.hint", { a, b }), explain };
}

function genAdd2() {
  const a = randInt(10, 99), b = randInt(10, 99);
  const aOnes = a % 10, bOnes = b % 10;
  const aTens = Math.floor(a / 10), bTens = Math.floor(b / 10);
  const onesSum = aOnes + bOnes;
  const params = { aOnes, bOnes, onesSum, aTens, bTens, tensSum: aTens + bTens, tensSumCarry: aTens + bTens + 1, sum: a + b };
  const explain = onesSum >= 10
    ? t("math.add2.explainCarry", params)
    : t("math.add2.explainPlain", params);
  return { text: `${a} ＋ ${b} = ?`, answer: String(a + b), type: "number",
    hint: t("math.add2.hint"), explain };
}

function genSub2() {
  const a = randInt(20, 99), b = randInt(10, a - 1);
  return { text: `${a} － ${b} = ?`, answer: String(a - b), type: "number",
    hint: t("math.sub2.hint"),
    explain: t("math.sub2.explain", { a, b, diff: a - b }) };
}

function genMul2() {
  const a = randInt(2, 9), b = randInt(2, 9);
  const terms = Array(b).fill(a).join("＋");
  return { text: `${a} × ${b} = ?`, answer: String(a * b), type: "number",
    hint: t("math.mul2.hint", { a }),
    explain: t("math.mul2.explain", { a, b, terms, product: a * b }) };
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
    text: `${a} ＋ ${b} = ?`,
    answer: `${a + b}`,
    type: "number",
    hint: t("math.add3.hint"),
    explain: t("math.add3.explain", { a, b, aParts: decompose(a), bParts: decompose(b), sum: a + b }),
  };
}

// 3〜4桁のひき算を、位ごとに くり下がりの有無を示しながら説明する。
// genAdd2 の explainCarry（一の位→十の位の1回のくり上がり）を、
// 桁数可変・複数回のくり下がりに対応させたもの。
const SUB3_PLACE_KEYS = ["math.placeOnes", "math.placeTens", "math.placeHundreds", "math.placeThousands"];
function subtractStepsExplain(a, b) {
  const digitAt = (n, i) => Math.floor(n / 10 ** i) % 10;
  const len = String(a).length;
  let borrowIn = 0;
  const lines = [];
  for (let i = 0; i < len; i++) {
    const place = t(SUB3_PLACE_KEYS[i]);
    const bot = digitAt(b, i);
    const hadBorrowIn = borrowIn > 0;
    // 位の数字が0で、さらに下の位への貸し出し分も差し引く場合、そのままだと負の数になる。
    // 「-1」のようなマイナスをそのまま見せると小学生には分からないので、10を足して
    // 正しい1桁の数字（＝さらに上の位からも借りている状態）にそろえる。
    let top = digitAt(a, i) - borrowIn;
    let cascaded = false;
    if (top < 0) {
      top += 10;
      cascaded = true;
    }
    if (top < bot) {
      const borrowedTop = top + 10;
      lines.push(t("math.sub3.stepBorrowOut", { place, top, bot, borrowedTop, digit: borrowedTop - bot }));
      borrowIn = 1;
    } else if (cascaded || hadBorrowIn) {
      lines.push(t("math.sub3.stepBorrowIn", { place, top, bot, digit: top - bot }));
      borrowIn = cascaded ? 1 : 0;
    } else {
      lines.push(t("math.sub3.step", { place, top, bot, digit: top - bot }));
      borrowIn = 0;
    }
  }
  const sep = t("common.sentenceSep");
  return `${lines.join(sep)}${sep}${t("math.sub3.final", { a, b, diff: a - b })}`;
}

function genSub3() {
  let a = randInt(100, 9000);
  let b = randInt(100, 9000);
  if (b > a) [a, b] = [b, a];
  if (a === b) a += 1;
  return {
    text: `${a} － ${b} = ?`,
    answer: `${a - b}`,
    type: "number",
    hint: t("math.sub3.hint"),
    explain: subtractStepsExplain(a, b),
  };
}

function genMul3() {
  const a = randInt(11, 99);
  const b = randInt(2, 9);
  const tens = Math.floor(a / 10) * 10;
  const ones = a % 10;
  return {
    text: `${a} × ${b} = ?`,
    answer: `${a * b}`,
    type: "number",
    hint: t("math.mul3.hint", { a, b }),
    explain: t("math.mul3.explain", { tens, ones, b, tensPart: tens * b, onesPart: ones * b, product: a * b }),
  };
}

function genDiv3() {
  const b = randInt(2, 9);
  const q = randInt(2, 9);
  const a = b * q;
  return {
    text: `${a} ÷ ${b} = ?`,
    answer: `${q}`,
    type: "number",
    hint: t("math.div3.hint", { a, b }),
    explain: t("math.div3.explain", { a, b, q }),
  };
}

function genDivRemainder3() {
  const b = randInt(2, 12);
  const q = randInt(2, 12);
  const r = randInt(1, b - 1);
  const a = b * q + r;
  return {
    text: t("math.divRemainder3.text", { a, b }),
    answer: t("math.divRemainder3.answer", { q, r }),
    // 表記ゆれの受け入れ（日本語なら「あまり」と「余り」）。言語ごとに増やせるよう
    // 配列で持つ。answer 自身は必ず先頭に入れる。
    accept: [t("math.divRemainder3.answer", { q, r }),
             ...tList("math.divRemainder3.accept").map((f) => f.replace("{q}", q).replace("{r}", r))],
    type: "text",
    hint: t("math.divRemainder3.hint", { a, b }),
    explain: t("math.divRemainder3.explain", { a, b, q, r, product: b * q }),
  };
}

function randNonMultipleOf10(min, max) {
  let n;
  do { n = randInt(min, max); } while (n % 10 === 0);
  return n;
}

// 小数の表示をロケールに合わせる（スペイン語の学校では小数点にカンマを使う）。
// checkAnswer() は既にカンマ入力を許容しているので、表示側もここで揃える。
// 内部で比較に使う answer 文字列（ピリオド区切り）自体は変えず、画面に出す直前だけ通す。
function fmtDecimal(n) {
  const s = String(n);
  return getLocale() === "es" ? s.replace(".", ",") : s;
}

function genDecimal3() {
  const na = randNonMultipleOf10(1, 50);
  let nb;
  do { nb = randNonMultipleOf10(1, 50); } while (nb === na);
  const a = na / 10, b = nb / 10;
  const isAdd = Math.random() < 0.5;
  const hint = t("math.decimal3.hint");
  if (isAdd) {
    const answer = roundedText(a + b);
    const explain = t("math.decimal3.explainAdd", { a: fmtDecimal(a), b: fmtDecimal(b), na, nb, raw: na + nb, answer: fmtDecimal(answer) });
    return { text: `${fmtDecimal(a)} ＋ ${fmtDecimal(b)} = ?`, answer, type: "number", hint, explain };
  }
  const hiRaw = Math.max(na, nb), loRaw = Math.min(na, nb);
  const hi = hiRaw / 10, lo = loRaw / 10;
  const answer = roundedText(hi - lo);
  const explain = t("math.decimal3.explainSub", { hi: fmtDecimal(hi), lo: fmtDecimal(lo), hiRaw, loRaw, raw: hiRaw - loRaw, answer: fmtDecimal(answer) });
  return { text: `${fmtDecimal(hi)} － ${fmtDecimal(lo)} = ?`, answer, type: "number", hint, explain };
}

// 約分が起きたときは解説に一手足す。起きなければ何も足さない（S3-2）。
function reduceExplainSuffix(rawNum, d, result) {
  if (result.den === d) return "";
  const g = gcd(rawNum, d);
  return t("math.fraction.reduceSuffix", { rawNum, d, g, reduced: fractionToText(result) });
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
      text: `${n1}/${d} ＋ ${n2}/${d} = ?`,
      answer: fractionToText(result),
      type: "fraction",
      hint: t("math.fractionSame3.hintAdd"),
      explain: t("math.fractionSame3.explainAdd", { n1, n2, sum, d }) + reduceExplainSuffix(sum, d, result),
    };
  }
  const n1 = randInt(2, d);
  const n2 = randInt(1, n1 - 1);
  const diff = n1 - n2;
  const result = reduceFraction(diff, d);
  return {
    text: `${n1}/${d} － ${n2}/${d} = ?`,
    answer: fractionToText(result),
    type: "fraction",
    hint: t("math.fractionSame3.hintSub"),
    explain: t("math.fractionSame3.explainSub", { n1, n2, diff, d }) + reduceExplainSuffix(diff, d, result),
  };
}

// ===== 文章題の語彙（言語ごと） =====
// 数の作り方は言語に依存しないが、登場人物・品物・場所は言語ごとに要る。
// 生成器そのものは1つのまま保つ（複製すると、question-audit.md が何ヶ月もかけて
// 潰してきた正誤バグが二重管理になる）。
//
// 言語ごとに必要なものが違うので、品物は「その言語の文が必要とする欄」を持つ。
//   ja … counter（助数詞）と howMany（「なんこ」）。
//        ⚠️ 助数詞は**全品目「こ」で統一**している。従来の出力と1文字も変えないため。
//           本来シールは「まい」だが、変えると既存の日本語版の問題文が変わってしまう
//   es … 複数形と、数をたずねる語（Cuántos / Cuántas は名詞の性で変わる）
//
// edible は「たべました／つかいました」の出し分け用（えんぴつを食べる文を作らないため）。
const MATH_WORDS = {
  ja: {
    names: ["ゆうたくん", "さくらさん", "けんとくん", "みおさん", "たろうくん", "はなさん"],
    items: [
      { w: "りんご", counter: "こ", howMany: "なんこ", edible: true },
      { w: "みかん", counter: "こ", howMany: "なんこ", edible: true },
      { w: "あめ", counter: "こ", howMany: "なんこ", edible: true },
      { w: "クッキー", counter: "こ", howMany: "なんこ", edible: true },
      { w: "えんぴつ", counter: "こ", howMany: "なんこ", edible: false },
      { w: "シール", counter: "こ", howMany: "なんこ", edible: false },
      { w: "おりがみ", counter: "こ", howMany: "なんこ", edible: false },
      { w: "どんぐり", counter: "こ", howMany: "なんこ", edible: false },
    ],
    places: ["はこの中", "つくえの上", "かごの中", "ふくろの中"],
    consumed: { edible: { past: "たべました", plain: "たべた" }, other: { past: "つかいました", plain: "つかった" } },
    // 四捨五入する位（genRounding4）。label は「◯の位」、lower はその1つ下の位。
    roundPlaces: [
      { label: "十", unit: 10, lower: "一" },
      { label: "百", unit: 100, lower: "十" },
      { label: "千", unit: 1000, lower: "百" },
    ],
    // 大きな数の単位（genWordBigNumber4）。
    // ⚠️ 桁の区切り方は言語で違う。日本語は万（10^4）・億（10^8）、
    //    スペイン語は mil（10^3）・millón（10^6）。倍率ごと言語側に持たせる。
    bigUnits: [
      { label: "万", what: "人口", amount: "人" },
      { label: "億", what: "予算", amount: "円" },
    ],
    bigPlaces: ["市", "町", "県"],
    // 見積もり（genWordEstimate4）で使う位。unit は丸める単位。
    estimatePlaces: [{ label: "百", unit: 100 }, { label: "千", unit: 1000 }],
    areaPlaces: ["きょうしつ", "花だん", "にわ", "ちゅう車場"],
    amountItems: [
      { name: "ジュース", unit: "L" },
      { name: "水", unit: "L" },
      { name: "さとう", unit: "kg" },
    ],
    // 比例（genWordProportion4）。heavy=true は重さ（1mあたり数g）、false はねだん。
    proportionItems: [
      { name: "はりがね", unit: "m", amount: "g", word: "重さ", heavy: true },
      { name: "リボン", unit: "m", amount: "円", word: "ねだん", heavy: false },
    ],
    // 1あたりの量（genWordPerUnit5）
    perUnitItems: [
      { unit: "m", item: "リボン", per: "g", label: "おもさ" },
      { unit: "こ", item: "あめ", per: "円", label: "ねだん" },
      { unit: "L", item: "ペンキ", per: "㎡", label: "ぬれる面積" },
      { unit: "さつ", item: "ノート", per: "円", label: "ねだん" },
      { unit: "本", item: "えんぴつ", per: "円", label: "ねだん" },
    ],
    // 並べ方（genCombination6）で使う色
    colors: ["あか", "あお", "きいろ", "みどり", "むらさき", "オレンジ", "ピンク", "みずいろ"],
  },
  es: {
    names: ["Mateo", "Lucía", "Diego", "Sofía", "Pablo", "Elena"],
    items: [
      { w: "manzanas", counter: "", howMany: "Cuántas", edible: true },
      { w: "mandarinas", counter: "", howMany: "Cuántas", edible: true },
      { w: "caramelos", counter: "", howMany: "Cuántos", edible: true },
      { w: "galletas", counter: "", howMany: "Cuántas", edible: true },
      { w: "lápices", counter: "", howMany: "Cuántos", edible: false },
      { w: "pegatinas", counter: "", howMany: "Cuántas", edible: false },
      { w: "canicas", counter: "", howMany: "Cuántas", edible: false },
      { w: "bellotas", counter: "", howMany: "Cuántas", edible: false },
    ],
    places: ["en la caja", "encima del pupitre", "en la cesta", "en la bolsa"],
    consumed: { edible: { past: "se comieron", plain: "comerse" }, other: { past: "se usaron", plain: "usar" } },
    roundPlaces: [
      { label: "las decenas", unit: 10, lower: "las unidades" },
      { label: "las centenas", unit: 100, lower: "las decenas" },
      { label: "los millares", unit: 1000, lower: "las centenas" },
    ],
    // ⚠️ 桁の区切り方が日本語と違う（万・億 ではなく mil・millones）。
    //    倍率そのものは「単位のいくつぶんか」を答えさせる問題なので影響しない。
    bigUnits: [
      { label: "mil", what: "La población", amount: "habitantes" },
      { label: "millones", what: "El presupuesto", amount: "euros" },
    ],
    bigPlaces: ["una ciudad", "un pueblo", "una provincia"],
    estimatePlaces: [{ label: "las centenas", unit: 100 }, { label: "los millares", unit: 1000 }],
    areaPlaces: ["el aula", "el jardín", "el patio", "el aparcamiento"],
    amountItems: [
      { name: "zumo", unit: "L" },
      { name: "agua", unit: "L" },
      { name: "azúcar", unit: "kg" },
    ],
    proportionItems: [
      { name: "alambre", unit: "m", amount: "g", word: "el peso", heavy: true },
      { name: "cinta", unit: "m", amount: "céntimos", word: "el precio", heavy: false },
    ],
    // ⚠️ unit（数える単位）と item（品物）が同じ語にならないようにする。
    //    「caramelos de caramelos」のような文になる。
    //    label は不定冠詞つき（「tienen un peso de …」と続けるため）。
    // unitSg は「por cada …」に置く単数形（複数形のままだと "por cada cajas" になる）。
    perUnitItems: [
      { unit: "m", unitSg: "m", item: "cinta", per: "g", label: "un peso" },
      { unit: "kg", unitSg: "kg", item: "caramelos", per: "céntimos", label: "un precio" },
      { unit: "L", unitSg: "L", item: "pintura", per: "m²", label: "una cobertura" },
      { unit: "paquetes", unitSg: "paquete", item: "cuadernos", per: "céntimos", label: "un precio" },
      { unit: "cajas", unitSg: "caja", item: "lápices", per: "céntimos", label: "un precio" },
    ],
    colors: ["rojo", "azul", "amarillo", "verde", "morado", "naranja", "rosa", "celeste"],
  },
};

function mathWords() {
  return MATH_WORDS[getLocale()] || MATH_WORDS[DEFAULT_LOCALE];
}

// 文章題の1問ぶんの語彙をまとめて取り出す。生成器はこれを t() にそのまま渡す。
// 使わない欄がある言語もあるが、t() は使わない {param} を無視するので害はない。
function pickWordItem(opts) {
  const w = mathWords();
  const pool = opts && opts.edible !== undefined
    ? w.items.filter((it) => it.edible === opts.edible)
    : w.items;
  const it = pick(pool);
  return { item: it.w, c: it.counter, howMany: it.howMany };
}

function pickWordNames(n) {
  return shuffle(mathWords().names).slice(0, n);
}

function pickWordPlaces(n) {
  return shuffle(mathWords().places).slice(0, n);
}

function genWordAdd() {
  const w = pickWordItem();
  const a = randInt(3, 12);
  const b = randInt(2, Math.min(12, 20 - a));
  return {
    text: t("math.wordAdd.text", { ...w, a, b }),
    answer: `${a + b}`,
    type: "number",
    hint: t("math.wordAdd.hint"),
    explain: t("math.wordAdd.explain", { ...w, a, b, sum: a + b }),
  };
}

// 「えんぴつを たべました」のような不自然な文にならないよう、
// 数が減る場面の動詞は、食べ物かどうかで変える。
function pickConsumable() {
  const edible = Math.random() < 0.5;
  const verbs = mathWords().consumed[edible ? "edible" : "other"];
  return { ...pickWordItem({ edible }), past: verbs.past, plain: verbs.plain };
}

function genWordSub() {
  const w = pickConsumable();
  const bigger = randInt(3, 18);
  const b = randInt(1, bigger - 1);
  return {
    text: t("math.wordSub.text", { ...w, bigger, b }),
    answer: `${bigger - b}`,
    type: "number",
    hint: t("math.wordSub.hint", { plain: w.plain }),
    explain: t("math.wordSub.explain", { ...w, bigger, b, rest: bigger - b }),
  };
}

function genWordMul() {
  const w = pickWordItem();
  const perBag = randInt(2, 9);
  const bags = randInt(2, 9);
  return {
    text: t("math.wordMul.text", { ...w, perBag, bags }),
    answer: `${perBag * bags}`,
    type: "number",
    hint: t("math.wordMul.hint"),
    explain: t("math.wordMul.explain", { ...w, perBag, bags, total: perBag * bags }),
  };
}

function genWordDiv() {
  const w = pickWordItem();
  const people = randInt(2, 9);
  const each = randInt(2, 9);
  const total = people * each;
  return {
    text: t("math.wordDiv.text", { ...w, total, people }),
    answer: `${each}`,
    type: "number",
    hint: t("math.wordDiv.hint"),
    explain: t("math.wordDiv.explain", { ...w, total, people, each }),
  };
}

function genWordCompare() {
  const [nameA, nameB] = pickWordNames(2);
  const w = pickWordItem();
  const b = randInt(6, 40);
  // 「すくなく」のとき答えが負や0にならないよう、差は b 未満に収める
  const diff = randInt(2, Math.min(20, b - 1));
  const isMore = Math.random() < 0.5;
  const params = { ...w, nameA, nameB, b, diff, total: isMore ? b + diff : b - diff };
  return {
    text: t(isMore ? "math.wordCompare.textMore" : "math.wordCompare.textLess", params),
    answer: isMore ? `${b + diff}` : `${b - diff}`,
    type: "number",
    hint: t(isMore ? "math.wordCompare.hintMore" : "math.wordCompare.hintLess"),
    explain: t(isMore ? "math.wordCompare.explainMore" : "math.wordCompare.explainLess", params),
  };
}

// 合併（「あわせて いくつ」）。genWordAdd の増加（あとから もらう）と同じ たし算だが、
// 文章の型が違う。たし算しか習っていない時期でも、見た目の変化をつけられる。
function genWordAddCombine() {
  // 種類の違うものを合算すると不自然になるので、同じものが2か所にある形にする
  const w = pickWordItem();
  const [place1, place2] = pickWordPlaces(2);
  const a = randInt(3, 12);
  const b = randInt(2, Math.min(12, 20 - a));
  const params = { ...w, place1, place2, a, b, sum: a + b };
  return {
    text: t("math.wordAddCombine.text", params),
    answer: `${a + b}`,
    type: "number",
    hint: t("math.wordAddCombine.hint"),
    explain: t("math.wordAddCombine.explain", params),
  };
}

// 求差（「ちがいは いくつ」）。genWordSub の求残（たべて のこりは）と同じ ひきざんだが、
// 「へらす」のではなく「くらべる」場面なので、考え方の練習になる。
function genWordSubDiff1() {
  const [nameA, nameB] = pickWordNames(2);
  const w = pickWordItem();
  const a = randInt(3, 18);
  const b = randInt(1, a - 1);
  const params = { ...w, nameA, nameB, a, b, diff: a - b };
  return {
    text: t("math.wordSubDiff1.text", params),
    answer: `${a - b}`,
    type: "number",
    hint: t("math.wordSubDiff1.hint"),
    explain: t("math.wordSubDiff1.explain", params),
  };
}

// 3口の計算（たして、ひく）。2つの式を順にたどる練習。
function genWordAddSub1() {
  const w = pickConsumable();
  const a = randInt(3, 12);
  const b = randInt(2, Math.min(8, 20 - a));
  // のこりが0以下にならないようにする（答えが0の問題は学習価値が低い）
  const c = randInt(2, Math.min(10, a + b - 1));
  // ⚠️ ローカル変数 c（3つ目の数）と、語彙側の c（助数詞）が名前でぶつかる。
  //    数のほうを c2 として渡す。逆にすると助数詞が数字に化ける。
  const params = { ...w, a, b, c2: c, sum: a + b, rest: a + b - c };
  return {
    text: t("math.wordAddSub1.text", params),
    answer: `${a + b - c}`,
    type: "number",
    hint: t("math.wordAddSub1.hint", { plain: w.plain }),
    explain: t("math.wordAddSub1.explain", params),
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
        text: t("math.wordLength2.textAdd", { a, b }),
        answer: `${a + b}`,
        type: "number",
        hint: t("math.wordLength2.hintAdd"),
        explain: t("math.wordLength2.explainAdd", { a, b, sum: a + b }),
      }
    : {
        text: t("math.wordLength2.textSub", { a, b }),
        answer: `${a - b}`,
        type: "number",
        hint: t("math.wordLength2.hintSub"),
        explain: t("math.wordLength2.explainSub", { a, b, diff: a - b }),
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
    text: t("math.wordDivRemainder3.text", { total, perCar }),
    answer: `${cars + 1}`,
    type: "number",
    hint: t("math.wordDivRemainder3.hint", { total, perCar }),
    explain: t("math.wordDivRemainder3.explain", { total, perCar, cars, rest, need: cars + 1 }),
  };
}

// アレイ図（たて×よこ）。genWordMul の「1ふくろに◯こずつ」と同じ かけ算だが、
// ならんでいる形から数える場面なので、かけ算の意味の理解につながる。
function genWordMulArray2() {
  const rows = randInt(2, 9);
  const cols = randInt(2, 9);
  return {
    text: t("math.wordMulArray2.text", { rows, cols }),
    answer: `${rows * cols}`,
    type: "number",
    hint: t("math.wordMulArray2.hint"),
    explain: t("math.wordMulArray2.explain", { rows, cols, total: rows * cols }),
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
    return t("math.divLong4.explainExact", { a: rawDividend, b: divisor, qTens, tensPart });
  }
  const onesPart = divisor * qOnes;
  return t("math.divLong4.explainSplit", { a: rawDividend, b: divisor, q: rawQuotient, qTens, qOnes, tensPart, onesPart });
}

function genDivLong4() {
  const b = randInt(3, 9);
  const q = randInt(12, 99);
  const a = b * q;
  return {
    text: `${a} ÷ ${b} = ?`,
    answer: String(q),
    type: "number",
    hint: t("math.divLong4.hint"),
    explain: distributiveDivideExplain(a, b, q),
  };
}

function genDecimalAddSub4() {
  let aRaw, bRaw;
  do { aRaw = randInt(101, 999); } while (aRaw % 100 === 0);
  do { bRaw = randInt(101, 999); } while (bRaw % 100 === 0 || bRaw === aRaw);
  const a = aRaw / 100, b = bRaw / 100;
  const isAdd = Math.random() < 0.5;
  const bigRaw = Math.max(aRaw, bRaw), smallRaw = Math.min(aRaw, bRaw);
  const big = bigRaw / 100, small = smallRaw / 100;
  const answer = isAdd
    ? String(Math.round((a + b) * 100) / 100)
    : String(Math.round((big - small) * 100) / 100);
  const explain = isAdd
    ? t("math.decimalAddSub4.explainAdd", { a: fmtDecimal(a), b: fmtDecimal(b), aRaw, bRaw, raw: aRaw + bRaw, answer: fmtDecimal(answer) })
    : t("math.decimalAddSub4.explainSub", { big: fmtDecimal(big), small: fmtDecimal(small), bigRaw, smallRaw, raw: bigRaw - smallRaw, answer: fmtDecimal(answer) });
  return {
    text: isAdd ? `${fmtDecimal(a)} ＋ ${fmtDecimal(b)} = ?` : `${fmtDecimal(big)} － ${fmtDecimal(small)} = ?`,
    answer,
    type: "number",
    hint: t("math.decimalAddSub4.hint"),
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
      ? t("math.rectArea4.textSquare", { side })
      : t("math.rectArea4.textRect", { h, w }),
    answer: String(isSquare ? side * side : w * h),
    type: "number",
    hint: t(isSquare ? "math.rectArea4.hintSquare" : "math.rectArea4.hintRect"),
    explain: isSquare
      ? t("math.rectArea4.explainSquare", { side, area: side * side })
      : t("math.rectArea4.explainRect", { h, w, area: h * w }),
  };
}

function genRounding4() {
  const n = randInt(1234, 98765);
  const place = pick(mathWords().roundPlaces);
  const answer = Math.round(n / place.unit) * place.unit;
  const lowerDigit = Math.floor(n / (place.unit / 10)) % 10;
  const decision = t(lowerDigit >= 5 ? "math.rounding4.up" : "math.rounding4.down");
  const params = { n, place: place.label, lower: place.lower, lowerDigit, decision, answer };
  return {
    text: t("math.rounding4.text", params),
    answer: String(answer),
    type: "number",
    hint: t("math.rounding4.hint", params),
    explain: t("math.rounding4.explain", params),
  };
}

function genAngle4() {
  const a = randInt(20, 120);
  const b = randInt(20, 170 - a);
  return {
    text: t("math.angle4.text", { a, b }),
    answer: String(180 - a - b),
    type: "number",
    hint: t("math.angle4.hint"),
    explain: t("math.angle4.explain", { a, b, rest: 180 - a - b }),
  };
}

function genWordUnit4() {
  const m = randInt(2, 9);
  const cm = randInt(10, 99);
  const total = m * 100 + cm;
  return {
    text: t("math.wordUnit4.text", { total, m }),
    answer: String(cm),
    type: "number",
    hint: t("math.wordUnit4.hint"),
    explain: t("math.wordUnit4.explain", { total, m, cm }),
  };
}

// --- 4年の文章題 ---
// genWordUnit4（単位換算）1つしかなく、4年生の内容がセッションに乗りにくかったので追加した。
// 計算系（genRectArea4 / genRounding4 / genAngle4）と場面が重ならないようにしてある。

// 大きい数（万・億）。4年の1学期最初の単元なので、年度のはじめから出す。
function genWordBigNumber4() {
  const base = randInt(12, 98);
  const times = randInt(2, 9);
  const w = mathWords();
  // 6:4 で人口（万）と予算（億）を出し分ける。従来の比率を保つ。
  const u = Math.random() < 0.6 ? w.bigUnits[0] : w.bigUnits[1];
  const place = pick(w.bigPlaces);
  const params = { base, times, place, unit: u.label, what: u.what, amount: u.amount, total: base * times };
  return {
    text: t("math.wordBigNumber4.text", params),
    answer: String(base * times),
    type: "number",
    hint: t("math.wordBigNumber4.hint", params),
    explain: t("math.wordBigNumber4.explain", params),
  };
}

// がい数で見積もる。正確な計算ではなく「およそいくつか」を考える単元。
function genWordEstimate4() {
  const place = pick(mathWords().estimatePlaces);
  const unit = place.unit;
  // きりのいい数にならないよう、下の位に必ず端数を作る
  const make = () => randInt(unit * 2, unit * 9) + randInt(1, unit - 1);
  const a = make();
  const b = make();
  const ra = Math.round(a / unit) * unit;
  const rb = Math.round(b / unit) * unit;
  const params = { a, b, ra, rb, label: place.label, total: ra + rb };
  return {
    text: t("math.wordEstimate4.text", params),
    answer: String(ra + rb),
    type: "number",
    hint: t("math.wordEstimate4.hint", params),
    explain: t("math.wordEstimate4.explain", params),
  };
}

// 2けたでわるわり算の文章題。あまりをどう扱うかを場面から考える。
function genWordDivLarge4() {
  const perBox = randInt(12, 36);
  const boxes = randInt(4, 15);
  const rest = randInt(1, perBox - 1);
  const total = perBox * boxes + rest;
  const needAll = Math.random() < 0.5;
  const params = { total, perBox, boxes, rest, need: boxes + 1 };
  return needAll
    ? {
        text: t("math.wordDivLarge4.textNeed", params),
        answer: String(boxes + 1),
        type: "number",
        hint: t("math.wordDivLarge4.hintNeed", params),
        explain: t("math.wordDivLarge4.explainNeed", params),
      }
    : {
        text: t("math.wordDivLarge4.textFull", params),
        answer: String(boxes),
        type: "number",
        hint: t("math.wordDivLarge4.hintFull", params),
        explain: t("math.wordDivLarge4.explainFull", params),
      };
}

// 面積（m²）の文章題。genRectArea4 は cm² の図形問題なので、単位と場面を変えてある。
function genWordAreaRoom4() {
  const w = randInt(3, 12);
  const h = randInt(3, 12);
  // areaPlaces はスペイン語だと冠詞つき（"el aula" 等）で、この生成器の文では常に文頭に来るので大文字化する。
  // 日本語は大文字小文字の区別が無いので影響しない。
  const rawPlace = pick(mathWords().areaPlaces);
  const place = rawPlace.charAt(0).toUpperCase() + rawPlace.slice(1);
  const isFindSide = Math.random() < 0.4;
  const params = { w, h, place, area: w * h };
  return isFindSide
    ? {
        text: t("math.wordAreaRoom4.textSide", params),
        answer: String(w),
        type: "number",
        hint: t("math.wordAreaRoom4.hintSide"),
        explain: t("math.wordAreaRoom4.explainSide", params),
      }
    : {
        text: t("math.wordAreaRoom4.textArea", params),
        answer: String(w * h),
        type: "number",
        hint: t("math.wordAreaRoom4.hintArea"),
        explain: t("math.wordAreaRoom4.explainArea", params),
      };
}

// 小数のかさ・重さの文章題。式は4年の小数のたし算ひき算だが、場面から式を立てる。
function genWordDecimalAmount4() {
  const aRaw = randInt(15, 95);
  const bRaw = randInt(5, aRaw - 5);
  const a = aRaw / 10, b = bRaw / 10;
  const isAdd = Math.random() < 0.5;
  const item = pick(mathWords().amountItems);
  const params = { name: item.name, unit: item.unit, a, b,
    sum: Math.round((a + b) * 10) / 10, diff: Math.round((a - b) * 10) / 10 };
  // 表示用（スペイン語はカンマ小数）。answer など内部の比較用文字列は params の生の数値から作る。
  const dparams = { ...params, a: fmtDecimal(a), b: fmtDecimal(b), sum: fmtDecimal(params.sum), diff: fmtDecimal(params.diff) };
  return isAdd
    ? {
        text: t("math.wordDecimalAmount4.textAdd", dparams),
        answer: String(params.sum),
        type: "number",
        hint: t("math.wordDecimalAmount4.hintAdd"),
        explain: t("math.wordDecimalAmount4.explainAdd", dparams),
      }
    : {
        text: t("math.wordDecimalAmount4.textSub", dparams),
        answer: String(params.diff),
        type: "number",
        hint: t("math.wordDecimalAmount4.hintSub"),
        explain: t("math.wordDecimalAmount4.explainSub", dparams),
      };
}

// 変わり方（かんたんな比例）。1あたりの量から、まとまった量を求める。
function genWordProportion4() {
  const n1 = randInt(2, 6);
  const n2 = n1 + randInt(2, 8);
  // 1あたりの量は、場面として不自然にならない範囲にする（4mで12円のリボンは安すぎる）
  const item = pick(mathWords().proportionItems);
  const per = item.heavy ? randInt(3, 25) : randInt(4, 30) * 10;
  const params = { name: item.name, unit: item.unit, amount: item.amount, word: item.word,
    n1, n2, per, first: per * n1, total: per * n2 };
  return {
    text: t("math.wordProportion4.text", params),
    answer: String(per * n2),
    type: "number",
    hint: t("math.wordProportion4.hint", params),
    explain: t("math.wordProportion4.explain", params),
  };
}

// ===== 算数（小学5年生・新しく習う内容）=====
function genDecimalMul5() {
  const a = randNonMultipleOf10(11, 99) / 10;
  const b = randInt(2, 9);
  const answer = Math.round(a * b * 10) / 10;
  return {
    text: `${fmtDecimal(a)} × ${b} = ?`,
    answer: String(answer),
    type: "number",
    hint: t("math.decimalMul5.hint"),
    explain: t("math.decimalMul5.explain", { a10: a * 10, b, raw: a * 10 * b, answer: fmtDecimal(answer) }),
  };
}

function genDecimalDiv5() {
  const b = randInt(2, 9);
  let q10, a10;
  do {
    q10 = randInt(11, 99);
    a10 = q10 * b;
  } while (a10 % 10 === 0);
  const q = q10 / 10;
  const a = a10 / 10;
  return {
    text: `${fmtDecimal(a)} ÷ ${b} = ?`,
    answer: String(q),
    type: "number",
    hint: t("math.decimalDiv5.hint"),
    explain: t("math.decimalDiv5.explain", { a: fmtDecimal(a), a10, inner: distributiveDivideExplain(a10, b, q10), q: fmtDecimal(q) }),
  };
}

function genFractionAddDiff5() {
  const d1 = randInt(2, 9);
  let d2 = randInt(2, 12);
  while (d2 === d1) d2 = randInt(2, 12);
  // n1/d1・n2/d2 は既約な分数として出す（3/6 のような未約分の入力は
  // 「なぜ最初から約分しないのか」という違和感になる）
  let n1 = randInt(1, d1 - 1);
  while (gcd(n1, d1) !== 1) n1 = randInt(1, d1 - 1);
  let n2 = randInt(1, d2 - 1);
  while (gcd(n2, d2) !== 1) n2 = randInt(1, d2 - 1);
  // 通分は分母の積ではなく最小公倍数を使う（倍数・約数の単元で教える
  // 考え方と揃える。積を使うと 4/6+1/9 が 36/54+6/54 のように無駄に
  // 大きい数になっていた）
  const den = (d1 * d2) / gcd(d1, d2);
  const a = n1 * (den / d1);
  const b = n2 * (den / d2);
  const num = a + b;
  const result = reduceFraction(num, den);
  return {
    text: t("math.fractionAddDiff5.text", { n1, d1, n2, d2 }),
    answer: fractionToText(result),
    type: "fraction",
    hint: t("math.fractionAddDiff5.hint"),
    explain: t("math.fractionAddDiff5.explain", { a, b, den, num })
      + reduceExplainSuffix(num, den, result),
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
    text: t("math.average5.text", { values: values.join(t("math.listSeparator")), n }),
    answer: String(avg),
    type: "number",
    hint: t("math.average5.hint"),
    explain: t("math.average5.explain", { sum: values.reduce((x, y) => x + y, 0), n, avg }),
  };
}

function genPercent5() {
  const base = pick([20, 25, 30, 40, 50, 60, 70, 80, 90, 100, 120, 150, 200, 250, 300, 400, 500]);
  const pct = pick([5, 10, 15, 20, 25, 30, 40, 50, 60, 70, 75, 80, 90]);
  const answer = Math.round(((base * pct) / 100) * 100) / 100;
  return {
    text: t("math.percent5.text", { base, pct }),
    answer: String(answer),
    type: "number",
    hint: t("math.percent5.hint"),
    explain: t("math.percent5.explain", { base, pct, ratio: pct / 100, answer }),
  };
}

function genTriangleArea5() {
  const base = randInt(3, 30);
  const height = randInt(1, 15) * 2;
  return {
    text: t("math.triangleArea5.text", { base, height }),
    answer: String((base * height) / 2),
    type: "number",
    hint: t("math.triangleArea5.hint"),
    explain: t("math.triangleArea5.explain", { base, height, area: (base * height) / 2 }),
  };
}

function genWordPerUnit5() {
  const perUnit = randInt(3, 30);
  const units = randInt(3, 15);
  const total = perUnit * units;
  // ⚠️ ローカルに t という名前を使わない（i18n の t() を隠してしまうため）
  const tpl = pick(mathWords().perUnitItems);
  const params = { unit: tpl.unit, unitSg: tpl.unitSg || tpl.unit,
    item: tpl.item, per: tpl.per, label: tpl.label, units, total, perUnit };
  return {
    text: t("math.wordPerUnit5.text", params),
    answer: String(perUnit),
    type: "number",
    hint: t("math.wordPerUnit5.hint"),
    explain: t("math.wordPerUnit5.explain", params),
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
  const params = { a, b, lcm };
  return kind === "bus"
    ? {
        text: t("math.wordMultiple5.textBus", params),
        answer: String(lcm),
        type: "number",
        hint: t("math.wordMultiple5.hintBus", params),
        explain: t("math.wordMultiple5.explainBus", params),
      }
    : {
        text: t("math.wordMultiple5.textCard", params),
        answer: String(lcm),
        type: "number",
        hint: t("math.wordMultiple5.hintCard", params),
        explain: t("math.wordMultiple5.explainCard", params),
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
    text: t("math.wordDivisor5.text", { a, b }),
    answer: String(gcdVal),
    type: "number",
    hint: t("math.wordDivisor5.hint", { a, b }),
    explain: t("math.wordDivisor5.explain", { a, b, m, n, g: gcdVal }),
  };
}

// 割合（百分率）の文章題。genPercent5 は「◯の△％はいくつ」という式だけの問題なので、
// こちらは値引き・増量といった場面から立式させる。
function genWordPercent5() {
  const price = randInt(4, 30) * 100;
  const pct = pick([10, 15, 20, 25, 30, 40, 50]);
  const isDiscount = Math.random() < 0.6;
  const diff = (price * pct) / 100;
  const params = { price, pct, diff, ratio: pct / 100, rest: 100 - pct,
    lower: price - diff, higher: price + diff };
  return isDiscount
    ? {
        text: t("math.wordPercent5.textDiscount", params),
        answer: String(price - diff),
        type: "number",
        hint: t("math.wordPercent5.hintDiscount", params),
        explain: t("math.wordPercent5.explainDiscount", params),
      }
    : {
        text: t("math.wordPercent5.textRaise", params),
        answer: String(price + diff),
        type: "number",
        hint: t("math.wordPercent5.hintRaise", params),
        explain: t("math.wordPercent5.explainRaise", params),
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
    text: t("math.wordAverage5.text", { n, n1: n + 1, avgSoFar, targetAvg }),
    answer: String(need),
    type: "number",
    hint: t("math.wordAverage5.hint", { n1: n + 1 }),
    explain: t("math.wordAverage5.explain", { n, n1: n + 1, avgSoFar, targetAvg,
      now: avgSoFar * n, want: targetAvg * (n + 1), need }),
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
    text: t("math.wordDensity5.text", { areaA, totalA, areaB, totalB }),
    answer: String(dense),
    type: "number",
    hint: t("math.wordDensity5.hint"),
    explain: t("math.wordDensity5.explain", { areaA, totalA, perA, areaB, totalB, perB, denser, dense }),
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
    text: t("math.fractionMul6.text", { a, b, c, d }),
    answer: fractionToText(result),
    type: "fraction",
    hint: t("math.fractionMul6.hint"),
    explain: t("math.fractionMul6.explain", { a, b, c, d, rawNum, rawDen })
      + reduceExplainSuffix(rawNum, rawDen, result),
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
    text: t("math.fractionDiv6.text", { n1, d1, n2, d2 }),
    answer: fractionToText(result),
    type: "fraction",
    hint: t("math.fractionDiv6.hint"),
    explain: t("math.fractionDiv6.explain", { n1, d1, n2, d2, rawNum, rawDen })
      + reduceExplainSuffix(rawNum, rawDen, result),
  };
}

function genCircleArea6() {
  const r = randInt(2, 40);
  const area = Math.round(r * r * 3.14 * 100) / 100;
  return {
    text: t("math.circleArea6.text", { r }),
    answer: `${area}`,
    type: "number",
    hint: t("math.circleArea6.hint"),
    explain: t("math.circleArea6.explain", { r, area }),
  };
}

function genVolume6() {
  const l = randInt(2, 12);
  const w = randInt(2, 12);
  const h = randInt(2, 12);
  return {
    text: t("math.volume6.text", { w, l, h }),
    answer: `${l * w * h}`,
    type: "number",
    hint: t("math.volume6.hint"),
    explain: t("math.volume6.explain", { w, l, h, volume: l * w * h }),
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
    text: t("math.ratio6.text", { a, b }),
    answer: `${simpleX}:${simpleY}`,
    accept: [`${simpleX}:${simpleY}`, `${simpleX}：${simpleY}`],
    type: "text",
    hint: t("math.ratio6.hint"),
    explain: t("math.ratio6.explain", { a, b, factor, simpleX, simpleY }),
  };
}

function genWordSpeed() {
  const speed = randInt(2, 24) * 5;
  const hours = randInt(2, 9);
  const dist = speed * hours;
  const kind = pick(["distance", "time", "speed"]);
  const params = { speed, hours, dist };
  if (kind === "time") {
    return {
      text: t("math.wordSpeed.textTime", params),
      answer: `${hours}`,
      type: "number",
      hint: t("math.wordSpeed.hintTime"),
      explain: t("math.wordSpeed.explainTime", params),
    };
  }
  if (kind === "speed") {
    return {
      text: t("math.wordSpeed.textSpeed", params),
      answer: `${speed}`,
      type: "number",
      hint: t("math.wordSpeed.hintSpeed"),
      explain: t("math.wordSpeed.explainSpeed", params),
    };
  }
  return {
    text: t("math.wordSpeed.textDist", params),
    answer: `${dist}`,
    type: "number",
    hint: t("math.wordSpeed.hintDist"),
    explain: t("math.wordSpeed.explainDist", params),
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
    text: t("math.proportion6.text", { x1, y1, x2 }),
    answer: `${y2}`,
    type: "number",
    hint: t("math.proportion6.hint"),
    explain: t("math.proportion6.explain", { x1, y1, x2, y2, k }),
  };
}

function genCombination6() {
  const n = randInt(3, 5);
  const fact = Array.from({ length: n }, (_, i) => i + 1).reduce((p, c) => p * c, 1);
  const items = shuffle(mathWords().colors).slice(0, n);
  return {
    text: t("math.combination6.text", { items: items.join(t("math.itemSeparator")), n }),
    answer: `${fact}`,
    type: "number",
    hint: t("math.combination6.hint", { n, n1: n - 1 }),
    explain: t("math.combination6.explain", { terms: Array.from({ length: n }, (_, i) => n - i).join("×"), fact }),
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
    text: t("math.wordRatioSplit6.text", { total, rx, ry }),
    answer: `${answer}`,
    type: "number",
    hint: t("math.wordRatioSplit6.hint"),
    explain: t("math.wordRatioSplit6.explain", { rx, ry, totalUnits, total, perUnit, bigger: Math.max(rx, ry), answer }),
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
    text: t("math.wordFractionMul6.text", { num, den, len }),
    answer: String(answer),
    type: "number",
    hint: t("math.wordFractionMul6.hint"),
    explain: t("math.wordFractionMul6.explain", { num, den, len, prod: num * len, answer }),
  };
}

// 組み合わせ。genCombination6 は「ならべ方（順列）」なので、こちらは
// 順番を区別しない「えらび方（組み合わせ）」にする。混同しやすい対比が練習になる。
function genWordCombinationPick6() {
  const n = randInt(4, 8);
  const answer = (n * (n - 1)) / 2;
  const kind = pick(["team", "handshake"]);
  const params = { n, n1: n - 1, answer };
  return kind === "team"
    ? {
        text: t("math.wordCombinationPick6.textTeam", params),
        answer: String(answer),
        type: "number",
        hint: t("math.wordCombinationPick6.hintTeam", params),
        explain: t("math.wordCombinationPick6.explainTeam", params),
      }
    : {
        text: t("math.wordCombinationPick6.textShake", params),
        answer: String(answer),
        type: "number",
        hint: t("math.wordCombinationPick6.hintShake", params),
        explain: t("math.wordCombinationPick6.explainShake", params),
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
    text: t("math.wordInverse6.text", { total, x1, y1: total / x1, x2 }),
    answer: String(total / x2),
    type: "number",
    hint: t("math.wordInverse6.hint"),
    explain: t("math.wordInverse6.explain", { total, x2, y2: total / x2 }),
  };
}

// 円の面積の文章題。genCircleArea6 は「半径◯cmの円の面積は？」という式だけの問題なので、
// こちらは半径が直接与えられない場面（直径から求める・まわりの長さから考える）にする。
function genWordCircle6() {
  const r = randInt(2, 20);
  const d = r * 2;
  const area = Math.round(r * r * 3.14 * 100) / 100;
  return {
    text: t("math.wordCircle6.text", { d }),
    answer: String(area),
    type: "number",
    hint: t("math.wordCircle6.hint"),
    explain: t("math.wordCircle6.explain", { d, r, area }),
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
    text: t("math.wordRatioFind6.text", { rx, ry, known }),
    answer: String(answer),
    type: "number",
    hint: t("math.wordRatioFind6.hint", { rx, known }),
    explain: t("math.wordRatioFind6.explain", { rx, ry, known, unit, answer }),
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

// ===== 復習キュー（間違えた問題の間隔反復） =====
// 間違えた問題を覚えておき、翌日→3日後→7日後→20日後に もう一度出す。
// 「あと何日」ではなく「いつ出すか（期日）」で持つのが肝心。こうしておくと
// 毎日やらなくても間隔が勝手に進まず、次に開いた日に期日到来ぶんが出る。
const REVIEW_KEY = "review_queue";
const REVIEW_INTERVALS = [1, 3, 7, 20];
// 1セッションに混ぜる復習の上限。長く空けると期日到来が溜まるので、
// 上限を置かないと10問すべてが復習で埋まり、新しい問題に触れられなくなる。
const REVIEW_MAX_PER_SESSION = 3;

function getReviewQueue() {
  try {
    const parsed = JSON.parse(localStorage.getItem(pk(REVIEW_KEY)) || "{}");
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

function saveReviewQueue(queue) {
  localStorage.setItem(pk(REVIEW_KEY), JSON.stringify(queue));
  markSyncDirty();
}

// 算数は毎回ランダム生成で同じ問題が再現しないため、生成器（＝単元）を覚える。
// 国語・英語は問題バンクから出しているので、問題そのものを覚える。
//
// ⚠️ 国語・英語の目印は「表示される問題文」ではなく `pairKey` を使う。
// 問題文は t() で翻訳されるため、表示言語を切り替えると同じ問題でも文字列が変わり、
// 「バンクから消えた」と誤判定してしまう（実際に英語の復習が消える不具合になった）。
// pairKey は語そのもの（`tango:apple` など）なので言語に依らない。
// pairKey は「表と裏」の2問（漢字の読み↔書きなど）で共有しているので、
// それだけだと復習で逆向きの問題が出てしまう。向き（dir）まで含めて1問を特定する。
function reviewIdFor(problem) {
  if (!problem.pairKey) return problem.text;
  return problem.dir ? `${problem.pairKey}#${problem.dir}` : problem.pairKey;
}

function reviewKeyFor(problem) {
  if (!problem) return null;
  if (problem.subject === "math") {
    return problem.genName ? `math|${problem.category}|${problem.genName}` : null;
  }
  return `${problem.subject}|${problem.category}|${reviewIdFor(problem)}`;
}

function addDays(date, n) {
  const d = new Date(date);
  d.setDate(d.getDate() + n);
  return d;
}

// 期日は日付だけで比べたいので、時刻を持たない "YYYY-M-D" のまま数値化する
function dayKeyToNumber(key) {
  const [y, m, d] = String(key).split("-").map(Number);
  if (!y || !m || !d) return 0;
  return y * 10000 + m * 100 + d;
}

function dayKeyToDate(key) {
  const [y, m, d] = String(key).split("-").map(Number);
  if (!y || !m || !d) return null;
  return new Date(y, m - 1, d);
}

// 期日まであと何日か。今日以前なら 0（＝もう出せる）。
function daysUntilDue(dueKey) {
  const due = dayKeyToDate(dueKey);
  if (!due) return 0;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return Math.max(0, Math.round((due - today) / 86400000));
}

function scheduleReview(item, stage) {
  const interval = REVIEW_INTERVALS[Math.min(stage, REVIEW_INTERVALS.length - 1)];
  item.stage = stage;
  item.due = dayKey(addDays(new Date(), interval));
  return item;
}

// 間違えたときに呼ぶ。すでに復習中の問題を また間違えたら、最初の段階に戻す。
function recordWrongAnswer(problem) {
  const key = reviewKeyFor(problem);
  if (!key) return;
  const queue = getReviewQueue();
  const existing = queue[key];
  queue[key] = scheduleReview({
    subject: problem.subject,
    category: problem.category,
    grade: problem.grade || getGrade(),
    genName: problem.genName,
    // reviewId が照合に使う言語非依存の目印。text は保護者向け一覧の表示用
    reviewId: reviewIdFor(problem),
    text: problem.text,
    wrongCount: (existing ? existing.wrongCount : 0) + 1,
  }, 0);
  saveReviewQueue(queue);
}

// 復習で出した問題に正解したときに呼ぶ。最後の段階まで通ったらキューから外す（卒業）。
function recordReviewSuccess(problem) {
  const key = reviewKeyFor(problem);
  if (!key) return;
  const queue = getReviewQueue();
  const item = queue[key];
  if (!item) return;
  const nextStage = (item.stage || 0) + 1;
  if (nextStage >= REVIEW_INTERVALS.length) {
    delete queue[key];
  } else {
    queue[key] = scheduleReview(item, nextStage);
  }
  saveReviewQueue(queue);
}

// 今日以前が期日のものを、期日の古い順に返す
function getDueReviewItems(subject, category, grade) {
  const today = dayKeyToNumber(dayKey(new Date()));
  return Object.entries(getReviewQueue())
    .filter(([, item]) =>
      item.subject === subject &&
      item.category === category &&
      (item.grade || grade) <= grade &&
      dayKeyToNumber(item.due) <= today
    )
    .sort((a, b) => dayKeyToNumber(a[1].due) - dayKeyToNumber(b[1].due))
    .map(([key, item]) => ({ key, ...item }));
}

// 生成器を名前から引く（復習で同じ単元の問題を作り直すため）
let _mathGenByName = null;
function mathGenByName(name) {
  if (!_mathGenByName) {
    _mathGenByName = new Map();
    Object.values(MATH_GENS_BY_GRADE).forEach((byCategory) => {
      Object.values(byCategory || {}).forEach((entries) => {
        (entries || []).forEach((entry) => {
          const { fn } = normalizeMathGen(entry);
          if (fn && fn.name) _mathGenByName.set(fn.name, fn);
        });
      });
    });
  }
  return _mathGenByName.get(name) || null;
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
  if (!subjectAvailable(subject)) return [];
  return CATEGORY_DEFS[subject].filter((c) => grade >= c.minGrade).map((c) => c.def);
}

// 「国語」は日本語のバンク（漢字・ことわざ・四字熟語など）そのものなので、
// 他の言語には中身が無い。スペイン語版の Lengua（Antónimos・Refranes・
// Ortografía・Comprensión）を書いたら、ここに "es" を足す。
//
// 算数は生成器が数値を作るだけ、英語は英語側が問題本体なので、どちらも
// 言語に依存しない（es-handoff.md §2）。
const SUBJECT_LOCALES = { japanese: ["ja"] };

function subjectAvailable(subject) {
  const allowed = SUBJECT_LOCALES[subject];
  return !allowed || allowed.includes(getLocale());
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
    dir: "a",
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
    dir: "b",
  };
}

// 英語バンクの母語ラベル。英語側（word / text / answer / options）が問題本体で、
// ja / es はその訳にすぎないので、表示言語に合わせて引き替えるだけで
// スペイン語話者向けの英語教材になる（es-handoff.md §2）。
//
// 訳が無い言語のときは日本語に落とす。t() と揃えた挙動だが、静かに混ざると
// 気づけないので tools/check_i18n_keys.js が欠落を検出する。
function nativeGloss(item) {
  const gloss = item[getLocale()];
  return gloss !== undefined ? gloss : item.ja;
}

// 英語（外国語）。単語は母語→英・英→母語の両方向、表現は空所補充。
function buildEnglishPool(grade, category) {
  const pool = [];

  if (category === "tango") {
    const bank = upTo(EN_WORDS, grade, category);
    bank.forEach((item, idx) => {
      const word = item.word;
      const ja = nativeGloss(item);
      const others = shuffle(bank.filter((_, i) => i !== idx));
      const enOptions = others.slice(0, 3).map((x) => x.word);
      const jaOptions = others.slice(0, 3).map((x) => nativeGloss(x));
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
        dir: "a",
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
        dir: "b",
      });
    });
  }

  if (category === "kaiwa") {
    upTo(EN_PHRASES, grade, category).forEach((item) => {
      pool.push({
        grade: item.grade,
        // 英文そのものは翻訳されないので、復習の目印として言語に依らず使える
        pairKey: `kaiwa:${item.text}`,
        text: t("q.enPhrase", { sentence: item.text }),
        type: "choice",
        options: shuffle([...item.options]),
        answer: item.answer,
        hint: t("q.choiceHint"),
        explain: t("q.enPhraseExplain", { sentence: item.text.replace("___", item.answer), ja: nativeGloss(item) }),
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
        dir: "a",
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
        dir: "b",
      });
    });
  }

  if (category === "kotoba") {
    // 反対語は「AのはんたいはB」と「BのはんたいはA」の両方向を出す
    upTo(JA_ANTONYM, grade, category).forEach((item, idx) => {
      const left = answerList(item.a);
      const right = answerList(item.b);
      [[left, right], [right, left]].forEach(([fromList, toList], dirIdx) => {
        pool.push({
          grade: item.grade,
          text: t("q.antonym", { word: fromList[0] }),
          answer: toList[0],
          accept: toList,
          type: "text",
          hint: toList[0].length >= 3 ? t("q.antonymHint", { first: toList[0][0] }) : t("q.shortAnswerHint"),
          explain: t("q.antonymExplain", { word: fromList[0], opposite: toList[0] }),
          pairKey: `antonym:${idx}`,
          dir: dirIdx === 0 ? "a" : "b",
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
// 復習の期日が来た問題を、実際に出せる問題に組み立て直す。
// 算数は同じ生成器（＝単元）から作り直し、国語・英語はプールから同じ問題を探す。
//
// ⚠️ 国語・英語のプールは「その問題を間違えたときの学年」で組み立てる。
// セッションの学年で組むと、学年が上がったときに gradeFloor（2学年下まで）から
// 外れて見つからなくなり、コンテンツはあるのに「消えた」と誤判定してしまう。
function materializeReviewProblem(item, poolFor) {
  if (item.subject === "math") {
    const fn = mathGenByName(item.genName);
    if (!fn) return null;
    const problem = fn();
    problem.genName = item.genName;
    return problem;
  }
  const pool = poolFor(item.subject, item.category, item.grade);
  // reviewId で照合する（言語に依らない）。reviewId を持つ前に記録された項目は
  // 問題文で照合する。この場合だけは表示言語を変えると一致しなくなるが、
  // 見つからなくても削除はしないので、言語を戻せばまた復習できる。
  const found = item.reviewId
    ? pool.find((q) => reviewIdFor(q) === item.reviewId)
    : pool.find((q) => q.text === item.text);
  return found ? { ...found } : null;
}

// 期日が来た復習を、上限のぶんだけ組み立てて返す。
//
// 組み立てに失敗した項目は飛ばす。上限で先に切らず成功した数だけを数えるので、
// 出せない項目があっても生きている復習が締め出されることはない。
//
// ⚠️ 削除するのは「算数の生成器がビルドに存在しない」場合だけにする。
// 関数が無いことは確実に判定できるが、国語・英語が見つからない理由は
// （表示言語・学年・コンテンツの改訂など）確実には切り分けられない。
// 実際、表示言語を切り替えただけで英語の復習が消える不具合を出した。
// 出せないだけの項目は残し、保護者が「にがて分野」の×で消せるようにしてある。
function collectDueReviewProblems(subject, category, grade, limit) {
  const poolCache = new Map();
  const poolFor = (subj, cat, g) => {
    const key = `${subj}|${cat}|${g}`;
    if (!poolCache.has(key)) {
      poolCache.set(key, subj === "japanese" ? buildJapanesePool(g, cat) : buildEnglishPool(g, cat));
    }
    return poolCache.get(key);
  };

  const problems = [];
  const dead = [];
  // 上限で先に切らず、成功したものだけを数える。
  // そうしないと、組み立てに失敗する項目が1つあるだけで枠が1つ無駄になる。
  for (const item of getDueReviewItems(subject, category, grade)) {
    if (problems.length >= limit) break;
    const problem = materializeReviewProblem(item, poolFor);
    if (problem) {
      problem.isReview = true;
      problems.push(problem);
    } else if (item.subject === "math" && !mathGenByName(item.genName)) {
      // 生成器がビルドに無い＝二度と出せないことが確実なものだけ捨てる
      dead.push(item.key);
    }
  }

  if (dead.length > 0) {
    const queue = getReviewQueue();
    dead.forEach((key) => delete queue[key]);
    saveReviewQueue(queue);
  }
  return problems;
}

function buildSessionProblems(grade, subject, category, count) {
  // 期日が来た復習を先に確保してから、残りを通常どおり埋める
  const tag = (problem) => {
    problem.subject = subject;
    problem.category = category;
    return problem;
  };
  const dueProblems = collectDueReviewProblems(subject, category, grade, REVIEW_MAX_PER_SESSION);

  if (subject === "japanese" || subject === "english") {
    const pool = subject === "japanese" ? buildJapanesePool(grade, category) : buildEnglishPool(grade, category);
    const reviews = dueProblems.map(tag);
    const reviewTexts = new Set(reviews.map((q) => q.text));
    const recentSet = new Set(getRecentTexts(subject, category));
    // 復習ぶんと重複しないよう多めに取ってから間引く
    const fresh = pickSessionQuestions(pool, count, grade, recentSet)
      .filter((q) => !reviewTexts.has(q.text))
      .slice(0, Math.max(0, count - reviews.length));
    const result = shuffle(reviews.concat(fresh.map(tag)));
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
    result.push(tag(problem));
  };
  // 復習ぶんを先に確保する。accept を通すので、同じ単元が新規側で重ならないよう重みも下がる。
  dueProblems.forEach((problem) => {
    if (seen.has(problem.text)) return;
    seen.add(problem.text);
    accept(problem);
  });
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
  // 復習ぶんを先頭に固めず、通常の問題に紛れさせる
  const mixed = shuffle(result);
  recordSeenTexts(subject, category, mixed.map((q) => q.text));
  return mixed;
}

// ===== 採点 =====
// スペイン語などカンマを小数点として使う入力に対応（ピリオドが無い場合のみカンマを小数点として扱う）。
// 数値として読めなければ NaN を返す。
function parseLocaleNumber(str) {
  let numStr = str.replace(/[^\d.,\-]/g, "");
  numStr = numStr.includes(".") ? numStr.replace(/,/g, "") : numStr.replace(",", ".");
  return parseFloat(numStr);
}

function checkAnswer(userInput, problem) {
  const trimmed = (userInput ?? "").toString().trim();
  if (trimmed === "") return false;

  if (problem.type === "fraction") {
    const correctFrac = parseFractionInput(problem.answer);
    if (!correctFrac) return false;
    const userFrac = parseFractionInput(trimmed);
    if (userFrac && userFrac.num === correctFrac.num && userFrac.den === correctFrac.den) {
      return true;
    }
    // n/d のスラッシュ表記に加えて、小数の同値も正解にする（例: 3/4 → 0.75）。
    const userNum = parseLocaleNumber(trimmed);
    if (!Number.isFinite(userNum)) return false;
    return Math.abs(userNum - correctFrac.num / correctFrac.den) < 0.001;
  }

  if (problem.type === "number") {
    const userNum = parseLocaleNumber(trimmed);
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

// 縦の短い端末では、画面の中身が入りきらず主ボタンが下タブバーの裏に
// 隠れることがある（2026-08-29〜31 日次QAで複数画面から発見）。
// #screen-start・#screen-result は CSS 側で圧縮して確保済みだが、
// 中身の高さが可変な画面（分野の数で伸び縮みする #screen-category、
// 解説の長さで伸び縮みする #screen-quiz の回答後）は固定の圧縮では
// 追いつかないため、実測して足りない分だけスクロールする安全網を設ける。
// 「タブに隠れたボタンを押したつもりが別の画面（ガチャ）に飛ぶ」という
// 誤タップを防ぐのが目的で、賑わせるための演出ではない。
function ensureBottomActionVisible(root) {
  if (!root) return;
  const tabBar = document.getElementById("tab-bar");
  if (tabBar.classList.contains("hidden")) return;
  const tabTop = tabBar.getBoundingClientRect().top;
  const actionable = [...root.querySelectorAll("button, a")].filter(
    (el) => !el.disabled && !el.classList.contains("hidden") && el.offsetParent !== null
  );
  if (!actionable.length) return;
  const last = actionable[actionable.length - 1];
  const overlap = last.getBoundingClientRect().bottom - tabTop;
  if (overlap > 0) window.scrollBy(0, overlap + 12);
}

// 中身がおおむね1画面に収まる想定の画面だけを対象にする。せっていのような
// 長いスクロール前提の画面まで対象にすると、末尾の無関係なボタンまで
// 強制的にスクロールしてしまうため、あえて対象を絞っている。
const FIT_TO_FOLD_SCREENS = ["screen-start", "screen-result", "screen-category"];

function showScreen(id) {
  document.querySelectorAll(".screen").forEach((el) => el.classList.remove("active"));
  document.getElementById(id).classList.add("active");
  // 前の画面でスクロールしていた位置が引き継がれ、ステータスバーが画面外に隠れたまま
  // 新しい画面が始まる不具合があった（2026-08-15 日次QAで発見）。
  window.scrollTo(0, 0);

  const chromeHidden = PROFILE_SCREENS.includes(id);
  document.getElementById("status-bar").classList.toggle("hidden", chromeHidden);
  document.querySelector(".guide-box").classList.toggle("hidden", chromeHidden);
  document.getElementById("tab-bar").classList.toggle("hidden", chromeHidden);

  updateActiveTab(id);
  if (!chromeHidden) updateStatusBar();
  updateBgmForScreen(id);

  if (FIT_TO_FOLD_SCREENS.includes(id)) {
    requestAnimationFrame(() => ensureBottomActionVisible(document.getElementById(id)));
  }
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

  // 中身のない科目はカードごと出さない（いまは日本語以外での「国語」）。
  // 押せるのに空、という状態を作らないため。
  document.querySelectorAll(".level-card[data-subject]").forEach((btn) => {
    btn.classList.toggle("hidden", !subjectAvailable(btn.dataset.subject));
  });

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
  // クイズの start と共用にしていたので「10もん がんばろう！」がガチャ画面に出ていた
  setGuide("gacha");
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
      const levelupBox = document.getElementById("gacha-levelup-box");
      levelupBox.classList.remove("hidden");
      document.getElementById("gacha-levelup-emoji").innerHTML = `<div class="level-badge-large">Lv.${compendiumAfter.count}</div>`;
      document.getElementById("gacha-levelup-title").textContent = compendiumAfter.title;
      playLevelUpSound();
      // スクロールは closeGachaOverlay() 側で行う（オーバーレイが開いたまま＝
      // body.gacha-open で overflow:hidden の間はスクロールしても無効なため）
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

// 週間グラフの開閉。ボタンは縦の短い端末でだけ CSS で表示される（style.css の
// @media (max-height: 760px) を参照）。高い画面では is-open に関係なく開いたままなので、
// ここでクラスを付け外ししても表示は変わらない。
document.getElementById("btn-week-chart-toggle").addEventListener("click", () => {
  const card = document.querySelector(".week-chart-card");
  const open = card.classList.toggle("is-open");
  document.getElementById("btn-week-chart-toggle").setAttribute("aria-expanded", String(open));
  playClickSound();
});

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

  renderLanguageSetting();
  renderYearStartSetting();
  renderAnnouncements();
  renderReviewSetting();
  renderFeedbackSetting();
  renderTestimonialSetting();
  renderPlanSetting();

  const profile = getActiveProfile();
  document.getElementById("profile-current-line").textContent = profile
    ? t("profile.currentLine", { name: profile.name })
    : "";

  setGuide("settings");
  showScreen("screen-settings");
}

// 表示言語。ボタンのラベルは LOCALES[x].label（その言語自身の表記）なので、
// いま読めない言語で表示されていても自分の言語を見つけられる。
//
// 切り替えたら location.reload() する。applyTranslations() が入れ替えるのは
// data-i18n の付いた静的な要素だけで、分野一覧・ずかん・プランなど innerHTML で
// 組み立てている画面は再描画されない。読み込み直すのが確実で、影響も一度きり。
function renderLanguageSetting() {
  const box = document.getElementById("settings-language");
  if (!box) return;

  // 単一言語で配るデプロイでは切替を出さない。getLocale() が FORCED_LOCALE を
  // 返すので、押しても何も起きないボタンが残ってしまう。見出しと説明文ごと隠す。
  const row = document.getElementById("settings-language-row") || box;
  row.classList.toggle("hidden", !!FORCED_LOCALE);
  if (FORCED_LOCALE) return;

  const current = getLocale();

  box.innerHTML = Object.keys(LOCALES).map((code) => `
    <button type="button" class="grade-option${code === current ? " active" : ""}" data-locale="${code}" lang="${code}">
      ${LOCALES[code].label}
    </button>
  `).join("");

  box.querySelectorAll("[data-locale]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const code = btn.dataset.locale;
      if (code === getLocale()) return;
      playClickSound();
      setLocale(code);
      location.reload();
    });
  });
}

// 月の名前。日本語は「4月」と数字で足りるが、スペイン語は "abril" と名前で呼ぶ。
// settings.yearStartMonth には n（数字）と name（名前）の両方を渡し、
// どちらを使うかは各言語の文言側で決める。
function monthLabel(m) {
  return tList("months")[m - 1] || String(m);
}

// 年度の開始月。よく使う3つ（4月=日本、9月=米国・欧州、3月=韓国・南半球）を
// ボタンで、それ以外は12ヶ月から選べるようにする。
function renderYearStartSetting() {
  const box = document.getElementById("settings-year-start");
  if (!box) return;
  const current = getSchoolYearStart();

  const quick = SCHOOL_YEAR_START_QUICK.map((m) => `
    <button type="button" class="grade-option${m === current ? " active" : ""}" data-year-start="${m}">
      ${t("settings.yearStartMonth", { n: m, name: monthLabel(m) })}
    </button>
  `).join("");

  const options = Array.from({ length: 12 }, (_, i) => i + 1)
    .map((m) => `<option value="${m}"${m === current ? " selected" : ""}>${t("settings.yearStartMonth", { n: m, name: monthLabel(m) })}</option>`)
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

// にがて分野（保護者向け）。復習キューをそのまま読み取って一覧にする。
// 問題文をそのまま出すので、innerHTML ではなく textContent で組み立てる。
function renderReviewSetting() {
  const box = document.getElementById("settings-review-list");
  if (!box) return;
  box.innerHTML = "";

  const queue = getReviewQueue();
  const items = Object.entries(queue).map(([key, item]) => ({ ...item, key }));
  if (items.length === 0) {
    const empty = document.createElement("p");
    empty.className = "review-empty";
    empty.textContent = t("review.empty");
    box.appendChild(empty);
    return;
  }

  const today = dayKeyToNumber(dayKey(new Date()));
  const dueCount = items.filter((it) => dayKeyToNumber(it.due) <= today).length;

  const summary = document.createElement("p");
  summary.className = "review-summary";
  summary.textContent = t("review.summary", { n: items.length, due: dueCount });
  box.appendChild(summary);

  // 出る順（期日の古い順）に並べる。間違えた回数が多いものが上に来やすい
  items
    .slice()
    .sort((a, b) => dayKeyToNumber(a.due) - dayKeyToNumber(b.due))
    .forEach((item) => {
      const row = document.createElement("div");
      row.className = "review-row";

      const body = document.createElement("div");
      body.className = "review-row-body";

      const title = document.createElement("div");
      title.className = "review-row-title";
      // 算数は単元名、国語・英語は問題そのもの
      const label = item.subject === "math"
        ? (mathGenLabel(item.genName) || t(`cat.${item.category === "bunsho" ? "bunshoMath" : item.category}`))
        : item.text;
      title.textContent = label;
      body.appendChild(title);

      const meta = document.createElement("div");
      meta.className = "review-row-meta";
      const remaining = daysUntilDue(item.due);
      const wrong = item.wrongCount || 1;
      const parts = [
        t(`subject.${item.subject}`),
        remaining === 0 ? t("review.dueToday")
          : t(remaining === 1 ? "review.dueLaterOne" : "review.dueLater", { n: remaining }),
        t("review.stage", { current: (item.stage || 0) + 1, total: REVIEW_INTERVALS.length }),
        t(wrong === 1 ? "review.wrongCountOne" : "review.wrongCount", { n: wrong }),
      ];
      meta.textContent = parts.join(" ・ ");
      body.appendChild(meta);
      row.appendChild(body);

      // 保護者が手で外せるようにする。もう苦手ではない・そもそも出したくない、
      // といった判断はアプリ側では分からないため。
      const removeBtn = document.createElement("button");
      removeBtn.type = "button";
      removeBtn.className = "review-row-remove";
      removeBtn.textContent = "×";
      removeBtn.setAttribute("aria-label", t("review.remove"));
      removeBtn.title = t("review.remove");
      removeBtn.addEventListener("click", () => {
        playClickSound();
        if (!window.confirm(t("review.removeConfirm", { name: label }))) return;
        const latest = getReviewQueue();
        delete latest[item.key];
        saveReviewQueue(latest);
        renderReviewSetting();
      });
      row.appendChild(removeBtn);

      box.appendChild(row);
    });
}

// おしらせ一覧。表示するたびに、いま見せた項目を既読にする
// （今回はNEWバッジが見え、次に開いたときは消えている、という素直な既読管理）。
function renderAnnouncements() {
  const box = document.getElementById("settings-announce-list");
  if (!box) return;

  const locale = getLocale();
  const items = ANNOUNCEMENTS.slice().sort((a, b) => (a.date < b.date ? 1 : -1));

  if (items.length === 0) {
    box.innerHTML = `<p class="announce-empty">${t("announce.empty")}</p>`;
    updateSettingsTabBadge();
    return;
  }

  const readIds = getAnnounceReadIds();
  box.innerHTML = items.map((item) => {
    const isNew = !readIds.has(item.id);
    let ctaHTML = "";
    if (item.cta) {
      const label = item.cta.label[locale] || item.cta.label.ja;
      if (item.cta.action === "plan") {
        ctaHTML = `<button type="button" class="announce-cta" data-scroll-plan="1">${label}</button>`;
      } else if (item.cta.action === "youtube") {
        ctaHTML = `<a class="announce-cta" href="${t("youtube.url")}" target="_blank" rel="noopener noreferrer">${label}</a>`;
      } else if (item.cta.url) {
        ctaHTML = `<a class="announce-cta" href="${item.cta.url}" target="_blank" rel="noopener noreferrer">${label}</a>`;
      }
    }
    return `
      <div class="announce-card">
        <span class="announce-date">${item.date}</span>
        ${isNew ? `<span class="announce-new-badge">${t("announce.new")}</span>` : ""}
        <h4 class="announce-title">${item.title[locale] || item.title.ja}</h4>
        <p class="announce-body">${item.body[locale] || item.body.ja}</p>
        ${ctaHTML}
      </div>
    `;
  }).join("");

  box.querySelectorAll("[data-scroll-plan]").forEach((btn) => {
    btn.addEventListener("click", () => {
      playClickSound();
      document.getElementById("settings-plan").scrollIntoView({ behavior: "smooth", block: "start" });
    });
  });

  // 表示した分はここで既読にする（次回開いたときはNEWバッジが消えている）
  markAnnouncementsRead(items.map((i) => i.id));
  updateSettingsTabBadge();
}

// ご要望・お問い合わせ。Firestoreの feedback コレクションに書き込みのみ行う
// （一方通行の目安箱。ユーザー自身も読み返せない）。おためし中は送信できない
// ——保護者のアカウントに紐づけるため。この案内自体が登録への軽い後押しも兼ねる。
function renderFeedbackSetting() {
  const box = document.getElementById("settings-feedback");
  if (!box) return;

  if (!fbCurrentUser) {
    box.innerHTML = `<p class="feedback-guest-notice">${t("feedback.guestNotice")}</p>`;
    return;
  }

  box.innerHTML = `
    <textarea class="feedback-textarea" id="feedback-text" placeholder="${t("feedback.placeholder")}"></textarea>
    <div class="backup-actions">
      <button type="button" class="btn-secondary" id="btn-feedback-submit">${t("feedback.submit")}</button>
    </div>
    <p class="backup-feedback" id="feedback-status"></p>
  `;

  document.getElementById("btn-feedback-submit").addEventListener("click", async () => {
    const textEl = document.getElementById("feedback-text");
    const statusEl = document.getElementById("feedback-status");
    const text = textEl.value.trim();
    if (!text) {
      statusEl.textContent = t("feedback.empty");
      statusEl.className = "backup-feedback error";
      return;
    }
    playClickSound();
    statusEl.textContent = t("feedback.sending");
    statusEl.className = "backup-feedback";
    try {
      await fbDb.collection("feedback").add({
        uid: fbCurrentUser.uid,
        text,
        locale: getLocale(),
        createdAt: firebase.firestore.FieldValue.serverTimestamp(),
      });
      textEl.value = "";
      statusEl.textContent = t("feedback.sent");
      statusEl.className = "backup-feedback success";
    } catch (e) {
      console.warn("[feedback] failed:", e.message);
      statusEl.textContent = t("feedback.failed");
      statusEl.className = "backup-feedback error";
    }
  });
}

// 感想を送る。星評価＋自由記述＋「宣伝への使用に同意するか」のチェック（既定OFF）。
// Firestoreの reviews コレクションに書き込みのみ行う。同意ありのものだけ、
// 開発者が手作業でLP等に転載する（自動掲載はしない＝内容の質を担保するため）。
function renderTestimonialSetting() {
  const box = document.getElementById("settings-testimonial");
  if (!box) return;

  if (!fbCurrentUser) {
    box.innerHTML = `<p class="feedback-guest-notice">${t("testimonial.guestNotice")}</p>`;
    return;
  }

  let rating = 0;
  box.innerHTML = `
    <p class="review-summary">${t("testimonial.ratingLabel")}</p>
    <div class="feedback-rating" id="testimonial-stars">
      ${[1, 2, 3, 4, 5].map((n) => `<button type="button" class="feedback-star" data-star="${n}">★</button>`).join("")}
    </div>
    <textarea class="feedback-textarea" id="testimonial-text" placeholder="${t("testimonial.placeholder")}"></textarea>
    <label class="feedback-consent">
      <input type="checkbox" id="testimonial-consent">
      <span>${t("testimonial.consentLabel")}</span>
    </label>
    <div class="backup-actions">
      <button type="button" class="btn-secondary" id="btn-testimonial-submit">${t("testimonial.submit")}</button>
    </div>
    <p class="backup-feedback" id="testimonial-status"></p>
  `;

  const starButtons = [...box.querySelectorAll(".feedback-star")];
  starButtons.forEach((btn) => {
    btn.addEventListener("click", () => {
      playClickSound();
      rating = parseInt(btn.dataset.star, 10);
      starButtons.forEach((b) => b.classList.toggle("active", parseInt(b.dataset.star, 10) <= rating));
    });
  });

  document.getElementById("btn-testimonial-submit").addEventListener("click", async () => {
    const textEl = document.getElementById("testimonial-text");
    const consentEl = document.getElementById("testimonial-consent");
    const statusEl = document.getElementById("testimonial-status");
    if (rating < 1) {
      statusEl.textContent = t("testimonial.ratingRequired");
      statusEl.className = "backup-feedback error";
      return;
    }
    playClickSound();
    statusEl.textContent = t("testimonial.sending");
    statusEl.className = "backup-feedback";
    try {
      await fbDb.collection("reviews").add({
        uid: fbCurrentUser.uid,
        rating,
        text: textEl.value.trim(),
        consentToPublish: !!consentEl.checked,
        locale: getLocale(),
        createdAt: firebase.firestore.FieldValue.serverTimestamp(),
      });
      rating = 0;
      textEl.value = "";
      consentEl.checked = false;
      starButtons.forEach((b) => b.classList.remove("active"));
      statusEl.textContent = t("testimonial.sent");
      statusEl.className = "backup-feedback success";
    } catch (e) {
      console.warn("[testimonial] failed:", e.message);
      statusEl.textContent = t("testimonial.failed");
      statusEl.className = "backup-feedback error";
    }
  });
}

// プラン（無料→ファミリーの切り替え）。account-design.md §10-9。
// 課金の操作は保護者向けのせってい画面にだけ置く（§10-4：子どもがプレイ中に
// 課金を迫られる導線は作らない）。
function renderPlanSetting() {
  const box = document.getElementById("settings-plan");
  const line = document.getElementById("plan-current-line");
  if (!box || !line) return;

  // 有料会員：状態と「契約の管理」だけ。売り込みは出さない
  if (isPaidPlan()) {
    line.textContent = t("plan.paidLine");
    box.classList.remove("hidden");
    // 解約手段は必ず示す。ポータル未設定でも「解約できない」状態にしてはいけない
    // （tokusho.html で「せっていのプランからいつでも解約できます」と表示しているため、
    //   ここが空だと表示と実装が食い違い、特商法上も問題になる）。
    box.innerHTML = STRIPE_CUSTOMER_PORTAL_URL
      ? `<a class="btn-secondary plan-portal-link" href="${STRIPE_CUSTOMER_PORTAL_URL}" target="_blank" rel="noopener">${t("plan.managePortal")}</a>
         <p class="plan-note">${t("plan.manageNote")}</p>`
      : `<p class="plan-note">${t("plan.cancelByMail", { email: SUPPORT_EMAIL })}</p>`;
    box.innerHTML += legalLinkHTML();
    return;
  }
  box.classList.remove("hidden");

  line.textContent = t("plan.freeLine");

  const benefits = `
    <p class="plan-benefit-intro">${t("plan.benefitIntro")}</p>
    <ul class="plan-benefits">
      <li>${t("plan.benefit1", { n: PROFILE_MAX })}</li>
      <li>${t("plan.benefit2", { n: RELEASED_CARD_POOL.length })}</li>
      <li>${t("plan.benefit3")}</li>
    </ul>
    <p class="plan-promise">${t("plan.gachaPromise")}</p>`;

  // おためし中：先にアカウント登録が要る（支払いを世帯に結びつけられないため）
  if (!fbCurrentUser) {
    box.innerHTML = `${benefits}
      <p class="plan-note">${t("plan.guestNote")}</p>
      <button type="button" id="btn-plan-signup" class="btn-secondary">${t("auth.guestSignup")}</button>`;
    document.getElementById("btn-plan-signup").addEventListener("click", () => {
      playClickSound();
      setAuthBackToGuestVisible(true);
      openSignupScreen();
    });
    return;
  }

  const links = stripePaymentLinks();
  const monthly = buildUpgradeUrl(links.monthly);
  const yearly = buildUpgradeUrl(links.yearly);

  // Payment Link 未設定＝まだ販売を始めていない。買えそうで買えないボタンは出さない
  if (!monthly && !yearly) {
    box.innerHTML = `${benefits}<p class="plan-note">${t("plan.comingSoon")}</p>`;
    return;
  }

  // 特商法の表示は「購入前に必ず到達できる」ことが要件なので、購入ボタンと同じ画面に置く
  box.innerHTML = `${benefits}
    <div class="plan-buttons">
      ${monthly ? `<a class="btn-primary plan-buy-link" href="${monthly}" target="_blank" rel="noopener">${t("plan.monthly")}</a>` : ""}
      ${yearly ? `<a class="btn-primary plan-buy-link" href="${yearly}" target="_blank" rel="noopener">${t("plan.yearly")}</a>` : ""}
    </div>
    <p class="plan-note">${t("plan.afterBuyNote")}</p>
    ${legalLinkHTML()}`;
}

// ===== プロフィール画面 =====
// state.profileMode が "manage" のときは、選ぶかわりに消す操作になる
function openProfileSelectScreen(mode) {
  state.profileMode = mode === "manage" ? "manage" : "select";
  const list = document.getElementById("profile-list");
  const profiles = getProfiles();

  list.innerHTML = profiles.map((p) => `
    <button type="button" class="profile-card" data-profile-id="${p.id}">
      <span class="profile-card-name"></span>
      ${state.profileMode === "manage" ? `<span class="profile-card-delete">${t("profile.deleteBtn")}</span>` : ""}
    </button>
  `).join("") + (state.profileMode === "select" && profiles.length < profileLimit() ? `
    <button type="button" class="profile-card profile-card--new" id="btn-profile-new">
      <span class="profile-card-plus">＋</span>
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
  const profile = createProfile(name);
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
  maybeShowAnnounceModal();
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

  setGuide("category");
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
  // 次の問題への遷移は showScreen() を経由しないので、ここでも同様にリセットする
  // （長文の読解問題でスクロールしたまま次の問題に進むと、ステータスバーが
  // 隠れたままになっていた。2026-08-15 日次QAで発見）。
  window.scrollTo(0, 0);
  const p = state.problems[state.index];
  document.getElementById("quiz-progress").textContent = t("quiz.progress", { current: state.index + 1, total: state.problems.length });
  document.getElementById("quiz-stamps").textContent = t("quiz.stamps", { n: state.sessionStamps });

  const problemTextEl = document.getElementById("problem-text");
  problemTextEl.textContent = p.text;
  problemTextEl.classList.toggle("long-text", p.text.length > 40);

  const badgeEl = document.getElementById("problem-badge");
  if (p.isReview) badgeEl.textContent = t("quiz.badgeReview");
  else badgeEl.textContent = p.isRepeat ? t("quiz.badgeRepeat") : t("quiz.badgeNew");
  badgeEl.classList.toggle("is-repeat", !!p.isRepeat && !p.isReview);
  badgeEl.classList.toggle("is-review", !!p.isReview);

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
    const input = document.getElementById("answer-input");
    input.value = "";
    input.disabled = false;
    // 数字だけの答えは数字キーパッドの方が打ちやすい。分数は "/" が要るのでフルキーボードのまま
    input.inputMode = p.type === "number" ? "decimal" : "text";
    // 分数は「スラッシュで n/d の形に書く」という入力形式を誰も教えていなかったため、
    // プレースホルダーで例を示す（正しく解けているのに書式で不正解になるのを防ぐ）。
    input.placeholder = p.type === "fraction" ? t("quiz.fractionPlaceholder") : t("quiz.answerPlaceholder");
    form.querySelector("button").disabled = false;
    input.focus();
  }
}

function applyAnswerResult(isCorrect, feedbackWrongText, problem) {
  const feedback = document.getElementById("feedback");
  document.getElementById("btn-hint").disabled = true;

  if (isCorrect) {
    playCorrectSound();
    state.correctCount++;
    // 復習の問題は「直近に出た問題」でもあるが、苦手を克服できた回なのでポイントは満額にする
    const isReview = !!(problem && problem.isReview);
    const gained = problem && problem.isRepeat && !isReview ? REPEAT_STAMP_RATIO : 1;
    state.sessionStampsExact += gained;
    state.sessionStamps = Math.round(state.sessionStampsExact);
    feedback.textContent = pick(tList("guide.correct"));
    feedback.className = "feedback correct";
    if (isReview) {
      feedback.textContent += " " + t("quiz.reviewCleared");
      recordReviewSuccess(problem);
    } else if (problem && problem.isRepeat) {
      feedback.textContent += " " + t("quiz.repeatNote");
    }
    setGuide("correct");
  } else {
    playWrongSound();
    feedback.textContent = feedbackWrongText;
    feedback.className = "feedback wrong";
    setGuide("wrong");
    // 間違えた問題は、翌日→3日後→7日後→20日後 に もう一度出す
    recordWrongAnswer(problem);

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

  // 不正解で解説が伸びると「つぎへ」がタブバーの裏に隠れることがある
  // （2026-08-31 日次QAで発見。縦の短い端末で毎セッション起こりうる）。
  requestAnimationFrame(() => ensureBottomActionVisible(document.getElementById("screen-quiz")));
}

document.getElementById("answer-form").addEventListener("submit", (e) => {
  e.preventDefault();
  const input = document.getElementById("answer-input");
  const p = state.problems[state.index];
  const isCorrect = checkAnswer(input.value, p);

  input.disabled = true;
  e.target.querySelector("button").disabled = true;
  applyAnswerResult(isCorrect, t("quiz.wrongText", { answer: p.type === "number" ? fmtDecimal(p.answer) : p.answer }), p);
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
    t("result.points", { pt: state.sessionStamps, total: totalAfter });

  if (rate === 100) setGuide("resultPerfect");
  else if (rate >= 80) setGuide("resultHigh");
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
  const grade = gradeLabel(r.grade);
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
  updateSettingsTabBadge();
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
    reviewQueue: (function () { try { return JSON.parse(r(REVIEW_KEY) || "{}"); } catch { return {}; } })(),
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
  if (server.reviewQueue && typeof server.reviewQueue === "object") {
    localStorage.setItem(pre(REVIEW_KEY), JSON.stringify(server.reviewQueue));
  }
  if (server.seenHistory) applySeenHistory(profileId, server.seenHistory);

  localStorage.setItem(pre("updatedAt"), serverTs);
}

// ------- プランの変更をリアルタイムで受け取る -------
// 支払いはStripeの別タブで行われるため、購入が終わってもアプリ側のタブは
// ログイン時に読んだ fbPlan を持ったままだった（無料表示のまま変わらない）。
// webhookが households/{uid}.plan を書き換えた瞬間に気づけるよう購読する。

let _planUnsubscribe = null;

function watchHouseholdPlan() {
  stopWatchingHouseholdPlan();
  if (!fbCurrentUser) return;

  _planUnsubscribe = fbDb.collection("households").doc(fbCurrentUser.uid)
    .onSnapshot((snap) => {
      if (!snap.exists) return;
      const next = snap.data().plan === "paid" ? "paid" : "free";
      if (next === fbPlan) return;

      const becamePaid = next === "paid" && fbPlan !== "paid";
      fbPlan = next;

      // 開いている画面に即反映する（ずかんは開き直したときに新しいプランで描かれる）
      if (document.getElementById("screen-settings").classList.contains("active")) {
        renderPlanSetting();
      }
      if (becamePaid) showPlanUpgradedNotice();
    }, (e) => {
      // 購読に失敗してもアプリは動く（次回のログインで反映される）
      console.warn("[plan] watch failed:", e.message);
    });
}

function stopWatchingHouseholdPlan() {
  if (_planUnsubscribe) {
    _planUnsubscribe();
    _planUnsubscribe = null;
  }
}

// 有料になった瞬間に出す。別タブで支払った直後、アプリ側で何も起きないと
// 「反映されていないのでは」と不安になるため、必ず目に見える形で知らせる。
function showPlanUpgradedNotice() {
  playLevelUpSound();
  const box = document.createElement("div");
  box.className = "plan-upgraded-toast";
  box.textContent = t("plan.upgradedNotice");
  document.body.appendChild(box);
  setTimeout(() => box.classList.add("is-visible"), 20);
  setTimeout(() => {
    box.classList.remove("is-visible");
    setTimeout(() => box.remove(), 400);
  }, 6000);
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
    const cred = await fbAuth.createUserWithEmailAndPassword(email, password);
    // 確認メールを送る。届かなくてもアプリは使えるようにする（ここで止めると
    // 登録直後に何もできなくなり離脱する）。未確認であることはせっていに出す。
    try {
      await cred.user.sendEmailVerification();
    } catch (e) {
      console.warn("[auth] verification mail failed:", e.message);
    }
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
  document.getElementById("auth-guest-warning").classList.toggle("hidden", !guest);
  document.getElementById("auth-guest-prompt").classList.toggle("hidden", !guest);
  document.getElementById("btn-guest-signup").classList.toggle("hidden", !guest);
  document.getElementById("btn-guest-login").classList.toggle("hidden", !guest);
  document.getElementById("btn-account-logout").classList.toggle("hidden", guest);

  refreshEmailVerifyNotice();
}

// メールアドレスの確認状態。未確認のままだと年額の更新前通知（§10-7）が
// 届かないので、確認を促す。ただしアプリの利用自体は止めない。
function refreshEmailVerifyNotice() {
  const box = document.getElementById("auth-verify-box");
  if (!box) return;
  const needed = !!fbCurrentUser && !fbCurrentUser.emailVerified;
  box.classList.toggle("hidden", !needed);
}

document.getElementById("btn-resend-verify").addEventListener("click", async () => {
  playClickSound();
  const btn = document.getElementById("btn-resend-verify");
  if (!fbCurrentUser) return;
  btn.disabled = true;
  setVerifyFeedback(t("auth.working"), "");
  try {
    await fbCurrentUser.sendEmailVerification();
    setVerifyFeedback(t("auth.verifySent"), "ok");
  } catch (e) {
    console.warn("[auth] verification mail failed:", e.message);
    setVerifyFeedback(t("auth.verifyFailed"), "error");
  }
  btn.disabled = false;
});

// 確認リンクを踏んだあとアプリに戻ってきたとき、状態を取り直して表示を消す
document.getElementById("btn-check-verified").addEventListener("click", async () => {
  playClickSound();
  if (!fbCurrentUser) return;
  setVerifyFeedback(t("auth.working"), "");
  try {
    await fbCurrentUser.reload();
    fbCurrentUser = fbAuth.currentUser;
    if (fbCurrentUser.emailVerified) {
      setVerifyFeedback(t("auth.verifyDone"), "ok");
      setTimeout(refreshEmailVerifyNotice, 1500);
    } else {
      setVerifyFeedback(t("auth.verifyStillPending"), "error");
    }
  } catch (e) {
    setVerifyFeedback(t("auth.verifyFailed"), "error");
  }
});

function setVerifyFeedback(text, kind) {
  const el = document.getElementById("verify-feedback");
  el.textContent = text;
  el.className = "backup-feedback" + (kind ? " " + kind : "");
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
    stopWatchingHouseholdPlan();
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

  // 以降のプラン変更（支払い・解約）はこの購読が拾う
  watchHouseholdPlan();

  refreshAuthAccountLine();
  startInitialScreen();
});
