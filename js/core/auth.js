// ==========================================================================
// FILE: js/core/auth.js (JAPAR PANEL v4.0 - DUAL-NODE FEDERATED SHARDING & ZERO-SOCKET)
// FUNGSI:
//   1. Arsitektur Multi-Node Routing (Node #1 `japar-b1c5d` & Node #2 `japar-2`)
//      dengan Deteksi & Failover Otomatis serta Penguncian `email -> nodeId`
//   2. Penguncian Metode Login Eksklusif (Mutual-Exclusion: EMAIL vs GOOGLE)
//   3. Sistem Anti-Duplikasi Resto Lintas Akun/UID (Mencegah pendaftaran resto ganda)
//   4. Standarisasi 5 Kategori Toko (`HIDANGAN_UTAMA`, `MINUMAN_KOPI`, `CAMILAN_JAJANAN`,
//      `ROTI_OLEH_OLEH`, `PAKET_HEMAT`), Bitmask `srv` 8 Karakter (`111UMCRP`),
//      & Diet Byte Indeks RTDB (~220 Byte/Merchant) Murni HTTP REST API (0 WebSocket)
//   5. Mesin Tema Otomatis Presisi Berdasarkan Jam Lokal WIB (06:00-17:59 Siang, 18:00-05:59 Malam)
// ==========================================================================

import {
    auth,
    authNode1,
    authNode2,
    dbFirestore,
    provider,
    FIREBASE_NODE_CONTEXTS,
    getActiveNodeContext,
    getNodeContextById,
    setActiveNodeId,
    getNodeTerkunciUntukEmail,
    kunciIkatanNodeEmail,
    isSuperAdminUid
} from './firebase-config.js';
import {
    GoogleAuthProvider,
    signInWithPopup,
    signInWithRedirect,
    getRedirectResult,
    signInWithCredential,
    signInWithEmailAndPassword,
    createUserWithEmailAndPassword,
    sendPasswordResetEmail,
    fetchSignInMethodsForEmail,
    signOut,
    onAuthStateChanged,
    setPersistence,
    browserLocalPersistence
} from "https://www.gstatic.com/firebasejs/10.8.1/firebase-auth.js";
import { doc, getDoc, setDoc } from "https://www.gstatic.com/firebasejs/10.8.1/firebase-firestore.js";
import {
    encodeGeohash,
    hitungJarakHaversine,
    bersihkanPublicIdCloudinary,
    bangunUrlGambarCloudinary,
    unggahGambarKeCloudinary,
    uraiRentangJamOperasional,
    normalisasiArrayHariOperasional,
    getWaktuWibPresisi,
    parseKoordinatAman
} from '../utils/math-engine.js';
import { picuGetarSentuh } from '../utils/ui-components.js';
import { ekstrakKoordinatDariTeksAtauLinkGmaps, resolusiNamaJalanKoordinatViaGas, renderKotakPreviewLokasiGmaps, isikanOtomatisKolomAlamatResto, isValidIndonesiaCoord } from '../modules/location-picker.js';
import { klasifikasiKategoriMenuPintar } from '../modules/menu-catalog.js';
import {
    firebaseConfig,
    JAPAR_CLUSTER_NODES,
    ROOT_ADMIN_UID_N1,
    ROOT_ADMIN_UID_N2,
    DEFAULT_CENTER_PARE,
    ADMIN_WA_NUMBER
} from '../config/credentials.js';

export const DAFTAR_KODE_KATEGORI_TOKO_BAKU = [
    'HIDANGAN_UTAMA',
    'MINUMAN_KOPI',
    'CAMILAN_JAJANAN',
    'ROTI_OLEH_OLEH',
    'PAKET_HEMAT'
];

/**
 * Fungsi deterministik untuk menghitung shard node ('N1' atau 'N2') dari hash karakter email (lowercase)
 */
export function hitungShardNodeDariEmail(email) {
    const clean = String(email || '').toLowerCase().trim();
    if (!clean) return 'N1';
    let hash = 5381;
    for (let i = 0; i < clean.length; i++) {
        hash = ((hash << 5) + hash) + clean.charCodeAt(i);
        hash = hash & 0x7fffffff;
    }
    return (hash % 2 === 0) ? 'N1' : 'N2';
}
window.hitungShardNodeDariEmail = hitungShardNodeDariEmail;

function susunUrutanKandidatNodeUntukEmail(email) {
    const cleanEmail = String(email || '').toLowerCase().trim();
    const lockedNodeId = getNodeTerkunciUntukEmail(cleanEmail);
    if (lockedNodeId === 'N2') {
        return [FIREBASE_NODE_CONTEXTS.N2, FIREBASE_NODE_CONTEXTS.N1];
    }
    if (lockedNodeId === 'N1') {
        return [FIREBASE_NODE_CONTEXTS.N1, FIREBASE_NODE_CONTEXTS.N2];
    }
    // Demi kompatibilitas penuh dengan merchant lama di N1, periksa N1 lebih dulu lalu N2
    return [FIREBASE_NODE_CONTEXTS.N1, FIREBASE_NODE_CONTEXTS.N2];
}

export async function keluarSemuaNodeAuth() {
    await Promise.allSettled([
        signOut(authNode1),
        signOut(authNode2)
    ]);
}

/**
 * Menormalisasi kode kategori toko ke salah satu dari 5 taksonomi kuliner baru JAPAR
 */
export function normalisasiKategoriTokoJapar(rawKat, itemsArr = []) {
    const clean = String(rawKat || '').trim().toUpperCase();
    if (DAFTAR_KODE_KATEGORI_TOKO_BAKU.includes(clean)) {
        return clean;
    }
    if (clean === 'KULINER') {
        return 'HIDANGAN_UTAMA';
    }
    if (clean === 'OLEH_OLEH') {
        return 'ROTI_OLEH_OLEH';
    }
    if (clean === 'KOPI_JAJANAN') {
        const activeItems = Array.isArray(itemsArr)
            ? itemsArr.filter(it => it && it.s !== false)
            : [];
        if (activeItems.length > 0) {
            let camilanCount = 0;
            let otherCount = 0;
            activeItems.forEach(it => {
                const katMenu = klasifikasiKategoriMenuPintar(it.n || '', it.kat || '');
                const text = `${it.kat || ''} ${it.n || ''}`.toLowerCase();
                if (
                    katMenu === 'Camilan & Jajanan' ||
                    /\b(camilan|jajanan|kebab|gorengan|snack|martabak|burger|tahu|tempe|mendoan|cireng|pentol|cilok|sempol|dimsum|pisang|kentang|sosis|risol|lumpia|seblak|batagor|siomay)\b/i.test(text)
                ) {
                    camilanCount++;
                } else {
                    otherCount++;
                }
            });
            if (camilanCount > 0 && camilanCount >= otherCount) {
                return 'CAMILAN_JAJANAN';
            }
        }
        return 'MINUMAN_KOPI';
    }
    return 'HIDANGAN_UTAMA';
}
window.normalisasiKategoriTokoJapar = normalisasiKategoriTokoJapar;

/**
 * Memformat kode kategori toko menjadi label akuntabel untuk badge #header-store-category
 */
export function formatLabelKategoriToko(kodeKat) {
    const norm = normalisasiKategoriTokoJapar(kodeKat);
    const labelMap = {
        HIDANGAN_UTAMA: 'HIDANGAN UTAMA',
        MINUMAN_KOPI: 'MINUMAN & KOPI',
        CAMILAN_JAJANAN: 'CAMILAN & JAJANAN',
        ROTI_OLEH_OLEH: 'ROTI & OLEH-OLEH',
        PAKET_HEMAT: 'PAKET HEMAT'
    };
    return labelMap[norm] || 'HIDANGAN UTAMA';
}
window.formatLabelKategoriToko = formatLabelKategoriToko;

function getRtdbBaseUrl(nodeCtx = null) {
    const ctx = nodeCtx || getActiveNodeContext();
    const raw = (ctx && ctx.config && ctx.config.databaseURL)
        ? ctx.config.databaseURL
        : ((firebaseConfig && firebaseConfig.databaseURL)
            ? firebaseConfig.databaseURL
            : 'https://japar-b1c5d-default-rtdb.asia-southeast1.firebasedatabase.app');
    return String(raw).replace(/\/+$/, '');
}

async function rtdbSimpleRestGet(pathStr, nodeCtx = null) {
    const cleanPath = String(pathStr || '').replace(/^\/+|\/+$/g, '');
    const url = `${getRtdbBaseUrl(nodeCtx)}/${cleanPath}.json`;
    const resp = await fetch(url, { method: 'GET', cache: 'no-store' });
    if (!resp.ok) return null;
    return await resp.json().catch(() => null);
}

export const VERIFIED_CACHE_KEY = 'japar_verified_merchant_cache';
export const VERIFIED_CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000;
export const AUTH_METHOD_REGISTRY_KEY = 'japar_auth_method_registry_v1';
const SESSION_ATTEMPT_METHOD_KEY = 'japar_session_attempt_method_v1';
const FIRESTORE_DOC_TIMEOUT_MS = 8500;
const MANUAL_SYNC_COOLDOWN_MS = 60 * 1000;
export const PANEL_THEME_KEY = 'japar_panel_theme_mode_v1';

let lastManualServerSyncTs = 0;
let autoThemeIntervalTimer = null;
let isMultiNodeAuthProbeInProgress = false;

const GOOGLE_IDENTITY_BTN_HTML = `<span class="w-5 h-5 rounded-full bg-white flex items-center justify-center shrink-0">
  <svg class="w-4 h-4" viewBox="0 0 48 48" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
    <path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"/>
    <path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"/>
    <path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"/>
    <path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"/>
  </svg>
</span>
<span class="tracking-wide text-[0.82rem] font-bold">Masuk dengan Akun Google</span>`;

let isAudioMerchantUnlocked = false;
let merchantAudioCtx = null;
let panelAuthMode = 'LOGIN';

// ==========================================================================
// MANAJEMEN REGISTRI PENGUNCIAN METODE LOGIN EKSKLUSIF (EMAIL vs GOOGLE)
// ==========================================================================
function bacaRegistriMetodeAuth() {
    try {
        const raw = localStorage.getItem(AUTH_METHOD_REGISTRY_KEY);
        if (!raw) return { byEmail: {}, byStoreName: {}, byWa: {}, deviceLock: null };
        const parsed = JSON.parse(raw);
        return {
            byEmail: (parsed && typeof parsed.byEmail === 'object') ? parsed.byEmail : {},
            byStoreName: (parsed && typeof parsed.byStoreName === 'object') ? parsed.byStoreName : {},
            byWa: (parsed && typeof parsed.byWa === 'object') ? parsed.byWa : {},
            deviceLock: (parsed && parsed.deviceLock) ? parsed.deviceLock : null
        };
    } catch (e) {
        return { byEmail: {}, byStoreName: {}, byWa: {}, deviceLock: null };
    }
}

function simpanRegistriMetodeAuth(regObj) {
    try {
        localStorage.setItem(AUTH_METHOD_REGISTRY_KEY, JSON.stringify(regObj || {}));
    } catch (e) {}
}

export function normalisasiNamaRestoKunci(nama) {
    return String(nama || '')
        .toLowerCase()
        .replace(/[^a-z0-9]/g, '')
        .trim();
}

export function normalisasiWaKunci(wa) {
    const digits = String(wa || '').replace(/[^0-9]/g, '');
    if (digits.startsWith('08')) return '628' + digits.slice(2);
    if (digits.startsWith('8')) return '628' + digits.slice(1);
    return digits;
}

/**
 * Mencatat ikatan metode login permanen (`EMAIL` atau `GOOGLE`) untuk suatu email & resto
 */
export function catatIkatanMetodeLoginResto(email, method, uid = '', storeName = '', wa = '', nodeId = '') {
    const cleanEmail = String(email || '').toLowerCase().trim();
    const cleanMethod = (method === 'GOOGLE') ? 'GOOGLE' : 'EMAIL';
    if (!cleanEmail) return;

    const resolvedNodeId = nodeId === 'N2' || nodeId === 'N1'
        ? nodeId
        : (getNodeTerkunciUntukEmail(cleanEmail) || getActiveNodeContext().nodeId || 'N1');

    kunciIkatanNodeEmail(cleanEmail, resolvedNodeId);

    const reg = bacaRegistriMetodeAuth();
    const existing = reg.byEmail[cleanEmail] || {};
    const finalStoreName = storeName || existing.storeName || '';
    const finalWa = normalisasiWaKunci(wa || existing.wa || '');

    reg.byEmail[cleanEmail] = {
        method: cleanMethod,
        uid: uid || existing.uid || '',
        storeName: finalStoreName,
        wa: finalWa,
        nodeId: resolvedNodeId,
        updatedAt: Date.now()
    };

    const normStore = normalisasiNamaRestoKunci(finalStoreName);
    if (normStore.length >= 3) {
        reg.byStoreName[normStore] = {
            email: cleanEmail,
            method: cleanMethod,
            uid: uid || existing.uid || '',
            storeName: finalStoreName,
            nodeId: resolvedNodeId
        };
    }
    if (finalWa.length >= 9) {
        reg.byWa[finalWa] = {
            email: cleanEmail,
            method: cleanMethod,
            uid: uid || existing.uid || '',
            storeName: finalStoreName,
            nodeId: resolvedNodeId
        };
    }

    reg.deviceLock = {
        email: cleanEmail,
        method: cleanMethod,
        uid: uid || existing.uid || '',
        storeName: finalStoreName,
        nodeId: resolvedNodeId,
        lockedAt: Date.now()
    };

    simpanRegistriMetodeAuth(reg);
    sinkronkanVisualPenguncianMetodeLoginUI();
}

export function getMetodeLoginAktifUntukEmail(email) {
    const cleanEmail = String(email || '').toLowerCase().trim();
    const reg = bacaRegistriMetodeAuth();
    if (cleanEmail && reg.byEmail[cleanEmail]?.method) {
        return reg.byEmail[cleanEmail].method;
    }
    if (reg.deviceLock && (!cleanEmail || reg.deviceLock.email === cleanEmail)) {
        return reg.deviceLock.method;
    }
    return null;
}

function deteksiMetodeProviderFirebaseUser(user) {
    if (!user) return 'EMAIL';
    let sessionAttempt = '';
    try {
        sessionAttempt = sessionStorage.getItem(SESSION_ATTEMPT_METHOD_KEY) || '';
    } catch (e) {}

    const providers = Array.isArray(user.providerData) ? user.providerData : [];
    const hasPassword = providers.some(p => p && p.providerId === 'password');
    const hasGoogle = providers.some(p => p && p.providerId === 'google.com');

    if (sessionAttempt === 'EMAIL' || sessionAttempt === 'GOOGLE') {
        return sessionAttempt;
    }
    if (hasPassword && !hasGoogle) return 'EMAIL';
    if (hasGoogle && !hasPassword) return 'GOOGLE';

    const cachedMethod = getMetodeLoginAktifUntukEmail(user.email);
    if (cachedMethod) return cachedMethod;
    return hasPassword ? 'EMAIL' : 'GOOGLE';
}

/**
 * Menyinkronkan UI Halaman Login agar mengunci metode seberangnya jika akun/perangkat sudah terikat
 */
export function sinkronkanVisualPenguncianMetodeLoginUI() {
    const reg = bacaRegistriMetodeAuth();
    const lockBanner = document.getElementById('auth-method-lock-banner');
    const lockBannerText = document.getElementById('auth-method-lock-text');
    const btnUnlockDevice = document.getElementById('btn-unlock-device-auth-method');

    const inpEmail = document.getElementById('inputPanelAuthEmail');
    const inpPwd = document.getElementById('inputPanelAuthPassword');
    const btnEmailSubmit = document.getElementById('btnSubmitPanelEmailAuth');
    const btnGoogle = document.getElementById('btnGoogleLogin');
    const tabLogin = document.getElementById('tabPanelModeLogin');
    const tabReg = document.getElementById('tabPanelModeRegister');

    const typedEmail = String(inpEmail?.value || '').toLowerCase().trim();
    const emailEntry = typedEmail ? reg.byEmail[typedEmail] : null;
    const activeLock = emailEntry || reg.deviceLock || null;

    if (!activeLock || !activeLock.method) {
        if (lockBanner) lockBanner.classList.add('hidden-state');
        if (inpPwd) inpPwd.disabled = false;
        if (btnEmailSubmit) btnEmailSubmit.disabled = false;
        if (btnGoogle) {
            btnGoogle.disabled = false;
            btnGoogle.style.opacity = '1';
            btnGoogle.style.pointerEvents = 'auto';
            btnGoogle.innerHTML = GOOGLE_IDENTITY_BTN_HTML;
        }
        return;
    }

    const lockedMethod = activeLock.method; // 'EMAIL' | 'GOOGLE'
    const lockedEmail = activeLock.email || typedEmail || '';
    const storeLabel = activeLock.storeName ? ` (${activeLock.storeName})` : '';

    if (lockBanner && lockBannerText) {
        lockBanner.classList.remove('hidden-state');
        if (lockedMethod === 'EMAIL') {
            lockBanner.className = 'w-full mb-3 p-2.5 rounded-2xl bg-orange-500/15 border border-orange-500/45 text-[0.63rem] text-stone-200 space-y-1.5';
            lockBannerText.innerHTML = `
                <div class="font-extrabold text-orange-300 uppercase flex items-center gap-1.5">
                    <i class="fa-solid fa-shield-halved"></i> Metode Terkunci: Email &amp; Kata Sandi
                </div>
                <div>Akun resto <b>${lockedEmail}${storeLabel}</b> terdaftar menggunakan <b>Email &amp; Sandi</b>. Tombol Login Google dikunci otomatis untuk mencegah pembuatan resto ganda.</div>
            `;
        } else {
            lockBanner.className = 'w-full mb-3 p-2.5 rounded-2xl bg-emerald-500/15 border border-emerald-500/45 text-[0.63rem] text-stone-200 space-y-1.5';
            lockBannerText.innerHTML = `
                <div class="font-extrabold text-emerald-300 uppercase flex items-center gap-1.5">
                    <i class="fa-brands fa-google"></i> Metode Terkunci: Login Akun Google
                </div>
                <div>Akun resto <b>${lockedEmail}${storeLabel}</b> terdaftar menggunakan <b>Akun Google</b>. Formulir Email &amp; Sandi dikunci otomatis agar tidak terjadi pendaftaran ganda.</div>
            `;
        }
    }

    if (btnUnlockDevice) {
        btnUnlockDevice.classList.toggle('hidden-state', !reg.deviceLock);
    }

    if (lockedMethod === 'EMAIL') {
        if (inpEmail && !inpEmail.value && lockedEmail) {
            inpEmail.value = lockedEmail;
        }
        if (inpPwd) inpPwd.disabled = false;
        if (btnEmailSubmit) btnEmailSubmit.disabled = false;
        if (btnGoogle) {
            btnGoogle.disabled = true;
            btnGoogle.style.opacity = '0.42';
            btnGoogle.style.pointerEvents = 'none';
            btnGoogle.innerHTML = `<i class="fa-solid fa-lock text-amber-400"></i> <span class="text-[0.74rem] font-bold">Login Google Nonaktif (Gunakan Email &amp; Sandi)</span>`;
        }
    } else if (lockedMethod === 'GOOGLE') {
        if (inpPwd) inpPwd.disabled = true;
        if (btnEmailSubmit) {
            btnEmailSubmit.disabled = true;
            btnEmailSubmit.innerHTML = `<i class="fa-solid fa-lock mr-1.5"></i> Terkunci (Gunakan Tombol Login Google di Bawah)`;
        }
        if (tabReg) tabReg.classList.add('opacity-40', 'pointer-events-none');
        if (tabLogin) tabLogin.classList.add('opacity-40', 'pointer-events-none');
        if (btnGoogle) {
            btnGoogle.disabled = false;
            btnGoogle.style.opacity = '1';
            btnGoogle.style.pointerEvents = 'auto';
            btnGoogle.innerHTML = GOOGLE_IDENTITY_BTN_HTML;
        }
    }
}

export function hitungTemaBerdasarkanJamLokal(nowDate = new Date()) {
    const wib = getWaktuWibPresisi(nowDate);
    return (wib.hours >= 6 && wib.hours < 18) ? 'light' : 'dark';
}

export function getPreferensiTemaTersimpan() {
    try {
        const raw = localStorage.getItem(PANEL_THEME_KEY);
        if (raw === 'light' || raw === 'dark' || raw === 'auto') return raw;
    } catch (e) {}
    return 'auto';
}

export function terapkanTemaPanel(pref = 'auto', simpan = true) {
    const cleanPref = (pref === 'light' || pref === 'dark') ? pref : 'auto';
    if (simpan) {
        try { localStorage.setItem(PANEL_THEME_KEY, cleanPref); } catch (e) {}
    }

    const resolved = cleanPref === 'auto'
        ? hitungTemaBerdasarkanJamLokal(new Date())
        : cleanPref;

    document.documentElement.setAttribute('data-theme-pref', cleanPref);
    document.documentElement.setAttribute('data-theme', resolved);

    const metaTheme = document.querySelector('meta[name="theme-color"]');
    if (metaTheme) {
        metaTheme.setAttribute('content', resolved === 'light' ? '#F4F5F7' : '#121316');
    }

    document.querySelectorAll('.panel-theme-choice-btn').forEach(btn => {
        const val = btn.getAttribute('data-panel-theme');
        const active = val === cleanPref;
        btn.classList.toggle('border-orange-500', active);
        btn.classList.toggle('bg-orange-500/20', active);
        btn.classList.toggle('text-orange-300', active);
        btn.classList.toggle('border-white/10', !active);
        btn.classList.toggle('text-stone-300', !active);
    });

    const headerThemeBtn = document.getElementById('btn-header-theme-cycle');
    const headerThemeIcon = document.getElementById('header-theme-icon');
    const headerThemeLabel = document.getElementById('header-theme-label');
    if (headerThemeIcon) {
        if (cleanPref === 'auto') {
            headerThemeIcon.className = resolved === 'dark'
                ? 'fa-solid fa-wand-magic-sparkles text-amber-400 text-[0.7rem]'
                : 'fa-solid fa-wand-magic-sparkles text-orange-500 text-[0.7rem]';
        } else if (cleanPref === 'light') {
            headerThemeIcon.className = 'fa-solid fa-sun text-amber-500 text-[0.75rem]';
        } else {
            headerThemeIcon.className = 'fa-solid fa-moon text-amber-300 text-[0.75rem]';
        }
    }
    if (headerThemeLabel) {
        if (cleanPref === 'auto') {
            headerThemeLabel.textContent = resolved === 'dark' ? 'Otomatis•Malam' : 'Otomatis•Siang';
        } else if (cleanPref === 'light') {
            headerThemeLabel.textContent = 'Siang';
        } else {
            headerThemeLabel.textContent = 'Malam';
        }
    }
    if (headerThemeBtn) {
        headerThemeBtn.title = `Mode Tampilan: ${cleanPref.toUpperCase()} (Aktif: ${resolved === 'dark' ? 'Malam/Gelap' : 'Siang/Terang'}). Klik untuk mengganti.`;
    }

    const themeStatusNote = document.getElementById('theme-mode-active-explanation');
    if (themeStatusNote) {
        const nowHr = String(new Date().getHours()).padStart(2, '0') + ':' + String(new Date().getMinutes()).padStart(2, '0');
        if (cleanPref === 'auto') {
            themeStatusNote.innerHTML = `<i class="fa-solid fa-clock text-orange-400 mr-1"></i>Mode <b>Otomatis</b> aktif (Jam perangkat <b>${nowHr}</b>): Menggunakan tampilan <b>${resolved === 'dark' ? 'Malam (Gelap)' : 'Siang (Terang)'}</b>. Berubah otomatis pukul 06:00 &amp; 18:00.`;
        } else if (cleanPref === 'light') {
            themeStatusNote.innerHTML = `<i class="fa-solid fa-sun text-amber-400 mr-1"></i>Mode <b>Siang Manual</b> dikunci: Tampilan selalu terang sepanjang waktu.`;
        } else {
            themeStatusNote.innerHTML = `<i class="fa-solid fa-moon text-amber-300 mr-1"></i>Mode <b>Malam Manual</b> dikunci: Tampilan selalu gelap sepanjang waktu.`;
        }
    }
}

(function initPanelThemeBoot() {
    const saved = getPreferensiTemaTersimpan();
    terapkanTemaPanel(saved, false);

    if (autoThemeIntervalTimer) clearInterval(autoThemeIntervalTimer);
    autoThemeIntervalTimer = setInterval(() => {
        if (getPreferensiTemaTersimpan() === 'auto') {
            terapkanTemaPanel('auto', false);
        }
    }, 60 * 1000);

    document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible' && getPreferensiTemaTersimpan() === 'auto') {
            terapkanTemaPanel('auto', false);
        }
    });
})();

export function unlockAudioMerchant() {
    if (isAudioMerchantUnlocked) return;
    try {
        const AudioCtx = window.AudioContext || window.webkitAudioContext;
        if (AudioCtx) {
            if (!merchantAudioCtx) merchantAudioCtx = new AudioCtx();
            if (merchantAudioCtx.state === 'suspended') {
                merchantAudioCtx.resume().catch(() => {});
            }
        }
        isAudioMerchantUnlocked = true;
    } catch (e) {}
}
window.unlockAudioMerchant = unlockAudioMerchant;

export function mainkanNadaNotifikasiMerchant() {
    try {
        const AudioCtx = window.AudioContext || window.webkitAudioContext;
        if (!AudioCtx) return;
        if (!merchantAudioCtx) merchantAudioCtx = new AudioCtx();
        if (merchantAudioCtx.state === 'suspended') {
            merchantAudioCtx.resume().catch(() => {});
        }
        const now = merchantAudioCtx.currentTime;
        const osc = merchantAudioCtx.createOscillator();
        const gain = merchantAudioCtx.createGain();
        osc.type = 'sine';
        osc.frequency.setValueAtTime(587.33, now);
        osc.frequency.setValueAtTime(880, now + 0.12);
        gain.gain.setValueAtTime(0.12, now);
        gain.gain.exponentialRampToValueAtTime(0.001, now + 0.35);
        osc.connect(gain);
        gain.connect(merchantAudioCtx.destination);
        osc.start(now);
        osc.stop(now + 0.36);
    } catch (e) {}
}

['click', 'touchstart', 'pointerdown'].forEach((evtName) => {
    document.addEventListener(evtName, () => {
        if (!isAudioMerchantUnlocked) {
            unlockAudioMerchant();
        }
    }, { once: true, passive: true });
});

function sinkronkanUidMerchantKeServiceWorker(uid) {
    if (!uid) return;
    try {
        localStorage.setItem('japar_uid_merchant', uid);
    } catch (e) {}
    try {
        if ('serviceWorker' in navigator) {
            navigator.serviceWorker.ready.then((reg) => {
                if (reg && reg.active) {
                    reg.active.postMessage({ type: 'JAPAR_SET_MERCHANT_UID', uid: uid });
                }
            }).catch(() => {});
        }
    } catch (e) {}
}

export function bacaCacheProfilTerverifikasi(uid, emailKey) {
    try {
        const raw = localStorage.getItem(VERIFIED_CACHE_KEY);
        if (!raw) return null;
        const parsed = JSON.parse(raw);
        if (!parsed || parsed.uid !== uid || parsed.email !== emailKey) return null;
        if (!parsed.timestamp || (Date.now() - parsed.timestamp) >= VERIFIED_CACHE_TTL_MS) {
            localStorage.removeItem(VERIFIED_CACHE_KEY);
            return null;
        }
        const data = parsed.profileData;
        if (!data || !data.profile) {
            localStorage.removeItem(VERIFIED_CACHE_KEY);
            return null;
        }
        return data;
    } catch (e) {
        return null;
    }
}

export function simpanCacheProfilTerverifikasi(uid, emailKey, profileData) {
    try {
        if (!uid || !emailKey || !profileData) return;
        const payload = {
            uid: uid,
            email: emailKey,
            profileData: profileData,
            timestamp: Date.now()
        };
        localStorage.setItem(VERIFIED_CACHE_KEY, JSON.stringify(payload));
    } catch (e) {}
}

export function perbaruiCacheProfilTerverifikasi(partialProfile, itemsArray = null, newVersion = null) {
    try {
        const raw = localStorage.getItem(VERIFIED_CACHE_KEY);
        if (!raw) return;
        const parsed = JSON.parse(raw);
        if (!parsed || !parsed.profileData) return;
        if (partialProfile && typeof partialProfile === 'object') {
            parsed.profileData.profile = {
                ...(parsed.profileData.profile || {}),
                ...partialProfile
            };
        }
        if (Array.isArray(itemsArray)) {
            parsed.profileData.items = itemsArray;
        }
        if (typeof newVersion === 'number' && newVersion > 0) {
            parsed.profileData.v = newVersion;
        }
        parsed.timestamp = Date.now();
        localStorage.setItem(VERIFIED_CACHE_KEY, JSON.stringify(parsed));
    } catch (e) {}
}

function cekSesiCacheBootValid() {
    try {
        if (!localStorage.getItem('japar_merchant_session')) return false;
        const raw = localStorage.getItem(VERIFIED_CACHE_KEY);
        if (!raw) {
            localStorage.removeItem('japar_merchant_session');
            return false;
        }
        const parsed = JSON.parse(raw);
        if (!parsed || !parsed.uid || !parsed.email || !parsed.timestamp) {
            localStorage.removeItem('japar_merchant_session');
            return false;
        }
        if ((Date.now() - parsed.timestamp) >= VERIFIED_CACHE_TTL_MS) {
            localStorage.removeItem(VERIFIED_CACHE_KEY);
            localStorage.removeItem('japar_merchant_session');
            return false;
        }
        const data = parsed.profileData;
        if (!data || !data.profile) {
            localStorage.removeItem(VERIFIED_CACHE_KEY);
            localStorage.removeItem('japar_merchant_session');
            return false;
        }
        return true;
    } catch (e) {
        return false;
    }
}

let loginBootWatchdogTimer = null;

function hentikanWatchdogLoginBoot() {
    if (loginBootWatchdogTimer) {
        clearTimeout(loginBootWatchdogTimer);
        loginBootWatchdogTimer = null;
    }
}

function pastikanKapsulLoginAktif() {
    hentikanWatchdogLoginBoot();
    const loginViewEl = document.getElementById('state-login');
    if (loginViewEl) {
        loginViewEl.style.opacity = '1';
        loginViewEl.style.pointerEvents = 'auto';
    }
    pulihkanTombolLoginUI();
}

if (cekSesiCacheBootValid()) {
    const loginViewEl = document.getElementById('state-login');
    if (loginViewEl) {
        loginViewEl.style.opacity = '0';
        loginViewEl.style.pointerEvents = 'none';
    }
    loginBootWatchdogTimer = setTimeout(() => {
        const dashEl = document.getElementById('state-dashboard');
        const regEl = document.getElementById('state-registration');
        const rejEl = document.getElementById('state-rejected');
        const sudahPindah =
            (dashEl && !dashEl.classList.contains('hidden-state')) ||
            (regEl && !regEl.classList.contains('hidden-state')) ||
            (rejEl && !rejEl.classList.contains('hidden-state'));
        if (!sudahPindah) {
            pastikanKapsulLoginAktif();
            switchState('login');
        }
    }, 3500);
} else {
    const loginViewEl = document.getElementById('state-login');
    if (loginViewEl) {
        loginViewEl.style.opacity = '1';
        loginViewEl.style.pointerEvents = 'auto';
    }
}

export function switchState(stateName) {
    if (stateName !== 'login') {
        hentikanWatchdogLoginBoot();
    }
    ['login', 'rejected', 'registration', 'dashboard'].forEach(state => {
        const el = document.getElementById(`state-${state}`);
        if (el) el.classList.add('hidden-state');
    });

    const targetEl = document.getElementById(`state-${stateName}`);
    if (targetEl) {
        targetEl.classList.remove('hidden-state');
        if (stateName === 'login') {
            targetEl.style.opacity = '1';
            targetEl.style.pointerEvents = 'auto';
            sinkronkanVisualPenguncianMetodeLoginUI();
        }
    }
}

let popupWatchdogTimer = null;
let isLoginPopupInProgress = false;

function bersihkanWatchdogPopup() {
    isLoginPopupInProgress = false;
    if (popupWatchdogTimer) {
        clearTimeout(popupWatchdogTimer);
        popupWatchdogTimer = null;
    }
}

function pulihkanTombolLoginUI() {
    bersihkanWatchdogPopup();
    const btnGoogle = document.getElementById('btnGoogleLogin');
    if (btnGoogle) {
        btnGoogle.setAttribute('role', 'button');
        btnGoogle.setAttribute('aria-label', 'Masuk dengan Google');
        btnGoogle.innerHTML = GOOGLE_IDENTITY_BTN_HTML;
        btnGoogle.style.pointerEvents = 'auto';
        btnGoogle.style.opacity = '1';
        btnGoogle.disabled = false;
    }
    const btnBio = document.getElementById('btnBioLogin');
    if (btnBio) {
        btnBio.innerHTML = '<i class="fa-solid fa-fingerprint text-white text-lg"></i> Masuk dengan Biometrik';
        btnBio.style.pointerEvents = 'auto';
        btnBio.disabled = false;
    }
    const btnEmailSubmit = document.getElementById('btnSubmitPanelEmailAuth');
    if (btnEmailSubmit) {
        btnEmailSubmit.disabled = false;
        btnEmailSubmit.innerHTML = panelAuthMode === 'REGISTER'
            ? '<i class="fa-solid fa-user-plus mr-1.5"></i> Registrasi Email Pengelola'
            : '<i class="fa-solid fa-envelope-circle-check mr-1.5"></i> Masuk dengan Email &amp; Sandi';
    }
    sinkronkanVisualPenguncianMetodeLoginUI();
}

function getDocWithTimeout(docRef, timeoutMs = FIRESTORE_DOC_TIMEOUT_MS) {
    return Promise.race([
        getDoc(docRef),
        new Promise((_, reject) =>
            setTimeout(() => reject(new Error('Batas waktu koneksi server habis')), timeoutMs)
        )
    ]);
}

let currentUser = null;
let pendingUser = null;
let currentSessionId = null;

const REG_FORM_CONTROL_IDS = [
    'reg-kategori',
    'reg-nama-toko',
    'reg-pemilik',
    'reg-wa',
    'reg-alamat',
    'reg-gmaps-raw',
    'reg-lat',
    'reg-lng',
    'reg-jam',
    'reg-melayani-dinein',
    'reg-melayani-takeaway',
    'reg-wajib-dp',
    'reg-dp-min',
    'reg-ewallet-provider',
    'reg-ewallet-number',
    'reg-ewallet-name',
    'reg-bank-name',
    'reg-bank-number',
    'reg-bank-holder',
    'reg-kurir-warung',
    'reg-info-ongkir-warung',
    'btn-reg-paste-gmaps',
    'btn-reg-extract-gmaps',
    'btn-reg-use-gps',
    'btn-upload-reg-foto',
    'btn-upload-reg-qris'
];

setPersistence(authNode1, browserLocalPersistence).catch(() => {});
setPersistence(authNode2, browserLocalPersistence).catch(() => {});

getRedirectResult(authNode1).catch(() => {
    pulihkanTombolLoginUI();
});
getRedirectResult(authNode2).catch(() => {
    pulihkanTombolLoginUI();
});

async function verifikasiBiometrik() {
    const savedCredId = localStorage.getItem('japar_merchant_bio_id');
    if (!savedCredId || !window.PublicKeyCredential) return true;

    try {
        const challenge = new Uint8Array(32);
        window.crypto.getRandomValues(challenge);
        const rawId = Uint8Array.from(atob(savedCredId), c => c.charCodeAt(0));

        await navigator.credentials.get({
            publicKey: {
                challenge: challenge,
                allowCredentials: [{ type: "public-key", id: rawId }],
                userVerification: "required"
            }
        });
        return true;
    } catch (err) {
        return false;
    }
}

provider.setCustomParameters({ prompt: 'select_account' });

function aturModeTabAuthPanel(mode) {
    panelAuthMode = mode === 'REGISTER' ? 'REGISTER' : 'LOGIN';
    const isReg = panelAuthMode === 'REGISTER';

    const tabLogin = document.getElementById('tabPanelModeLogin');
    const tabReg = document.getElementById('tabPanelModeRegister');
    if (tabLogin) {
        tabLogin.className = !isReg
            ? 'flex-1 py-2 px-3 rounded-xl text-xs font-extrabold uppercase tracking-wider bg-orange-600 text-white shadow cursor-pointer transition-all'
            : 'flex-1 py-2 px-3 rounded-xl text-xs font-bold uppercase tracking-wider text-stone-300 hover:text-white cursor-pointer transition-all';
    }
    if (tabReg) {
        tabReg.className = isReg
            ? 'flex-1 py-2 px-3 rounded-xl text-xs font-extrabold uppercase tracking-wider bg-orange-600 text-white shadow cursor-pointer transition-all'
            : 'flex-1 py-2 px-3 rounded-xl text-xs font-bold uppercase tracking-wider text-stone-300 hover:text-white cursor-pointer transition-all';
    }

    const wrapConfirm = document.getElementById('wrapPanelConfirmPwd');
    const btnForgot = document.getElementById('btnPanelForgotPwd');
    if (wrapConfirm) wrapConfirm.classList.toggle('hidden-state', !isReg);
    if (btnForgot) btnForgot.classList.toggle('hidden-state', isReg);
    pulihkanTombolLoginUI();
}

async function cekWhitelistMerchantMurni(emailKey, nodeCtx = null, uid = '') {
    const activeCtx = nodeCtx || getActiveNodeContext();
    if (uid && isSuperAdminUid(uid)) {
        return {
            allowed: true,
            data: { allowed: true, isSuperAdmin: true, nodeId: activeCtx.nodeId },
            nodeId: activeCtx.nodeId
        };
    }
    if (!emailKey) return { allowed: false, data: null, nodeId: activeCtx.nodeId };
    const snap = await getDocWithTimeout(doc(activeCtx.dbFirestore, "whitelist_merchants", emailKey));
    if (!snap.exists()) return { allowed: false, data: null, nodeId: activeCtx.nodeId };
    const data = snap.data() || {};
    return { allowed: data.allowed !== false, data, nodeId: activeCtx.nodeId };
}

async function periksaKeberadaanMerchantAtauWhitelistDiNode(user, emailKey, nodeCtx) {
    if (!user || !nodeCtx) return { found: false, hasMerchantDoc: false, isWhitelisted: false, nodeCtx };
    if (isSuperAdminUid(user.uid)) {
        return {
            found: true,
            isSuperAdmin: true,
            hasMerchantDoc: false,
            isWhitelisted: true,
            nodeCtx
        };
    }
    try {
        const merchantSnap = await getDocWithTimeout(doc(nodeCtx.dbFirestore, "merchants", user.uid));
        if (merchantSnap.exists()) {
            return {
                found: true,
                hasMerchantDoc: true,
                isWhitelisted: true,
                merchantData: merchantSnap.data(),
                nodeCtx
            };
        }
    } catch (e) {}

    try {
        const wlCheck = await cekWhitelistMerchantMurni(emailKey, nodeCtx, user.uid);
        if (wlCheck.allowed) {
            return {
                found: true,
                hasMerchantDoc: false,
                isWhitelisted: true,
                whitelistData: wlCheck.data,
                nodeCtx
            };
        }
    } catch (e) {}

    return { found: false, hasMerchantDoc: false, isWhitelisted: false, nodeCtx };
}

/**
 * Menampilkan status Metode Login Eksklusif & Node Server Aktif di Dashboard
 */
function perbaruiStatusPenautanAkunDasbor(user, lockedAuthMethod = null, nodeId = null) {
    const infoEl = document.getElementById('dashboard-linked-providers-info');
    if (!user || !infoEl) return;

    const activeNodeId = nodeId || getActiveNodeContext().nodeId || 'N1';
    const method = lockedAuthMethod || deteksiMetodeProviderFirebaseUser(user);
    const badgeHtml = method === 'EMAIL'
        ? `<span class="px-2 py-0.5 rounded bg-orange-500/20 border border-orange-500/40 text-orange-300 font-extrabold text-[0.58rem] uppercase"><i class="fa-solid fa-envelope mr-1"></i>Terkunci: Email &amp; Sandi (${activeNodeId})</span>`
        : `<span class="px-2 py-0.5 rounded bg-emerald-500/20 border border-emerald-500/40 text-emerald-300 font-extrabold text-[0.58rem] uppercase"><i class="fa-brands fa-google mr-1"></i>Terkunci: Login Akun Google (${activeNodeId})</span>`;

    infoEl.innerHTML = `
        <div class="flex flex-col gap-1">
            <div class="flex items-center justify-between gap-2 flex-wrap">
                <span>Email Pengelola: <b class="text-amber-300 font-mono">${user.email || '-'}</b></span>
                ${badgeHtml}
            </div>
            <div class="text-[0.58rem] text-stone-400">
                <i class="fa-solid fa-shield-halved text-emerald-400 mr-1"></i><b>Proteksi Anti-Resto Ganda Aktif (Node ${activeNodeId}):</b> Akun resto ini dikunci secara eksklusif pada metode <b>${method === 'EMAIL' ? 'Email & Kata Sandi' : 'Login Akun Google'}</b> dan tidak dapat dicampur dengan metode lain.
            </div>
        </div>
    `;
}

/**
 * Cek Duplikasi Resto di Indeks Publik (`merchants_index`) lintas Node N1 & N2
 * agar tidak ada resto yang didaftarkan 2 kali dengan email atau metode login yang berbeda.
 */
async function cekDuplikasiRestoDiIndeksPublik(currentUid, namaTokoInput, waInput, latInput, lngInput) {
    const normInputName = normalisasiNamaRestoKunci(namaTokoInput);
    const normInputWa = normalisasiWaKunci(waInput);

    // 1. Cek di Registri Lokal terlebih dahulu (0 Kuota)
    const reg = bacaRegistriMetodeAuth();
    if (normInputName && reg.byStoreName[normInputName]) {
        const hit = reg.byStoreName[normInputName];
        if (hit.uid && hit.uid !== currentUid) {
            return {
                isDuplicate: true,
                reason: `Tempat usaha "${hit.storeName || namaTokoInput}" sudah terdaftar pada akun ${hit.email} dengan metode login ${hit.method === 'EMAIL' ? 'Email & Kata Sandi' : 'Akun Google'}.`
            };
        }
    }
    if (normInputWa && reg.byWa[normInputWa]) {
        const hitWa = reg.byWa[normInputWa];
        if (hitWa.uid && hitWa.uid !== currentUid) {
            return {
                isDuplicate: true,
                reason: `Nomor WhatsApp (${waInput}) sudah terdaftar untuk resto "${hitWa.storeName || 'Lain'}" pada akun ${hitWa.email} (Metode: ${hitWa.method === 'EMAIL' ? 'Email & Sandi' : 'Akun Google'}).`
            };
        }
    }

    // 2. Cek di RTDB `merchants_index` pada Node Aktif (Zero-Socket Simple REST GET)
    try {
        const allMerchants = await rtdbSimpleRestGet("merchants_index", getActiveNodeContext());
        if (allMerchants && typeof allMerchants === 'object') {
            for (const [otherUid, meta] of Object.entries(allMerchants)) {
                if (!meta || typeof meta !== 'object' || otherUid === currentUid) continue;
                const otherNameNorm = normalisasiNamaRestoKunci(meta.n || '');
                if (otherNameNorm && normInputName && otherNameNorm === normInputName) {
                    const methodHint = meta.am === 'E' ? 'Email & Kata Sandi' : (meta.am === 'G' ? 'Akun Google' : 'Akun Terdaftar');
                    return {
                        isDuplicate: true,
                        reason: `Tempat usaha dengan nama "${meta.n}" sudah terdaftar di sistem JAPAR (${methodHint}). Dilarang mendaftarkan resto yang sama secara ganda.`
                    };
                }
                const mLat = parseKoordinatAman(meta.lat);
                const mLng = parseKoordinatAman(meta.lng);
                if (!isNaN(mLat) && !isNaN(mLng) && !isNaN(latInput) && !isNaN(lngInput)) {
                    const distMeters = hitungJarakHaversine(latInput, lngInput, mLat, mLng);
                    if (distMeters < 15 && otherNameNorm && normInputName && (otherNameNorm.includes(normInputName) || normInputName.includes(otherNameNorm))) {
                        return {
                            isDuplicate: true,
                            reason: `Terdeteksi resto serupa ("${meta.n}") pada titik koordinat yang sama (< 15 meter). Gunakan akun resto Anda yang sudah ada.`
                        };
                    }
                }
            }
        }
    } catch (e) {}

    return { isDuplicate: false, reason: '' };
}

/**
 * Menghitung 5 karakter flag ketersediaan kelompok menu aktif (`UMCRP`) untuk bitmask `srv` (total 8 karakter):
 * - Karakter 3 (`U` atau `-`): Hidangan Utama (`HIDANGAN_UTAMA`)
 * - Karakter 4 (`M` atau `-`): Minuman & Kopi (`MINUMAN_KOPI`)
 * - Karakter 5 (`C` atau `-`): Camilan & Jajanan (`CAMILAN_JAJANAN`)
 * - Karakter 6 (`R` atau `-`): Roti, Kue & Oleh-Oleh (`ROTI_OLEH_OLEH`)
 * - Karakter 7 (`P` atau `-`): Paket Hemat & Combo / memiliki `desc`+`drk` (`PAKET_HEMAT`)
 */
export function hitungKodeMenuRingkasUntukSrv(itemsArr = [], kategoriUtama = 'HIDANGAN_UTAMA') {
    const normKatToko = normalisasiKategoriTokoJapar(kategoriUtama, itemsArr);
    const activeItems = Array.isArray(itemsArr)
        ? itemsArr.filter(it => it && it.s !== false)
        : [];

    let hasU = normKatToko === 'HIDANGAN_UTAMA';
    let hasM = normKatToko === 'MINUMAN_KOPI';
    let hasC = normKatToko === 'CAMILAN_JAJANAN';
    let hasR = normKatToko === 'ROTI_OLEH_OLEH';
    let hasP = normKatToko === 'PAKET_HEMAT';

    activeItems.forEach(it => {
        const normItemKat = klasifikasiKategoriMenuPintar(it.n || '', it.kat || '');
        if (normItemKat === 'Hidangan Utama') hasU = true;
        if (normItemKat === 'Minuman & Kopi') hasM = true;
        if (normItemKat === 'Camilan & Jajanan') hasC = true;
        if (normItemKat === 'Roti, Kue & Oleh-Oleh') hasR = true;
        if (normItemKat === 'Paket Hemat & Combo' || (Boolean(it.desc) && Boolean(it.drk))) hasP = true;
    });

    return `${hasU ? 'U' : '-'}${hasM ? 'M' : '-'}${hasC ? 'C' : '-'}${hasR ? 'R' : '-'}${hasP ? 'P' : '-'}`;
}

/**
 * Membangun indeks kata kunci unik (`kw` maks 95 karakter - Diet Byte RTDB)
 * dari nama menu aktif yang sudah dideduplikasi agar pencarian katalog di aplikasi publik berjalan 0 kuota Firestore.
 */
export function bangunRingkasanKataKunciMenu(itemsArr = []) {
    try {
        const tokens = new Set();
        if (Array.isArray(itemsArr)) {
            itemsArr.forEach(it => {
                if (!it || it.s === false) return;
                String(`${it.n || ''} ${it.desc || ''} ${it.drk || ''}`)
                    .toLowerCase()
                    .replace(/[^a-z0-9\s]/g, ' ')
                    .split(/\s+/)
                    .filter(w => w.length >= 3)
                    .forEach(w => tokens.add(w));
            });
        }
        return Array.from(tokens).join(' ').substring(0, 95).trim();
    } catch (e) {
        return '';
    }
}

/**
 * Membangun payload RTDB dengan Diet Byte Indeks RTDB (~220 Byte/Merchant) & Zero-Byte Overhead untuk field opsional
 */
export function bangunPayloadRtdbDariProfil(profileObj, versionTs, includeExtraKeys = true, itemsArr = null) {
    const p = profileObj || {};
    const activeNode = getActiveNodeContext();
    const itemsList = Array.isArray(itemsArr) ? itemsArr : [];
    const center = DEFAULT_CENTER_PARE || { lat: -7.768049, lng: 112.196514 };
    const pLat = parseKoordinatAman(p.lat);
    const pLng = parseKoordinatAman(p.lng);
    const lat = isValidIndonesiaCoord(pLat, pLng) ? Number(pLat.toFixed(6)) : Number(center.lat.toFixed(6));
    const lng = isValidIndonesiaCoord(pLat, pLng) ? Number(pLng.toFixed(6)) : Number(center.lng.toFixed(6));
    const gh = String(p.geohash || encodeGeohash(lat, lng, 6)).substring(0, 6);
    const kategori = normalisasiKategoriTokoJapar(p.kategori, itemsList);
    const rawNama = String(p.namaToko || 'Resto JAPAR').trim();
    const namaToko = (rawNama.length >= 2 ? rawNama : 'Resto JAPAR').substring(0, 60);
    const diskonToko = Math.min(99, Math.max(0, parseInt(p.diskonTokoPersen || 0, 10) || 0));
    const parsedHours = uraiRentangJamOperasional(p.jamBukaTutup || '08:00-21:00');
    const cleanDays = normalisasiArrayHariOperasional(p.hariOperasional);
    const hClean = parsedHours.normalized.substring(0, 35);
    const nodeCode = (p.nodeId === 'N2' || activeNode.nodeId === 'N2') ? 'N2' : 'N1';

    const char0 = p.melayaniDineIn !== false ? '1' : '0';
    const char1 = p.melayaniTakeaway !== false ? '1' : '0';
    const char2 = p.kurirWarungAktif === true ? '1' : '0';
    const menuFlags = hitungKodeMenuRingkasUntukSrv(itemsList, kategori);
    // Panjang `srv` adalah 8 karakter (`[DineIn][Takeaway][Delivery][U][M][C][R][P]`)
    const srvEncoded = `${char0}${char1}${char2}${menuFlags}`.substring(0, 8);

    const basePayload = {
        n: namaToko,
        c: kategori,
        lat: lat,
        lng: lng,
        gh: gh,
        o: Boolean(p.isOpen),
        h: hClean,
        v: Number(versionTs || Date.now()),
        nd: nodeCode,
        srv: srvEncoded
    };

    // Field opsional HANYA ditulis ke JSON RTDB jika bernilai aktif/tidak default (Zero-Byte Overhead):
    const promoSingkat = String(p.promoSingkat || '').trim().substring(0, 50);
    if (promoSingkat) {
        basePayload.pr = promoSingkat;
    }

    const cleanImg = bersihkanPublicIdCloudinary(p.fotoTokoPublicId || '').substring(0, 180);
    if (cleanImg) {
        basePayload.img = cleanImg;
    }

    const cleanAddr = String(p.alamat || '').trim().substring(0, 60);
    if (cleanAddr) {
        basePayload.addr = cleanAddr;
    }

    if (diskonToko > 0) {
        basePayload.dsc = Number(diskonToko);
    }

    if (p.wajibDp === true) {
        basePayload.dp = true;
    }

    if (
        p.skemaDiskonGlobal &&
        p.skemaDiskonGlobal !== 'MAX_BEST' &&
        (p.skemaDiskonGlobal === 'ITEM_OVERRIDE' || p.skemaDiskonGlobal === 'STACK_ADD')
    ) {
        basePayload.dm = p.skemaDiskonGlobal;
    }

    if (p.autoSchedule === true) {
        basePayload.as = true;
    }

    if (cleanDays.length > 0 && cleanDays.length < 7) {
        basePayload.hd = cleanDays.join(',').substring(0, 14);
    }

    if (includeExtraKeys) {
        const kwStr = bangunRingkasanKataKunciMenu(itemsList);
        if (kwStr) {
            basePayload.kw = kwStr;
        }
    }

    return basePayload;
}

/**
 * Menulis indeks resto ke RTDB menggunakan Murni HTTP REST API PUT (0 WebSocket)
 * dengan Diet Byte Indeks RTDB (~220 Byte/Merchant)
 */
export async function tulisAmanRtdbIndex(uid, profileObj, versionTs, itemsArr = null) {
    const targetNodeId = profileObj?.nodeId === 'N2' || profileObj?.nodeId === 'N1'
        ? profileObj.nodeId
        : getActiveNodeContext().nodeId;
    const activeNode = getNodeContextById(targetNodeId);
    const activeUser = activeNode.auth.currentUser || authNode1.currentUser || authNode2.currentUser || currentUser;

    let idToken = '';
    if (activeUser && typeof activeUser.getIdToken === 'function') {
        idToken = await activeUser.getIdToken(false);
    }

    const baseUrl = String(activeNode.config.databaseURL || '').replace(/\/+$/, '');
    const putUrl = `${baseUrl}/merchants_index/${encodeURIComponent(uid)}.json${idToken ? `?auth=${encodeURIComponent(idToken)}` : ''}`;

    const dietPayload = bangunPayloadRtdbDariProfil(profileObj, versionTs, true, itemsArr);
    const resp = await fetch(putUrl, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(dietPayload)
    });

    if (!resp.ok) {
        const fallbackPayload = bangunPayloadRtdbDariProfil(profileObj, versionTs, false, itemsArr);
        const retryResp = await fetch(putUrl, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(fallbackPayload)
        });
        if (!retryResp.ok) {
            const errText = await retryResp.text().catch(() => '');
            throw new Error(`RTDB PUT gagal (${retryResp.status}): ${errText}`);
        }
    }
    return true;
}

export async function jalankanPipelineValidasi(user, forceNetwork = false, explicitAttemptMethod = null, explicitNodeCtx = null) {
    currentUser = user;
    const emailKey = (user.email || '').toLowerCase().trim();
    const detectedAttemptMethod = explicitAttemptMethod || deteksiMetodeProviderFirebaseUser(user);

    let activeNode = explicitNodeCtx || getActiveNodeContext();
    if (user.uid === ROOT_ADMIN_UID_N2) {
        activeNode = setActiveNodeId('N2');
    } else if (user.uid === ROOT_ADMIN_UID_N1) {
        activeNode = setActiveNodeId('N1');
    }

    // 1. CEK PENGUNCIAN METODE LOGIN LOKAL SEBELUM LANJUT
    const registeredLocalMethod = getMetodeLoginAktifUntukEmail(emailKey);
    if (registeredLocalMethod && registeredLocalMethod !== detectedAttemptMethod && !isSuperAdminUid(user.uid)) {
        await keluarSemuaNodeAuth();
        pastikanKapsulLoginAktif();
        switchState('login');
        const labelLocked = registeredLocalMethod === 'EMAIL' ? 'Email & Kata Sandi' : 'Login Akun Google';
        const labelTried = detectedAttemptMethod === 'EMAIL' ? 'Email & Kata Sandi' : 'Login Akun Google';
        window.alert(
            `METODE LOGIN TERKUNCI (ANTI-DUPLIKASI): Akun "${emailKey}" sudah terdaftar menggunakan metode ${labelLocked}. Anda tidak dapat masuk menggunakan metode ${labelTried}. Silakan gunakan metode ${labelLocked}.`,
            "error"
        );
        return;
    }

    sinkronkanUidMerchantKeServiceWorker(user.uid);

    let rtdbExistingVal = null;
    if (!forceNetwork) {
        const cachedData = bacaCacheProfilTerverifikasi(user.uid, emailKey);
        if (cachedData && cachedData.profile) {
            const cachedNodeId = cachedData.profile.nodeId || getNodeTerkunciUntukEmail(emailKey) || activeNode.nodeId;
            activeNode = kunciIkatanNodeEmail(emailKey, cachedNodeId);
            cachedData.profile.nodeId = activeNode.nodeId;
            cachedData.profile.kategori = normalisasiKategoriTokoJapar(cachedData.profile.kategori, cachedData.items || []);
            const savedProfileAuthMethod = cachedData.profile.authMethod;
            if (savedProfileAuthMethod && savedProfileAuthMethod !== detectedAttemptMethod && !isSuperAdminUid(user.uid)) {
                await keluarSemuaNodeAuth();
                catatIkatanMetodeLoginResto(emailKey, savedProfileAuthMethod, user.uid, cachedData.profile.namaToko, cachedData.profile.wa, activeNode.nodeId);
                pastikanKapsulLoginAktif();
                switchState('login');
                window.alert(
                    `AKSES DITOLAK: Resto "${cachedData.profile.namaToko || emailKey}" dikunci pada metode login ${savedProfileAuthMethod === 'EMAIL' ? 'Email & Kata Sandi' : 'Akun Google'}.`,
                    "error"
                );
                return;
            }

            try {
                rtdbExistingVal = await rtdbSimpleRestGet("merchants_index/" + user.uid, activeNode);
                if (rtdbExistingVal && typeof rtdbExistingVal === 'object') {
                    const cachedV = Number(cachedData.v || 0);
                    if (Number(rtdbExistingVal.v) === cachedV) {
                        if (typeof rtdbExistingVal.o === 'boolean') {
                            cachedData.profile.isOpen = Boolean(rtdbExistingVal.o);
                        }
                        if (typeof rtdbExistingVal.as === 'boolean') {
                            cachedData.profile.autoSchedule = Boolean(rtdbExistingVal.as);
                        }
                        catatIkatanMetodeLoginResto(
                            emailKey,
                            savedProfileAuthMethod || detectedAttemptMethod,
                            user.uid,
                            cachedData.profile.namaToko,
                            cachedData.profile.wa,
                            activeNode.nodeId
                        );
                        perbaruiStatusPenautanAkunDasbor(user, savedProfileAuthMethod || detectedAttemptMethod, activeNode.nodeId);
                        pulihkanTombolLoginUI();
                        inisialisasiSesiMerchant(user.uid, cachedData);
                        return;
                    }
                }
            } catch (rtdbErr) {
                perbaruiStatusPenautanAkunDasbor(user, savedProfileAuthMethod || detectedAttemptMethod, activeNode.nodeId);
                pulihkanTombolLoginUI();
                inisialisasiSesiMerchant(user.uid, cachedData);
                return;
            }
        }
    }

    try {
        // Cek dokumen merchants/{uid} terlebih dahulu di node aktif (bebas kuota baca whitelist untuk akun yang sudah punya toko)
        const profileSnap = await getDocWithTimeout(doc(activeNode.dbFirestore, "merchants", user.uid));

        if (!profileSnap.exists()) {
            const whitelistCheck = await cekWhitelistMerchantMurni(emailKey, activeNode, user.uid);
            if (!whitelistCheck.allowed) {
                localStorage.removeItem(VERIFIED_CACHE_KEY);
                localStorage.removeItem('japar_merchant_session');
                pulihkanTombolLoginUI();
                const elRejectedEmail = document.getElementById('rejected-email-display');
                if (elRejectedEmail) {
                    elRejectedEmail.innerText = user.email || emailKey || 'Email tidak diketahui';
                }
                const btnWaRejected = document.getElementById('btn-wa-admin-rejected');
                if (btnWaRejected && (user.email || emailKey)) {
                    const pesanWa = `Halo Admin JAPAR (Jaringan Kuliner Pare), mohon daftarkan email saya (${user.email || emailKey}) ke dalam daftar akses Pengelola Resto (whitelist_merchants).`;
                    btnWaRejected.href = `https://wa.me/${ADMIN_WA_NUMBER}?text=${encodeURIComponent(pesanWa)}`;
                }
                switchState('rejected');
                return;
            }

            const wlMethod = String(whitelistCheck.data?.authMethod || '').toUpperCase();
            if ((wlMethod === 'EMAIL' || wlMethod === 'GOOGLE') && wlMethod !== detectedAttemptMethod && !isSuperAdminUid(user.uid)) {
                await keluarSemuaNodeAuth();
                catatIkatanMetodeLoginResto(emailKey, wlMethod, user.uid, '', '', activeNode.nodeId);
                pastikanKapsulLoginAktif();
                switchState('login');
                window.alert(
                    `METODE LOGIN TIDAK SESUAI: Email "${emailKey}" wajib menggunakan metode login ${wlMethod === 'EMAIL' ? 'Email & Kata Sandi' : 'Akun Google'}.`,
                    "error"
                );
                return;
            }

            localStorage.removeItem(VERIFIED_CACHE_KEY);
            localStorage.removeItem('japar_merchant_session');
            kunciIkatanNodeEmail(emailKey, activeNode.nodeId);
            catatIkatanMetodeLoginResto(emailKey, detectedAttemptMethod, user.uid, '', '', activeNode.nodeId);
            perbaruiStatusPenautanAkunDasbor(user, detectedAttemptMethod, activeNode.nodeId);
            pulihkanTombolLoginUI();
            const regEmailEl = document.getElementById('reg-email');
            if (regEmailEl) regEmailEl.value = user.email;
            bukaFormRegistrasi(detectedAttemptMethod);
            return;
        }

        const data = profileSnap.data() || {};
        const docAuthMethod = data.profile?.authMethod;

        if ((docAuthMethod === 'EMAIL' || docAuthMethod === 'GOOGLE') && docAuthMethod !== detectedAttemptMethod && !isSuperAdminUid(user.uid)) {
            await keluarSemuaNodeAuth();
            catatIkatanMetodeLoginResto(emailKey, docAuthMethod, user.uid, data.profile?.namaToko, data.profile?.wa, activeNode.nodeId);
            pastikanKapsulLoginAktif();
            switchState('login');
            window.alert(
                `AKSES DITOLAK (METODE LOGIN TERKUNCI): Resto "${data.profile?.namaToko || emailKey}" sudah terdaftar menggunakan metode ${docAuthMethod === 'EMAIL' ? 'Email & Kata Sandi' : 'Login Akun Google'}. Anda tidak dapat menggunakan metode ${detectedAttemptMethod === 'EMAIL' ? 'Email & Kata Sandi' : 'Login Akun Google'}.`,
                "error"
            );
            return;
        }

        const finalLockedMethod = (docAuthMethod === 'EMAIL' || docAuthMethod === 'GOOGLE')
            ? docAuthMethod
            : detectedAttemptMethod;
        if (!data.profile) data.profile = {};
        data.profile.authMethod = finalLockedMethod;
        data.profile.nodeId = activeNode.nodeId;
        data.profile.kategori = normalisasiKategoriTokoJapar(data.profile.kategori, Array.isArray(data.items) ? data.items : []);

        const versionTs = Number(data.v || Date.now());
        data.v = versionTs;

        kunciIkatanNodeEmail(emailKey, activeNode.nodeId);
        catatIkatanMetodeLoginResto(
            emailKey,
            finalLockedMethod,
            user.uid,
            data.profile.namaToko,
            data.profile.wa,
            activeNode.nodeId
        );
        perbaruiStatusPenautanAkunDasbor(user, finalLockedMethod, activeNode.nodeId);

        // Sinkronkan status isOpen & autoSchedule dari RTDB jika sudah ada di RTDB (karena saklar buka/tutup 0-kuota Firestore)
        try {
            if (!rtdbExistingVal) {
                rtdbExistingVal = await rtdbSimpleRestGet("merchants_index/" + user.uid, activeNode);
            }
            if (rtdbExistingVal && typeof rtdbExistingVal === 'object') {
                if (typeof rtdbExistingVal.o === 'boolean') {
                    data.profile.isOpen = Boolean(rtdbExistingVal.o);
                }
                if (typeof rtdbExistingVal.as === 'boolean') {
                    data.profile.autoSchedule = Boolean(rtdbExistingVal.as);
                }
            }
            const needRtdbWrite = !rtdbExistingVal ||
                Number(rtdbExistingVal.v) !== versionTs ||
                rtdbExistingVal.nd !== activeNode.nodeId;

            if (needRtdbWrite) {
                await tulisAmanRtdbIndex(user.uid, data.profile, versionTs, Array.isArray(data.items) ? data.items : []);
            }
        } catch (syncRtdbErr) {}

        pulihkanTombolLoginUI();
        simpanCacheProfilTerverifikasi(user.uid, emailKey, data);
        inisialisasiSesiMerchant(user.uid, data);
    } catch (err) {
        const errMsg = String(err && err.message ? err.message : err || '');
        pastikanKapsulLoginAktif();
        switchState('login');
        window.alert("Gagal memverifikasi akun pengelola resto: " + errMsg, "error");
    }
}

/**
 * Orkestrator Login & Registrasi Email/Sandi Multi-Node (N1 & N2)
 */
async function eksekusiAutentikasiEmailMultiNode(email, pwd, mode) {
    const cleanEmail = String(email || '').toLowerCase().trim();
    const candidateNodes = susunUrutanKandidatNodeUntukEmail(cleanEmail);
    let lastAuthError = null;

    isMultiNodeAuthProbeInProgress = true;
    try {
        if (mode === 'REGISTER') {
            let fallbackCreatedUser = null;
            let fallbackNodeCtx = candidateNodes[0];

            for (let idx = 0; idx < candidateNodes.length; idx++) {
                const nodeCtx = candidateNodes[idx];
                try {
                    let userOnNode = null;
                    try {
                        const createdCred = await createUserWithEmailAndPassword(nodeCtx.auth, cleanEmail, pwd);
                        userOnNode = createdCred?.user || null;
                    } catch (createErr) {
                        if (createErr?.code === 'auth/email-already-in-use') {
                            const signInCred = await signInWithEmailAndPassword(nodeCtx.auth, cleanEmail, pwd);
                            userOnNode = signInCred?.user || null;
                        } else {
                            throw createErr;
                        }
                    }

                    if (userOnNode) {
                        const checkRes = await periksaKeberadaanMerchantAtauWhitelistDiNode(userOnNode, cleanEmail, nodeCtx);
                        if (checkRes.found) {
                            // Kunci ikatan email -> nodeId karena ditemukan di whitelist_merchants atau merchants pada node ini
                            kunciIkatanNodeEmail(cleanEmail, nodeCtx.nodeId);
                            const otherNode = nodeCtx.nodeId === 'N1' ? FIREBASE_NODE_CONTEXTS.N2 : FIREBASE_NODE_CONTEXTS.N1;
                            if (otherNode.auth.currentUser) {
                                await signOut(otherNode.auth).catch(() => {});
                            }
                            return { user: userOnNode, nodeCtx };
                        }
                        if (!fallbackCreatedUser) {
                            fallbackCreatedUser = userOnNode;
                            fallbackNodeCtx = nodeCtx;
                        }
                        if (idx < candidateNodes.length - 1) {
                            await signOut(nodeCtx.auth).catch(() => {});
                        }
                    }
                } catch (nodeErr) {
                    lastAuthError = nodeErr;
                }
            }

            if (fallbackCreatedUser) {
                if (!fallbackNodeCtx.auth.currentUser) {
                    const reCred = await signInWithEmailAndPassword(fallbackNodeCtx.auth, cleanEmail, pwd);
                    return { user: reCred.user, nodeCtx: fallbackNodeCtx };
                }
                return { user: fallbackCreatedUser, nodeCtx: fallbackNodeCtx };
            }
            throw lastAuthError || new Error('Gagal mendaftarkan akun pengelola pada server.');
        } else {
            // Mode LOGIN: cek ikatan lokal lebih dulu, lalu N1 -> N2
            let firstAuthenticatedUser = null;
            let firstAuthenticatedNode = null;

            for (let idx = 0; idx < candidateNodes.length; idx++) {
                const nodeCtx = candidateNodes[idx];
                try {
                    const cred = await signInWithEmailAndPassword(nodeCtx.auth, cleanEmail, pwd);
                    if (cred && cred.user) {
                        const checkRes = await periksaKeberadaanMerchantAtauWhitelistDiNode(cred.user, cleanEmail, nodeCtx);
                        if (checkRes.found) {
                            kunciIkatanNodeEmail(cleanEmail, nodeCtx.nodeId);
                            const otherNode = nodeCtx.nodeId === 'N1' ? FIREBASE_NODE_CONTEXTS.N2 : FIREBASE_NODE_CONTEXTS.N1;
                            if (otherNode.auth.currentUser) {
                                await signOut(otherNode.auth).catch(() => {});
                            }
                            return { user: cred.user, nodeCtx };
                        }
                        if (!firstAuthenticatedUser) {
                            firstAuthenticatedUser = cred.user;
                            firstAuthenticatedNode = nodeCtx;
                        }
                        if (idx < candidateNodes.length - 1) {
                            await signOut(nodeCtx.auth).catch(() => {});
                        }
                    }
                } catch (loginErr) {
                    lastAuthError = loginErr;
                }
            }

            if (firstAuthenticatedUser && firstAuthenticatedNode) {
                if (!firstAuthenticatedNode.auth.currentUser) {
                    const reCred = await signInWithEmailAndPassword(firstAuthenticatedNode.auth, cleanEmail, pwd);
                    return { user: reCred.user, nodeCtx: firstAuthenticatedNode };
                }
                return { user: firstAuthenticatedUser, nodeCtx: firstAuthenticatedNode };
            }

            throw lastAuthError || new Error('Email atau kata sandi belum sesuai.');
        }
    } finally {
        isMultiNodeAuthProbeInProgress = false;
    }
}

let bootAuthSettledN1 = false;
let bootAuthSettledN2 = false;

function handleMultiNodeAuthStateChanged(nodeId, user) {
    if (nodeId === 'N1') bootAuthSettledN1 = true;
    if (nodeId === 'N2') bootAuthSettledN2 = true;

    if (isMultiNodeAuthProbeInProgress) return;

    const btnGoogle = document.getElementById('btnGoogleLogin');
    const btnBio = document.getElementById('btnBioLogin');
    const btnForceLogout = document.getElementById('btn-force-logout');
    const loginSubtitle = document.getElementById('login-subtitle');

    if (user && user.email) {
        const nodeCtx = setActiveNodeId(nodeId);
        bersihkanWatchdogPopup();
        sinkronkanUidMerchantKeServiceWorker(user.uid);
        const requiresBio = !!localStorage.getItem('japar_merchant_bio_id');
        if (requiresBio) {
            pendingUser = user;
            if (loginSubtitle) loginSubtitle.innerText = "PENGELOLA OPERASIONAL DAPUR & RESTO";
            if (btnGoogle) btnGoogle.classList.add('hidden-state');
            if (btnBio) btnBio.classList.remove('hidden-state');
            if (btnForceLogout) btnForceLogout.classList.remove('hidden-state');
            pastikanKapsulLoginAktif();
            switchState('login');

            if (document.visibilityState === 'visible' && btnBio) {
                setTimeout(() => { btnBio.click(); }, 300);
            }
        } else {
            if (loginSubtitle) loginSubtitle.innerText = "PENGELOLA OPERASIONAL DAPUR & RESTO";
            jalankanPipelineValidasi(user, false, null, nodeCtx);
        }
        return;
    }

    // Jika salah satu node melaporkan null, pastikan node sebelahnya juga tidak sedang memiliki sesi aktif
    const otherActiveUser = authNode1.currentUser || authNode2.currentUser;
    if (otherActiveUser) return;
    if (!bootAuthSettledN1 || !bootAuthSettledN2) return;

    pendingUser = null;
    localStorage.removeItem('japar_merchant_session');
    if (loginSubtitle) loginSubtitle.innerText = "PENGELOLA OPERASIONAL DAPUR & RESTO";
    if (btnBio) btnBio.classList.add('hidden-state');
    if (btnForceLogout) btnForceLogout.classList.add('hidden-state');
    if (btnGoogle) btnGoogle.classList.remove('hidden-state');
    pastikanKapsulLoginAktif();
    switchState('login');
}

onAuthStateChanged(authNode1, (user) => handleMultiNodeAuthStateChanged('N1', user));
onAuthStateChanged(authNode2, (user) => handleMultiNodeAuthStateChanged('N2', user));

document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && pendingUser) {
        const btnBio = document.getElementById('btnBioLogin');
        const loginViewEl = document.getElementById('state-login');
        if (loginViewEl && !loginViewEl.classList.contains('hidden-state') && btnBio && !btnBio.innerHTML.includes('MEMVERIFIKASI')) {
            setTimeout(() => { btnBio.click(); }, 150);
        }
    }
});

async function inisialisasiSesiMerchant(uid, profileData) {
    hentikanWatchdogLoginBoot();
    currentSessionId = localStorage.getItem('japar_merchant_session') || ("JSES_" + Date.now() + "_" + Math.random().toString(36).substring(2, 7));
    localStorage.setItem('japar_merchant_session', currentSessionId);
    sinkronkanUidMerchantKeServiceWorker(uid);

    switchState('dashboard');
    window.__JAPAR_MERCHANT_DATA_BUFFER = profileData;
    requestAnimationFrame(() => {
        setTimeout(() => window.dispatchEvent(new CustomEvent('merchantDataLoaded', { detail: profileData })), 50);
    });
}

export function sinkronkanTampilanSaklarWajibDpReg() {
    const chkWajibDp = document.getElementById('reg-wajib-dp');
    const dpMinWrap = document.getElementById('reg-dp-min-wrap');
    const infoBox = document.getElementById('reg-dp-scheme-info');
    const isWajib = chkWajibDp ? Boolean(chkWajibDp.checked) : true;

    if (dpMinWrap) {
        dpMinWrap.classList.toggle('hidden-state', !isWajib);
    }
    if (infoBox) {
        if (isWajib) {
            infoBox.className = 'text-[0.65rem] px-3 py-2 rounded-xl bg-amber-500/10 border border-amber-500/30 text-amber-300';
            infoBox.innerHTML = 'Mode Aktif: <b>Wajib DP / Transfer Awal</b>. Wajib mengisi minimal 1 metode pembayaran (Foto QRIS, E-Wallet, atau Rekening Bank).';
        } else {
            infoBox.className = 'text-[0.65rem] px-3 py-2 rounded-xl bg-emerald-500/10 border border-emerald-500/30 text-emerald-300';
            infoBox.innerHTML = 'Mode Aktif: <b>Tanpa DP (Bayar Tunai di Tempat / COD)</b>. Pelanggan dapat memesan langsung tanpa DP. Pengisian QRIS/E-Wallet/Bank bersifat opsional.';
        }
    }
}

function bukaFormRegistrasi(activeMethod = 'EMAIL') {
    switchState('registration');
    const alertBox = document.getElementById('reg-status-alert');
    const activeNode = getActiveNodeContext();
    const methodLabel = activeMethod === 'GOOGLE' ? 'Login Akun Google' : 'Email & Kata Sandi';
    if (alertBox) {
        alertBox.className = "mb-4 p-3 rounded-xl text-[0.72rem] text-center border border-emerald-500/40 text-emerald-200 bg-emerald-500/10";
        alertBox.innerHTML = `<i class="fa-solid fa-shield-halved mr-1"></i> <b>Email Terdaftar di ${activeNode.label} • Metode Login Dikunci ke [${methodLabel}]</b><br><span class="text-[0.64rem] text-stone-300">Lengkapi profil resto di bawah ini. Sistem otomatis memeriksa agar tidak ada resto yang didaftarkan ganda.</span>`;
    }

    const latEl = document.getElementById('reg-lat');
    const lngEl = document.getElementById('reg-lng');
    const center = DEFAULT_CENTER_PARE || { lat: -7.768049, lng: 112.196514 };
    if (latEl && !latEl.value) latEl.value = center.lat;
    if (lngEl && !lngEl.value) lngEl.value = center.lng;

    const dpMinEl = document.getElementById('reg-dp-min');
    if (dpMinEl) {
        dpMinEl.value = String(Math.max(5000, parseInt(dpMinEl.value || '10000', 10) || 10000));
    }

    sinkronkanTampilanSaklarWajibDpReg();

    REG_FORM_CONTROL_IDS.forEach(id => {
        const el = document.getElementById(id);
        if (el) el.disabled = false;
    });
    const btnSub = document.getElementById('btn-submit-reg');
    if (btnSub) btnSub.classList.remove('hidden-state');
}

function pasangHandlerUnggahCloudinary(btnId, fileInputId, hiddenInputId, previewImgId, statusElId, previewWidth = 400) {
    const btn = document.getElementById(btnId);
    const fileInp = document.getElementById(fileInputId);
    const hiddenInp = document.getElementById(hiddenInputId);
    const previewImg = document.getElementById(previewImgId);
    const statusEl = document.getElementById(statusElId);

    if (!btn || !fileInp) return;

    btn.addEventListener('click', () => {
        picuGetarSentuh(10);
        fileInp.value = '';
        fileInp.click();
    });

    fileInp.addEventListener('change', async (e) => {
        const file = e.target.files && e.target.files[0];
        if (!file) return;

        const origBtnHtml = btn.innerHTML;
        btn.disabled = true;
        btn.innerHTML = `<i class="fa-solid fa-circle-notch fa-spin"></i> Mengunggah...`;
        if (statusEl) {
            statusEl.className = 'text-[0.62rem] text-amber-300 font-bold';
            statusEl.textContent = 'Memproses gambar WebP & mengunggah...';
        }

        try {
            const res = await unggahGambarKeCloudinary(file);
            if (hiddenInp) hiddenInp.value = res.publicId;
            if (previewImg) {
                previewImg.src = previewWidth === 500 ? res.qrisPreviewUrl : res.previewUrl;
            }
            if (statusEl) {
                statusEl.className = 'text-[0.62rem] text-emerald-400 font-bold';
                statusEl.textContent = `Berhasil diunggah (${res.sizeKb} KB${res.fromCache ? ' • Cache Hemat Kuota' : ''})`;
            }
            window.showToast(`Foto berhasil diunggah (${res.sizeKb} KB).`, 'success');
        } catch (err) {
            if (statusEl) {
                statusEl.className = 'text-[0.62rem] text-red-400 font-bold';
                statusEl.textContent = 'Gagal mengunggah: ' + (err?.message || 'Periksa koneksi');
            }
            window.alert('Gagal mengunggah foto: ' + (err?.message || err), 'error');
        } finally {
            btn.disabled = false;
            btn.innerHTML = origBtnHtml;
        }
    });
}

(() => {
    const inisialisasiEventAuth = () => {
        sinkronkanVisualPenguncianMetodeLoginUI();

        const inpAuthEmail = document.getElementById('inputPanelAuthEmail');
        if (inpAuthEmail) {
            inpAuthEmail.addEventListener('input', () => {
                sinkronkanVisualPenguncianMetodeLoginUI();
            });
            inpAuthEmail.addEventListener('change', () => {
                sinkronkanVisualPenguncianMetodeLoginUI();
            });
        }

        const btnUnlockDevice = document.getElementById('btn-unlock-device-auth-method');
        if (btnUnlockDevice) {
            btnUnlockDevice.addEventListener('click', async () => {
                picuGetarSentuh(12);
                const yakin = await window.showConfirm(
                    'UBAH AKUN RESTO DI PERANGKAT INI?',
                    'Membuka ikatan perangkat hanya digunakan jika Anda ingin masuk ke akun resto yang berbeda. Catatan: Akun yang sudah terdaftar dengan Email tetap tidak bisa login dengan Google, dan sebaliknya.',
                    'Ya, Ganti Akun Resto',
                    false
                );
                if (!yakin) return;
                const reg = bacaRegistriMetodeAuth();
                reg.deviceLock = null;
                simpanRegistriMetodeAuth(reg);
                if (inpAuthEmail) inpAuthEmail.value = '';
                const tabLogin = document.getElementById('tabPanelModeLogin');
                const tabReg = document.getElementById('tabPanelModeRegister');
                if (tabLogin) tabLogin.classList.remove('opacity-40', 'pointer-events-none');
                if (tabReg) tabReg.classList.remove('opacity-40', 'pointer-events-none');
                pulihkanTombolLoginUI();
                window.showToast('Ikatan perangkat dibuka. Silakan masukkan akun resto Anda.', 'info');
            });
        }

        const tabPanelLoginEl = document.getElementById('tabPanelModeLogin');
        const tabPanelRegEl = document.getElementById('tabPanelModeRegister');
        if (tabPanelLoginEl) {
            tabPanelLoginEl.addEventListener('click', () => {
                picuGetarSentuh(10);
                aturModeTabAuthPanel('LOGIN');
            });
        }
        if (tabPanelRegEl) {
            tabPanelRegEl.addEventListener('click', () => {
                picuGetarSentuh(10);
                aturModeTabAuthPanel('REGISTER');
            });
        }

        const formPanelEmailAuth = document.getElementById('formPanelEmailAuth');
        if (formPanelEmailAuth) {
            formPanelEmailAuth.addEventListener('submit', async (e) => {
                e.preventDefault();
                unlockAudioMerchant();
                const email = (document.getElementById('inputPanelAuthEmail')?.value || '').trim().toLowerCase();
                const pwd = (document.getElementById('inputPanelAuthPassword')?.value || '');
                const confirmPwd = (document.getElementById('inputPanelAuthConfirmPassword')?.value || '');

                if (!email || !email.includes('@')) {
                    return window.alert("Masukkan alamat email pengelola yang valid.", "warning");
                }

                const knownMethod = getMetodeLoginAktifUntukEmail(email);
                if (knownMethod === 'GOOGLE') {
                    sinkronkanVisualPenguncianMetodeLoginUI();
                    return window.alert(
                        `METODE LOGIN TERKUNCI: Email "${email}" sudah terdaftar menggunakan metode Login Akun Google. Anda tidak dapat menggunakan metode Email & Kata Sandi untuk akun ini.`,
                        "error"
                    );
                }

                if (!pwd || pwd.length < 6) {
                    return window.alert("Kata sandi minimal 6 karakter.", "warning");
                }
                if (panelAuthMode === 'REGISTER' && pwd !== confirmPwd) {
                    return window.alert("Konfirmasi kata sandi belum cocok.", "warning");
                }

                const btnSub = document.getElementById('btnSubmitPanelEmailAuth');
                if (btnSub) {
                    btnSub.disabled = true;
                    btnSub.innerHTML = '<i class="fa-solid fa-circle-notch fa-spin mr-1.5"></i> Memverifikasi Server Node &amp; Akun...';
                }

                try {
                    try {
                        sessionStorage.setItem(SESSION_ATTEMPT_METHOD_KEY, 'EMAIL');
                    } catch (e2) {}

                    const candidateNodes = susunUrutanKandidatNodeUntukEmail(email);
                    try {
                        const signInMethods = await fetchSignInMethodsForEmail(candidateNodes[0].auth, email);
                        if (Array.isArray(signInMethods)) {
                            if (signInMethods.includes('google.com') && !signInMethods.includes('password')) {
                                catatIkatanMetodeLoginResto(email, 'GOOGLE', '', '', '', candidateNodes[0].nodeId);
                                pulihkanTombolLoginUI();
                                return window.alert(
                                    `METODE LOGIN DITOLAK: Email "${email}" sudah terdaftar menggunakan Login Akun Google. Demi mencegah duplikasi resto, gunakan tombol "Masuk dengan Akun Google".`,
                                    "error"
                                );
                            }
                        }
                    } catch (enumErr) {}

                    const authRes = await eksekusiAutentikasiEmailMultiNode(email, pwd, panelAuthMode);
                    if (authRes && authRes.user && authRes.nodeCtx) {
                        const targetNode = authRes.nodeCtx;
                        kunciIkatanNodeEmail(email, targetNode.nodeId);
                        catatIkatanMetodeLoginResto(email, 'EMAIL', authRes.user.uid, '', '', targetNode.nodeId);
                        await jalankanPipelineValidasi(authRes.user, panelAuthMode === 'REGISTER', 'EMAIL', targetNode);
                    }
                } catch (err) {
                    pulihkanTombolLoginUI();
                    const code = String(err?.code || '');
                    if (code === 'auth/email-already-in-use') {
                        aturModeTabAuthPanel('LOGIN');
                        window.alert(
                            `Email "${email}" sudah pernah terdaftar. Jika sebelumnya Anda mendaftar dengan Email & Sandi, silakan langsung masuk pada tab "Masuk Akun". Jika sebelumnya memakai Akun Google, gunakan tombol "Masuk dengan Akun Google".`,
                            "warning"
                        );
                    } else {
                        window.alert("Otentikasi Email Gagal: " + (err?.message || err), "error");
                    }
                }
            });
        }

        const btnPanelForgotPwd = document.getElementById('btnPanelForgotPwd');
        if (btnPanelForgotPwd) {
            btnPanelForgotPwd.addEventListener('click', async () => {
                const email = (document.getElementById('inputPanelAuthEmail')?.value || '').trim().toLowerCase();
                if (!email || !email.includes('@')) {
                    return window.alert("Ketik alamat email Anda terlebih dahulu pada kolom Email.", "warning");
                }
                const knownMethod = getMetodeLoginAktifUntukEmail(email);
                if (knownMethod === 'GOOGLE') {
                    return window.alert(`Email "${email}" menggunakan metode Login Akun Google (tanpa kata sandi lokal). Silakan masuk melalui tombol Login Google.`, "warning");
                }
                try {
                    const candidateNodes = susunUrutanKandidatNodeUntukEmail(email);
                    let sent = false;
                    let lastErr = null;
                    for (const nodeCtx of candidateNodes) {
                        try {
                            await sendPasswordResetEmail(nodeCtx.auth, email);
                            sent = true;
                            break;
                        } catch (e) {
                            lastErr = e;
                        }
                    }
                    if (!sent && lastErr) throw lastErr;
                    window.alert("Tautan pemulihan kata sandi telah dikirim ke " + email, "success");
                } catch (err) {
                    window.alert("Gagal mengirim email pemulihan: " + (err?.message || err), "error");
                }
            });
        }

        const btnGoogleLoginEl = document.getElementById('btnGoogleLogin');
        if (btnGoogleLoginEl) {
            btnGoogleLoginEl.addEventListener('click', (e) => {
                unlockAudioMerchant();
                const typedEmail = (document.getElementById('inputPanelAuthEmail')?.value || '').trim().toLowerCase();
                const knownMethod = getMetodeLoginAktifUntukEmail(typedEmail);
                if (knownMethod === 'EMAIL') {
                    sinkronkanVisualPenguncianMetodeLoginUI();
                    return window.alert(
                        `METODE LOGIN TERKUNCI: Akun resto ini sudah menggunakan metode Email & Kata Sandi. Anda tidak dapat menggunakan Login Google.`,
                        "error"
                    );
                }

                try {
                    sessionStorage.setItem(SESSION_ATTEMPT_METHOD_KEY, 'GOOGLE');
                } catch (e2) {}

                const reg = bacaRegistriMetodeAuth();
                const preferredNodeId = getNodeTerkunciUntukEmail(typedEmail) || reg.deviceLock?.nodeId || 'N1';
                const primaryNode = getNodeContextById(preferredNodeId);
                const secondaryNode = primaryNode.nodeId === 'N1' ? FIREBASE_NODE_CONTEXTS.N2 : FIREBASE_NODE_CONTEXTS.N1;

                const btn = e.currentTarget;
                btn.innerHTML = '<i class="fa-solid fa-circle-notch fa-spin"></i> <span class="tracking-wide text-[0.86rem] font-bold">Memverifikasi Akun Google...</span>';
                btn.style.pointerEvents = 'none';
                btn.style.opacity = '0.8';
                isLoginPopupInProgress = true;
                isMultiNodeAuthProbeInProgress = true;

                if (popupWatchdogTimer) clearTimeout(popupWatchdogTimer);
                popupWatchdogTimer = setTimeout(() => {
                    if (isLoginPopupInProgress && !authNode1.currentUser && !authNode2.currentUser) {
                        isMultiNodeAuthProbeInProgress = false;
                        pulihkanTombolLoginUI();
                    }
                }, 12000);

                signInWithPopup(primaryNode.auth, provider)
                    .then(async (cred) => {
                        bersihkanWatchdogPopup();
                        if (!cred || !cred.user) {
                            isMultiNodeAuthProbeInProgress = false;
                            pulihkanTombolLoginUI();
                            return;
                        }

                        const gEmail = (cred.user.email || '').toLowerCase().trim();
                        const providers = Array.isArray(cred.user.providerData) ? cred.user.providerData : [];
                        const hasPasswordProvider = providers.some(p => p && p.providerId === 'password');
                        const lockedForEmail = getMetodeLoginAktifUntukEmail(gEmail);

                        if ((hasPasswordProvider || lockedForEmail === 'EMAIL') && !isSuperAdminUid(cred.user.uid)) {
                            isMultiNodeAuthProbeInProgress = false;
                            await keluarSemuaNodeAuth();
                            catatIkatanMetodeLoginResto(gEmail, 'EMAIL', '', '', '', primaryNode.nodeId);
                            pulihkanTombolLoginUI();
                            window.alert(
                                `AKSES GOOGLE DITOLAK: Email "${gEmail}" sudah terdaftar menggunakan metode Email & Kata Sandi. Sesuai aturan anti-duplikasi JAPAR, silakan masuk menggunakan kolom Email & Kata Sandi.`,
                                "error"
                            );
                            return;
                        }

                        // Cek keberadaan dokumen merchants/{uid} atau whitelist_merchants/{email} di primaryNode
                        const boundNodeForGoogleEmail = getNodeTerkunciUntukEmail(gEmail);
                        if (boundNodeForGoogleEmail && boundNodeForGoogleEmail !== primaryNode.nodeId) {
                            // Email sudah terikat pada node sebelah, coba otentikasi credential ke secondaryNode
                            try {
                                const gCred = GoogleAuthProvider.credentialFromResult(cred);
                                if (gCred) {
                                    const cred2 = await signInWithCredential(secondaryNode.auth, gCred);
                                    if (cred2 && cred2.user) {
                                        await signOut(primaryNode.auth).catch(() => {});
                                        kunciIkatanNodeEmail(gEmail, secondaryNode.nodeId);
                                        isMultiNodeAuthProbeInProgress = false;
                                        await jalankanPipelineValidasi(cred2.user, false, 'GOOGLE', secondaryNode);
                                        return;
                                    }
                                }
                            } catch (switchErr) {}
                        }

                        const checkPrimary = await periksaKeberadaanMerchantAtauWhitelistDiNode(cred.user, gEmail, primaryNode);
                        if (checkPrimary.found) {
                            kunciIkatanNodeEmail(gEmail, primaryNode.nodeId);
                            isMultiNodeAuthProbeInProgress = false;
                            await jalankanPipelineValidasi(cred.user, false, 'GOOGLE', primaryNode);
                            return;
                        }

                        // Jika tidak ditemukan di primaryNode, coba alihkan ke secondaryNode (N2)
                        try {
                            const gCred = GoogleAuthProvider.credentialFromResult(cred);
                            if (gCred) {
                                const cred2 = await signInWithCredential(secondaryNode.auth, gCred);
                                if (cred2 && cred2.user) {
                                    const checkSecondary = await periksaKeberadaanMerchantAtauWhitelistDiNode(cred2.user, gEmail, secondaryNode);
                                    if (checkSecondary.found) {
                                        await signOut(primaryNode.auth).catch(() => {});
                                        kunciIkatanNodeEmail(gEmail, secondaryNode.nodeId);
                                        isMultiNodeAuthProbeInProgress = false;
                                        await jalankanPipelineValidasi(cred2.user, false, 'GOOGLE', secondaryNode);
                                        return;
                                    }
                                    await signOut(secondaryNode.auth).catch(() => {});
                                }
                            }
                        } catch (secErr) {}

                        isMultiNodeAuthProbeInProgress = false;
                        await jalankanPipelineValidasi(cred.user, false, 'GOOGLE', primaryNode);
                    })
                    .catch(error => {
                        isMultiNodeAuthProbeInProgress = false;
                        pulihkanTombolLoginUI();
                        if (error.code === 'auth/account-exists-with-different-credential') {
                            const conflictEmail = error.customData?.email || typedEmail || 'Email Anda';
                            catatIkatanMetodeLoginResto(conflictEmail, 'EMAIL', '', '', '', primaryNode.nodeId);
                            window.alert(
                                `METODE LOGIN TERKUNCI: Akun "${conflictEmail}" sudah terdaftar dengan metode Email & Kata Sandi. Anda tidak dapat masuk menggunakan Login Google.`,
                                "error"
                            );
                        } else if (error.code === 'auth/popup-blocked' || error.code === 'auth/web-storage-unsupported') {
                            signInWithRedirect(primaryNode.auth, provider);
                        } else if (error.code !== 'auth/popup-closed-by-user' && error.code !== 'auth/cancelled-popup-request') {
                            window.alert("Otorisasi Google Gagal: " + error.message, "error");
                        }
                    });
            });
        }

        const btnBioLoginEl = document.getElementById('btnBioLogin');
        if (btnBioLoginEl) {
            btnBioLoginEl.addEventListener('click', async () => {
                unlockAudioMerchant();
                if (!pendingUser) return;
                const btn = document.getElementById('btnBioLogin');
                btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> MEMVERIFIKASI...';

                const lolos = await verifikasiBiometrik();
                if (lolos) {
                    btn.innerHTML = '<i class="fa-solid fa-check"></i> BERHASIL';
                    jalankanPipelineValidasi(pendingUser, false, null, getActiveNodeContext());
                } else {
                    btn.innerHTML = '<i class="fa-solid fa-fingerprint text-white text-lg"></i> Masuk dengan Biometrik';
                    window.alert("Verifikasi biometrik dibatalkan atau belum sesuai.", "error");
                }
            });
        }

        const btnForceLogoutEl = document.getElementById('btn-force-logout');
        if (btnForceLogoutEl) {
            btnForceLogoutEl.addEventListener('click', () => {
                localStorage.removeItem('japar_merchant_bio_id');
                localStorage.removeItem('japar_merchant_session');
                localStorage.removeItem('japar_uid_merchant');
                localStorage.removeItem(VERIFIED_CACHE_KEY);
                pulihkanTombolLoginUI();
                keluarSemuaNodeAuth();
            });
        }

        const btnBackLoginEl = document.getElementById('btn-back-login');
        if (btnBackLoginEl) {
            btnBackLoginEl.addEventListener('click', () => {
                localStorage.removeItem(VERIFIED_CACHE_KEY);
                localStorage.removeItem('japar_merchant_session');
                pulihkanTombolLoginUI();
                keluarSemuaNodeAuth().then(() => switchState('login')).catch(() => switchState('login'));
            });
        }

        document.querySelectorAll('.btn-logout').forEach(btn => {
            btn.addEventListener('click', async () => {
                const confirmOut = await window.showConfirm(
                    'KELUAR AKUN PENGELOLA',
                    'Keluar dari JAPAR Panel? Metode login & node server akun resto Anda tetap dikunci dengan aman agar tidak terjadi duplikasi.',
                    'Ya, Keluar',
                    true
                );
                if (!confirmOut) return;

                localStorage.removeItem('japar_merchant_bio_id');
                localStorage.removeItem('japar_merchant_session');
                localStorage.removeItem('japar_uid_merchant');
                localStorage.removeItem(VERIFIED_CACHE_KEY);
                pulihkanTombolLoginUI();
                await keluarSemuaNodeAuth();
            });
        });

        const chkRegWajibDp = document.getElementById('reg-wajib-dp');
        if (chkRegWajibDp) {
            chkRegWajibDp.addEventListener('change', () => {
                picuGetarSentuh(10);
                sinkronkanTampilanSaklarWajibDpReg();
            });
        }

        document.querySelectorAll('[data-reg-outlet-preset]').forEach(btn => {
            btn.addEventListener('click', () => {
                picuGetarSentuh(10);
                const preset = btn.getAttribute('data-reg-outlet-preset');
                const chkDineIn = document.getElementById('reg-melayani-dinein');
                const chkTakeaway = document.getElementById('reg-melayani-takeaway');
                const chkKurir = document.getElementById('reg-kurir-warung');
                if (preset === 'RUMAHAN') {
                    if (chkDineIn) chkDineIn.checked = false;
                    if (chkTakeaway) chkTakeaway.checked = true;
                    if (chkKurir) chkKurir.checked = true;
                } else {
                    if (chkDineIn) chkDineIn.checked = true;
                    if (chkTakeaway) chkTakeaway.checked = true;
                }
            });
        });

        const regDpMinInput = document.getElementById('reg-dp-min');
        if (regDpMinInput) {
            regDpMinInput.addEventListener('change', (e) => {
                const val = Math.max(5000, parseInt(e.target.value || '10000', 10) || 10000);
                e.target.value = String(val);
            });
        }

        pasangHandlerUnggahCloudinary('btn-upload-reg-foto', 'file-reg-foto', 'reg-foto-cloudinary', 'reg-foto-preview', 'status-upload-reg-foto', 400);
        pasangHandlerUnggahCloudinary('btn-upload-reg-qris', 'file-reg-qris', 'reg-qris-cloudinary', 'reg-qris-preview', 'status-upload-reg-qris', 500);

        const btnRegPasteGmaps = document.getElementById('btn-reg-paste-gmaps');
        const inpRegGmapsRaw = document.getElementById('reg-gmaps-raw');
        const btnRegExtractGmaps = document.getElementById('btn-reg-extract-gmaps');
        const regPreviewBox = document.getElementById('reg-gmaps-preview');
        const mainPreviewBox = document.getElementById('merchant-gmaps-preview');

        if (btnRegPasteGmaps && inpRegGmapsRaw) {
            btnRegPasteGmaps.addEventListener('click', async () => {
                picuGetarSentuh(10);
                try {
                    if (navigator.clipboard && typeof navigator.clipboard.readText === 'function') {
                        const clipText = await navigator.clipboard.readText();
                        if (clipText && clipText.trim()) {
                            inpRegGmapsRaw.value = clipText.trim();
                            if (btnRegExtractGmaps) btnRegExtractGmaps.click();
                            return;
                        }
                    }
                    if (inpRegGmapsRaw.value && inpRegGmapsRaw.value.trim() && btnRegExtractGmaps) {
                        btnRegExtractGmaps.click();
                        return;
                    }
                    inpRegGmapsRaw.focus();
                    window.showToast('Tekan tahan pada kolom lalu pilih Tempel (Paste), kemudian ketuk Ekstrak.', 'info');
                } catch (e) {
                    if (inpRegGmapsRaw.value && inpRegGmapsRaw.value.trim() && btnRegExtractGmaps) {
                        btnRegExtractGmaps.click();
                        return;
                    }
                    inpRegGmapsRaw.focus();
                    window.showToast('Tekan tahan pada kolom lalu pilih Tempel (Paste), kemudian ketuk Ekstrak.', 'info');
                }
            });
        }

        if (btnRegExtractGmaps) {
            btnRegExtractGmaps.addEventListener('click', async () => {
                picuGetarSentuh(12);
                let raw = (document.getElementById('reg-gmaps-raw')?.value || '').trim();
                if (!raw && navigator.clipboard && typeof navigator.clipboard.readText === 'function') {
                    try {
                        const clip = await navigator.clipboard.readText();
                        if (clip && clip.trim()) {
                            raw = clip.trim();
                            if (inpRegGmapsRaw) inpRegGmapsRaw.value = raw;
                        }
                    } catch (e) {}
                }
                if (!raw) {
                    return window.alert("Tempelkan Link Google Maps (maps.app.goo.gl), Kode Plus (Plus Code), atau angka koordinat terlebih dahulu.", "warning");
                }
                const origHtml = btnRegExtractGmaps.innerHTML;
                btnRegExtractGmaps.disabled = true;
                btnRegExtractGmaps.innerHTML = '<i class="fa-solid fa-circle-notch fa-spin mr-1"></i> Mengekstrak Jalan...';
                try {
                    const hasil = await ekstrakKoordinatDariTeksAtauLinkGmaps(raw);
                    if (hasil && isValidIndonesiaCoord(hasil.lat, hasil.lng)) {
                        const latEl = document.getElementById('reg-lat');
                        const lngEl = document.getElementById('reg-lng');
                        if (latEl) latEl.value = hasil.lat.toFixed(6);
                        if (lngEl) lngEl.value = hasil.lng.toFixed(6);

                        const extractedAddr = isikanOtomatisKolomAlamatResto(hasil, 'reg-alamat');
                        isikanOtomatisKolomAlamatResto(hasil, 'store-input-alamat');
                        renderKotakPreviewLokasiGmaps(regPreviewBox, hasil);
                        renderKotakPreviewLokasiGmaps(mainPreviewBox, hasil);

                        window.showToast(
                            extractedAddr
                                ? `Lokasi & Alamat berhasil diisi otomatis: ${extractedAddr}`
                                : `Koordinat resto ditetapkan: ${hasil.lat.toFixed(5)}, ${hasil.lng.toFixed(5)}`,
                            "success"
                        );
                    } else {
                        window.alert("Koordinat belum terbaca dari input tersebut. Pastikan menempelkan Link Bagikan Google Maps (maps.app.goo.gl), Kode Plus (contoh: 75JX+8J Pare, Kediri), atau angka -7.xxxx, 112.xxxx.", "warning");
                    }
                } finally {
                    btnRegExtractGmaps.disabled = false;
                    btnRegExtractGmaps.innerHTML = origHtml;
                }
            });
        }

        const btnRegUseGps = document.getElementById('btn-reg-use-gps');
        if (btnRegUseGps) {
            btnRegUseGps.addEventListener('click', () => {
                if (!navigator.geolocation) {
                    return window.alert("Perangkat tidak mendukung sensor GPS.", "error");
                }
                const origGpsHtml = btnRegUseGps.innerHTML;
                btnRegUseGps.disabled = true;
                btnRegUseGps.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Membaca GPS & Nama Jalan...';
                navigator.geolocation.getCurrentPosition(
                    async (geoCoord) => {
                        try {
                            const lat = geoCoord.coords.latitude;
                            const lng = geoCoord.coords.longitude;
                            const latEl = document.getElementById('reg-lat');
                            const lngEl = document.getElementById('reg-lng');
                            if (latEl) latEl.value = lat.toFixed(6);
                            if (lngEl) lngEl.value = lng.toFixed(6);

                            const revRes = await resolusiNamaJalanKoordinatViaGas(lat, lng);
                            const mergedGps = {
                                lat: Number(lat.toFixed(6)),
                                lng: Number(lng.toFixed(6)),
                                geohash: encodeGeohash(lat, lng, 6),
                                address: revRes ? (revRes.address || revRes.shortStreet || '') : '',
                                shortStreet: revRes ? (revRes.shortStreet || revRes.address || '') : '',
                                street: revRes ? (revRes.street || '') : '',
                                subdistrict: revRes ? (revRes.subdistrict || '') : '',
                                city: revRes ? (revRes.city || '') : '',
                                fromCache: Boolean(revRes && revRes.fromCache)
                            };
                            const filledAddr = isikanOtomatisKolomAlamatResto(mergedGps, 'reg-alamat');
                            isikanOtomatisKolomAlamatResto(mergedGps, 'store-input-alamat');
                            renderKotakPreviewLokasiGmaps(regPreviewBox, mergedGps);
                            renderKotakPreviewLokasiGmaps(mainPreviewBox, mergedGps);

                            window.showToast(
                                filledAddr
                                    ? `GPS & Nama Jalan diterapkan: ${filledAddr}`
                                    : "Titik koordinat GPS perangkat berhasil diambil.",
                                "success"
                            );
                        } finally {
                            btnRegUseGps.disabled = false;
                            btnRegUseGps.innerHTML = origGpsHtml;
                        }
                    },
                    (err) => {
                        btnRegUseGps.disabled = false;
                        btnRegUseGps.innerHTML = origGpsHtml;
                        window.alert("Gagal membaca GPS: " + err.message, "warning");
                    },
                    { enableHighAccuracy: true, timeout: 10000, maximumAge: 60000 }
                );
            });
        }

        // Dual-Write Registrasi Awal ke Firestore + RTDB pada Node Aktif dengan Proteksi Anti-Resto Ganda
        const btnSubmitReg = document.getElementById('btn-submit-reg');
        if (btnSubmitReg) {
            btnSubmitReg.addEventListener('click', async () => {
                if (!currentUser) return;
                const activeNode = getActiveNodeContext();

                const rawKategori = (document.getElementById('reg-kategori')?.value || 'HIDANGAN_UTAMA').trim().toUpperCase();
                const cleanKategori = normalisasiKategoriTokoJapar(rawKategori, []);
                const namaToko = (document.getElementById('reg-nama-toko')?.value || '').trim();
                const pemilik = (document.getElementById('reg-pemilik')?.value || '').trim();
                const waRaw = (document.getElementById('reg-wa')?.value || '').trim().replace(/[^0-9]/g, '');
                let alamat = (document.getElementById('reg-alamat')?.value || '').trim();
                const rawJam = (document.getElementById('reg-jam')?.value || '08:00-21:00').trim();
                const parsedHours = uraiRentangJamOperasional(rawJam);
                const jamBukaTutup = parsedHours.normalized;
                const fotoTokoPublicId = bersihkanPublicIdCloudinary(document.getElementById('reg-foto-cloudinary')?.value || '');

                const melayaniDineIn = document.getElementById('reg-melayani-dinein')
                    ? Boolean(document.getElementById('reg-melayani-dinein').checked)
                    : true;
                const melayaniTakeaway = document.getElementById('reg-melayani-takeaway')
                    ? Boolean(document.getElementById('reg-melayani-takeaway').checked)
                    : true;
                const kurirWarungAktif = Boolean(document.getElementById('reg-kurir-warung')?.checked);
                const infoOngkirWarung = (document.getElementById('reg-info-ongkir-warung')?.value || '').trim().substring(0, 60);

                const wajibDp = Boolean(document.getElementById('reg-wajib-dp')?.checked);
                const dpMin = Math.max(5000, parseInt(document.getElementById('reg-dp-min')?.value || '10000', 10) || 10000);
                const qrisPublicId = bersihkanPublicIdCloudinary(document.getElementById('reg-qris-cloudinary')?.value || '');
                const ewalletProvider = (document.getElementById('reg-ewallet-provider')?.value || '').trim();
                const ewalletNumber = (document.getElementById('reg-ewallet-number')?.value || '').trim().replace(/[^0-9+]/g, '');
                const ewalletHolder = (document.getElementById('reg-ewallet-name')?.value || '').trim().substring(0, 60);
                const bankName = (document.getElementById('reg-bank-name')?.value || '').trim().substring(0, 40);
                const bankNumber = (document.getElementById('reg-bank-number')?.value || '').trim().replace(/[^0-9-]/g, '').substring(0, 40);
                const bankHolder = (document.getElementById('reg-bank-holder')?.value || '').trim().substring(0, 40);

                let finalLat = parseKoordinatAman(document.getElementById('reg-lat')?.value);
                let finalLng = parseKoordinatAman(document.getElementById('reg-lng')?.value);

                const rawGmapsInput = (document.getElementById('reg-gmaps-raw')?.value || '').trim();
                if (rawGmapsInput && (!isValidIndonesiaCoord(finalLat, finalLng) || !alamat)) {
                    const parsedCoord = await ekstrakKoordinatDariTeksAtauLinkGmaps(rawGmapsInput);
                    if (parsedCoord) {
                        finalLat = parsedCoord.lat;
                        finalLng = parsedCoord.lng;
                        if (!alamat && (parsedCoord.address || parsedCoord.placeName)) {
                            alamat = String(parsedCoord.address || parsedCoord.placeName).trim();
                            const regAlamatEl = document.getElementById('reg-alamat');
                            if (regAlamatEl) regAlamatEl.value = alamat;
                        }
                    }
                }

                if (!namaToko || namaToko.length < 2) {
                    return window.alert("Nama Resto / Outlet minimal 2 karakter.", "warning");
                }
                if (!pemilik || !waRaw || !alamat) {
                    return window.alert("Nama Resto, Nama Pengelola, Nomor WhatsApp, dan Alamat/Patokan wajib diisi.", "warning");
                }
                if (!melayaniDineIn && !melayaniTakeaway && !kurirWarungAktif) {
                    return window.alert("Pilih minimal 1 metode layanan pesanan (Makan di Tempat, Ambil Sendiri, atau Diantar Kurir Outlet).", "warning");
                }

                const hasQris = Boolean(qrisPublicId);
                const hasEwallet = Boolean(ewalletProvider && ewalletNumber && ewalletHolder);
                const hasBank = Boolean(bankName && bankNumber && bankHolder);

                if (wajibDp && !hasQris && !hasEwallet && !hasBank) {
                    return window.alert("Karena saklar Wajib DP diaktifkan, Anda wajib mengisi minimal 1 metode pembayaran (Foto QRIS, E-Wallet, atau Rekening Bank).", "warning");
                }

                const center = DEFAULT_CENTER_PARE || { lat: -7.768049, lng: 112.196514 };
                if (!isValidIndonesiaCoord(finalLat, finalLng)) {
                    finalLat = center.lat;
                    finalLng = center.lng;
                }

                btnSubmitReg.disabled = true;
                btnSubmitReg.innerHTML = '<i class="fa-solid fa-circle-notch fa-spin"></i> Memeriksa Anti-Duplikasi &amp; Menyimpan...';

                const cleanWa = waRaw.startsWith('0') ? ('62' + waRaw.slice(1)) : waRaw;
                const dupCheck = await cekDuplikasiRestoDiIndeksPublik(currentUser.uid, namaToko, cleanWa, finalLat, finalLng);
                if (dupCheck.isDuplicate) {
                    btnSubmitReg.disabled = false;
                    btnSubmitReg.innerHTML = '<i class="fa-solid fa-floppy-disk mr-1.5"></i> Simpan &amp; Aktifkan Resto Sekarang';
                    return window.alert(`PENDAFTARAN GANDA DITOLAK: ${dupCheck.reason}`, "error");
                }

                const finalGeohash = encodeGeohash(finalLat, finalLng, 6);
                const versionTs = Date.now();
                const lockedAuthMethod = deteksiMetodeProviderFirebaseUser(currentUser);

                const payload = {
                    profile: {
                        namaToko: namaToko.substring(0, 60),
                        pemilik: pemilik.substring(0, 60),
                        email: currentUser.email,
                        authMethod: lockedAuthMethod,
                        nodeId: activeNode.nodeId,
                        wa: cleanWa,
                        kategori: cleanKategori,
                        alamat: alamat.substring(0, 120),
                        lat: Number(finalLat.toFixed(6)),
                        lng: Number(finalLng.toFixed(6)),
                        geohash: finalGeohash,
                        isOpen: false,
                        jamBukaTutup: jamBukaTutup.substring(0, 35),
                        hariOperasional: normalisasiArrayHariOperasional(document.getElementById('reg-hari-aktif')?.value || '1,2,3,4,5,6,0'),
                        autoSchedule: false,
                        diskonTokoPersen: 0,
                        skemaDiskonGlobal: 'MAX_BEST',
                        promoSingkat: "",
                        fotoTokoPublicId: fotoTokoPublicId,
                        tipeOutlet: melayaniDineIn ? 'RESTO_FISIK' : 'DAPUR_RUMAHAN',
                        melayaniDineIn: melayaniDineIn,
                        melayaniTakeaway: melayaniTakeaway,
                        kurirWarungAktif: kurirWarungAktif,
                        infoOngkirWarung: infoOngkirWarung,
                        wajibDp: wajibDp,
                        dpMin: dpMin,
                        qrisPublicId: qrisPublicId,
                        ewallet: {
                            provider: ewalletProvider,
                            number: ewalletNumber,
                            holder: ewalletHolder
                        },
                        bank: {
                            name: bankName,
                            number: bankNumber,
                            holder: bankHolder
                        }
                    },
                    v: versionTs,
                    items: []
                };

                try {
                    const uid = currentUser.uid;
                    await setDoc(doc(activeNode.dbFirestore, "merchants", uid), payload);
                    try {
                        await tulisAmanRtdbIndex(uid, payload.profile, versionTs, []);
                    } catch (rtdbRegErr) {
                        try {
                            localStorage.setItem('japar_pending_rtdb_sync_v1', JSON.stringify({
                                uid: uid,
                                nodeId: activeNode.nodeId,
                                profile: payload.profile,
                                versionTs: versionTs,
                                items: [],
                                savedAt: Date.now()
                            }));
                        } catch (e2) {}
                    }

                    const emailKey = (currentUser.email || '').toLowerCase().trim();
                    const headerCat = document.getElementById('header-store-category');
                    if (headerCat) headerCat.innerText = formatLabelKategoriToko(cleanKategori);

                    kunciIkatanNodeEmail(emailKey, activeNode.nodeId);
                    catatIkatanMetodeLoginResto(emailKey, lockedAuthMethod, uid, payload.profile.namaToko, payload.profile.wa, activeNode.nodeId);
                    simpanCacheProfilTerverifikasi(uid, emailKey, payload);
                    window.showToast(`Profil Resto berhasil diaktifkan di ${activeNode.label}.`, "success");
                    inisialisasiSesiMerchant(uid, payload);
                } catch (err) {
                    btnSubmitReg.disabled = false;
                    btnSubmitReg.innerHTML = '<i class="fa-solid fa-floppy-disk mr-1.5"></i> Simpan &amp; Aktifkan Resto Sekarang';
                    window.alert("Gagal menyimpan pendaftaran: " + err.message, "error");
                }
            });
        }

        document.querySelectorAll('.panel-theme-choice-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                picuGetarSentuh(10);
                const pref = btn.getAttribute('data-panel-theme') || 'auto';
                terapkanTemaPanel(pref, true);
            });
        });

        const btnHeaderThemeCycle = document.getElementById('btn-header-theme-cycle');
        if (btnHeaderThemeCycle) {
            btnHeaderThemeCycle.addEventListener('click', () => {
                picuGetarSentuh(10);
                const cur = getPreferensiTemaTersimpan();
                const next = cur === 'auto' ? 'light' : (cur === 'light' ? 'dark' : 'auto');
                terapkanTemaPanel(next, true);
                const labelMap = {
                    auto: `Tema Otomatis (${hitungTemaBerdasarkanJamLokal() === 'dark' ? 'Malam' : 'Siang'})`,
                    light: 'Tema Siang (Terang)',
                    dark: 'Tema Malam (Gelap)'
                };
                window.showToast(`Tampilan diubah ke ${labelMap[next]}.`, 'info');
            });
        }
    };

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', inisialisasiEventAuth, { once: true });
    } else {
        inisialisasiEventAuth();
    }
})();

window.addEventListener('focus', () => {
    if (isLoginPopupInProgress) {
        setTimeout(() => {
            if (isLoginPopupInProgress && !authNode1.currentUser && !authNode2.currentUser) {
                isMultiNodeAuthProbeInProgress = false;
                pulihkanTombolLoginUI();
            }
        }, 1200);
    }
});

export async function toggleBiometrikMerchant(aktifkan) {
    if (!aktifkan) {
        localStorage.removeItem('japar_merchant_bio_id');
        return false;
    }
    if (!window.PublicKeyCredential || !currentUser) {
        window.alert("Perangkat ini tidak mendukung autentikasi biometrik.", "warning");
        return false;
    }

    try {
        const challenge = new Uint8Array(32);
        window.crypto.getRandomValues(challenge);
        const userId = new TextEncoder().encode(currentUser.uid);

        const cred = await navigator.credentials.create({
            publicKey: {
                challenge: challenge,
                rp: { name: "JAPAR Panel" },
                user: { id: userId, name: currentUser.email, displayName: "Pengelola Resto JAPAR" },
                pubKeyCredParams: [{ type: "public-key", alg: -7 }],
                authenticatorSelection: { authenticatorAttachment: "platform", userVerification: "required" },
                timeout: 60000
            }
        });
        localStorage.setItem('japar_merchant_bio_id', btoa(String.fromCharCode(...new Uint8Array(cred.rawId))));
        return true;
    } catch (err) {
        window.alert("Registrasi biometrik dibatalkan.", "error");
        return false;
    }
}

export async function sinkronisasiPaksaProfilDariServer() {
    const activeNode = getActiveNodeContext();
    const activeUser = activeNode.auth.currentUser || currentUser;
    if (!activeUser) return;
    if (lastManualServerSyncTs > 0 && (Date.now() - lastManualServerSyncTs) < MANUAL_SYNC_COOLDOWN_MS) {
        window.showToast("Data resto baru saja disinkronkan kurang dari 1 menit lalu.", "info");
        return;
    }
    lastManualServerSyncTs = Date.now();
    window.showToast(`Memuat ulang data dari ${activeNode.label}...`, "info");
    await jalankanPipelineValidasi(activeUser, true, null, activeNode);
}

// Dual-Node Zero-Socket Mode Active
