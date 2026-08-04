// ===== 多言語対応の土台 =====
// 画面に出る文言はすべてここに集める。英語版を足すときは LOCALES に "en" を
// 追加するだけで済むようにしてある（ロジック側は t() 経由でしか文言を触らない）。
//
// 使い方:
//   t("home.title")                     -> "まなびめぐる"
//   t("result.points", { pt: 7, total: 21 })
//   HTML側は <span data-i18n="home.title"></span> と書けば applyTranslations() で入る

const LOCALE_KEY = "locale";
const DEFAULT_LOCALE = "ja";

const LOCALES = {
  ja: {
    label: "日本語",

    // --- 共通 ---
    "common.back": "もどる",
    "common.home": "ホームへ",
    "common.sound": "おとの きりかえ",

    // --- タブバー ---
    "tab.home": "ホーム",
    "tab.study": "べんきょう",
    "tab.gacha": "ガチャ",
    "tab.collection": "ずかん",
    "tab.settings": "せってい",
    "tab.gachaAria": "ガチャをひく",

    // --- オープニング ---
    "splash.tap": "タップして はじめる",

    // --- せってい ---
    "settings.title": "⚙️ せってい",
    "settings.sub": "がくねんを えらぶと、その がくねんまでの もんだいが 出ます",
    "settings.backupTitle": "📦 バックアップ",
    "settings.backupDesc": "べつの たんまつに ひっこしするときや、データが きえてしまったときのために、いままでの きろく（がくねん・カード・ポイント）をファイルに ほぞんしておけます。",
    "settings.backupExport": "書き出す",
    "settings.backupImport": "読み込む",
    "settings.backupConfirmYes": "読み込む",
    "settings.backupConfirmNo": "やめる",
    "settings.backupExportOk": "書き出しました！ファイルを だいじに ほかんしてね",
    "settings.backupExportFailed": "書き出しに しっぱいしました。もういちど ためしてね",
    "settings.backupImportInvalid": "このファイルは 読み込めませんでした",
    "settings.backupImportConfirm": "{profiles}人ぶん・カード{cards}しゅるい・ポイント{points}点 を読み込みます。今の きろくは うわがきされます。よろしいですか？",
    "settings.backupImportOk": "読み込みました！",
    "settings.backupImportFailed": "読み込みに しっぱいしました。もういちど ためしてね",

    // --- プロフィール ---
    "profile.selectTitle": "だれが あそぶ？",
    "profile.selectSub": "じぶんの なまえを えらんでね",
    "profile.createTitle": "あたらしく つくる",
    "profile.createSub": "なまえと すきな どうぶつを えらんでね",
    "profile.createNew": "＋ あたらしく つくる",
    "profile.nameLabel": "なまえ",
    "profile.avatarLabel": "アバター",
    "profile.createOk": "つくる",
    "profile.nameRequired": "なまえを いれてね",
    "profile.defaultName": "わたし",
    "profile.settingsTitle": "👤 プロフィール",
    "profile.currentLine": "いま あそんでいるのは {avatar} {name} だよ",
    "profile.switch": "きりかえる",
    "profile.manage": "けす",
    "profile.deleteConfirm": "{name} の きろく（カード・ポイント・がくねん）を ぜんぶ けします。もとには もどせません。よろしいですか？",
    "profile.deleteBtn": "けす",
    "profile.deleteCancel": "やめる",
    "profile.full": "プロフィールは {n}人までです",

    // --- 共有 ---
    "share.copyHint": "↑ このぶんしょうを コピーして つかってね",
    "share.copyPrompt": "したの ぶんしょうを コピーして つかってね",

    // --- ホーム ---
    "home.title": "まなびめぐる",
    "home.heroGreeting": "きょうも いっしょに\nまなびめぐろう！",
    "home.heroSub": "きょうも 10もん チャレンジ！",
    "home.startStudy": "📖 べんきょうを はじめる",
    "home.weekTitle": "1しゅうかんの がんばり",
    "home.drawGacha": "🎰 ガチャをひく",

    // --- 学年 ---
    "grade.1": "小学1年生",
    "grade.2": "小学2年生",
    "grade.3": "小学3年生",
    "grade.4": "小学4年生",
    "grade.5": "小学5年生",
    "grade.6": "小学6年生",
    "grade.course": "{grade} コース",

    // --- 図鑑ランク ---
    "rank.0": "みならい研究者",
    "rank.4": "かけだし博士",
    "rank.8": "せいれい図鑑マスター",
    "rank.12": "きせつのけんきゅういん",
    "rank.16": "だいベテラン研究者",
    "rank.20": "でんせつの図鑑編さん者",
    "rank.40": "せいれい研究長",
    "rank.60": "ずかんの賢者",
    "rank.80": "きせつをこえたけんきゅういん",
    "rank.100": "せいれいたちの相談役",
    "rank.120": "でんせつをつむぐもの",
    "rank.140": "そらのかなたの案内人",
    "rank.160": "せいれい図鑑のまもり神",
    "rank.180": "きせつのすべてを知るもの",
    "rank.200": "せいれい図鑑 だいけんきゅうしゃ",

    // --- 科目・分野 ---
    "subject.pick": "科目をえらんでね",
    "subject.math": "算数",
    "subject.japanese": "国語",
    "subject.mathDesc": "計算・文章題",
    "subject.japaneseDesc": "漢字・ことば・読解",
    "subject.english": "英語",
    "subject.englishDesc": "たんご・かんたんな かいわ",
    "subject.englishLocked": "英語は 3年生から",
    "category.pick": "やりたい ぶんやを えらんでね",

    // --- クイズ ---
    "quiz.start": "10もん チャレンジ スタート！",
    "quiz.progress": "{current} / {total}",
    "quiz.stamps": "スタンプ {n} 🐣",
    "quiz.hint": "💡 わからない時は ヒント",
    "quiz.answerPlaceholder": "こたえ",
    "quiz.submit": "こたえる",
    "quiz.next": "つぎへ",
    "quiz.badges": "きょうかしょうごう: {n} こ 🏅",
    "quiz.badgeNew": "🆕 はじめての もんだい",
    "quiz.badgeRepeat": "🔁 まえに 出た もんだい（ポイント半分）",
    "quiz.repeatNote": "（🔁 ポイント半分）",

    // --- 結果 ---
    "result.title": "おつかれさま！",
    "result.score": "{correct} / {total} もん せいかい！",
    "result.points": "🎰 ガチャポイント ＋{pt}pt（るいけい {total}pt）",
    "result.retry": "もういちど",
    "result.share": "📤 きょうの せいかを きょうゆうする",

    // --- ガチャ ---
    "gacha.title": "🎰 ガチャ",
    "gacha.titleFor": "🎰 {grade} ガチャ",
    "gacha.points": "ガチャポイント",
    "gacha.cost": "10ポイントで 1かい ひける",
    "gacha.pull": "🎰 ガチャを ひく！",
    "gacha.skip": "スキップ ▶▶",
    "gacha.close": "とじる",
    "gacha.new": "はじめて てにいれた！",
    "gacha.insufficient": "ポイントが たりないよ。もんだいを といて ポイントを ためよう！",
    "gacha.rankUp": "🎉 ずかんランクアップ！ 🎉",
    "gacha.pityHint": "あと {n} かいで かならず 新しいカード",
    "gacha.pityReady": "つぎは かならず 新しいカード！",
    "gacha.pityDone": "ぜんぶ あつめたよ！",
    "gacha.refund": "もっているカードだったので {n}pt もどってきた！",
    "gacha.newCard": "はじめて てにいれた！",

    // --- ずかん ---
    "collection.title": "🎴 カードずかん",
    "collection.count": "{owned} / {total} しゅるい あつめた！",
    "collection.scopeSelf": "じぶん",
    "collection.scopeFamily": "かぞく",
    "collection.countFamily": "かぞく ぜんいんで {owned} / {total} しゅるい あつめた！",

    // --- レアリティ ---
    "rarity.N": "ノーマル",
    "rarity.R": "レア",
    "rarity.SR": "スーパーレア",
    "rarity.UR": "ウルトラレア",

    // --- テーマ ---
    "theme.fireworks": "花火・夜空",
    "theme.ocean": "海・水あそび",
    "theme.festival": "お祭り・夜店",
    "theme.bugs": "虫とり・自然かんさつ",
    "theme.dessert": "ひんやりデザート",
    "theme.special": "なつのしょうちょう",
    "theme.coolbreeze": "すずしさ",
    "theme.starrysky": "ほしぞら",

    // --- ぶんや名 ---
    "cat.keisan": "けいさん",
    "cat.keisanDesc": "たし算・ひき算・かけ算・わり算・分数など",
    "cat.bunshoMath": "ぶんしょうだい",
    "cat.bunshoMathDesc": "文章を読んで解く問題",
    "cat.kanji": "かんじ",
    "cat.kanjiDesc": "漢字の読み方",
    "cat.kotoba": "ことば",
    "cat.kotobaDesc": "はんたいの言葉",
    "cat.kotowaza": "ことわざ",
    "cat.kotowazaDesc": "ことわざの意味をあてよう",
    "cat.yojijukugo": "四字熟語",
    "cat.yojijukugoDesc": "いみをあてよう",
    "cat.bunshoJa": "ぶんしょうだい",
    "cat.bunshoJaDesc": "文章を読んで答える読解問題",
    "cat.tango": "たんご",
    "cat.tangoDesc": "英語と 日本語を むすびつけよう",
    "cat.kaiwa": "かいわ",
    "cat.kaiwaDesc": "あいさつや やりとりの あなうめ",
    "cat.titleFor": "{grade} - {subject}",
    "settings.gradeRange": "1〜{n}年の もんだい",
    "settings.gradeRange1": "1年の もんだい",

    // --- 問題文・解説のひな形 ---
    "q.kanjiRead": "「{kanji}」の 読み方を ひらがなで 書いてね",
    "q.kanjiReadHint": "さいしょの文字は「{first}」だよ",
    "q.shortAnswerHint": "みじかい ことばだよ。声に 出して 読んでみよう",
    "q.kanjiReadExplain": "「{kanji}」は「{reading}」と読みます",
    "q.antonym": "「{word}」の はんたいの ことばは？",
    "q.antonymHint": "さいしょの文字は「{first}」だよ",
    "q.antonymExplain": "「{word}」の はんたいは「{opposite}」だよ",
    "q.meaning": "「{word}」の いみは どれ？",
    "q.meaningReverse": "「{meaning}」という いみの ことばは どれ？",
    "q.kanjiWrite": "「{reading}」と 読む ことばは どれ？",
    "q.meaningExplain": "「{word}」は「{meaning}」という いみです",
    "q.enToJa": "「{word}」の いみは どれ？",
    "q.jaToEn": "「{ja}」を あらわす 英語は どれ？",
    "q.enExplain": "{word} は「{ja}」という いみです",
    "q.enPhrase": "{sentence}\n\n___ に 入る ことばは どれ？",
    "q.enPhraseExplain": "{sentence}（{ja}）",
    "q.choiceHint": "せんたくしを 1つ へらすよ",
    "q.readingPositionHint": "本文の{zone}あたりに 注目してみよう",
    "q.reading": "{passage}\n\nしつもん：{question}",
    "q.readingExplain": "本文の {why}",

    // --- ガイドのセリフ ---
    "guide.home": [
      "こんにちは！きょうも いっしょに べんきょうしよう！",
      "どのれべるに ちょうせんする？",
      "まいにち すこしずつ がんばろうね！",
    ],
    "guide.subject": [
      "さんすう と こくご、どっちにする？",
      "とくいなほうから やってみよう！",
    ],
    "guide.start": [
      "じゅんびは いいかな？10もん がんばろう！",
      "がんばると ガチャが ひけるよ。せいれいずかんを ふやそう！",
    ],
    "guide.correct": [
      "せいかい！すごいね！",
      "やったね！そのちょうし！",
      "かんぺき！りかいも できてるよ！",
      "すばらしい！",
    ],
    "guide.wrong": [
      "おしい！つぎは できるよ！",
      "だいじょうぶ、もう一回かんがえてみよう！",
      "ちょっとむずかしかったね。こたえを おぼえておこう！",
    ],
    "guide.resultHigh": [
      "すごい！ほとんど せいかいだね！かんぺきだよ！",
      "やったー！だいせいこう！",
    ],
    "guide.resultMid": [
      "よくがんばったね！つぎは もっと せいかいできるよ！",
      "いいちょうしだよ！このまま つづけよう！",
    ],
    "guide.resultLow": [
      "まちがえても だいじょうぶ！れんしゅうすれば きっとできるよ！",
      "つぎこそ がんばろう！おうえんしてるよ！",
    ],


    // --- 画面から出るその他の文言 ---
    "quiz.explainPrefix": "💡 かんがえかた: {text}",
    "quiz.hintPrefix": "💡 ヒント: {text}",
    "quiz.hintFallback": "よく もんだいぶんを 読んでみよう",
    "quiz.seeResult": "けっかを見る",
    "quiz.wrongText": "ざんねん… こたえは {answer}",
    "quiz.wrongChoice": "せいかいは 「{answer}」 だよ",
    "result.rate": "せいかいりつ {rate}％",
    "rank.nextIn": "つぎの かいきゅうまで あと {n}しゅるい",
    "rank.max": "さいこうかいきゅうに とうたつ！",
    "rank.beyond": "{base} Lv.{n}",
    "share.done": "きょうゆうしました！",
    "share.failed": "きょうゆうできませんでした。もういちど ためしてね",
    "share.copied": "コピーしました！LINEなどに はりつけて つかってね",

    "summary.subject": "【まなびめぐる】{date} の学習成果",
    "summary.intro": "{date} の学習成果です。",
    "summary.course": "コース: {grade} - {subject}",
    "summary.result": "結果: {total}問中 {correct}問 正解（正答率 {rate}％）",
    "summary.earned": "獲得ガチャポイント: {pt}pt",
    "summary.total": "累計ガチャポイント（{grade}）: {total}pt",
    "locale.dateFormat": "ja-JP",
    "home.heroDate": "{month}月{day}日（{weekday}）",
    "weekdays": ["日", "月", "火", "水", "木", "金", "土"],

  },
};

function getLocale() {
  const saved = localStorage.getItem(LOCALE_KEY);
  return saved && LOCALES[saved] ? saved : DEFAULT_LOCALE;
}

function setLocale(locale) {
  if (!LOCALES[locale]) return;
  localStorage.setItem(LOCALE_KEY, locale);
  document.documentElement.lang = locale;
  applyTranslations();
}

// key が見つからない場合は key をそのまま返す。翻訳漏れが画面上で分かるようにするため。
function t(key, params) {
  const dict = LOCALES[getLocale()] || LOCALES[DEFAULT_LOCALE];
  let text = dict[key];
  if (text === undefined) text = LOCALES[DEFAULT_LOCALE][key];
  if (text === undefined) return key;
  if (params) {
    text = text.replace(/\{(\w+)\}/g, (m, name) =>
      params[name] !== undefined ? params[name] : m
    );
  }
  return text;
}

// ガイドのセリフのように、候補が配列になっているものを取り出す
function tList(key) {
  const dict = LOCALES[getLocale()] || LOCALES[DEFAULT_LOCALE];
  const list = dict[key] !== undefined ? dict[key] : LOCALES[DEFAULT_LOCALE][key];
  return Array.isArray(list) ? list : [];
}

// data-i18n 属性のついた要素にまとめて文言を流し込む
function applyTranslations(root) {
  const scope = root || document;
  scope.querySelectorAll("[data-i18n]").forEach((el) => {
    el.textContent = t(el.dataset.i18n);
  });
  scope.querySelectorAll("[data-i18n-placeholder]").forEach((el) => {
    el.placeholder = t(el.dataset.i18nPlaceholder);
  });
  scope.querySelectorAll("[data-i18n-aria]").forEach((el) => {
    el.setAttribute("aria-label", t(el.dataset.i18nAria));
  });
}
