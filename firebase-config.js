// ===== Firebaseの初期設定 =====
// apiKeyなどはクライアントに埋め込んでよい値（秘密情報ではない）。
// 実際のアクセス制御はFirestoreのセキュリティルール側で行う（firestore.rules参照）。
const firebaseConfig = {
  apiKey: "AIzaSyDCm3j1dn_MOkV0yHcn-XriwcJdeuNW1nE",
  authDomain: "manabimeguru.firebaseapp.com",
  projectId: "manabimeguru",
  storageBucket: "manabimeguru.firebasestorage.app",
  messagingSenderId: "170590781083",
  appId: "1:170590781083:web:8504c21a95f55522c2903e",
};

firebase.initializeApp(firebaseConfig);

// script.js からは fbAuth / fbDb をそのまま参照する（非モジュールscript間はグローバルスコープを共有する）
const fbAuth = firebase.auth();
const fbDb = firebase.firestore();
