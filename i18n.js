// ===== 多言語対応の土台 =====
// 画面に出る文言はすべてここに集める。言語を足すときは LOCALES にキーを
// 追加するだけで済むようにしてある（ロジック側は t() 経由でしか文言を触らない）。
//
// ⚠️ t() は「キーが無ければ日本語に落ちる」実装なので、翻訳漏れは画面上では
//    その1箇所だけ日本語になって静かに埋まる。ロケールを足したら必ず
//    `node tools/check_i18n_keys.js` でキー集合の一致を確かめること。
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
    // 複数の文をJS側で連結するときの区切り（subtractStepsExplain など）。
    // 日本語の句点をそのままハードコードすると他言語でも「。」が混ざってしまうため。
    "common.sentenceSep": "。",

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
    "settings.sub": "がくねんを えらぶと、その がくねんに あわせた もんだいが 出ます",
    "settings.languageTitle": "🌐 ことば",
    "settings.languageDesc": "アプリの ひょうじを きりかえます。えらぶと ページを よみこみなおします。",
    "settings.yearStartTitle": "📅 新学期がはじまる月",
    "settings.yearStartDesc": "お住まいの地域に合わせて選んでください。学校で習うころに合わせて、出る問題の種類がすこしずつ増えていきます（日本は4月、アメリカ・ヨーロッパの多くは9月、韓国や南半球は3月です）。",
    "settings.yearStartMonth": "{n}月",
    "settings.yearStartOther": "そのほかの月",

    // --- おしらせ（保護者向け）。新カード・新動画などの告知を静的に置く（ANNOUNCEMENTSを参照） ---
    "announce.title": "📢 おしらせ",
    "announce.desc": "新しいせいれいカードや動画の情報をお知らせします。",
    "announce.empty": "いまのところ、おしらせはありません。",
    "announce.new": "NEW",
    "announce.ctaPlan": "プランを見る",

    "review.title": "💪 にがて分野",
    "review.desc": "まちがえた問題は、翌日・3日後・7日後・20日後にもう一度出ます。正解できたら次の間かくへ進み、4回とも正解したら卒業してこの一覧から消えます。毎日やらなくても間かくは崩れません。復習しなくてよいものは「×」で削除できます。",
    "review.empty": "いまのところ、復習が必要な問題はありません。",
    "review.dueToday": "きょう出ます",
    // 日本語は単複で形が変わらないので One も同じ文言。スペイン語側で使い分ける
    "review.dueLater": "あと{n}日",
    "review.dueLaterOne": "あと1日",
    "review.wrongCount": "まちがえた回数 {n}回",
    "review.wrongCountOne": "まちがえた回数 1回",
    "review.stage": "{current}/{total}回目",
    "review.summary": "復習中 {n}件（うち きょう出るぶん {due}件）",
    "review.remove": "この項目を削除",
    "review.removeConfirm": "「{name}」を一覧から削除します。もう一度まちがえたときは、あらためて復習に入ります。よろしいですか？",
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
    "profile.createSub": "なまえを おしえてね",
    "profile.createNew": "＋ あたらしく つくる",
    "profile.nameLabel": "なまえ",
    "profile.createOk": "つくる",
    "profile.nameRequired": "なまえを いれてね",
    "profile.defaultName": "わたし",
    "profile.settingsTitle": "👤 プロフィール",
    "profile.currentLine": "いま あそんでいるのは {name} だよ",
    "profile.switch": "きりかえる",
    "profile.manage": "けす",
    "profile.deleteConfirm": "{name} の きろく（カード・ポイント・がくねん）を ぜんぶ けします。もとには もどせません。よろしいですか？",
    "profile.deleteBtn": "けす",
    "profile.deleteCancel": "やめる",
    "profile.full": "プロフィールは {n}人までです",
    "profile.freeLimit": "むりょうプランでは プロフィールは1人までです。プレミアムプランで さいだい{n}人まで つくれます。",

    // --- ログイン／新規登録（保護者向け） ---
    "auth.loginTitle": "ログイン",
    "auth.loginSub": "おうちの方のメールアドレスでログインしてください。",
    "auth.signupTitle": "新規登録",
    "auth.signupSub": "おうちの人といっしょに とうろくしてね。ここは保護者の方が行ってください。",
    "auth.emailLabel": "メールアドレス",
    "auth.passwordLabel": "パスワード",
    "auth.passwordHint": "6文字以上で設定してください。",
    "auth.loginSubmit": "ログイン",
    "auth.signupSubmit": "登録する",
    "auth.needAccount": "はじめての方はこちら（新規登録）",
    "auth.haveAccount": "アカウントをお持ちの方はこちら（ログイン）",
    "auth.forgotPassword": "パスワードをわすれた方はこちら",
    "auth.forgotSent": "パスワード再設定メールを送信しました。メールをご確認ください。",
    "auth.emailRequired": "メールアドレスを入力してください",
    "auth.fieldsRequired": "メールアドレスとパスワードを入力してください",
    "auth.working": "処理中です…",
    "auth.errorInvalidEmail": "メールアドレスの形式が正しくありません",
    "auth.errorWeakPassword": "パスワードは6文字以上で設定してください",
    "auth.errorEmailInUse": "このメールアドレスはすでに登録されています",
    "auth.errorWrongPassword": "メールアドレスまたはパスワードが正しくありません",
    "auth.errorUserNotFound": "このメールアドレスは登録されていません",
    "auth.errorGeneric": "エラーが発生しました。時間をおいてもう一度お試しください",
    "auth.accountTitle": "🔐 アカウント",
    "auth.accountLine": "ログイン中：{email}",
    "auth.logout": "ログアウト",
    "auth.syncing": "同期中…",
    "auth.syncDone": "同期しました",
    "auth.syncFailed": "同期に失敗しました（次回また試みます）",

    // --- メールアドレスの確認 ---
    "auth.verifyNotice": "📧 メールアドレスの確認がまだ済んでいません。ご登録のアドレスに確認メールをお送りしていますので、リンクを開いて完了してください。年額プランの更新前のお知らせも、このアドレスにお送りします。",
    "auth.verifyResend": "確認メールを再送する",
    "auth.verifyCheck": "確認できたか調べる",
    "auth.verifySent": "確認メールを送りました。受信箱をご確認ください（迷惑メールに入ることがあります）",
    "auth.verifyDone": "確認できました。ありがとうございます！",
    "auth.verifyStillPending": "まだ確認できていません。メールのリンクを開いてから、もう一度お試しください",
    "auth.verifyFailed": "送信に失敗しました。時間をおいてもう一度お試しください",

    // --- おためし（未登録で使う） ---
    "auth.tryAsGuest": "とうろくせずに ためす",
    "auth.guestNotice": "登録しなくても、そのまま全部あそべます。",
    "auth.guestAccountLine": "おためし中（未登録）",
    "auth.guestSignupPrompt": "アカウントを登録すると、この端末が変わってもデータを引き継げます。いま集めたカードとポイントは、そのまま引き継がれます。",
    "auth.guestDataWarning": "⚠️ いまの記録は、この端末のブラウザの中だけに保存されています。ブラウザのデータを消したときや、別の端末に変えたときには引き継げません。アカウントの登録は無料です。",
    "auth.guestSignup": "アカウントを登録する",
    "auth.guestLogin": "ログインする",
    "auth.backToGuest": "もどる",

    // --- ご要望・お問い合わせ（保護者のアカウントがある場合のみ送信可） ---
    "feedback.title": "💬 ご意見・ご要望",
    "feedback.desc": "アプリへのご意見・ご要望をお送りください。個別のお返事はできませんが、すべて目を通しています。",
    "feedback.placeholder": "こんな問題がほしい、こんな機能があるとうれしい、など",
    "feedback.submit": "送信する",
    "feedback.guestNotice": "アカウント登録すると送れます。",
    "feedback.empty": "内容を入力してください",
    "feedback.sending": "送信中…",
    "feedback.sent": "送信しました。ありがとうございます！",
    "feedback.failed": "送信に失敗しました。時間をおいてもう一度お試しください",

    // --- 感想を送る（保護者のアカウントがある場合のみ送信可） ---
    "testimonial.title": "⭐ 感想を送る",
    "testimonial.desc": "まなびめぐるを使ってみたご感想をお聞かせください。",
    "testimonial.ratingLabel": "評価",
    "testimonial.placeholder": "よかったところ、気になったところなど（にんいです）",
    "testimonial.consentLabel": "この感想を、宣伝（Webページなど）で紹介してもよい",
    "testimonial.submit": "送信する",
    "testimonial.guestNotice": "アカウント登録すると送れます。",
    "testimonial.ratingRequired": "評価を選んでください",
    "testimonial.sending": "送信中…",
    "testimonial.sent": "送信しました。ありがとうございます！",
    "testimonial.failed": "送信に失敗しました。時間をおいてもう一度お試しください",

    // --- プラン（無料→ファミリー） ---
    "plan.title": "🎫 プラン",
    "plan.freeLine": "いまは 無料プランです",
    "plan.paidLine": "ファミリープランを ご利用中です 🎉",
    "plan.benefitIntro": "アップグレードすると、こんなことができます：",
    "plan.benefit1": "お子さんの登録が {n}人まで",
    "plan.benefit2": "せいれいカードが 全{n}種そろう（SR・URも）",
    "plan.benefit3": "かぞくのずかん（家族みんなで集めた図鑑）",
    "plan.gachaPromise": "カードのガチャは、お金では引けません。勉強することでしか引けません。",
    "plan.monthly": "月払い 1,480円",
    "plan.yearly": "年払い 14,800円（2か月ぶん無料）",
    "plan.comingSoon": "ファミリープランは準備中です。もうすこしお待ちください。",
    "plan.guestNote": "ご購入には、さきに保護者の方のアカウント登録が必要です。",
    "plan.afterBuyNote": "お支払いは保護者の方が行ってください。完了後、アプリに反映されます。",
    "plan.managePortal": "契約の管理（解約・お支払い方法）",
    "plan.manageNote": "ご登録のメールアドレスを入力すると、確認用のリンクが届きます。解約されたあとも、お支払い済みの期間が終わるまではそのままお使いいただけます。",
    "plan.cancelByMail": "解約をご希望の場合は、{email} までご連絡ください。お支払い済みの期間が終わるまではそのままお使いいただけます。",
    "plan.legalLink": "特定商取引法に基づく表記",
    "plan.upgradedNotice": "🎉 ファミリープランになりました！ぜんぶのカードが あつめられます",

    // --- 共有 ---
    "share.copyHint": "↑ このぶんしょうを コピーして つかってね",
    "share.copyPrompt": "したの ぶんしょうを コピーして つかってね",

    // --- ホーム ---
    "home.title": "まなびめぐる",
    "home.heroGreeting": "きょうも いっしょに\nまなびめぐろう！",
    "home.heroSub": "きょうも 10もん チャレンジ！",
    "home.startStudy": "📖 べんきょうを はじめる",
    "home.weekTitle": "1しゅうかんの がんばり",
    "home.weekToggle": "1しゅうかんの がんばりを ひらく／とじる",
    "home.drawGacha": "🎰 ガチャをひく",

    // --- 公式YouTube（アプリの外に出る） ---
    "youtube.linkHome": "📺 せいれいの どうがを みる",
    "youtube.linkCollection": "📺 せいれい図鑑チャンネル",
    "youtube.external": "YouTube がひらきます",
    "youtube.url": "https://www.youtube.com/@manabimeguru",

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
    "quiz.fractionPlaceholder": "れい: 3/4",
    "quiz.submit": "こたえる",
    "quiz.next": "つぎへ",
    "quiz.badges": "きょうかしょうごう: {n} こ 🏅",
    "quiz.badgeNew": "🆕 はじめての もんだい",
    "quiz.badgeRepeat": "🔁 まえに 出た もんだい（ポイント半分）",
    "quiz.repeatNote": "（🔁 ポイント半分）",
    "quiz.badgeReview": "💪 まえに まちがえた もんだい",
    "quiz.reviewCleared": "まえは まちがえた もんだいだよ。よく できたね！",

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
    "collection.premiumNote": "🔒 の {n}まいは プレミアムプランで あつめられるよ",
    "collection.premiumBadge": "プレミアム",

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
    "settings.gradeRange": "{lo}〜{n}年の もんだい",
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
    "guide.category": [
      "どのもんだいに ちょうせんする？",
      "すきなぶんやから やってみよう！",
    ],
    "guide.gacha": [
      "どの せいれいに あえるかな？",
      "いいカードが でると いいね！",
    ],
    "guide.collection": [
      "あつめた せいれいを みてみよう！",
      "ぜんぶ あつめられるかな？",
    ],
    "guide.settings": [
      "せっていは おうちの人と いっしょにね",
      "こまったら ここを みてね",
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
    "guide.resultPerfect": [
      "すごい！ぜんもん せいかいだね！かんぺきだよ！",
      "パーフェクト！やったね！",
    ],
    "guide.resultHigh": [
      "すごい！ほとんど せいかいだね！",
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
    // --- 算数の生成器（1〜3年） ---
    // ⚠️ 問題文の数字は生成器が作る。ここにあるのは文だけ。
    //    キー名は生成器の関数名に合わせてある（genAdd1 → math.add1.*）。
    //    {c} は助数詞（「こ」）、{howMany} は「なんこ」。スペイン語では {c} は空で、
    //    {howMany} が Cuántos / Cuántas（品物の性で変わる）になる。
    "math.add1.hint": "{a}に {b}を たすよ。ゆびで かぞえても いいよ",
    "math.add1.explainTen": "10に {b}を たすと {sum}",
    "math.add1.explainSplit": "{a}は 10と{aOnes}。{aOnes}に {b}を たすと {part}。10と{part}で {sum}",
    "math.add1.explainMakeTen": "{a}に {toTen}たして 10。のこりの {rest}を たして {sum}",
    "math.add1.explainPlain": "{a}に {b}を たすと {sum}",
    "math.sub1.hint": "{a}から {b}を へらすよ",
    "math.sub1.explainPlain": "{a}から {b}を ひくと {diff}",
    "math.sub1.explainFromTen": "10は ちょうど10。10から {b}を ひくと {diff}",
    "math.sub1.explainSplit": "{a}は 10と{aOnes}。{aOnes}－{b}＝{part}。10と{part}で {diff}",
    "math.sub1.explainBorrow": "{a}は 10と{aOnes}。10－{b}＝{borrow}。{borrow}に {aOnes}を たして {diff}",
    "math.add2.hint": "十の位と 一の位に わけて たしてみよう",
    "math.add2.explainCarry": "一の位: {aOnes}＋{bOnes}＝{onesSum}なので、十の位に1くり上げる。十の位: {aTens}＋{bTens}＋1＝{tensSumCarry}。あわせて {sum}",
    "math.add2.explainPlain": "一の位: {aOnes}＋{bOnes}＝{onesSum}。十の位: {aTens}＋{bTens}＝{tensSum}。あわせて {sum}",
    "math.sub2.hint": "くり下がりに 気をつけよう",
    "math.sub2.explain": "{a} － {b} ＝ {diff}。たしかめ算: {diff} ＋ {b} ＝ {a}",
    "math.mul2.hint": "{a}のだんの 九九を おもいだそう",
    "math.mul2.explain": "{a} × {b} は {a}を {b}回 たすことだから、{terms}＝{product}",
    "math.add3.hint": "位をそろえて、一の位からじゅんばんに たしざんしてみよう",
    "math.add3.explain": "{a} は {aParts}、{b} は {bParts}。同じ位どうしを たすと {sum} になるよ",
    // ⚠️ ひき算はくり下がりがあるので「一の位から」が正しい。
    //    以前は「大きい位から順に」と書いてあり、解説（subtractStepsExplain は一の位から）
    //    ・math.add3.hint・スペイン語版のいずれとも矛盾していた（2026-08-13 修正）。
    "math.sub3.hint": "位をそろえて、一の位からじゅんばんに ひき算してみよう。くり下がりに注意",
    "math.placeOnes": "一の位",
    "math.placeTens": "十の位",
    "math.placeHundreds": "百の位",
    "math.placeThousands": "千の位",
    "math.sub3.step": "{place}：{top}－{bot}＝{digit}",
    "math.sub3.stepBorrowIn": "{place}：上の位に かした分を ひいて {top}－{bot}＝{digit}",
    "math.sub3.stepBorrowOut": "{place}：{top}－{bot} は たりないので、上の位から1くり下げて {borrowedTop}－{bot}＝{digit}",
    "math.sub3.final": "位をそろえて 下の位から じゅんに計算すると、{a}－{b}＝{diff}",
    "math.mul3.hint": "{a}を 十の位と一の位に分けて、それぞれ {b}を かけてみよう",
    "math.mul3.explain": "{tens}×{b}＝{tensPart}、{ones}×{b}＝{onesPart}。あわせて {tensPart}＋{onesPart}＝{product}",
    "math.div3.hint": "{b}のだんの 九九で こたえが {a} になる数を さがそう",
    "math.div3.explain": "{b} × {q} = {a} だから、{a} ÷ {b} の こたえは {q}",
    "math.divRemainder3.text": "{a} ÷ {b} = ？（例のように「〇あまり△」の形で書いてね。例: 5あまり3）",
    "math.divRemainder3.answer": "{q}あまり{r}",
    "math.divRemainder3.accept": ["{q}余り{r}"],
    "math.divRemainder3.hint": "{b}のだんの 九九で {a}を こえない、いちばん大きい数を さがそう",
    "math.divRemainder3.explain": "{b} × {q} ＝ {product}。{a} － {product} ＝ {r} あまる。だから {q}あまり{r}",
    "math.decimal3.hint": "小数点の位置を そろえて 計算しよう",
    "math.decimal3.explainAdd": "{a}を 10ばいすると {na}、{b}を 10ばいすると {nb}。{na}＋{nb}＝{raw}。10で わって もとに もどすと {answer}",
    "math.decimal3.explainSub": "{hi}を 10ばいすると {hiRaw}、{lo}を 10ばいすると {loRaw}。{hiRaw}－{loRaw}＝{raw}。10で わって もとに もどすと {answer}",
    "math.fraction.reduceSuffix": "。{rawNum}と{d}を{g}でわって やくぶんすると {reduced}",
    "math.fractionSame3.hintAdd": "分母はそのまま、分子どうしを たしざんしよう",
    "math.fractionSame3.explainAdd": "分母はそのままで、分子は {n1}＋{n2}＝{sum}。だから {sum}/{d}",
    "math.fractionSame3.hintSub": "分母はそのまま、分子どうしを ひきざんしよう",
    "math.fractionSame3.explainSub": "分母はそのままで、分子は {n1}－{n2}＝{diff}。だから {diff}/{d}",
    "math.wordAdd.text": "{item}が {a}{c} ありました。{b}{c} もらいました。ぜんぶで {howMany}？",
    "math.wordAdd.hint": "「もらった」ということは、数が ふえるね。たしざんを つかおう",
    "math.wordAdd.explain": "はじめに {a}{c}、もらった {b}{c}を たすと {a}＋{b}＝{sum}{c} になるよ",
    "math.wordSub.text": "{item}が {bigger}{c} ありました。{b}{c} {past}。のこりは {howMany}？",
    "math.wordSub.hint": "「{plain}」ということは、数が へるね。ひきざんを つかおう",
    "math.wordSub.explain": "はじめに {bigger}{c} あって、{b}{c} {plain}から {bigger}－{b}＝{rest}{c} のこるよ",
    "math.wordMul.text": "1ふくろに {item}が {perBag}{c}ずつ 入っています。{bags}ふくろでは ぜんぶで {howMany}？",
    "math.wordMul.hint": "「1ふくろに◯こ」が「△ふくろぶん」あるときは、かけ算を つかおう",
    "math.wordMul.explain": "1ふくろ {perBag}{c} が {bags}ふくろぶん あるから {perBag}×{bags}＝{total}{c} になるよ",
    "math.wordDiv.text": "{item}が {total}{c} あります。{people}人で おなじ数ずつ わけると、1人ぶんは {howMany}？",
    "math.wordDiv.hint": "「おなじ数ずつ わける」ときは、わり算を つかおう",
    "math.wordDiv.explain": "ぜんぶで {total}{c} を {people}人で 同じ数ずつ わけるから {total}÷{people}＝{each}{c} になるよ",
    "math.wordCompare.textMore": "{nameA}は {item}を {b}{c} もっています。{nameB}は {nameA}より {diff}{c} おおく もっています。{nameB}は {howMany}？",
    "math.wordCompare.textLess": "{nameA}は {item}を {b}{c} もっています。{nameB}は {nameA}より {diff}{c} すくなく もっています。{nameB}は {howMany}？",
    "math.wordCompare.hintMore": "「多い」ということは、たしざんを つかおう",
    "math.wordCompare.hintLess": "「少ない」ということは、ひきざんを つかおう",
    "math.wordCompare.explainMore": "{nameA}は{b}{c}。{nameB}は{nameA}より{diff}{c}多いから、{b}＋{diff}＝{total}{c} になるよ",
    "math.wordCompare.explainLess": "{nameA}は{b}{c}。{nameB}は{nameA}より{diff}{c}少ないから、{b}－{diff}＝{total}{c} になるよ",
    "math.wordAddCombine.text": "{place1}に {item}が {a}{c}、{place2}に {b}{c} あります。あわせて {howMany}？",
    "math.wordAddCombine.hint": "「あわせて」と きかれたら、たしざんを つかおう",
    "math.wordAddCombine.explain": "{place1}に {a}{c}、{place2}に {b}{c}。あわせると {a}＋{b}＝{sum}{c} だよ",
    "math.wordSubDiff1.text": "{nameA}は {item}を {a}{c}、{nameB}は {b}{c} もっています。ちがいは {howMany}？",
    "math.wordSubDiff1.hint": "「ちがい」を きかれたら、大きいほうから 小さいほうを ひこう",
    "math.wordSubDiff1.explain": "{a}－{b}＝{diff}。{nameA}のほうが {diff}{c} おおいよ",
    "math.wordAddSub1.text": "{item}が {a}{c} ありました。{b}{c} もらって、そのあと {c2}{c} {past}。のこりは {howMany}？",
    "math.wordAddSub1.hint": "はじめの数に もらった数を たして、そのあと {plain}数を ひこう",
    "math.wordAddSub1.explain": "{a}＋{b}＝{sum}{c}。そこから {c2}{c} {plain}から {sum}－{c2}＝{rest}{c} のこるよ",
    "math.wordLength2.textAdd": "あおい テープが {a}cm、あかい テープが {b}cm あります。つなげると なんcm？",
    "math.wordLength2.hintAdd": "つなげた長さは、2本の長さを たすと もとめられるよ",
    "math.wordLength2.explainAdd": "{a}＋{b}＝{sum}（cm）",
    "math.wordLength2.textSub": "{a}cm の テープから {b}cm きりとりました。のこりは なんcm？",
    "math.wordLength2.hintSub": "きりとった長さを ひくと、のこりが もとめられるよ",
    "math.wordLength2.explainSub": "{a}－{b}＝{diff}（cm）",
    "math.wordDivRemainder3.text": "{total}人が 1台に {perCar}人ずつ 車に のります。ぜんいん のるには 車は なんだい いりますか？",
    "math.wordDivRemainder3.hint": "{total}÷{perCar} を計算して、あまった人のぶんも 1台 かぞえよう",
    "math.wordDivRemainder3.explain": "{total}÷{perCar}＝{cars}あまり{rest}。あまった{rest}人にも 車が いるので {cars}＋1＝{need}台 だよ",
    "math.wordMulArray2.text": "シールを たてに {rows}れつ、よこに {cols}れつ ならべて はりました。シールは ぜんぶで なんまい？",
    "math.wordMulArray2.hint": "「たて × よこ」で ぜんぶの数が もとめられるよ",
    "math.wordMulArray2.explain": "たて {rows}れつ、よこ {cols}れつ ならんでいるから {rows}×{cols}＝{total}まい だよ",

    // --- 算数の生成器（4年） ---
    "math.divLong4.hint": "大きい位から じゅんばんに わっていく ひっ算で 計算しよう",
    "math.divLong4.explainExact": "{a}を {b}で わると、ちょうど {qTens}になる（{tensPart}÷{b}＝{qTens}）",
    "math.divLong4.explainSplit": "{a}を {tensPart}と{onesPart}に分けると、{tensPart}÷{b}＝{qTens}、{onesPart}÷{b}＝{qOnes}。あわせて {q}",
    "math.decimalAddSub4.hint": "小数点の いちを そろえて、ひっ算で 計算しよう",
    "math.decimalAddSub4.explainAdd": "{a}を 100ばいすると {aRaw}、{b}を 100ばいすると {bRaw}。{aRaw}＋{bRaw}＝{raw}。100で わって もとに もどすと {answer}",
    "math.decimalAddSub4.explainSub": "{big}を 100ばいすると {bigRaw}、{small}を 100ばいすると {smallRaw}。{bigRaw}－{smallRaw}＝{raw}。100で わって もとに もどすと {answer}",
    "math.rectArea4.textSquare": "1辺が {side}cm の 正方形の 面積は なんcm²？",
    "math.rectArea4.textRect": "たて {h}cm、よこ {w}cm の 長方形の 面積は なんcm²？",
    "math.rectArea4.hintSquare": "正方形の 面積 ＝ 1辺 × 1辺",
    "math.rectArea4.hintRect": "長方形の 面積 ＝ たて × よこ",
    "math.rectArea4.explainSquare": "{side} × {side} ＝ {area}（cm²）",
    "math.rectArea4.explainRect": "{h} × {w} ＝ {area}（cm²）",
    "math.rounding4.text": "{n} を 四捨五入して、{place}の位までの がい数に すると?",
    "math.rounding4.hint": "{place}の位の 1つ下の 数を 見て、4以下なら きりさげ、5以上なら きりあげ",
    "math.rounding4.explain": "{place}の位の 1つ下、{lower}の位の 数字は {lowerDigit}。{decision} {place}の位までの がい数に すると {answer}",
    "math.rounding4.up": "5以上なので きりあげて",
    "math.rounding4.down": "4以下なので きりさげて",
    "math.angle4.text": "1つの 直線の 上に 2つの 角が ならんでいます。1つが {a}度、もう1つが {b}度の とき、のこりの 角は なん度？",
    "math.angle4.hint": "1つの 直線が つくる 角は ぜんぶで 180度",
    "math.angle4.explain": "180 － {a} － {b} ＝ {rest}（度）",
    "math.wordUnit4.text": "テープが {total}cm あります。これは なんm なんcm？（cm の 数を 答えてね。{m}m ◯cm）",
    "math.wordUnit4.hint": "100cm ＝ 1m だよ。100で わった あまりを かんがえよう",
    "math.wordUnit4.explain": "{total}cm ＝ {m}m {cm}cm（100cm が {m}こ ぶんと、あまり {cm}cm）",
    "math.wordBigNumber4.text": "ある{place}の {what}は {base}{unit}{amount} です。となりの{place}は その {times}ばい です。となりの{place}の {what}は なん{unit}{amount}？（{unit}を のぞいた 数を 答えてね）",
    "math.wordBigNumber4.hint": "{unit}の いくつぶんか で かんがえよう。{base} × {times} を 計算するよ",
    "math.wordBigNumber4.explain": "{base}{unit} の {times}ばい は {base}×{times}＝{total}。つまり {total}{unit}{amount}",
    "math.wordEstimate4.text": "ある店で 月よう日に {a}人、火よう日に {b}人 きました。それぞれ {label}の位までの がい数に して、2日で およそ なん人か もとめましょう。",
    "math.wordEstimate4.hint": "先に それぞれを {label}の位までの がい数に してから たすよ",
    "math.wordEstimate4.explain": "{a}は およそ {ra}、{b}は およそ {rb}。{ra}＋{rb}＝{total}（人）",
    "math.wordDivLarge4.textNeed": "{total}この ボールを 1はこに {perBox}こずつ 入れます。ぜんぶ 入れるには はこは なんこ いりますか？",
    "math.wordDivLarge4.hintNeed": "{total}÷{perBox} を計算して、あまったぶんの はこも かぞえよう",
    "math.wordDivLarge4.explainNeed": "{total}÷{perBox}＝{boxes}あまり{rest}。あまった {rest}こにも はこが いるので {boxes}＋1＝{need}こ",
    "math.wordDivLarge4.textFull": "{total}この ボールを 1はこに {perBox}こずつ 入れます。いっぱいに なる はこは なんこ できますか？",
    "math.wordDivLarge4.hintFull": "{total}÷{perBox} の 商が、いっぱいに なった はこの 数だよ",
    "math.wordDivLarge4.explainFull": "{total}÷{perBox}＝{boxes}あまり{rest}。いっぱいに なるのは {boxes}こ（{rest}こ あまる）",
    "math.wordAreaRoom4.textSide": "{place}の 面積は {area}m² です。たての 長さが {h}m の とき、よこの 長さは なんm？",
    "math.wordAreaRoom4.hintSide": "面積 ÷ たて ＝ よこ。かけ算の ぎゃくを かんがえよう",
    "math.wordAreaRoom4.explainSide": "{area}÷{h}＝{w}（m）",
    "math.wordAreaRoom4.textArea": "たて {h}m、よこ {w}m の {place}が あります。面積は なんm²？",
    "math.wordAreaRoom4.hintArea": "長方形の 面積 ＝ たて × よこ",
    "math.wordAreaRoom4.explainArea": "{h}×{w}＝{area}（m²）",
    "math.wordDecimalAmount4.textAdd": "{name}が 大きい入れものに {a}{unit}、小さい入れものに {b}{unit} あります。あわせて なん{unit}？",
    "math.wordDecimalAmount4.hintAdd": "小数点の いちを そろえて たそう",
    "math.wordDecimalAmount4.explainAdd": "{a}＋{b}＝{sum}（{unit}）",
    "math.wordDecimalAmount4.textSub": "{name}が {a}{unit} ありました。{b}{unit} つかいました。のこりは なん{unit}？",
    "math.wordDecimalAmount4.hintSub": "小数点の いちを そろえて ひこう",
    "math.wordDecimalAmount4.explainSub": "{a}－{b}＝{diff}（{unit}）",
    "math.wordProportion4.text": "{name} {n1}{unit} の {word}は {first}{amount} です。同じ {name} {n2}{unit} では なん{amount}？",
    "math.wordProportion4.hint": "まず 1{unit} ぶんの {word}を もとめよう",
    "math.wordProportion4.explain": "1{unit} ぶんは {first}÷{n1}＝{per}{amount}。{n2}{unit} では {per}×{n2}＝{total}{amount}",

    // --- 算数の生成器（5・6年） ---
    // 数を並べるときの区切り。日本語は「、」、スペイン語は「, 」。
    "math.listSeparator": "、",
    "math.itemSeparator": "・",
    "math.decimalMul5.hint": "小数点が ないものとして かけ算し、あとで 小数点を もどそう",
    "math.decimalMul5.explain": "{a10} × {b} ＝ {raw}。小数点を 1つ もどして {answer}",
    "math.decimalDiv5.hint": "わられる数の 小数点の いちを そのまま 商に うつして 計算しよう",
    "math.decimalDiv5.explain": "{a}を 10ばいすると {a10}。{inner}。10で わって もとに もどすと {q}",
    "math.fractionAddDiff5.text": "{n1}/{d1} ＋ {n2}/{d2} = ？（やくぶんしてね）",
    "math.fractionAddDiff5.hint": "分母を そろえて（通分して）から たしざんしよう",
    // 末尾に句点を置かない。約分が起きたときだけ reduceExplainSuffix が
    //「。…やくぶんすると …」を足す（fractionMul6・fractionSame3 と同じ作り）。
    "math.fractionAddDiff5.explain": "通分すると {a}/{den} ＋ {b}/{den} ＝ {num}/{den}",
    "math.average5.text": "{values} の {n}つの 数の 平均は いくつ？",
    "math.average5.hint": "平均 ＝ ぜんぶを たした数 ÷ 個数",
    "math.average5.explain": "ぜんぶ たすと {sum}。{n}で わって {avg}",
    "math.percent5.text": "{base} の {pct}％ は いくつ？",
    "math.percent5.hint": "◯％ は 100で わった わりあい。もとの数 × わりあい で もとまるよ",
    "math.percent5.explain": "{pct}％ ＝ {ratio}。{base} × {ratio} ＝ {answer}",
    "math.triangleArea5.text": "ていへんが {base}cm、たかさが {height}cm の 三角形の 面積は なんcm²？",
    "math.triangleArea5.hint": "三角形の 面積 ＝ ていへん × たかさ ÷ 2",
    "math.triangleArea5.explain": "{base} × {height} ÷ 2 ＝ {area}（cm²）",
    "math.wordPerUnit5.text": "{units}{unit}の {item}の{label}は {total}{per} です。1{unit}あたりの{label}は なん{per}？",
    "math.wordPerUnit5.hint": "1あたりの 大きさ ＝ ぜんたい ÷ いくつ分",
    "math.wordPerUnit5.explain": "{total} ÷ {units} ＝ {perUnit}（{per}）",
    "math.wordMultiple5.textBus": "駅から Aの バスは {a}分ごと、Bの バスは {b}分ごとに 出ます。2つが 同時に 出たあと、つぎに 同時に 出るのは なん分後？",
    "math.wordMultiple5.hintBus": "{a}と {b}の 公倍数の うち、いちばん 小さい数（最小公倍数）を 見つけよう",
    "math.wordMultiple5.explainBus": "{a}の倍数と {b}の倍数に 共通する いちばん小さい数は {lcm}。だから {lcm}分後",
    "math.wordMultiple5.textCard": "たて {a}cm、よこ {b}cm の カードを すきまなく ならべて 正方形を つくります。いちばん 小さい 正方形の 1辺は なんcm？",
    "math.wordMultiple5.hintCard": "たてにも よこにも きっちり ならぶ長さ＝{a}と {b}の 最小公倍数",
    "math.wordMultiple5.explainCard": "{a}と {b}の 最小公倍数は {lcm}。だから 1辺 {lcm}cm",
    "math.wordDivisor5.text": "あめが {a}こ、クッキーが {b}こ あります。どちらも あまりが 出ないように 同じ数ずつ 分けます。いちばん 多くて なん人に 分けられますか？",
    "math.wordDivisor5.hint": "{a}と {b}の 両方を わりきれる数の うち、いちばん 大きい数（最大公約数）だよ",
    "math.wordDivisor5.explain": "{a}÷{g}＝{m}、{b}÷{g}＝{n} で どちらも わりきれる。{g}より大きい数では わりきれないので {g}人",
    "math.wordPercent5.textDiscount": "定価 {price}円の 品物が {pct}％引きに なりました。ねだんは いくらに なりますか？",
    "math.wordPercent5.hintDiscount": "{pct}％引き ＝ 定価の (100－{pct})％ を はらうということ",
    "math.wordPercent5.explainDiscount": "ひく分は {price}×{ratio}＝{diff}円。{price}－{diff}＝{lower}円",
    "math.wordPercent5.textRaise": "もとの ねだんが {price}円の 品物が {pct}％ ねあがりしました。いまの ねだんは いくら？",
    "math.wordPercent5.hintRaise": "ふえる分は もとの ねだんの {pct}％。それを もとの ねだんに たすよ",
    "math.wordPercent5.explainRaise": "ふえる分は {price}×{ratio}＝{diff}円。{price}＋{diff}＝{higher}円",
    "math.wordAverage5.text": "テストを {n}回 うけて、平均は {avgSoFar}点でした。つぎの テストで なん点 とれば、{n1}回の 平均が {targetAvg}点に なりますか？",
    "math.wordAverage5.hint": "{n1}回ぶんの 合計が いくつ 必要か を 先に もとめよう",
    "math.wordAverage5.explain": "いまの合計は {avgSoFar}×{n}＝{now}点。ほしい合計は {targetAvg}×{n1}＝{want}点。差の {need}点が 必要",
    "math.wordDensity5.text": "Aの うさぎ小屋は {areaA}m²に {totalA}ひき、Bの うさぎ小屋は {areaB}m²に {totalB}ひき います。こんでいる ほうの 小屋の 1m²あたりの 数は なんひき？",
    "math.wordDensity5.hint": "どちらも 1m²あたり なんひきか を もとめて くらべよう",
    "math.wordDensity5.explain": "Aは {totalA}÷{areaA}＝{perA}ひき、Bは {totalB}÷{areaB}＝{perB}ひき。こんでいるのは {denser}で {dense}ひき",
    "math.fractionMul6.text": "{a}/{b} × {c}/{d} = ？（やくぶんしてね）",
    "math.fractionMul6.hint": "分子どうし、分母どうしを かけてから やくぶんしよう",
    "math.fractionMul6.explain": "分子: {a}×{c}＝{rawNum}、分母: {b}×{d}＝{rawDen}。だから {rawNum}/{rawDen}",
    "math.fractionDiv6.text": "{n1}/{d1} ÷ {n2}/{d2} = ？（やくぶんしてね）",
    "math.fractionDiv6.hint": "わる数の分数をひっくり返して、かけ算にしよう",
    "math.fractionDiv6.explain": "{n2}/{d2} を ひっくり返すと {d2}/{n2}。{n1}/{d1} × {d2}/{n2} ＝ {rawNum}/{rawDen}",
    "math.circleArea6.text": "半径 {r}cm の円の面積は？（cm²、円周率は3.14）",
    "math.circleArea6.hint": "円の面積 ＝ 半径 × 半径 × 3.14 の公式を つかおう",
    "math.circleArea6.explain": "{r} × {r} × 3.14 ＝ {area}",
    "math.volume6.text": "たて{w}cm、よこ{l}cm、たかさ{h}cm の 直方体の体積は？（cm³）",
    "math.volume6.hint": "直方体の体積 ＝ たて × よこ × たかさ の公式を つかおう",
    "math.volume6.explain": "{w} × {l} × {h} ＝ {volume}",
    "math.ratio6.text": "{a} : {b} を いちばん かんたんな 比に すると？",
    "math.ratio6.hint": "公約数で わって、これ以上われない形にしよう",
    "math.ratio6.explain": "{a}と{b}の 最大公約数は {factor}。両方を それで わると {simpleX}:{simpleY}",
    "math.wordSpeed.textTime": "時速 {speed}kmで はしる 車が {dist}km すすむのに かかる時間は なん時間？",
    "math.wordSpeed.hintTime": "時間 ＝ 道のり ÷ 速さ の公式を つかおう",
    "math.wordSpeed.explainTime": "{dist} ÷ {speed} ＝ {hours}（時間）",
    "math.wordSpeed.textSpeed": "車が {hours}時間で {dist}km すすみました。時速は なんkm？",
    "math.wordSpeed.hintSpeed": "速さ ＝ 道のり ÷ 時間 の公式を つかおう",
    "math.wordSpeed.explainSpeed": "{dist} ÷ {hours} ＝ {speed}（km）",
    "math.wordSpeed.textDist": "時速 {speed}kmで はしる 車が {hours}時間 はしると、なんkm すすむ？",
    "math.wordSpeed.hintDist": "道のり ＝ 速さ × 時間 の公式を つかおう",
    "math.wordSpeed.explainDist": "時速{speed}km × {hours}時間 ＝ {dist}km",
    "math.proportion6.text": "yはxに比例します。x＝{x1}のとき y＝{y1}です。x＝{x2}のとき yはいくつ？",
    "math.proportion6.hint": "比例の関係では、yはいつも「xに決まった数をかけた形」になっているよ",
    "math.proportion6.explain": "x＝{x1}のとき y＝{y1}だから、決まった数は {y1}÷{x1}＝{k}。x＝{x2}のとき y ＝ {x2} × {k} ＝ {y2}",
    "math.combination6.text": "{items}の {n}まいの カードを 横一列に ならべます。ならべ方は 何通り？",
    "math.combination6.hint": "さいしょの1まいの えらび方は{n}通り、つぎは{n1}通り…と かけ算していこう",
    "math.combination6.explain": "{terms}＝{fact}通り",
    "math.wordRatioSplit6.text": "{total}円を {rx}:{ry}の 比で 2人に わけます。おおい方は いくら？",
    "math.wordRatioSplit6.hint": "比の合計にあわせて、全体をいくつ分にわけるか考えよう",
    "math.wordRatioSplit6.explain": "比の合計は {rx}＋{ry}＝{totalUnits}。{total}÷{totalUnits}＝{perUnit}円が1あたり。おおい方は {bigger}×{perUnit}＝{answer}円",
    "math.wordFractionMul6.text": "1mの 重さが {num}/{den}kg の ぼうが あります。この ぼう {len}m の 重さは なんkg？",
    "math.wordFractionMul6.hint": "1mあたりの 重さ × 長さ で もとめられるよ",
    "math.wordFractionMul6.explain": "{num}/{den} × {len} ＝ {num}×{len}/{den} ＝ {prod}/{den} ＝ {answer}（kg）",
    "math.wordCombinationPick6.textTeam": "{n}つの チームが、どのチームとも 1回ずつ 試合を します。試合は ぜんぶで なん試合？",
    "math.wordCombinationPick6.hintTeam": "{n}チームから 2チームを えらぶ 組み合わせの 数だよ。順番は 区別しない",
    "math.wordCombinationPick6.explainTeam": "{n}×({n}－1)÷2 ＝ {n}×{n1}÷2 ＝ {answer}試合（AとBの試合は 1回と数える）",
    "math.wordCombinationPick6.textShake": "{n}人が、おたがいに 1回ずつ あくしゅを します。あくしゅは ぜんぶで なん回？",
    "math.wordCombinationPick6.hintShake": "{n}人から 2人を えらぶ 組み合わせの 数だよ",
    "math.wordCombinationPick6.explainShake": "{n}×({n}－1)÷2 ＝ {n}×{n1}÷2 ＝ {answer}回",
    "math.wordInverse6.text": "面積が {total}cm²の 長方形が あります。たての 長さが {x1}cm の とき よこは {y1}cm でした。たてを {x2}cm に すると、よこは なんcm？",
    "math.wordInverse6.hint": "たて × よこ が いつも 同じ数（面積）に なる。これが 反比例の 関係だよ",
    "math.wordInverse6.explain": "たて×よこ＝{total} で いつも 同じ。{total}÷{x2}＝{y2}（cm）",
    "math.wordCircle6.text": "直径 {d}m の まるい 花だんが あります。この 花だんの 面積は なんm²？（円周率は3.14）",
    "math.wordCircle6.hint": "先に 半径を もとめよう。半径 ＝ 直径 ÷ 2",
    "math.wordCircle6.explain": "半径は {d}÷2＝{r}m。{r}×{r}×3.14＝{area}（m²）",
    "math.wordRatioFind6.text": "すと あぶらを {rx}:{ry} の 比で まぜます。すを {known}mL つかうとき、あぶらは なんmL？",
    "math.wordRatioFind6.hint": "すの {rx} が {known}mL なので、比の 1あたりが いくつかを もとめよう",
    "math.wordRatioFind6.explain": "比の1あたりは {known}÷{rx}＝{unit}mL。あぶらは {ry}×{unit}＝{answer}mL",

    "locale.dateFormat": "ja-JP",
    "home.heroDate": "{month}月{day}日（{weekday}）",
    "weekdays": ["日", "月", "火", "水", "木", "金", "土"],
    // weekdays は Date.getDay() の値（0=日曜）で引くので、並びは日曜始まりで固定。
    // 週の始まりが月曜の地域でも、ホームの週グラフは「今日から数えて7日ぶん」を
    // 日付順に並べるだけなので、この並びを変える必要はない。
    "months": ["1月", "2月", "3月", "4月", "5月", "6月", "7月", "8月", "9月", "10月", "11月", "12月"],

  },

  // ===== スペイン語 =====
  // 対象は Primaria（6年制・6〜12歳）。日本の小1〜6と学年も年齢も1対1で対応するため、
  // 各バンクの grade はそのまま使える（es-handoff.md 罠④の確認結果）。
  //
  // 子ども向けの文言は tú で、保護者向け（ログイン・プラン・法務）は敬体に寄せている。
  // 国語（Lengua）は未執筆のため es では科目ごと隠しているが、キー集合を ja と
  // 一致させる必要があるので、将来 Lengua を書くときの訳語を先に置いてある。
  es: {
    label: "Español",

    // --- 共通 ---
    "common.back": "Volver",
    "common.home": "Inicio",
    "common.sound": "Sonido",
    "common.sentenceSep": ". ",

    // --- タブバー ---
    "tab.home": "Inicio",
    "tab.study": "Estudiar",
    "tab.gacha": "Sobres",
    "tab.collection": "Álbum",
    "tab.settings": "Ajustes",
    "tab.gachaAria": "Abrir un sobre",

    // --- オープニング ---
    "splash.tap": "Toca para empezar",

    // --- せってい ---
    "settings.title": "⚙️ Ajustes",
    "settings.sub": "Elige tu curso y los ejercicios se adaptarán a él",
    "settings.languageTitle": "🌐 Idioma",
    "settings.languageDesc": "Cambia el idioma de la aplicación. Al elegir uno, la página se recargará.",
    "settings.yearStartTitle": "📅 Mes en que empieza el curso escolar",
    "settings.yearStartDesc": "Elige el mes según tu país. Los tipos de ejercicio van apareciendo poco a poco, siguiendo el ritmo del colegio (en España es septiembre, en México agosto, en Japón abril, y en el hemisferio sur marzo).",
    "settings.yearStartMonth": "{name}",
    "settings.yearStartOther": "Otro mes",

    "announce.title": "📢 Novedades",
    "announce.desc": "Aquí anunciamos nuevas cartas y vídeos.",
    "announce.empty": "Por ahora no hay novedades.",
    "announce.new": "NUEVO",
    "announce.ctaPlan": "Ver el plan",

    "review.title": "💪 Lo que cuesta más",
    "review.desc": "Las preguntas falladas vuelven a salir al día siguiente y a los 3, 7 y 20 días. Cada acierto pasa al siguiente intervalo y, tras acertar las cuatro veces, la pregunta desaparece de esta lista. Los intervalos se respetan aunque no se juegue todos los días. Con la «×» puedes quitar lo que no haga falta repasar.",
    "review.empty": "Ahora mismo no hay nada pendiente de repasar.",
    "review.dueToday": "Sale hoy",
    "review.dueLater": "En {n} días",
    "review.dueLaterOne": "Mañana",
    "review.wrongCount": "Fallada {n} veces",
    "review.wrongCountOne": "Fallada 1 vez",
    "review.stage": "Repaso {current} de {total}",
    "review.summary": "{n} en repaso ({due} para hoy)",
    "review.remove": "Quitar de la lista",
    "review.removeConfirm": "Se quitará «{name}» de la lista. Si vuelve a fallar esta pregunta, entrará otra vez en el repaso. ¿Continuar?",
    "settings.backupTitle": "📦 Copia de seguridad",
    "settings.backupDesc": "Puedes guardar tu progreso (curso, cartas y puntos) en un archivo, por si cambias de dispositivo o pierdes los datos.",
    "settings.backupExport": "Exportar",
    "settings.backupImport": "Importar",
    "settings.backupConfirmYes": "Importar",
    "settings.backupConfirmNo": "Cancelar",
    "settings.backupExportOk": "¡Guardado! Conserva bien el archivo",
    "settings.backupExportFailed": "No se pudo exportar. Inténtalo otra vez",
    "settings.backupImportInvalid": "No se ha podido leer este archivo",
    "settings.backupImportConfirm": "Se importarán {profiles} perfil(es), {cards} cartas distintas y {points} puntos. Tu progreso actual se sustituirá. ¿Quieres continuar?",
    "settings.backupImportOk": "¡Importado!",
    "settings.backupImportFailed": "No se pudo importar. Inténtalo otra vez",

    // --- プロフィール ---
    "profile.selectTitle": "¿Quién va a jugar?",
    "profile.selectSub": "Elige tu nombre",
    "profile.createTitle": "Crear un perfil nuevo",
    "profile.createSub": "¿Cómo te llamas?",
    "profile.createNew": "＋ Crear un perfil nuevo",
    "profile.nameLabel": "Nombre",
    "profile.createOk": "Crear",
    "profile.nameRequired": "Escribe tu nombre",
    "profile.defaultName": "Yo",
    "profile.settingsTitle": "👤 Perfil",
    "profile.currentLine": "Ahora está jugando {name}",
    "profile.switch": "Cambiar",
    "profile.manage": "Borrar",
    "profile.deleteConfirm": "Se borrará todo el progreso de {name} (cartas, puntos y curso). No se podrá recuperar. ¿Seguro que quieres continuar?",
    "profile.deleteBtn": "Borrar",
    "profile.deleteCancel": "Cancelar",
    "profile.full": "Solo se pueden crear {n} perfiles",
    "profile.freeLimit": "El plan gratuito permite un solo perfil. Con el plan Premium puedes crear hasta {n}.",

    // --- ログイン／新規登録（保護者向け） ---
    "auth.loginTitle": "Iniciar sesión",
    "auth.loginSub": "Inicie sesión con el correo electrónico de la madre, el padre o el tutor.",
    "auth.signupTitle": "Crear una cuenta",
    "auth.signupSub": "Este paso debe realizarlo una persona adulta.",
    "auth.emailLabel": "Correo electrónico",
    "auth.passwordLabel": "Contraseña",
    "auth.passwordHint": "Debe tener 6 caracteres como mínimo.",
    "auth.loginSubmit": "Iniciar sesión",
    "auth.signupSubmit": "Crear cuenta",
    "auth.needAccount": "¿Es la primera vez? Crear una cuenta",
    "auth.haveAccount": "¿Ya tiene cuenta? Iniciar sesión",
    "auth.forgotPassword": "He olvidado mi contraseña",
    "auth.forgotSent": "Le hemos enviado un correo para restablecer la contraseña. Revise su bandeja de entrada.",
    "auth.emailRequired": "Introduzca su correo electrónico",
    "auth.fieldsRequired": "Introduzca el correo electrónico y la contraseña",
    "auth.working": "Procesando…",
    "auth.errorInvalidEmail": "El formato del correo electrónico no es válido",
    "auth.errorWeakPassword": "La contraseña debe tener 6 caracteres como mínimo",
    "auth.errorEmailInUse": "Este correo electrónico ya está registrado",
    "auth.errorWrongPassword": "El correo electrónico o la contraseña no son correctos",
    "auth.errorUserNotFound": "Este correo electrónico no está registrado",
    "auth.errorGeneric": "Se ha producido un error. Inténtelo de nuevo más tarde",
    "auth.accountTitle": "🔐 Cuenta",
    "auth.accountLine": "Sesión iniciada: {email}",
    "auth.logout": "Cerrar sesión",
    "auth.syncing": "Sincronizando…",
    "auth.syncDone": "Sincronizado",
    "auth.syncFailed": "No se pudo sincronizar (se volverá a intentar)",

    // --- メールアドレスの確認 ---
    "auth.verifyNotice": "📧 Su correo electrónico aún no está verificado. Le hemos enviado un mensaje de confirmación: abra el enlace para completar la verificación. Los avisos previos a la renovación del plan anual también se envían a esta dirección.",
    "auth.verifyResend": "Reenviar el correo de verificación",
    "auth.verifyCheck": "Comprobar si ya está verificado",
    "auth.verifySent": "Correo de verificación enviado. Revise su bandeja de entrada (puede llegar a la carpeta de spam)",
    "auth.verifyDone": "Verificado. ¡Muchas gracias!",
    "auth.verifyStillPending": "Todavía no está verificado. Abra el enlace del correo y vuelva a intentarlo",
    "auth.verifyFailed": "No se pudo enviar. Inténtelo de nuevo más tarde",

    // --- おためし（未登録で使う） ---
    "auth.tryAsGuest": "Probar sin registrarse",
    "auth.guestNotice": "Puedes jugar a todo sin registrarte.",
    "auth.guestAccountLine": "Modo de prueba (sin cuenta)",
    "auth.guestSignupPrompt": "Si crea una cuenta, podrá conservar los datos aunque cambie de dispositivo. Las cartas y los puntos conseguidos hasta ahora se mantienen.",
    "auth.guestDataWarning": "⚠️ Su progreso está guardado únicamente en el navegador de este dispositivo. Se perderá si borra los datos del navegador o si cambia de dispositivo. Crear una cuenta es gratuito.",
    "auth.guestSignup": "Crear una cuenta",
    "auth.guestLogin": "Iniciar sesión",
    "auth.backToGuest": "Volver",

    "feedback.title": "💬 Opiniones y sugerencias",
    "feedback.desc": "Envíanos tu opinión o sugerencia sobre la app. No podemos responder de forma individual, pero las leemos todas.",
    "feedback.placeholder": "Un tipo de ejercicio que te gustaría, una función que echas en falta, etc.",
    "feedback.submit": "Enviar",
    "feedback.guestNotice": "Puedes enviarlo si te registras.",
    "feedback.empty": "Escribe algo antes de enviar",
    "feedback.sending": "Enviando…",
    "feedback.sent": "Enviado. ¡Gracias!",
    "feedback.failed": "No se pudo enviar. Inténtalo de nuevo más tarde",

    "testimonial.title": "⭐ Enviar una opinión",
    "testimonial.desc": "Cuéntanos qué te ha parecido Manabimeguru.",
    "testimonial.ratingLabel": "Valoración",
    "testimonial.placeholder": "Qué te ha gustado, qué mejorarías (opcional)",
    "testimonial.consentLabel": "Podéis usar esta opinión en material promocional (como la página web)",
    "testimonial.submit": "Enviar",
    "testimonial.guestNotice": "Puedes enviarlo si te registras.",
    "testimonial.ratingRequired": "Elige una valoración",
    "testimonial.sending": "Enviando…",
    "testimonial.sent": "Enviado. ¡Gracias!",
    "testimonial.failed": "No se pudo enviar. Inténtalo de nuevo más tarde",

    // --- プラン（無料→ファミリー） ---
    // ⚠️ 価格はまだ日本円のまま（Stripe の Payment Link が JPY 建てのため）。
    //    スペイン語圏向けの価格は未定（es-handoff.md §6・account-design.md §8-2）。
    "plan.title": "🎫 Plan",
    "plan.freeLine": "Ahora tiene el plan gratuito",
    "plan.paidLine": "Tiene el plan Familia activo 🎉",
    "plan.benefitIntro": "Al mejorar el plan, podrá:",
    "plan.benefit1": "Hasta {n} perfiles de niños y niñas",
    "plan.benefit2": "Las {n} cartas de espíritus al completo (también SR y UR)",
    "plan.benefit3": "Álbum familiar (todas las cartas reunidas en familia)",
    "plan.gachaPromise": "Los sobres de cartas no se pueden comprar con dinero. Solo se consiguen estudiando.",
    "plan.monthly": "Mensual: 1.480 JPY",
    "plan.yearly": "Anual: 14.800 JPY (2 meses gratis)",
    "plan.comingSoon": "El plan Familia estará disponible próximamente.",
    "plan.guestNote": "Para comprar es necesario que una persona adulta cree antes una cuenta.",
    "plan.afterBuyNote": "El pago debe realizarlo una persona adulta. Una vez completado, se aplicará en la aplicación.",
    "plan.managePortal": "Gestionar la suscripción (cancelar o cambiar el pago)",
    "plan.manageNote": "Escribe el correo electrónico con el que te registraste y te enviaremos un enlace de confirmación. Aunque canceles, podrás seguir usando la aplicación hasta que termine el periodo que ya has pagado.",
    "plan.cancelByMail": "Si deseas cancelar, escríbenos a {email}. Podrás seguir usando la aplicación hasta que termine el periodo que ya has pagado.",
    "plan.legalLink": "Información legal (Ley japonesa de transacciones comerciales)",
    "plan.upgradedNotice": "🎉 ¡Ya tienes el plan Familia! Puedes conseguir todas las cartas",

    // --- 共有 ---
    "share.copyHint": "↑ Copia este texto para compartirlo",
    "share.copyPrompt": "Copia el texto de abajo para compartirlo",

    // --- ホーム ---
    "home.title": "Manabimeguru",
    "home.heroGreeting": "¡Hoy también\naprendemos juntos!",
    "home.heroSub": "¡El reto de hoy: 10 preguntas!",
    "home.startStudy": "📖 Empezar a estudiar",
    "home.weekTitle": "Tu semana",
    "home.weekToggle": "Abrir o cerrar el resumen de la semana",
    "home.drawGacha": "🎰 Abrir un sobre",

    // --- YouTube oficial (sale de la app) ---
    "youtube.linkHome": "📺 Ver los vídeos de los espíritus",
    // チャンネル名そのものを指す。SNS・YouTube 側は Enciclopedia で通す決まりなので
    // アプリ内の Álbum とは意図的に語が違う（es-handoff.md §6「ずかんの呼び方」）
    "youtube.linkCollection": "📺 Canal Enciclopedia de Espíritus",
    // スペイン語チャンネル「Manabimeguru Enciclopedia de Espíritus」（2026-08-12 開設）
    "youtube.url": "https://www.youtube.com/@manabimeguru_es",
    "youtube.external": "Se abre YouTube",

    // --- 学年 ---
    // Primaria は6年制（España・México とも 6〜12歳）。日本の小1〜6と1対1で対応する。
    "grade.1": "1º de Primaria",
    "grade.2": "2º de Primaria",
    "grade.3": "3º de Primaria",
    "grade.4": "4º de Primaria",
    "grade.5": "5º de Primaria",
    "grade.6": "6º de Primaria",
    "grade.course": "{grade}",

    // --- 図鑑ランク ---
    "rank.0": "Aprendiz de investigación",
    "rank.4": "Investigador novato",
    "rank.8": "Maestro del álbum",
    "rank.12": "Estudioso de las estaciones",
    "rank.16": "Investigador veterano",
    "rank.20": "Cronista legendario",
    "rank.40": "Jefe de investigación",
    "rank.60": "Sabio del álbum",
    "rank.80": "Investigador de todas las estaciones",
    "rank.100": "Consejero de los espíritus",
    "rank.120": "Tejedor de leyendas",
    "rank.140": "Guía del cielo lejano",
    "rank.160": "Guardián del álbum de espíritus",
    "rank.180": "Conocedor de todas las estaciones",
    "rank.200": "Gran investigador del álbum de espíritus",

    // --- 科目・分野 ---
    "subject.pick": "Elige una asignatura",
    "subject.math": "Matemáticas",
    "subject.japanese": "Lengua",
    "subject.mathDesc": "Cálculo y problemas",
    "subject.japaneseDesc": "Ortografía, vocabulario y comprensión",
    "subject.english": "Inglés",
    "subject.englishDesc": "Vocabulario y conversación básica",
    "subject.englishLocked": "El inglés empieza en 3º",
    "category.pick": "Elige lo que quieres practicar",

    // --- クイズ ---
    "quiz.start": "¡Empieza el reto de 10 preguntas!",
    "quiz.progress": "{current} / {total}",
    "quiz.stamps": "Sellos: {n} 🐣",
    "quiz.hint": "💡 ¿No lo sabes? Pide una pista",
    "quiz.answerPlaceholder": "Respuesta",
    "quiz.fractionPlaceholder": "ej.: 3/4",
    "quiz.submit": "Responder",
    "quiz.next": "Siguiente",
    "quiz.badges": "Medallas de hoy: {n} 🏅",
    "quiz.badgeNew": "🆕 Pregunta nueva",
    "quiz.badgeRepeat": "🔁 Pregunta repetida (la mitad de puntos)",
    "quiz.repeatNote": "(🔁 mitad de puntos)",
    "quiz.badgeReview": "💪 Antes la fallaste",
    "quiz.reviewCleared": "¡Antes la fallaste y ahora te ha salido! ¡Muy bien!",

    // --- 結果 ---
    "result.title": "¡Buen trabajo!",
    "result.score": "¡{correct} de {total} correctas!",
    "result.points": "🎰 Puntos de sobre +{pt} pt (total: {total} pt)",
    "result.retry": "Otra vez",
    "result.share": "📤 Compartir el resultado de hoy",

    // --- ガチャ ---
    "gacha.title": "🎰 Sobres",
    "gacha.titleFor": "🎰 Sobres de {grade}",
    "gacha.points": "Puntos de sobre",
    "gacha.cost": "Cada sobre cuesta 10 puntos",
    "gacha.pull": "🎰 ¡Abrir un sobre!",
    "gacha.skip": "Saltar ▶▶",
    "gacha.close": "Cerrar",
    "gacha.new": "¡La consigues por primera vez!",
    "gacha.insufficient": "No tienes puntos suficientes. ¡Resuelve preguntas para conseguir más!",
    "gacha.rankUp": "🎉 ¡Has subido de rango! 🎉",
    "gacha.pityHint": "En {n} sobres más te tocará una carta nueva seguro",
    "gacha.pityReady": "¡El siguiente sobre trae una carta nueva seguro!",
    "gacha.pityDone": "¡Las tienes todas!",
    "gacha.refund": "Ya tenías esta carta, así que recuperas {n} pt",
    "gacha.newCard": "¡La consigues por primera vez!",

    // --- ずかん ---
    "collection.title": "🎴 Álbum de cartas",
    "collection.count": "¡Has reunido {owned} de {total}!",
    "collection.scopeSelf": "Yo",
    "collection.scopeFamily": "Familia",
    "collection.countFamily": "¡Entre toda la familia habéis reunido {owned} de {total}!",
    "collection.premiumNote": "Las {n} cartas con 🔒 se consiguen con el plan Premium",
    "collection.premiumBadge": "Premium",

    // --- レアリティ ---
    "rarity.N": "Normal",
    "rarity.R": "Rara",
    "rarity.SR": "Súper rara",
    "rarity.UR": "Ultra rara",

    // --- テーマ ---
    "theme.fireworks": "Fuegos artificiales y cielo nocturno",
    "theme.ocean": "Mar y juegos de agua",
    "theme.festival": "Fiestas y puestos nocturnos",
    "theme.bugs": "Insectos y naturaleza",
    "theme.dessert": "Postres fresquitos",
    "theme.special": "Símbolos del verano",
    "theme.coolbreeze": "Brisa fresca",
    "theme.starrysky": "Cielo estrellado",

    // --- ぶんや名 ---
    // Lengua（国語）の分野名は未執筆。es-handoff.md §2 の対応表にそろえてある。
    "cat.keisan": "Cálculo",
    "cat.keisanDesc": "Sumas, restas, multiplicaciones, divisiones, fracciones…",
    "cat.bunshoMath": "Problemas",
    "cat.bunshoMathDesc": "Problemas para leer y resolver",
    "cat.kanji": "Ortografía",
    "cat.kanjiDesc": "Cómo se escriben las palabras",
    "cat.kotoba": "Antónimos",
    "cat.kotobaDesc": "Palabras que significan lo contrario",
    "cat.kotowaza": "Refranes",
    "cat.kotowazaDesc": "Adivina el significado del refrán",
    "cat.yojijukugo": "Expresiones",
    "cat.yojijukugoDesc": "Adivina el significado",
    "cat.bunshoJa": "Comprensión lectora",
    "cat.bunshoJaDesc": "Lee el texto y responde",
    "cat.tango": "Vocabulario",
    "cat.tangoDesc": "Une el inglés con el español",
    "cat.kaiwa": "Conversación",
    "cat.kaiwaDesc": "Completa saludos y diálogos",
    "cat.titleFor": "{grade} - {subject}",
    "settings.gradeRange": "Ejercicios de {lo}º a {n}º",
    "settings.gradeRange1": "Ejercicios de 1º",

    // --- 問題文・解説のひな形 ---
    // q.kanji* / q.antonym* / q.meaning* / q.reading* は Lengua 用。未執筆なので
    // 現時点では画面に出ないが、キー集合を ja とそろえるために置いてある。
    "q.kanjiRead": "¿Cómo se escribe correctamente «{kanji}»?",
    "q.kanjiReadHint": "Empieza por «{first}»",
    "q.shortAnswerHint": "Es una palabra corta. Prueba a leerla en voz alta",
    "q.kanjiReadExplain": "«{kanji}» se escribe «{reading}»",
    "q.antonym": "¿Cuál es lo contrario de «{word}»?",
    "q.antonymHint": "Empieza por «{first}»",
    "q.antonymExplain": "Lo contrario de «{word}» es «{opposite}»",
    "q.meaning": "¿Qué significa «{word}»?",
    "q.meaningReverse": "¿Qué palabra significa «{meaning}»?",
    "q.kanjiWrite": "¿Qué palabra se lee «{reading}»?",
    "q.meaningExplain": "«{word}» significa «{meaning}»",
    "q.enToJa": "¿Qué significa «{word}»?",
    "q.jaToEn": "¿Cómo se dice «{ja}» en inglés?",
    "q.enExplain": "«{word}» significa «{ja}»",
    "q.enPhrase": "{sentence}\n\n¿Qué palabra va en el hueco (___)?",
    "q.enPhraseExplain": "{sentence} ({ja})",
    "q.choiceHint": "Quitamos una de las opciones",
    "q.readingPositionHint": "Fíjate en la parte {zone} del texto",
    "q.reading": "{passage}\n\nPregunta: {question}",
    "q.readingExplain": "En el texto, {why}",

    // --- ガイドのセリフ ---
    "guide.home": [
      "¡Hola! ¿Estudiamos juntos hoy también?",
      "¿Qué te apetece practicar?",
      "¡Un poquito cada día y llegarás lejos!",
    ],
    "guide.subject": [
      "¿Matemáticas o inglés?",
      "¡Empieza por lo que más te guste!",
    ],
    "guide.category": [
      "¿Qué tipo de preguntas quieres practicar?",
      "¡Elige el que más te guste!",
    ],
    "guide.gacha": [
      "¿Qué espíritu te tocará?",
      "¡Ojalá te salga una carta genial!",
    ],
    "guide.collection": [
      "¡Mira los espíritus que has reunido!",
      "¿Podrás conseguirlos todos?",
    ],
    "guide.settings": [
      "Mira los ajustes con una persona adulta",
      "Si tienes dudas, echa un vistazo aquí",
    ],
    "guide.start": [
      "¿Preparado? ¡Vamos con 10 preguntas!",
      "Si te esfuerzas conseguirás sobres. ¡A llenar el álbum!",
    ],
    "guide.correct": [
      "¡Correcto! ¡Qué bien!",
      "¡Muy bien! ¡Sigue así!",
      "¡Perfecto! ¡Lo has entendido!",
      "¡Estupendo!",
    ],
    "guide.wrong": [
      "¡Casi! ¡La próxima seguro!",
      "Tranquilo, piénsalo otra vez.",
      "Esta era un poco difícil. ¡Quédate con la respuesta!",
    ],
    "guide.resultPerfect": [
      "¡Guau! ¡Todas correctas! ¡Perfecto!",
      "¡Puntuación perfecta! ¡Genial!",
    ],
    "guide.resultHigh": [
      "¡Guau! ¡Casi todas correctas!",
      "¡Bieeen! ¡Genial!",
    ],
    "guide.resultMid": [
      "¡Muy buen trabajo! ¡La próxima vez acertarás más!",
      "¡Vas muy bien! ¡Sigue así!",
    ],
    "guide.resultLow": [
      "No pasa nada por fallar. ¡Con práctica lo conseguirás!",
      "¡A por la próxima! ¡Yo te animo!",
    ],


    // --- 画面から出るその他の文言 ---
    "quiz.explainPrefix": "💡 Cómo se piensa: {text}",
    "quiz.hintPrefix": "💡 Pista: {text}",
    "quiz.hintFallback": "Vuelve a leer el enunciado con calma",
    "quiz.seeResult": "Ver el resultado",
    "quiz.wrongText": "Casi… la respuesta era {answer}",
    "quiz.wrongChoice": "La respuesta correcta era «{answer}»",
    "result.rate": "Aciertos: {rate} %",
    "rank.nextIn": "Te faltan {n} cartas para el siguiente rango",
    "rank.max": "¡Has llegado al rango más alto!",
    "rank.beyond": "{base} Nv.{n}",
    "share.done": "¡Compartido!",
    "share.failed": "No se pudo compartir. Inténtalo otra vez",
    "share.copied": "¡Copiado! Pégalo donde quieras compartirlo",

    "summary.subject": "[Manabimeguru] Resultados del {date}",
    "summary.intro": "Estos son los resultados del {date}.",
    "summary.course": "Curso: {grade} - {subject}",
    "summary.result": "Resultado: {correct} de {total} correctas ({rate} % de aciertos)",
    "summary.earned": "Puntos de sobre conseguidos: {pt} pt",
    "summary.total": "Puntos de sobre acumulados ({grade}): {total} pt",
    // --- 算数の生成器（1〜3年） ---
    // ⚠️ 数字は生成器が作る。ここにあるのは文だけ。
    //    {c}（助数詞）はスペイン語では空文字なので使わない。{howMany} は
    //    Cuántos / Cuántas（品物の性で変わる）。文頭に来るので大文字始まりで持っている。
    "math.add1.hint": "Suma {b} a {a}. Puedes contar con los dedos.",
    "math.add1.explainTen": "10 más {b} son {sum}.",
    "math.add1.explainSplit": "{a} es 10 y {aOnes}. {aOnes} más {b} son {part}. Y 10 más {part} son {sum}.",
    "math.add1.explainMakeTen": "A {a} le sumas {toTen} y llegas a 10. Te quedan {rest}, así que {sum}.",
    "math.add1.explainPlain": "{a} más {b} son {sum}.",
    "math.sub1.hint": "A {a} le quitas {b}.",
    "math.sub1.explainPlain": "{a} menos {b} son {diff}.",
    "math.sub1.explainFromTen": "10 es justo una decena. 10 menos {b} son {diff}.",
    "math.sub1.explainSplit": "{a} es 10 y {aOnes}. {aOnes} − {b} = {part}. Y 10 más {part} son {diff}.",
    "math.sub1.explainBorrow": "{a} es 10 y {aOnes}. 10 − {b} = {borrow}. Y {borrow} más {aOnes} son {diff}.",
    "math.add2.hint": "Separa las decenas y las unidades y súmalas por separado.",
    "math.add2.explainCarry": "Unidades: {aOnes} + {bOnes} = {onesSum}, así que te llevas 1 a las decenas. Decenas: {aTens} + {bTens} + 1 = {tensSumCarry}. En total, {sum}.",
    "math.add2.explainPlain": "Unidades: {aOnes} + {bOnes} = {onesSum}. Decenas: {aTens} + {bTens} = {tensSum}. En total, {sum}.",
    "math.sub2.hint": "Ojo con lo que te llevas al restar.",
    "math.sub2.explain": "{a} − {b} = {diff}. Para comprobarlo: {diff} + {b} = {a}.",
    "math.mul2.hint": "Acuérdate de la tabla del {a}.",
    "math.mul2.explain": "{a} × {b} es sumar {a} un total de {b} veces: {terms} = {product}.",
    "math.add3.hint": "Coloca las cifras en columna y suma empezando por las unidades.",
    "math.add3.explain": "{a} es {aParts} y {b} es {bParts}. Sumando cada columna sale {sum}.",
    "math.sub3.hint": "Resta empezando por las unidades y ojo con lo que te llevas.",
    "math.placeOnes": "las unidades",
    "math.placeTens": "las decenas",
    "math.placeHundreds": "las centenas",
    "math.placeThousands": "los millares",
    "math.sub3.step": "{place}: {top} − {bot} = {digit}",
    "math.sub3.stepBorrowIn": "{place}: restando lo que le prestaste a la columna anterior, {top} − {bot} = {digit}",
    "math.sub3.stepBorrowOut": "{place}: como {top} − {bot} no alcanza, te llevas 1 prestado de la columna siguiente: {borrowedTop} − {bot} = {digit}",
    "math.sub3.final": "Alineando las cifras y calculando desde las unidades: {a} − {b} = {diff}",
    "math.mul3.hint": "Separa {a} en decenas y unidades y multiplica cada parte por {b}.",
    "math.mul3.explain": "{tens}×{b}={tensPart} y {ones}×{b}={onesPart}. Juntando: {tensPart}+{onesPart}={product}.",
    "math.div3.hint": "Busca en la tabla del {b} el número que da {a}.",
    "math.div3.explain": "{b} × {q} = {a}, así que {a} ÷ {b} = {q}.",
    "math.divRemainder3.text": "{a} ÷ {b} = ? (escríbelo así: «número resto número». Ejemplo: 5 resto 3)",
    "math.divRemainder3.answer": "{q} resto {r}",
    "math.divRemainder3.accept": ["{q}resto{r}", "{q} r {r}"],
    "math.divRemainder3.hint": "Busca en la tabla del {b} el número más grande que no pase de {a}.",
    "math.divRemainder3.explain": "{b} × {q} = {product}. {a} − {product} = {r}, que es lo que sobra. Por eso, {q} resto {r}.",
    "math.decimal3.hint": "Alinea las comas decimales y luego calcula.",
    "math.decimal3.explainAdd": "{a} por 10 es {na}, y {b} por 10 es {nb}. {na}+{nb}={raw}. Dividiendo entre 10 vuelves a {answer}.",
    "math.decimal3.explainSub": "{hi} por 10 es {hiRaw}, y {lo} por 10 es {loRaw}. {hiRaw}−{loRaw}={raw}. Dividiendo entre 10 vuelves a {answer}.",
    "math.fraction.reduceSuffix": ". Dividiendo {rawNum} y {d} entre {g} se simplifica a {reduced}",
    "math.fractionSame3.hintAdd": "El denominador no cambia. Suma solo los numeradores.",
    "math.fractionSame3.explainAdd": "El denominador se queda igual y el numerador es {n1}+{n2}={sum}. Por eso, {sum}/{d}",
    "math.fractionSame3.hintSub": "El denominador no cambia. Resta solo los numeradores.",
    "math.fractionSame3.explainSub": "El denominador se queda igual y el numerador es {n1}−{n2}={diff}. Por eso, {diff}/{d}",
    "math.wordAdd.text": "Había {a} {item}. Le dieron {b} más. ¿{howMany} hay en total?",
    "math.wordAdd.hint": "Si «le dieron más», la cantidad crece. Usa la suma.",
    "math.wordAdd.explain": "Al principio {a} y le dieron {b} más: {a}+{b}={sum}.",
    "math.wordSub.text": "Había {bigger} {item}, pero {past} {b}. ¿{howMany} quedan?",
    "math.wordSub.hint": "Si hay que «{plain}», la cantidad baja. Usa la resta.",
    "math.wordSub.explain": "Al principio había {bigger} y {past} {b}, así que {bigger}−{b}={rest}.",
    "math.wordMul.text": "En cada bolsa hay {perBag} {item}. ¿{howMany} hay en {bags} bolsas?",
    "math.wordMul.hint": "Cuando hay «tantos en cada bolsa» y varias bolsas, usa la multiplicación.",
    "math.wordMul.explain": "{perBag} en cada bolsa por {bags} bolsas: {perBag}×{bags}={total}.",
    "math.wordDiv.text": "Hay {total} {item}. Se reparten entre {people} niños a partes iguales. ¿{howMany} le tocan a cada uno?",
    "math.wordDiv.hint": "Cuando se reparte «a partes iguales», usa la división.",
    "math.wordDiv.explain": "{total} repartidos entre {people} a partes iguales: {total}÷{people}={each}.",
    "math.wordCompare.textMore": "{nameA} tiene {b} {item}. {nameB} tiene {diff} más que {nameA}. ¿{howMany} tiene {nameB}?",
    "math.wordCompare.textLess": "{nameA} tiene {b} {item}. {nameB} tiene {diff} menos que {nameA}. ¿{howMany} tiene {nameB}?",
    "math.wordCompare.hintMore": "Si tiene «más», usa la suma.",
    "math.wordCompare.hintLess": "Si tiene «menos», usa la resta.",
    "math.wordCompare.explainMore": "{nameA} tiene {b}. {nameB} tiene {diff} más, así que {b}+{diff}={total}.",
    "math.wordCompare.explainLess": "{nameA} tiene {b}. {nameB} tiene {diff} menos, así que {b}−{diff}={total}.",
    "math.wordAddCombine.text": "Hay {a} {item} {place1} y {b} {place2}. ¿{howMany} hay en total?",
    "math.wordAddCombine.hint": "Cuando preguntan «en total», usa la suma.",
    "math.wordAddCombine.explain": "{a} {place1} y {b} {place2}. Juntando: {a}+{b}={sum}.",
    "math.wordSubDiff1.text": "{nameA} tiene {a} {item} y {nameB} tiene {b}. ¿{howMany} tiene {nameA} de diferencia?",
    "math.wordSubDiff1.hint": "Cuando preguntan «la diferencia», resta el pequeño del grande.",
    "math.wordSubDiff1.explain": "{a}−{b}={diff}. {nameA} tiene {diff} más.",
    "math.wordAddSub1.text": "Había {a} {item}. Le dieron {b} más y después {past} {c2}. ¿{howMany} quedan?",
    "math.wordAddSub1.hint": "Suma lo que le dieron y después resta lo que hubo que {plain}.",
    "math.wordAddSub1.explain": "{a}+{b}={sum}. Quitando {c2}: {sum}−{c2}={rest}.",
    "math.wordLength2.textAdd": "Una cinta azul mide {a} cm y una cinta roja mide {b} cm. Si las unes, ¿cuántos cm miden?",
    "math.wordLength2.hintAdd": "El largo total se calcula sumando el largo de las dos cintas.",
    "math.wordLength2.explainAdd": "{a}+{b}={sum} (cm)",
    "math.wordLength2.textSub": "De una cinta de {a} cm se cortan {b} cm. ¿Cuántos cm quedan?",
    "math.wordLength2.hintSub": "Resta el trozo cortado y te queda el resto.",
    "math.wordLength2.explainSub": "{a}−{b}={diff} (cm)",
    "math.wordDivRemainder3.text": "{total} personas van en coche, {perCar} en cada uno. ¿Cuántos coches hacen falta para que quepan todas?",
    "math.wordDivRemainder3.hint": "Calcula {total}÷{perCar} y cuenta un coche más para los que sobran.",
    "math.wordDivRemainder3.explain": "{total}÷{perCar}={cars} resto {rest}. Las {rest} personas que sobran también necesitan coche, así que {cars}+1={need} coches.",
    "math.wordMulArray2.text": "Se pegan pegatinas en {rows} filas y {cols} columnas. ¿Cuántas pegatinas hay en total?",
    "math.wordMulArray2.hint": "«Filas × columnas» te da el total.",
    "math.wordMulArray2.explain": "{rows} filas por {cols} columnas: {rows}×{cols}={total} pegatinas.",

    // --- 算数の生成器（4年） ---
    "math.divLong4.hint": "Divide con la cuenta larga, empezando por la cifra de mayor valor.",
    // ⚠️ 末尾にピリオドを付けないこと。この2つは decimalDiv5.explain の {inner} として
    //    差し込まれ、呼び出し側が「. Dividiendo...」と続けるため、二重ピリオドになる。
    //    日本語版も同じ理由で句点を付けていない。
    "math.divLong4.explainExact": "{a} entre {b} da justo {qTens} ({tensPart}÷{b}={qTens})",
    "math.divLong4.explainSplit": "Separa {a} en {tensPart} y {onesPart}: {tensPart}÷{b}={qTens} y {onesPart}÷{b}={qOnes}. En total, {q}",
    "math.decimalAddSub4.hint": "Alinea las comas decimales y calcula en columna.",
    "math.decimalAddSub4.explainAdd": "{a} por 100 es {aRaw}, y {b} por 100 es {bRaw}. {aRaw}+{bRaw}={raw}. Dividiendo entre 100 vuelves a {answer}.",
    "math.decimalAddSub4.explainSub": "{big} por 100 es {bigRaw}, y {small} por 100 es {smallRaw}. {bigRaw}−{smallRaw}={raw}. Dividiendo entre 100 vuelves a {answer}.",
    "math.rectArea4.textSquare": "Un cuadrado tiene {side} cm de lado. ¿Cuál es su área en cm²?",
    "math.rectArea4.textRect": "Un rectángulo mide {h} cm de alto y {w} cm de ancho. ¿Cuál es su área en cm²?",
    "math.rectArea4.hintSquare": "Área del cuadrado = lado × lado",
    "math.rectArea4.hintRect": "Área del rectángulo = alto × ancho",
    "math.rectArea4.explainSquare": "{side} × {side} = {area} (cm²)",
    "math.rectArea4.explainRect": "{h} × {w} = {area} (cm²)",
    "math.rounding4.text": "Redondea {n} a {place}. ¿Qué número sale?",
    "math.rounding4.hint": "Mira la cifra que va justo debajo de {place}: si es 4 o menos redondeas hacia abajo, y si es 5 o más hacia arriba.",
    "math.rounding4.explain": "La cifra de {lower}, justo debajo de {place}, es {lowerDigit}. {decision} redondeando a {place} sale {answer}.",
    "math.rounding4.up": "Como es 5 o más se redondea hacia arriba, así que",
    "math.rounding4.down": "Como es 4 o menos se redondea hacia abajo, así que",
    "math.angle4.text": "Sobre una recta hay dos ángulos seguidos. Si uno mide {a}° y el otro {b}°, ¿cuánto mide el ángulo que queda?",
    "math.angle4.hint": "Los ángulos sobre una recta suman 180°.",
    "math.angle4.explain": "180 − {a} − {b} = {rest} (grados)",
    "math.wordUnit4.text": "Una cinta mide {total} cm. ¿Cuántos m y cuántos cm son? (escribe solo los cm: {m} m y ◯ cm)",
    "math.wordUnit4.hint": "100 cm = 1 m. Piensa en el resto de dividir entre 100.",
    "math.wordUnit4.explain": "{total} cm = {m} m y {cm} cm ({m} veces 100 cm, y sobran {cm} cm).",
    "math.wordBigNumber4.text": "{what} de {place} es de {base} {unit} {amount}. La de al lado es {times} veces mayor. ¿Cuántos {unit} {amount} tiene? (escribe el número sin «{unit}»)",
    "math.wordBigNumber4.hint": "Piensa en cuántos «{unit}» son. Calcula {base} × {times}.",
    "math.wordBigNumber4.explain": "{base} {unit} por {times} es {base}×{times}={total}. Es decir, {total} {unit} {amount}.",
    "math.wordEstimate4.text": "A una tienda fueron {a} personas el lunes y {b} el martes. Redondea cada número a {label} y calcula aproximadamente cuántas personas fueron en los dos días.",
    "math.wordEstimate4.hint": "Primero redondea cada número a {label} y después súmalos.",
    "math.wordEstimate4.explain": "{a} es aproximadamente {ra} y {b} es aproximadamente {rb}. {ra}+{rb}={total} personas.",
    "math.wordDivLarge4.textNeed": "Hay {total} pelotas y en cada caja caben {perBox}. ¿Cuántas cajas hacen falta para guardarlas todas?",
    "math.wordDivLarge4.hintNeed": "Calcula {total}÷{perBox} y cuenta una caja más para las que sobran.",
    "math.wordDivLarge4.explainNeed": "{total}÷{perBox}={boxes} resto {rest}. Las {rest} que sobran también necesitan caja, así que {boxes}+1={need} cajas.",
    "math.wordDivLarge4.textFull": "Hay {total} pelotas y en cada caja caben {perBox}. ¿Cuántas cajas se llenan del todo?",
    "math.wordDivLarge4.hintFull": "El cociente de {total}÷{perBox} es el número de cajas llenas.",
    "math.wordDivLarge4.explainFull": "{total}÷{perBox}={boxes} resto {rest}. Se llenan {boxes} cajas y sobran {rest}.",
    "math.wordAreaRoom4.textSide": "{place} tiene un área de {area} m². Si mide {h} m de largo, ¿cuánto mide de ancho?",
    "math.wordAreaRoom4.hintSide": "Área ÷ largo = ancho. Es la operación contraria a multiplicar.",
    "math.wordAreaRoom4.explainSide": "{area}÷{h}={w} (m)",
    "math.wordAreaRoom4.textArea": "{place} mide {h} m de largo y {w} m de ancho. ¿Cuál es su área en m²?",
    "math.wordAreaRoom4.hintArea": "Área del rectángulo = largo × ancho",
    "math.wordAreaRoom4.explainArea": "{h}×{w}={area} (m²)",
    "math.wordDecimalAmount4.textAdd": "Hay {a} {unit} de {name} en un recipiente grande y {b} {unit} en uno pequeño. ¿Cuántos {unit} hay en total?",
    "math.wordDecimalAmount4.hintAdd": "Alinea las comas decimales y suma.",
    "math.wordDecimalAmount4.explainAdd": "{a}+{b}={sum} ({unit})",
    "math.wordDecimalAmount4.textSub": "Había {a} {unit} de {name} y se usaron {b} {unit}. ¿Cuántos {unit} quedan?",
    "math.wordDecimalAmount4.hintSub": "Alinea las comas decimales y resta.",
    "math.wordDecimalAmount4.explainSub": "{a}−{b}={diff} ({unit})",
    "math.wordProportion4.text": "{n1} {unit} de {name} tienen {word} de {first} {amount}. ¿Y {n2} {unit} del mismo {name}?",
    "math.wordProportion4.hint": "Primero calcula {word} de 1 {unit}.",
    "math.wordProportion4.explain": "1 {unit} es {first}÷{n1}={per} {amount}. Para {n2} {unit}: {per}×{n2}={total} {amount}.",

    // --- 算数の生成器（5・6年） ---
    "math.listSeparator": ", ",
    "math.itemSeparator": ", ",
    "math.decimalMul5.hint": "Multiplica como si no hubiera coma decimal y al final vuelve a ponerla.",
    "math.decimalMul5.explain": "{a10} × {b} = {raw}. Corriendo la coma decimal un lugar sale {answer}.",
    "math.decimalDiv5.hint": "La coma decimal del dividendo pasa igual al cociente.",
    "math.decimalDiv5.explain": "{a} por 10 es {a10}. {inner}. Dividiendo entre 10 vuelves a {q}.",
    "math.fractionAddDiff5.text": "{n1}/{d1} + {n2}/{d2} = ? (simplifica el resultado)",
    "math.fractionAddDiff5.hint": "Pon el mismo denominador en las dos fracciones y después suma.",
    "math.fractionAddDiff5.explain": "Con el mismo denominador: {a}/{den} + {b}/{den} = {num}/{den}",
    "math.average5.text": "¿Cuál es la media de estos {n} números: {values}?",
    "math.average5.hint": "Media = suma de todos ÷ cuántos son",
    "math.average5.explain": "La suma es {sum}. Dividiendo entre {n} sale {avg}.",
    "math.percent5.text": "¿Cuánto es el {pct} % de {base}?",
    "math.percent5.hint": "Un porcentaje es una parte de 100. Multiplica el número por esa parte.",
    "math.percent5.explain": "{pct} % = {ratio}. {base} × {ratio} = {answer}.",
    "math.triangleArea5.text": "Un triángulo tiene {base} cm de base y {height} cm de altura. ¿Cuál es su área en cm²?",
    "math.triangleArea5.hint": "Área del triángulo = base × altura ÷ 2",
    "math.triangleArea5.explain": "{base} × {height} ÷ 2 = {area} (cm²)",
    "math.wordPerUnit5.text": "{units} {unit} de {item} tienen {label} de {total} {per}. ¿Cuánto es por cada {unitSg}?",
    "math.wordPerUnit5.hint": "Cantidad por unidad = total ÷ número de unidades",
    "math.wordPerUnit5.explain": "{total} ÷ {units} = {perUnit} ({per})",
    "math.wordMultiple5.textBus": "De una estación, el autobús A sale cada {a} minutos y el B cada {b} minutos. Si acaban de salir a la vez, ¿dentro de cuántos minutos vuelven a salir juntos?",
    "math.wordMultiple5.hintBus": "Busca el múltiplo común más pequeño de {a} y {b} (el mínimo común múltiplo).",
    "math.wordMultiple5.explainBus": "El número más pequeño que es múltiplo de {a} y de {b} es {lcm}. Por eso, dentro de {lcm} minutos.",
    "math.wordMultiple5.textCard": "Con tarjetas de {a} cm de alto y {b} cm de ancho se forma un cuadrado sin dejar huecos. ¿Cuánto mide el lado del cuadrado más pequeño posible?",
    "math.wordMultiple5.hintCard": "El lado que encaja a lo alto y a lo ancho es el mínimo común múltiplo de {a} y {b}.",
    "math.wordMultiple5.explainCard": "El mínimo común múltiplo de {a} y {b} es {lcm}. Por eso el lado mide {lcm} cm.",
    "math.wordDivisor5.text": "Hay {a} caramelos y {b} galletas. Se reparten a partes iguales sin que sobre nada. ¿Entre cuántas personas como máximo se pueden repartir?",
    "math.wordDivisor5.hint": "Es el número más grande que divide a la vez a {a} y a {b} (el máximo común divisor).",
    "math.wordDivisor5.explain": "{a}÷{g}={m} y {b}÷{g}={n}: los dos son exactos. Con un número mayor que {g} ya no salen exactos, así que {g} personas.",
    "math.wordPercent5.textDiscount": "Un artículo que costaba {price} céntimos tiene un {pct} % de descuento. ¿Cuánto cuesta ahora?",
    "math.wordPercent5.hintDiscount": "Un {pct} % de descuento significa pagar el (100−{pct}) % del precio, es decir el {rest} %.",
    "math.wordPercent5.explainDiscount": "El descuento es {price}×{ratio}={diff}. {price}−{diff}={lower}.",
    "math.wordPercent5.textRaise": "Un artículo que costaba {price} céntimos ha subido un {pct} %. ¿Cuánto cuesta ahora?",
    "math.wordPercent5.hintRaise": "Lo que sube es el {pct} % del precio original. Súmaselo al precio.",
    "math.wordPercent5.explainRaise": "La subida es {price}×{ratio}={diff}. {price}+{diff}={higher}.",
    "math.wordAverage5.text": "Después de {n} exámenes la media es {avgSoFar} puntos. ¿Cuántos puntos hay que sacar en el siguiente para que la media de los {n1} sea {targetAvg}?",
    "math.wordAverage5.hint": "Calcula primero cuánto tiene que sumar el total de los {n1} exámenes.",
    "math.wordAverage5.explain": "El total de ahora es {avgSoFar}×{n}={now}. El total que hace falta es {targetAvg}×{n1}={want}. La diferencia, {need} puntos, es lo que hay que sacar.",
    "math.wordDensity5.text": "En la conejera A hay {totalA} conejos en {areaA} m², y en la B hay {totalB} conejos en {areaB} m². En la conejera que está más llena, ¿cuántos conejos hay por m²?",
    "math.wordDensity5.hint": "Calcula cuántos conejos hay por m² en cada una y compara.",
    "math.wordDensity5.explain": "A: {totalA}÷{areaA}={perA} por m². B: {totalB}÷{areaB}={perB} por m². La más llena es la {denser}, con {dense}.",
    "math.fractionMul6.text": "{a}/{b} × {c}/{d} = ? (simplifica el resultado)",
    "math.fractionMul6.hint": "Multiplica numerador por numerador y denominador por denominador, y luego simplifica.",
    "math.fractionMul6.explain": "Numerador: {a}×{c}={rawNum}. Denominador: {b}×{d}={rawDen}. Queda {rawNum}/{rawDen}",
    "math.fractionDiv6.text": "{n1}/{d1} ÷ {n2}/{d2} = ? (simplifica el resultado)",
    "math.fractionDiv6.hint": "Dale la vuelta a la fracción que divide y conviértelo en una multiplicación.",
    "math.fractionDiv6.explain": "{n2}/{d2} del revés es {d2}/{n2}. {n1}/{d1} × {d2}/{n2} = {rawNum}/{rawDen}",
    "math.circleArea6.text": "¿Cuál es el área de un círculo de {r} cm de radio? (en cm², usa 3,14 para π)",
    "math.circleArea6.hint": "Área del círculo = radio × radio × 3,14",
    "math.circleArea6.explain": "{r} × {r} × 3,14 = {area}",
    "math.volume6.text": "¿Cuál es el volumen de un ortoedro de {w} cm de largo, {l} cm de ancho y {h} cm de alto? (en cm³)",
    "math.volume6.hint": "Volumen del ortoedro = largo × ancho × alto",
    "math.volume6.explain": "{w} × {l} × {h} = {volume}",
    "math.ratio6.text": "¿Cómo se escribe la razón {a} : {b} de la forma más simple?",
    "math.ratio6.hint": "Divide los dos números por un divisor común hasta que ya no se pueda más.",
    "math.ratio6.explain": "El máximo común divisor de {a} y {b} es {factor}. Dividiendo los dos queda {simpleX}:{simpleY}.",
    "math.wordSpeed.textTime": "Un coche va a {speed} km/h. ¿Cuántas horas tarda en recorrer {dist} km?",
    "math.wordSpeed.hintTime": "Tiempo = distancia ÷ velocidad",
    "math.wordSpeed.explainTime": "{dist} ÷ {speed} = {hours} (horas)",
    "math.wordSpeed.textSpeed": "Un coche recorre {dist} km en {hours} horas. ¿A cuántos km/h va?",
    "math.wordSpeed.hintSpeed": "Velocidad = distancia ÷ tiempo",
    "math.wordSpeed.explainSpeed": "{dist} ÷ {hours} = {speed} (km/h)",
    "math.wordSpeed.textDist": "Un coche va a {speed} km/h durante {hours} horas. ¿Cuántos km recorre?",
    "math.wordSpeed.hintDist": "Distancia = velocidad × tiempo",
    "math.wordSpeed.explainDist": "{speed} km/h × {hours} h = {dist} km",
    "math.proportion6.text": "«y» es proporcional a «x». Cuando x={x1}, y={y1}. ¿Cuánto vale y cuando x={x2}?",
    "math.proportion6.hint": "En una relación proporcional, «y» siempre es «x» multiplicado por un número fijo.",
    "math.proportion6.explain": "Como x={x1} da y={y1}, el número fijo es {y1}÷{x1}={k}. Cuando x={x2}: y = {x2} × {k} = {y2}.",
    "math.combination6.text": "Se colocan en fila {n} tarjetas de estos colores: {items}. ¿De cuántas maneras distintas se pueden ordenar?",
    "math.combination6.hint": "Para la primera hay {n} opciones, para la siguiente {n1}… y se van multiplicando.",
    "math.combination6.explain": "{terms} = {fact} maneras",
    "math.wordRatioSplit6.text": "Se reparten {total} céntimos entre dos personas en la razón {rx}:{ry}. ¿Cuánto le toca a la que más recibe?",
    "math.wordRatioSplit6.hint": "Suma los términos de la razón y piensa en cuántas partes se divide el total.",
    "math.wordRatioSplit6.explain": "La razón suma {rx}+{ry}={totalUnits}. {total}÷{totalUnits}={perUnit} por parte. La que más recibe se lleva {bigger}×{perUnit}={answer}.",
    "math.wordFractionMul6.text": "Una barra pesa {num}/{den} kg por cada metro. ¿Cuánto pesan {len} m de esa barra?",
    "math.wordFractionMul6.hint": "Peso por metro × longitud",
    "math.wordFractionMul6.explain": "{num}/{den} × {len} = {num}×{len}/{den} = {prod}/{den} = {answer} (kg)",
    "math.wordCombinationPick6.textTeam": "{n} equipos juegan una vez contra cada uno de los demás. ¿Cuántos partidos se juegan en total?",
    "math.wordCombinationPick6.hintTeam": "Es el número de formas de elegir 2 equipos entre {n}. El orden no cuenta.",
    "math.wordCombinationPick6.explainTeam": "{n}×({n}−1)÷2 = {n}×{n1}÷2 = {answer} partidos (A contra B cuenta una sola vez).",
    "math.wordCombinationPick6.textShake": "{n} personas se dan la mano una vez con cada una de las demás. ¿Cuántos apretones de manos hay en total?",
    "math.wordCombinationPick6.hintShake": "Es el número de formas de elegir 2 personas entre {n}.",
    "math.wordCombinationPick6.explainShake": "{n}×({n}−1)÷2 = {n}×{n1}÷2 = {answer} apretones",
    "math.wordInverse6.text": "Un rectángulo tiene {total} cm² de área. Cuando mide {x1} cm de alto, el ancho es {y1} cm. Si el alto pasa a ser {x2} cm, ¿cuánto mide el ancho?",
    "math.wordInverse6.hint": "Alto × ancho siempre da el mismo número (el área). Eso es una relación inversamente proporcional.",
    "math.wordInverse6.explain": "Alto×ancho={total} siempre. {total}÷{x2}={y2} (cm)",
    "math.wordCircle6.text": "Hay un parterre redondo de {d} m de diámetro. ¿Cuál es su área en m²? (usa 3,14 para π)",
    "math.wordCircle6.hint": "Calcula primero el radio: radio = diámetro ÷ 2",
    "math.wordCircle6.explain": "El radio es {d}÷2={r} m. {r}×{r}×3,14={area} (m²)",
    "math.wordRatioFind6.text": "Se mezclan vinagre y aceite en la razón {rx}:{ry}. Si se usan {known} mL de vinagre, ¿cuántos mL de aceite hacen falta?",
    "math.wordRatioFind6.hint": "Los {rx} del vinagre son {known} mL. Calcula cuánto vale una parte de la razón.",
    "math.wordRatioFind6.explain": "Una parte es {known}÷{rx}={unit} mL. El aceite es {ry}×{unit}={answer} mL.",

    "locale.dateFormat": "es-ES",
    "home.heroDate": "{weekday} {day}/{month}",
    // 並びは ja と同じく日曜始まり（Date.getDay() の値で引くため。上のコメント参照）
    "weekdays": ["dom", "lun", "mar", "mié", "jue", "vie", "sáb"],
    "months": ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"],

  },
};

// ── 算数の単元名（保護者向けの「にがて分野」表示だけで使う）──────────
//
// 算数の問題は毎回ランダム生成なので「間違えた問題」を保存しても再現できない。
// そのかわり生成器（＝単元）を記録しているので、それを人が読める名前にする。
// キーは script.js の生成器の関数名。ここに無い名前は分野名にフォールバックする。
const MATH_GEN_LABELS = {
  ja: {
    genAdd1: "たしざん（1年）", genSub1: "ひきざん（1年）",
    genAdd2: "たし算（2年）", genSub2: "ひき算（2年）", genMul2: "かけ算（九九）",
    genAdd3: "たし算の筆算", genSub3: "ひき算の筆算", genMul3: "かけ算（3年）",
    genDiv3: "わり算", genDivRemainder3: "あまりのあるわり算",
    genDecimal3: "小数のたし算・ひき算（3年）", genFractionSame3: "分数のたし算・ひき算（分母が同じ）",
    genRounding4: "がい数・四捨五入", genDivLong4: "わり算の筆算",
    genDecimalAddSub4: "小数のたし算・ひき算（4年）", genRectArea4: "長方形・正方形の面積",
    genAngle4: "角の大きさ",
    genDecimalMul5: "小数のかけ算", genDecimalDiv5: "小数のわり算",
    genFractionAddDiff5: "分数のたし算・ひき算（通分）", genPercent5: "割合・百分率",
    genAverage5: "平均", genTriangleArea5: "三角形の面積",
    genFractionMul6: "分数のかけ算", genFractionDiv6: "分数のわり算",
    genCircleArea6: "円の面積", genVolume6: "体積", genRatio6: "比",
    genProportion6: "比例", genCombination6: "場合の数",
    genWordAdd: "たし算の文章題", genWordSub: "ひき算の文章題",
    genWordAddSub1: "たし算・ひき算の文章題（1年）", genWordSubDiff1: "ちがいをもとめる文章題",
    genWordAddCombine: "あわせていくつの文章題", genWordCompare: "大きさくらべの文章題",
    genWordMul: "かけ算の文章題", genWordDiv: "わり算の文章題",
    genWordMulArray2: "かけ算（〇こずつ）の文章題", genWordLength2: "長さの文章題",
    genWordDivRemainder3: "あまりのあるわり算の文章題",
    genWordUnit4: "単位の文章題", genWordBigNumber4: "大きな数の文章題",
    genWordEstimate4: "がい数の文章題", genWordDivLarge4: "大きな数のわり算の文章題",
    genWordAreaRoom4: "面積の文章題", genWordProportion4: "変わり方の文章題",
    genWordDecimalAmount4: "小数（かさ・重さ）の文章題",
    genWordAverage5: "平均の文章題", genWordPercent5: "割合の文章題",
    genWordPerUnit5: "1あたりの量の文章題", genWordDensity5: "こみぐあいの文章題",
    genWordMultiple5: "公倍数の文章題", genWordDivisor5: "公約数の文章題",
    genWordSpeed: "速さの文章題", genWordCircle6: "円の文章題",
    genWordFractionMul6: "分数のかけ算の文章題", genWordRatioFind6: "比の文章題",
    genWordRatioSplit6: "比で分ける文章題", genWordInverse6: "反比例の文章題",
    genWordCombinationPick6: "場合の数の文章題",
  },
  es: {
    genAdd1: "Sumas (1.º)", genSub1: "Restas (1.º)",
    genAdd2: "Sumas (2.º)", genSub2: "Restas (2.º)", genMul2: "Tablas de multiplicar",
    genAdd3: "Sumas en columna", genSub3: "Restas en columna", genMul3: "Multiplicaciones (3.º)",
    genDiv3: "Divisiones", genDivRemainder3: "Divisiones con resto",
    genDecimal3: "Sumas y restas con decimales (3.º)", genFractionSame3: "Fracciones con el mismo denominador",
    genRounding4: "Redondeo y aproximación", genDivLong4: "Divisiones en columna",
    genDecimalAddSub4: "Sumas y restas con decimales (4.º)", genRectArea4: "Área del rectángulo y del cuadrado",
    genAngle4: "Ángulos",
    genDecimalMul5: "Multiplicación de decimales", genDecimalDiv5: "División de decimales",
    genFractionAddDiff5: "Fracciones con distinto denominador", genPercent5: "Porcentajes y proporciones",
    genAverage5: "Media", genTriangleArea5: "Área del triángulo",
    genFractionMul6: "Multiplicación de fracciones", genFractionDiv6: "División de fracciones",
    genCircleArea6: "Área del círculo", genVolume6: "Volumen", genRatio6: "Razones",
    genProportion6: "Proporcionalidad", genCombination6: "Combinatoria",
    genWordAdd: "Problemas de sumar", genWordSub: "Problemas de restar",
    genWordAddSub1: "Problemas de sumar y restar (1.º)", genWordSubDiff1: "Problemas de diferencia",
    genWordAddCombine: "Problemas de juntar cantidades", genWordCompare: "Problemas de comparar",
    genWordMul: "Problemas de multiplicar", genWordDiv: "Problemas de dividir",
    genWordMulArray2: "Problemas de grupos iguales", genWordLength2: "Problemas de longitud",
    genWordDivRemainder3: "Problemas de división con resto",
    genWordUnit4: "Problemas de unidades", genWordBigNumber4: "Problemas de números grandes",
    genWordEstimate4: "Problemas de aproximación", genWordDivLarge4: "Problemas de división con números grandes",
    genWordAreaRoom4: "Problemas de área", genWordProportion4: "Problemas de variación",
    genWordDecimalAmount4: "Problemas con decimales (capacidad y peso)",
    genWordAverage5: "Problemas de media", genWordPercent5: "Problemas de porcentaje",
    genWordPerUnit5: "Problemas de cantidad por unidad", genWordDensity5: "Problemas de densidad",
    genWordMultiple5: "Problemas de múltiplos comunes", genWordDivisor5: "Problemas de divisores comunes",
    genWordSpeed: "Problemas de velocidad", genWordCircle6: "Problemas del círculo",
    genWordFractionMul6: "Problemas de multiplicar fracciones", genWordRatioFind6: "Problemas de razones",
    genWordRatioSplit6: "Problemas de repartir en una razón", genWordInverse6: "Problemas de proporcionalidad inversa",
    genWordCombinationPick6: "Problemas de combinatoria",
  },
};

function mathGenLabel(name) {
  const dict = MATH_GEN_LABELS[getLocale()] || MATH_GEN_LABELS[DEFAULT_LOCALE];
  return (dict && dict[name]) || (MATH_GEN_LABELS[DEFAULT_LOCALE] || {})[name] || null;
}

// ── カードの表示（画像と alt） ──────────────────────────────
//
// カード画像は名前・レアリティ・説明文をデザインに焼き込んだフルアートで、
// script.js の renderCardHTML はその上に文字を重ねない。
// つまり言語の切り替えは「画像そのものの差し替え」になる。
//
// 同じファイル名（n1.webp など）を使うので、スペイン語版は必ず別ディレクトリに置く。
// assets/cards/ を上書きすると main へマージした瞬間に日本語版が壊れる。
const LOCALE_CARD_DIR = {
  ja: "assets/cards",
  es: "assets/cards-es",
};

// 説明文（flavor）は画像の中だけにあり、HTMLには一度も描画されない。
// なので翻訳が要るのは alt 属性に使う名前だけ。
// 正典は card-es-names.md。並びは図鑑番号順（tools/build_es_cards.py と同じ）。
const CARD_NAMES = {
  es: {
    n1: "Espíritu Hanabi",                    // No.001
    n2: "Burbujita",                          // No.002
    n3: "Gorrión de Feria",                   // No.003
    n4: "Ciervo Volante",                     // No.004
    n5: "Hielo Picado",                       // No.005
    n6: "Chispita de Bengala",                // No.006
    n7: "Peque Flotador",                     // No.007
    n8: "Pececillo Rojo",                     // No.008
    r1: "Señor del Gran BUM",                 // No.009
    r2: "Espíritu del Oleaje",                // No.010
    r3: "Chico del Tambor",                   // No.011
    r4: "Capitán Escarabajo",                 // No.012
    r5: "Espíritu del Polo",                  // No.013
    r6: "Luciérnaga Brillo",                  // No.014
    sr1: "Fuego de Arcoíris",                 // No.015
    sr2: "Señor del Abismo",                  // No.016
    sr3: "Bailarina de Verano",               // No.017
    sr4: "Princesa de Hielo",                 // No.018
    ur1: "Dragón de la Montaña",              // No.019
    ur2: "Rey de los Espíritus",              // No.020
    n9: "Chispa Saltarina",                   // No.021
    r7: "Aprendiz Pirotécnico",               // No.022
    n10: "Olita",                             // No.023
    r8: "Buscaconchas",                       // No.024
    n11: "Algodoncito",                       // No.025
    r9: "Manzana Brillante",                  // No.026
    n12: "Cigarra Cantora",                   // No.027
    n13: "Don Libélula",                      // No.028
    sr5: "Escarabajo Joya",                   // No.029
    n14: "Pepita de Sandía",                  // No.030
    r10: "Dragoncito de Soda",                // No.031
    n15: "Campanita de Viento",               // No.032
    r11: "Sombra Fresca",                     // No.033
    sr6: "Chaparrón de Tarde",                // No.034
    ur3: "Señor de la Brisa",                 // No.035
    n16: "Trocito de Estrella",               // No.036
    r12: "Nana de la Vía Láctea",             // No.037
    sr7: "Globo de los Deseos",               // No.038
    sr8: "Sabio de Estrellas",                // No.039
    ur4: "Reina de la Luna",                  // No.040
  },
};

function cardImageDir() {
  return LOCALE_CARD_DIR[getLocale()] || LOCALE_CARD_DIR[DEFAULT_LOCALE];
}

// 未登録のIDでは日本語名に落ちる。alt が空になるよりは読める名前が入るほうがまし。
// 漏れは tools/check_i18n_keys.js が検出する。
function cardName(cardDef) {
  const names = CARD_NAMES[getLocale()];
  return (names && names[cardDef.id]) || cardDef.name;
}

// ── 言語の決め方 ────────────────────────────────────────
//
// スペイン語版は別URLで配る方針のため、そのデプロイでは実行時に推測せず
// ここを "es" に固定する（配信先が決まった時点で設定する）。
// null のあいだは日本語版としてふるまい、せってい画面から手動で切り替えられる。
const FORCED_LOCALE = null;

// 自動判定は、別URL方式にしたことで役目が無くなった。
// （スペイン語圏の訪問者は最初からスペイン語版のURLに来るため）
// 日本語版と同居させる構成に戻すときだけ true にする意味が出る。
const LOCALE_AUTODETECT = false;

// まだ一度も選んでいない人には、ブラウザの表示言語から推測した言語を出す。
// せってい画面まで辿り着かないと切り替えられないと、日本語が読めない訪問者は
// そこへ行き着く前に離脱するため。選べば localStorage が優先される。
function detectLocale() {
  if (!LOCALE_AUTODETECT) return DEFAULT_LOCALE;
  const langs = (navigator.languages && navigator.languages.length)
    ? navigator.languages
    : [navigator.language || ""];
  for (const lang of langs) {
    const base = String(lang).toLowerCase().split("-")[0];
    if (LOCALES[base]) return base;
  }
  return DEFAULT_LOCALE;
}

function getLocale() {
  // 単一言語で配るデプロイでは、保存値もブラウザ設定も見ない。
  if (FORCED_LOCALE && LOCALES[FORCED_LOCALE]) return FORCED_LOCALE;
  const saved = localStorage.getItem(LOCALE_KEY);
  if (saved && LOCALES[saved]) return saved;
  return detectLocale();
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
  // リンク先そのものが言語で変わるもの（公式YouTubeなど）。
  // href を直書きすると、スペイン語版から日本語のチャンネルへ飛んでしまう。
  scope.querySelectorAll("[data-i18n-href]").forEach((el) => {
    el.setAttribute("href", t(el.dataset.i18nHref));
  });
}
