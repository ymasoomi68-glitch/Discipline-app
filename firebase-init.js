/* ═══════════════════════════════════════════════════
   🔥 Firebase + UI — دفتر انضباطی (یکپارچه)
   ═══════════════════════════════════════════════════ */

import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js";
import {
    getAuth, signInWithPopup, GoogleAuthProvider, onAuthStateChanged, signOut, setPersistence, browserLocalPersistence
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js";
import {
    getFirestore, doc, getDoc, setDoc, updateDoc,
    collection, query, where, getDocs, onSnapshot, serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";

/* ═══════════════ Firebase Init ═══════════════ */
const firebaseConfig = {
    apiKey: "AIzaSyA5ZeLud_9aK5Atp0gpF5VLCoRNCv9jnX4",
    authDomain: "discipline-app-685df.firebaseapp.com",
    projectId: "discipline-app-685df",
    storageBucket: "discipline-app-685df.firebasestorage.app",
    messagingSenderId: "249103944782",
    appId: "1:249103944782:web:175f26e2d263669201071f"
};

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
// ورود روی دستگاه بماند (با رفرش یا بستن برنامه دوباره لاگین نخواهد شد)
try { setPersistence(auth, browserLocalPersistence).catch(function() {}); } catch(e) {}
const db = getFirestore(app);
const provider = new GoogleAuthProvider();
provider.setCustomParameters({ prompt: 'select_account' });

let currentUser = null;
let userData = null;
let schoolData = null;
let authReady = false;
const readyCbs = [];
const userChangeCbs = [];
let pendingWatch = null;
let loadFailed = false;

/* ═══════════════ Store ═══════════════ */
function storeProxy() {
    const prefix = 'fu_' + (currentUser ? currentUser.uid : 'anon') + '__';
    return {
        getItem: function(k) { return localStorage.getItem(prefix + k); },
        setItem: function(k, v) { localStorage.setItem(prefix + k, v); },
        removeItem: function(k) { localStorage.removeItem(prefix + k); },
        keys: function() {
            const out = [];
            for (let i = 0; i < localStorage.length; i++) {
                const k = localStorage.key(i);
                if (k && k.indexOf(prefix) === 0) out.push(k.substring(prefix.length));
            }
            return out;
        }
    };
}

function userRef(uid) { return doc(db, 'users', uid); }
function schoolRef(sid) { return doc(db, 'schools', sid); }

function cacheKey(uid) { return 'fb_cache_' + uid; }
function withTimeout(promise, ms) {
    return Promise.race([promise, new Promise(function(_, rej) { setTimeout(function() { rej(new Error('timeout')); }, ms); })]);
}
async function loadUserData() {
    loadFailed = false;
    if (!currentUser) { userData = null; schoolData = null; return; }
    try {
        const snap = await withTimeout(getDoc(userRef(currentUser.uid)), 7000);
        userData = snap.exists() ? { uid: currentUser.uid, ...snap.data() } : null;
        if (userData && userData.schoolId) {
            const ssnap = await withTimeout(getDoc(schoolRef(userData.schoolId)), 7000);
            schoolData = ssnap.exists() ? { id: userData.schoolId, ...ssnap.data() } : null;
        } else {
            schoolData = null;
        }
        try { localStorage.setItem(cacheKey(currentUser.uid), JSON.stringify({ u: userData, s: schoolData })); } catch(e) {}
    } catch(e) {
        console.error('خطا در بارگذاری:', e);
        // شبکه/Firestore در دسترس نیست: از آخرین اطلاعات ذخیره‌شدهٔ همین کاربر استفاده کن
        let c = null;
        try { c = JSON.parse(localStorage.getItem(cacheKey(currentUser.uid)) || 'null'); } catch(x) {}
        if (c && c.u) { userData = c.u; schoolData = c.s || null; }
        else { userData = null; schoolData = null; loadFailed = true; }   // خطا ≠ کاربر تازه
    }
}

async function createSchool(schoolName, schoolCode, adminName) {
    if (!currentUser) throw new Error('ابتدا وارد شوید');
    if (loadFailed) throw new Error('اطلاعات حساب شما بارگذاری نشد؛ اتصال را بررسی و دوباره تلاش کنید');
    schoolCode = String(schoolCode || '').trim().toLowerCase();
    if (!/^[a-z0-9\-]{3,30}$/.test(schoolCode)) throw new Error('کد مدرسه فقط حروف کوچک انگلیسی، عدد و خط تیره (۳ تا ۳۰ کاراکتر)');
    const sref = schoolRef(schoolCode);
    const existing = await getDoc(sref);
    if (existing.exists()) throw new Error('این کد مدرسه قبلاً استفاده شده است');
    if (userData && userData.schoolId) throw new Error('شما قبلاً مدرسه ساخته‌اید');
    await setDoc(sref, {
        name: schoolName || 'مدرسه من',
        code: schoolCode,
        adminUid: currentUser.uid,
        adminEmail: currentUser.email,
        adminName: adminName || currentUser.displayName || '',
        createdAt: serverTimestamp()
    });
    await setDoc(userRef(currentUser.uid), {
        email: currentUser.email,
        name: adminName || currentUser.displayName || '',
        photo: currentUser.photoURL || '',
        role: 'admin',
        schoolId: schoolCode,
        status: 'active',
        createdAt: serverTimestamp()
    }, { merge: true });
    userData = { ...userData, role: 'admin', schoolId: schoolCode, name: adminName, status: 'active' };
    schoolData = { id: schoolCode, name: schoolName, code: schoolCode, adminUid: currentUser.uid };
    return schoolData;
}

async function joinSchool(schoolCode, teacherName, className) {
    if (!currentUser) throw new Error('ابتدا وارد شوید');
    if (loadFailed) throw new Error('اطلاعات حساب شما بارگذاری نشد؛ اتصال را بررسی و دوباره تلاش کنید');
    schoolCode = String(schoolCode || '').trim().toLowerCase();
    const ssnap = await getDoc(schoolRef(schoolCode));
    if (!ssnap.exists()) throw new Error('مدرسه‌ای با این کد پیدا نشد');
    const school = ssnap.data();
    if (userData && userData.schoolId && userData.status === 'active') throw new Error('شما قبلاً به یک مدرسه پیوسته‌اید');
    await setDoc(userRef(currentUser.uid), {
        email: currentUser.email,
        name: teacherName || currentUser.displayName || '',
        photo: currentUser.photoURL || '',
        role: 'teacher',
        schoolId: schoolCode,
        schoolName: school.name || '',
        requestedClass: className || '',
        status: 'pending',
        requestedAt: serverTimestamp()
    }, { merge: true });
    userData = { uid: currentUser.uid, email: currentUser.email, name: teacherName, role: 'teacher', schoolId: schoolCode, status: 'pending', requestedClass: className };
    schoolData = { id: schoolCode, ...school };
    return userData;
}


/* ═══════════════ حضور و غیاب آنلاین ═══════════════ */
function needSchool() {
    if (!currentUser || !userData || !userData.schoolId) throw new Error('ابتدا وارد مدرسه شوید');
    return userData.schoolId;
}
// معاون: انتشار لیست کلاس‌ها/دانش‌آموزان برای معلم‌ها
async function publishClasses(list) {
    const sid = needSchool();
    if (userData.role !== 'admin') throw new Error('دسترسی ندارید');
    await setDoc(doc(db, 'schools', sid, 'meta', 'classes'), { classes: list, updatedAt: serverTimestamp() });
}
// معلم: دریافت کلاس‌های منتشرشده
async function getClasses() {
    const sid = needSchool();
    const snap = await withTimeout(getDoc(doc(db, 'schools', sid, 'meta', 'classes')), 8000);
    return snap.exists() ? (snap.data().classes || []) : [];
}
// معلم: ارسال گزارش حضور و غیاب (پیام کوتاه DB2)
async function sendReport(msg, className, date, teacherName) {
    const sid = needSchool();
    if (userData.status !== 'active') throw new Error('هنوز توسط معاون تأیید نشده‌اید');
    const id = String(className + '_' + date).replace(/[\/\s|#?\[\]]+/g, '-');
    await withTimeout(setDoc(doc(db, 'schools', sid, 'reports', id), {
        uid: currentUser.uid, teacher: teacherName || userData.name || '', c: className, d: date,
        msg: msg, applied: false, createdAt: serverTimestamp()
    }), 10000);
}
// معاون: گزارش‌های ثبت‌نشدهٔ آنلاین (لحظه‌ای)
function watchReports(cb) {
    if (!userData || !userData.schoolId) return () => {};
    const q = query(collection(db, 'schools', userData.schoolId, 'reports'), where('applied', '==', false));
    return onSnapshot(q, (snap) => {
        const out = [];
        snap.forEach(d => out.push({ id: d.id, ...d.data() }));
        cb(out);
    }, (e) => console.error('watchReports:', e));
}
async function markReportsApplied(ids) {
    const sid = needSchool();
    await Promise.all(ids.map(id => updateDoc(doc(db, 'schools', sid, 'reports', id), { applied: true })));
}
async function setTeacherClasses(uid, classId) {
    if (!userData || userData.role !== 'admin') throw new Error('دسترسی ندارید');
    await updateDoc(userRef(uid), { classId: classId || '' });
}

function watchPending(onChange) {
    if (pendingWatch) pendingWatch();
    pendingWatch = onSnapshot(userRef(currentUser.uid), (snap) => {
        if (!snap.exists()) return;
        const d = snap.data();
        userData = { uid: currentUser.uid, ...d };
        if (onChange) onChange(userData);
    }, (e) => console.error('watchPending:', e));
}

async function approveTeacher(uid, className) {
    if (!userData || userData.role !== 'admin') throw new Error('دسترسی ندارید');
    await updateDoc(userRef(uid), { status: 'active', classId: className || '', approvedAt: serverTimestamp() });
}

async function rejectTeacher(uid) {
    if (!userData || userData.role !== 'admin') throw new Error('دسترسی ندارید');
    await updateDoc(userRef(uid), { status: 'rejected' });
}

function watchTeachers(cb) {
    if (!userData || !userData.schoolId) return () => {};
    const q = query(collection(db, 'users'), where('schoolId', '==', userData.schoolId));
    return onSnapshot(q, (snap) => {
        const out = [];
        snap.forEach(d => out.push({ uid: d.id, ...d.data() }));
        cb(out);
    }, (e) => console.error('watchTeachers:', e));
}

async function signInGoogle() {
    try {
        const result = await signInWithPopup(auth, provider);
        return result.user;
    } catch(e) {
        console.error('signInGoogle:', e);
        throw new Error(faErr(e));
    }
}

function faErr(e) {
    const code = e && e.code || '';
    if (code === 'auth/popup-closed-by-user') return 'پنجرهٔ ورود بسته شد.';
    if (code === 'auth/popup-blocked') return 'مرورگر پنجرهٔ ورود را بلاک کرده. اجازه دهید.';
    if (code === 'auth/network-request-failed') return 'خطای شبکه. اتصال اینترنت را بررسی کنید.';
    if (code === 'auth/unauthorized-domain') return 'این دامنه در Firebase مجاز نشده.';
    return e && e.message ? e.message : 'خطای ناشناخته در ورود';
}

async function doSignOut() {
    if (pendingWatch) { pendingWatch(); pendingWatch = null; }
    try { sessionStorage.removeItem('fb_pick_role'); if (currentUser) localStorage.removeItem(cacheKey(currentUser.uid)); } catch(e) {}
    await signOut(auth);
    try { localStorage.removeItem('cm_active_page'); } catch(e) {}
}

onAuthStateChanged(auth, async (user) => {
    currentUser = user || null;
    await loadUserData();
    authReady = true;
    readyCbs.forEach(cb => { try { cb(); } catch(e) {} });
    userChangeCbs.forEach(cb => { try { cb(currentUser, userData, schoolData); } catch(e) {} });
});

window.FB = {
    get user() { return currentUser; },
    get userData() { return userData; },
    get school() { return schoolData; },
    get ready() { return authReady; },
    get loadFailed() { return loadFailed; },
    reload: async () => { await loadUserData(); },
    onReady: (cb) => { if (authReady) cb(); else readyCbs.push(cb); },
    onUserChange: (cb) => { userChangeCbs.push(cb); if (authReady) cb(currentUser, userData, schoolData); },
    signInGoogle, signOut: doSignOut,
    createSchool, joinSchool,
    approveTeacher, rejectTeacher,
    watchTeachers, watchPending,
    publishClasses, getClasses, sendReport, watchReports, markReportsApplied, setTeacherClasses,
    store: storeProxy,
    _faErr: faErr
};

/* ═══════════════ UI - صفحهٔ ورود ═══════════════ */
(function() {
    const root = document.getElementById('authRoot');
    if (!root) return;

    const css = `
    #authRoot { display: none; }
    html.cm-locked body > *:not(#authRoot):not(script) { display: none !important; }
    html.cm-locked #authRoot { display: flex; }
    #authRoot {
        position: fixed; inset: 0; z-index: 99999; overflow: auto;
        align-items: stretch; justify-content: center;
        background: radial-gradient(1200px 700px at 85% -10%, #7c3aed 0%, transparent 60%),
                    radial-gradient(900px 600px at -10% 110%, #06b6d4 0%, transparent 55%),
                    linear-gradient(135deg, #1e1b4b 0%, #312e81 45%, #4f46e5 100%);
        color: #fff; font-family: 'Vazirmatn', Tahoma, sans-serif;
    }
    .fb-blob { position: absolute; border-radius: 50%; filter: blur(60px); opacity: .5; pointer-events: none; animation: fbFloat 14s ease-in-out infinite; }
    .fb-blob.b1 { width: 340px; height: 340px; background: #22d3ee; top: -90px; left: -80px; }
    .fb-blob.b2 { width: 420px; height: 420px; background: #a855f7; bottom: -140px; right: -100px; animation-delay: -5s; }
    @keyframes fbFloat { 0%,100% { transform: translate(0,0) scale(1);} 50% { transform: translate(30px,-26px) scale(1.08);} }
    .fb-shell { position: relative; z-index: 1; width: 100%; max-width: 460px; margin: auto; padding: 24px 18px; display: flex; flex-direction: column; justify-content: center; min-height: 100%; }
    .fb-logo { display: flex; align-items: center; gap: 12px; margin-bottom: 20px; justify-content: center; }
    .fb-logo-ic { width: 62px; height: 62px; border-radius: 18px; background: #fff; display: flex; align-items: center; justify-content: center; font-size: 30px; box-shadow: 0 10px 30px rgba(0,0,0,.35); }
    .fb-logo b { font-size: 22px; font-weight: 900; display: block; }
    .fb-logo small { font-size: 12px; opacity: .75; }
    .fb-card { background: rgba(255,255,255,.08); backdrop-filter: blur(12px); -webkit-backdrop-filter: blur(12px); border: 1px solid rgba(255,255,255,.15); border-radius: 22px; padding: 22px 20px; margin-bottom: 16px; }
    .fb-h1 { font-size: 22px; font-weight: 900; line-height: 1.5; text-align: center; margin-bottom: 8px; }
    .fb-h1 span { background: linear-gradient(90deg, #67e8f9, #f0abfc); -webkit-background-clip: text; background-clip: text; color: transparent; }
    .fb-sub { font-size: 13.5px; opacity: .8; line-height: 2; text-align: center; margin-bottom: 22px; }
    .fb-google { width: 100%; background: #fff; color: #1f2937; border: 0; border-radius: 14px; padding: 15px 18px; font-family: inherit; font-size: 15px; font-weight: 800; cursor: pointer; display: flex; align-items: center; justify-content: center; gap: 12px; box-shadow: 0 10px 24px rgba(0,0,0,.25); transition: all .15s; }
    .fb-google:hover { transform: translateY(-2px); box-shadow: 0 14px 32px rgba(0,0,0,.35); }
    .fb-google:disabled { opacity: .6; cursor: wait; transform: none; }
    .fb-role { width: 100%; border: 0; border-radius: 20px; padding: 20px 18px; font-family: inherit; cursor: pointer; display: flex; align-items: center; gap: 14px; text-align: right; margin-bottom: 12px; transition: all .15s; position: relative; overflow: hidden; color: #fff; }
    .fb-role::before { content: ''; position: absolute; width: 130px; height: 130px; border-radius: 50%; background: rgba(255,255,255,.15); top: -50px; left: -40px; }
    .fb-role:hover { transform: translateY(-3px); }
    .fb-role:active { transform: scale(.98); }
    .fb-role.admin { background: linear-gradient(135deg, #6366f1, #8b5cf6); box-shadow: 0 12px 28px rgba(99,102,241,.45); }
    .fb-role.teacher { background: linear-gradient(135deg, #059669, #10b981); box-shadow: 0 12px 28px rgba(5,150,105,.45); }
    .fb-role-ic { width: 56px; height: 56px; border-radius: 16px; background: rgba(255,255,255,.22); border: 1px solid rgba(255,255,255,.35); display: flex; align-items: center; justify-content: center; font-size: 28px; flex-shrink: 0; position: relative; }
    .fb-role-info { flex: 1; position: relative; }
    .fb-role-info b { display: block; font-size: 17px; font-weight: 900; margin-bottom: 3px; }
    .fb-role-info small { font-size: 12px; opacity: .92; line-height: 1.7; display: block; }
    .fb-role-arrow { font-size: 22px; opacity: .7; position: relative; }
    .fb-field { margin-bottom: 14px; }
    .fb-field label { display: block; font-size: 12.5px; font-weight: 700; margin-bottom: 6px; opacity: .9; }
    .fb-field input { width: 100%; background: rgba(255,255,255,.1); border: 1.5px solid rgba(255,255,255,.2); border-radius: 12px; padding: 13px 14px; color: #fff; font-family: inherit; font-size: 15px; outline: none; transition: all .2s; }
    .fb-field input::placeholder { color: rgba(255,255,255,.4); }
    .fb-field input:focus { border-color: #a5b4fc; background: rgba(255,255,255,.15); box-shadow: 0 0 0 4px rgba(165,180,252,.15); }
    .fb-field .hint { font-size: 11.5px; opacity: .7; margin-top: 5px; line-height: 1.7; }
    .fb-main { width: 100%; background: linear-gradient(135deg, #6366f1, #8b5cf6); color: #fff; border: 0; border-radius: 14px; padding: 15px; font-family: inherit; font-size: 16px; font-weight: 900; cursor: pointer; box-shadow: 0 12px 26px rgba(99,102,241,.45); transition: all .15s; margin-top: 6px; }
    .fb-main:hover { transform: translateY(-2px); }
    .fb-main:disabled { opacity: .6; cursor: wait; transform: none; }
    .fb-main.green { background: linear-gradient(135deg, #059669, #10b981); box-shadow: 0 12px 26px rgba(5,150,105,.45); }
    .fb-ghost { width: 100%; background: transparent; color: #fff; border: 1.5px solid rgba(255,255,255,.25); border-radius: 14px; padding: 13px; font-family: inherit; font-size: 14px; font-weight: 700; cursor: pointer; margin-top: 10px; }
    .fb-ghost:hover { background: rgba(255,255,255,.08); }
    .fb-err { background: rgba(239,68,68,.15); color: #fecaca; border: 1px solid rgba(239,68,68,.35); border-radius: 12px; padding: 10px 12px; font-size: 13px; margin-bottom: 12px; line-height: 1.9; display: none; }
    .fb-err.show { display: block; }
    .fb-pending-ic { width: 92px; height: 92px; border-radius: 50%; background: linear-gradient(135deg, #fbbf24, #f59e0b); display: flex; align-items: center; justify-content: center; font-size: 44px; margin: 20px auto; box-shadow: 0 12px 30px rgba(245,158,11,.45); animation: fbPulse 2s ease-in-out infinite; }
    @keyframes fbPulse { 0%,100% { transform: scale(1);} 50% { transform: scale(1.06);} }
    `;
    const style = document.createElement('style');
    style.textContent = css;
    document.head.appendChild(style);

    root.innerHTML = '<div class="fb-blob b1"></div><div class="fb-blob b2"></div><div class="fb-shell" id="fbShell"></div>';
    const shell = document.getElementById('fbShell');

    function show(html) { shell.innerHTML = html; }
    function showErr(msg) {
        const e = document.getElementById('fbErr');
        if (!e) return;
        e.textContent = msg || '';
        e.classList.toggle('show', !!msg);
    }

    function paneWelcome() {
        show(`
            <div class="fb-logo"><div class="fb-logo-ic">📒</div><div><b>دفتر انضباطی</b><small>نسخهٔ آنلاین</small></div></div>
            <h1 class="fb-h1">انضباط کلاس را <span>دقیق و ساده</span> ثبت کن</h1>
            <p class="fb-sub">حضور و غیاب، ثبت رفتار و گزارش‌های انضباطی — آنلاین و لحظه‌ای</p>
            <div class="fb-err" id="fbErr"></div>
            <div class="fb-card">
                <button class="fb-google" id="fbGoogle">
                    <svg width="20" height="20" viewBox="0 0 48 48">
                        <path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3c-1.6 4.7-6.1 8-11.3 8-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.9 1.2 8 3.1l5.7-5.7C34.1 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.3-.4-3.5z"/>
                        <path fill="#FF3D00" d="M6.3 14.7l6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.9 1.2 8 3.1l5.7-5.7C34.1 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z"/>
                        <path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-7.9l-6.5 5C9.5 39.6 16.2 44 24 44z"/>
                        <path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.3-2.2 4.2-4.1 5.6l6.2 5.2C41.4 35.7 44 30.3 44 24c0-1.3-.1-2.3-.4-3.5z"/>
                    </svg>
                    ورود با حساب Google
                </button>
            </div>
            <p style="text-align:center; font-size:11.5px; opacity:.65; line-height:1.9;">
                🔒 با ورود، شرایط استفاده را می‌پذیرید.<br>
                داده‌های شما روی سرور ابری محفوظ است.
            </p>
        `);
        document.getElementById('fbGoogle').addEventListener('click', async () => {
            const btn = document.getElementById('fbGoogle');
            btn.disabled = true;
            showErr('');
            try { sessionStorage.setItem('fb_pick_role', '1'); } catch(x) {}
            try { await FB.signInGoogle(); }
            catch(e) { try { sessionStorage.removeItem('fb_pick_role'); } catch(x) {} btn.disabled = false; showErr(e.message || 'خطا در ورود'); }
        });
    }

    function route() {
        if (!FB.user) { document.documentElement.classList.add('cm-locked'); paneWelcome(); return; }
        if (FB.loadFailed) { document.documentElement.classList.add('cm-locked'); paneRetry(); return; }
        const ud = FB.userData;
        let pick = false; try { pick = sessionStorage.getItem('fb_pick_role') === '1'; } catch(e) {}
        if (pick && ud && ud.role && ud.schoolId) { document.documentElement.classList.add('cm-locked'); paneRole(ud.role); return; }
        if (!ud) { document.documentElement.classList.add('cm-locked'); paneRole(); return; }
        if (ud.role === 'admin') {
            if (!ud.schoolId) { document.documentElement.classList.add('cm-locked'); paneCreateSchool(); return; }
            enterApp(); return;
        }
        if (ud.role === 'teacher') {
            if (!ud.schoolId) { document.documentElement.classList.add('cm-locked'); paneJoinSchool(); return; }
            if (ud.status === 'pending') { document.documentElement.classList.add('cm-locked'); panePending(); return; }
            if (ud.status === 'rejected') { document.documentElement.classList.add('cm-locked'); paneRejected(); return; }
            enterApp(); return;
        }
        document.documentElement.classList.add('cm-locked'); paneRole();
    }

    function enterApp() {
        // معاون → دفتر انضباطی ، معلم → صفحهٔ معلم
        try {
            const onTeacherPage = /teacher\.html/.test(location.pathname);
            const role = FB.userData && FB.userData.role;
            if (role === 'admin' && onTeacherPage) { location.replace('index.html'); return; }
            if (role === 'teacher' && !onTeacherPage) { location.replace('teacher.html'); return; }
        } catch(e) {}
        try { sessionStorage.removeItem('fb_pick_role'); if (FB.user) localStorage.setItem(cacheKey(FB.user.uid), JSON.stringify({ u: FB.userData, s: FB.school })); } catch(e) {}
        document.documentElement.classList.remove('cm-locked');
        root.style.display = 'none';
        window.dispatchEvent(new CustomEvent('fb-ready', { detail: { user: FB.user, userData: FB.userData, school: FB.school } }));
        if (typeof window.onFBEnterApp === 'function') window.onFBEnterApp();
    }

    function paneRole(savedRole) {
        show(`
            <div class="fb-logo"><div class="fb-logo-ic">👋</div><div><b>خوش آمدی</b><small>${FB.user && FB.user.email || ''}</small></div></div>
            <p class="fb-sub">${savedRole ? 'با چه نقشی وارد می‌شوید؟' : 'نقش خود را انتخاب کن'}</p>
            <div class="fb-err" id="fbErr"></div>
            <button class="fb-role admin" data-role="admin">
                <span class="fb-role-ic">👨‍💼</span>
                <span class="fb-role-info"><b>معاون مدرسه</b><small>مدیریت کل کلاس‌ها<br>تعیین معلم‌ها و Dashboard</small></span>
                <span class="fb-role-arrow">‹</span>
            </button>
            <button class="fb-role teacher" data-role="teacher">
                <span class="fb-role-ic">👨‍🏫</span>
                <span class="fb-role-info"><b>معلم کلاس</b><small>ثبت حضور و غیاب کلاس خودم<br>ارسال لحظه‌ای به معاون</small></span>
                <span class="fb-role-arrow">‹</span>
            </button>
            <button class="fb-ghost" id="fbOut">خروج از حساب</button>
        `);
        document.getElementById('fbOut').addEventListener('click', () => FB.signOut());
        shell.querySelectorAll('[data-role]').forEach(b => {
            b.addEventListener('click', () => {
                const role = b.getAttribute('data-role');
                if (savedRole) {
                    if (role === savedRole) { try { sessionStorage.removeItem('fb_pick_role'); } catch(e) {} route(); }
                    else showErr('این حساب قبلاً به‌عنوان «' + (savedRole === 'admin' ? 'معاون' : 'معلم') + '» ثبت شده است. همان نقش را انتخاب کنید.');
                    return;
                }
                if (role === 'admin') paneCreateSchool();
                else paneJoinSchool();
            });
        });
    }

    function paneCreateSchool() {
        show(`
            <div class="fb-logo"><div class="fb-logo-ic">🏫</div><div><b>ساخت مدرسه</b><small>فقط برای معاون</small></div></div>
            <p class="fb-sub">یک بار مدرسه را بساز، بعد معلم‌ها با کد آن وارد می‌شوند</p>
            <div class="fb-err" id="fbErr"></div>
            <div class="fb-card">
                <div class="fb-field"><label>نام مدرسه *</label><input type="text" id="fSchoolName" placeholder="مثلاً: دبستان شهید بهشتی"></div>
                <div class="fb-field"><label>نام و نام خانوادگی شما *</label><input type="text" id="fAdminName" placeholder="مثلاً: یوسف معصومی" value="${FB.user && FB.user.displayName || ''}"></div>
                <div class="fb-field"><label>کد مدرسه *</label><input type="text" id="fSchoolCode" placeholder="مثلاً: beheshti-1404" style="direction:ltr; text-align:right; font-family:monospace;"><div class="hint">این کد را به معلم‌ها می‌دهید. حروف کوچک انگلیسی، عدد و خط تیره.</div></div>
            </div>
            <button class="fb-main" id="fbCreate">✨ ساخت مدرسه و شروع</button>
            <button class="fb-ghost" id="fbBack">◀ بازگشت</button>
        `);
        document.getElementById('fbBack').addEventListener('click', paneRole);
        document.getElementById('fbCreate').addEventListener('click', async () => {
            const name = document.getElementById('fSchoolName').value.trim();
            const admin = document.getElementById('fAdminName').value.trim();
            const code = document.getElementById('fSchoolCode').value.trim();
            if (!name) { showErr('نام مدرسه را وارد کنید'); return; }
            if (!admin) { showErr('نام خود را وارد کنید'); return; }
            if (!code) { showErr('کد مدرسه را وارد کنید'); return; }
            const btn = document.getElementById('fbCreate');
            btn.disabled = true; btn.textContent = 'در حال ساخت...';
            try { await FB.createSchool(name, code, admin); enterApp(); }
            catch(e) { btn.disabled = false; btn.textContent = '✨ ساخت مدرسه و شروع'; showErr(e.message || 'خطا'); }
        });
    }

    function paneJoinSchool(prefCode, prefClass) {
        show(`
            <div class="fb-logo"><div class="fb-logo-ic">🔑</div><div><b>پیوستن به مدرسه</b><small>برای معلم</small></div></div>
            <p class="fb-sub">کد مدرسه را از معاون بگیر و وارد کن</p>
            <div class="fb-err" id="fbErr"></div>
            <div class="fb-card">
                <div class="fb-field"><label>کد مدرسه *</label><input type="text" id="jCode" value="${prefCode || ''}" placeholder="مثلاً: beheshti-1404" style="direction:ltr; text-align:right; font-family:monospace;"></div>
                <div class="fb-field"><label>نام و نام خانوادگی شما *</label><input type="text" id="jName" placeholder="مثلاً: علی رضایی" value="${FB.user && FB.user.displayName || ''}"></div>
                <div class="fb-field"><label>کلاس من</label><input type="text" id="jClass" value="${prefClass || ''}" placeholder="مثلاً: ۱۰۱"></div>
                <div class="hint" style="font-size:11.5px; opacity:.7; line-height:1.8;">پس از تأیید معاون، می‌توانی غیبت‌ها را ثبت کنی.</div>
            </div>
            <button class="fb-main green" id="fbJoin">📨 ارسال درخواست</button>
            <button class="fb-ghost" id="fbBack">◀ بازگشت</button>
        `);
        document.getElementById('fbBack').addEventListener('click', paneRole);
        document.getElementById('fbJoin').addEventListener('click', async () => {
            const code = document.getElementById('jCode').value.trim();
            const name = document.getElementById('jName').value.trim();
            const cls = document.getElementById('jClass').value.trim();
            if (!code) { showErr('کد مدرسه را وارد کنید'); return; }
            if (!name) { showErr('نام خود را وارد کنید'); return; }
            const btn = document.getElementById('fbJoin');
            btn.disabled = true; btn.textContent = 'در حال ارسال...';
            try { await FB.joinSchool(code, name, cls); panePending(); }
            catch(e) { btn.disabled = false; btn.textContent = '📨 ارسال درخواست'; showErr(e.message || 'خطا'); }
        });
    }

    function panePending() {
        show(`
            <div class="fb-logo"><div class="fb-logo-ic">⏳</div><div><b>در انتظار تأیید</b><small>لطفاً صبر کنید</small></div></div>
            <div class="fb-pending-ic">⏳</div>
            <h1 class="fb-h1">درخواست شما ارسال شد</h1>
            <p class="fb-sub">معاون مدرسه در اسرع وقت درخواست شما را بررسی می‌کند.<br>بعد از تأیید، به‌طور خودکار وارد می‌شوید.</p>
            <div class="fb-card" style="padding:14px 16px;">
                <div style="display:flex; align-items:center; gap:12px; font-size:13px;">
                    <div style="width:40px; height:40px; border-radius:12px; background:rgba(255,255,255,.15); display:flex; align-items:center; justify-content:center; font-size:20px;">📩</div>
                    <div style="flex:1; line-height:1.8;">
                        <b>${FB.school ? FB.school.name : 'درخواست پیوستن ارسال شد'}</b><br>
                        <span style="opacity:.7; font-size:12px;">${FB.userData && FB.userData.requestedClass ? 'کلاس: ' + FB.userData.requestedClass : ''}</span>
                    </div>
                </div>
            </div>
            <button class="fb-ghost" id="fbOut">انصراف و خروج</button>
        `);
        document.getElementById('fbOut').addEventListener('click', () => FB.signOut());
        FB.watchPending((ud) => {
            if (ud && ud.status === 'active') enterApp();
            else if (ud && ud.status === 'rejected') paneRejected();
        });
    }

    function paneRetry() {
        show(`
            <div class="fb-logo"><div class="fb-logo-ic">📡</div><div><b>اتصال برقرار نشد</b></div></div>
            <h1 class="fb-h1">اطلاعات حساب شما بارگذاری نشد</h1>
            <p class="fb-sub">اینترنت (یا فیلترشکن) را بررسی کنید و دوباره تلاش کنید.<br>تا آن موقع چیزی ساخته یا تغییر داده نمی‌شود.</p>
            <div class="fb-err" id="fbErr"></div>
            <button class="fb-main" id="fbRetry">🔄 تلاش دوباره</button>
            <button class="fb-ghost" id="fbOut">خروج از حساب</button>
        `);
        document.getElementById('fbOut').addEventListener('click', () => FB.signOut());
        document.getElementById('fbRetry').addEventListener('click', async () => {
            const b = document.getElementById('fbRetry'); b.disabled = true; b.textContent = 'در حال تلاش…';
            try { await FB.reload(); } catch(e) {}
            route();
        });
    }

    function paneRejected() {
        show(`
            <div class="fb-logo"><div class="fb-logo-ic">❌</div><div><b>درخواست رد شد</b></div></div>
            <h1 class="fb-h1">درخواست شما تأیید نشد</h1>
            <p class="fb-sub">معاون مدرسه درخواست پیوستن شما را رد کرده است.<br>برای اطلاعات بیشتر با ایشان تماس بگیرید.</p>
            <button class="fb-main green" id="fbAgain">🔁 ارسال درخواست دوباره</button>
            <button class="fb-ghost" id="fbOut">خروج از حساب</button>
        `);
        document.getElementById('fbOut').addEventListener('click', () => FB.signOut());
        document.getElementById('fbAgain').addEventListener('click', () => paneJoinSchool(FB.userData && FB.userData.schoolId, FB.userData && FB.userData.requestedClass));
    }

    FB.onReady(route);
    FB.onUserChange((user) => {
        if (!user) { document.documentElement.classList.add('cm-locked'); paneWelcome(); }
        else route();
    });
    if (FB.ready) { if (FB.user) route(); else { document.documentElement.classList.add('cm-locked'); paneWelcome(); } }
    else { document.documentElement.classList.add('cm-locked'); show('<div style="text-align:center;padding:60px 0;line-height:2.2;"><div style="font-size:46px">📒</div><b>دفتر انضباطی</b><br><span style="opacity:.75;font-size:13px">در حال بررسی ورود…</span></div>'); }
})();