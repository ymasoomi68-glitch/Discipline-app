/* ═══════════════════════════════════════════════════
   🔥 Firebase Init — دفتر انضباطی
   ═══════════════════════════════════════════════════ */

import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js";
import {
    getAuth, signInWithPopup, GoogleAuthProvider, onAuthStateChanged, signOut
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js";
import {
    getFirestore, doc, getDoc, setDoc, updateDoc,
    collection, query, where, getDocs, onSnapshot, serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";

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

/* ═══ ذخیره‌سازی محلی به‌ازای هر کاربر ═══ */
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

async function loadUserData() {
    if (!currentUser) { userData = null; schoolData = null; return; }
    try {
        const snap = await getDoc(userRef(currentUser.uid));
        userData = snap.exists() ? { uid: currentUser.uid, ...snap.data() } : null;
        if (userData && userData.schoolId) {
            const ssnap = await getDoc(schoolRef(userData.schoolId));
            schoolData = ssnap.exists() ? { id: userData.schoolId, ...ssnap.data() } : null;
        } else {
            schoolData = null;
        }
    } catch(e) {
        console.error('خطا در بارگذاری:', e);
        userData = null; schoolData = null;
    }
}

async function createSchool(schoolName, schoolCode, adminName) {
    if (!currentUser) throw new Error('ابتدا وارد شوید');
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
    schoolCode = String(schoolCode || '').trim().toLowerCase();

    const ssnap = await getDoc(schoolRef(schoolCode));
    if (!ssnap.exists()) throw new Error('مدرسه‌ای با این کد پیدا نشد');
    const school = ssnap.data();

    if (userData && userData.schoolId && userData.status === 'active') {
        throw new Error('شما قبلاً به یک مدرسه پیوسته‌اید');
    }

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
    await updateDoc(userRef(uid), {
        status: 'active',
        classId: className || '',
        approvedAt: serverTimestamp()
    });
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
    onReady: (cb) => { if (authReady) cb(); else readyCbs.push(cb); },
    onUserChange: (cb) => { userChangeCbs.push(cb); if (authReady) cb(currentUser, userData, schoolData); },
    signInGoogle, signOut: doSignOut,
    createSchool, joinSchool,
    approveTeacher, rejectTeacher,
    watchTeachers, watchPending,
    store: storeProxy,
    _faErr: faErr
};