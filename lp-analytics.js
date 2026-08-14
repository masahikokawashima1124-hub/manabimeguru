// ===== LP専用のアクセス計測（Firebase Analytics / GA4） =====
// lp.html・lp-es.html だけで読み込む。アプリ本体（index.html）には含めない
// （lp-plan.md §5「LPはさらに軽くする」方針。Auth・Firestoreは不要なので読み込まない）。
//
// vendor/firebase-app-compat.js と vendor/firebase-analytics-compat.js を
// このファイルより先に読み込んでおくこと。
//
// 各LPのCTAボタンにある data-cta="closing" などの値が、そのまま計測イベントの
// パラメータになる（lp.html側の <script> が window.trackEvent を呼ぶ）。
const firebaseConfigLP = {
  apiKey: "AIzaSyDCm3j1dn_MOkV0yHcn-XriwcJdeuNW1nE",
  authDomain: "manabimeguru.firebaseapp.com",
  projectId: "manabimeguru",
  storageBucket: "manabimeguru.firebasestorage.app",
  messagingSenderId: "170590781083",
  appId: "1:170590781083:web:8504c21a95f55522c2903e",
  measurementId: "G-CX81QFLDT2",
};

firebase.initializeApp(firebaseConfigLP);
const lpAnalytics = firebase.analytics();

// ページ表示そのものを記録する。gtag.jsと違い、compat SDKは自動送信しないため手動で呼ぶ。
lpAnalytics.logEvent("page_view", {
  page_location: location.href,
  page_path: location.pathname,
  page_title: document.title,
});

// lp.html/lp-es.html 側の <script> が呼ぶ。data-cta の値（ボタンの位置）を
// そのままイベントパラメータに渡すので、GA4側で「どのボタンが押されたか」を見られる。
window.trackEvent = function (name, data) {
  lpAnalytics.logEvent(name, data);
};
