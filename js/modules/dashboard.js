// ==========================================================================
// FILE: js/modules/dashboard.js (JAPAR PANEL v4.0 - DUAL-NODE & TWO-PHASE SYNC)
// FUNGSI: Orkestrasi Utama Panel Pengelola Dapur & Resto JAPAR:
//         a) Saklar Buka / Tutup Resto Instan 0-Kuota Firestore (Murni HTTP PATCH ke RTDB)
//         b) Protokol Sinkronisasi 2-Fase & Antrean Pemulihan Koneksi (`japar_pending_rtdb_sync_v1`)
//         c) Standarisasi 5 Kategori Toko (`normalisasiKategoriTokoJapar` & `formatLabelKategoriToko`)
//         d) Popup Jam & Jadwal Mingguan Mewah Khas Aplikasi Mobile (Luxury Time & Schedule Picker)
//         e) Smart Coalesced Auto-Publish + Deduplikasi Signature (Hemat Kuota RTDB & Firestore)
// ==========================================================================

import {
    auth,
    dbFirestore,
    getActiveNodeContext,
    getNodeContextById
} from '../core/firebase-config.js';
import { doc, updateDoc } from "https://www.gstatic.com/firebasejs/10.8.1/firebase-firestore.js";
import {
    perbaruiCacheProfilTerverifikasi,
    toggleBiometrikMerchant,
    sinkronisasiPaksaProfilDariServer,
    unlockAudioMerchant,
    tulisAmanRtdbIndex,
    terapkanTemaPanel,
    getPreferensiTemaTersimpan,
    catatIkatanMetodeLoginResto,
    getMetodeLoginAktifUntukEmail,
    normalisasiKategoriTokoJapar,
    formatLabelKategoriToko
} from '../core/auth.js';
import {
    bersihkanPublicIdCloudinary,
    bangunUrlGambarCloudinary,
    unggahGambarKeCloudinary,
    cekDalamJamOperasional,
    uraiRentangJamOperasional,
    normalisasiArrayHariOperasional,
    formatLabelHariOperasional
} from '../utils/math-engine.js';
import { picuGetarSentuh } from '../utils/ui-components.js';
import {
    inisialisasiKoordinatWarung,
    getKoordinatWarungAktif,
    pasangEventPenentuLokasiWarung
} from './location-picker.js';
import {
    inisialisasiManajemenMenu,
    getDaftarMenuAktif,
    getSkemaDiskonGlobalAktif,
    setDiskonTokoGlobalUntukKalkulasi,
    setSkemaDiskonGlobalUntukKalkulasi,
    pasangEventManajemenMenu,
    evaluasiDanRenderPreviewStudioJson,
    sinkronkanPreviewPromptAiUI
} from './menu-catalog.js';
import { DEFAULT_CENTER_PARE } from '../config/credentials.js';

export const PENDING_RTDB_SYNC_KEY = 'japar_pending_rtdb_sync_v1';

let currentMerchantData = null;
let isStoreOpen = false;
let isAutoScheduleEnabled = false;
let autoScheduleTimer = null;
let lastAutoScheduleState = null;
let hasUnsavedMenuChanges = false;
let isSyncingStore = false;
let isFlushingPendingRtdb = false;
let lastSavedStateSignature = '';
let lastToggleWriteTs = 0;
let coalescedAutoPublishTimer = null;
let isAutoSyncMenuEnabled = true;

// State Popup Jam & Jadwal Mingguan Mewah
let luxuryModalTarget = 'STORE'; // 'STORE' | 'REG'
let luxuryActiveSlot = 'OPEN';   // 'OPEN' | 'CLOSE'
let luxuryOpenHour = 8;
let luxuryOpenMin = 0;
let luxuryCloseHour = 21;
let luxuryCloseMin = 0;
let luxurySelectedDays = [1, 2, 3, 4, 5, 6, 0];

const DRAFT_STORAGE_PREFIX = 'japar_unsaved_draft_';

function getActiveMerchantUser() {
    const activeNode = getActiveNodeContext();
    return activeNode?.auth?.currentUser || auth.currentUser || null;
}

function getDraftStorageKey() {
    const activeUser = getActiveMerchantUser();
    const uid = activeUser?.uid || localStorage.getItem('japar_uid_merchant') || 'anon';
    return DRAFT_STORAGE_PREFIX + uid;
}

function simpanDraftLokalSementara(reasonLabel = 'Perubahan belum ditayangkan') {
    try {
        const snapshot = kumpulkanDataProfilDariForm();
        const items = getDaftarMenuAktif();
        localStorage.setItem(getDraftStorageKey(), JSON.stringify({
            ts: Date.now(),
            reason: reasonLabel,
            profile: snapshot,
            items: items
        }));
    } catch (e) {}
}

function bersihkanDraftLokalSementara() {
    try {
        localStorage.removeItem(getDraftStorageKey());
    } catch (e) {}
}

function simpanAntreanSinkronisasiRtdbTertunda(payloadObj) {
    try {
        if (!payloadObj || !payloadObj.uid) return;
        localStorage.setItem(PENDING_RTDB_SYNC_KEY, JSON.stringify(payloadObj));
    } catch (e) {}
}

/**
 * Menembakkan ulang `tulisAmanRtdbIndex` jika Fase 1 (Firestore) sukses tetapi Fase 2 (RTDB)
 * sempat tertunda karena sinyal internet terputus di tengah jalan.
 */
export async function prosesAntreanSinkronisasiRtdbTertunda() {
    if (isFlushingPendingRtdb) return false;
    if (typeof navigator !== 'undefined' && navigator.onLine === false) return false;

    let pending = null;
    try {
        const raw = localStorage.getItem(PENDING_RTDB_SYNC_KEY);
        if (!raw) return false;
        pending = JSON.parse(raw);
    } catch (e) {
        return false;
    }

    if (!pending || !pending.uid || !pending.profile) {
        try { localStorage.removeItem(PENDING_RTDB_SYNC_KEY); } catch (e) {}
        return false;
    }

    const targetNode = getNodeContextById(pending.nodeId || pending.profile.nodeId || getActiveNodeContext().nodeId);
    const activeUser = targetNode?.auth?.currentUser || getActiveMerchantUser();
    if (!activeUser || activeUser.uid !== pending.uid) {
        return false;
    }

    isFlushingPendingRtdb = true;
    try {
        await tulisAmanRtdbIndex(
            pending.uid,
            pending.profile,
            Number(pending.versionTs || Date.now()),
            Array.isArray(pending.items) ? pending.items : []
        );
        localStorage.removeItem(PENDING_RTDB_SYNC_KEY);
        if (typeof window.showToast === 'function') {
            window.showToast("Sinkronisasi indeks katalog tertunda berhasil dituntaskan.", "success");
        }
        return true;
    } catch (err) {
        return false;
    } finally {
        isFlushingPendingRtdb = false;
    }
}
window.prosesAntreanSinkronisasiRtdbTertunda = prosesAntreanSinkronisasiRtdbTertunda;

window.addEventListener('online', () => {
    prosesAntreanSinkronisasiRtdbTertunda();
});

document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') {
        prosesAntreanSinkronisasiRtdbTertunda();
    }
});

function hitungSignatureDataResto(profileObj, itemsArr) {
    try {
        const cleanP = { ...(profileObj || {}) };
        return JSON.stringify({ p: cleanP, i: itemsArr || [] });
    } catch (e) {
        return '';
    }
}

function getHariOperasionalAktifDariForm() {
    const rawStr = document.getElementById('store-input-hari-aktif')?.value || '1,2,3,4,5,6,0';
    return normalisasiArrayHariOperasional(rawStr);
}

function perbaruiIndikatorUnsaved(unsaved, reasonText = '') {
    hasUnsavedMenuChanges = Boolean(unsaved);
    const btnPublish = document.getElementById('btn-publish-catalog');
    const btnPublishLabel = document.getElementById('btn-publish-catalog-label');
    const badgeUnsaved = document.getElementById('unsaved-changes-badge');
    const floatingBar = document.getElementById('floating-unsaved-bar');
    const floatingReason = document.getElementById('floating-unsaved-reason');

    if (badgeUnsaved) {
        badgeUnsaved.classList.toggle('hidden-state', !hasUnsavedMenuChanges);
    }

    if (btnPublish) {
        if (hasUnsavedMenuChanges) {
            btnPublish.className = 'btn-trigger-publish px-2.5 h-8 rounded-xl bg-gradient-to-r from-orange-600 to-amber-500 text-white text-[0.6rem] font-extrabold uppercase tracking-wider shrink-0 cursor-pointer shadow-md ring-2 ring-emerald-400 animate-pulse transition-all flex items-center gap-1';
            if (btnPublishLabel) btnPublishLabel.textContent = 'TAYANGKAN';
        } else {
            btnPublish.className = 'btn-trigger-publish px-2.5 h-8 rounded-xl bg-emerald-500/15 hover:bg-emerald-500/25 border border-emerald-500/40 text-emerald-300 text-[0.6rem] font-extrabold uppercase tracking-wider shrink-0 cursor-pointer transition-all flex items-center gap-1';
            if (btnPublishLabel) btnPublishLabel.textContent = 'TERSIMPAN';
        }
    }

    if (floatingBar) {
        floatingBar.classList.toggle('hidden-state', !hasUnsavedMenuChanges);
        if (floatingReason && reasonText) {
            floatingReason.textContent = reasonText;
        } else if (floatingReason && !reasonText && hasUnsavedMenuChanges) {
            floatingReason.textContent = 'Ada perubahan yang belum ditayangkan ke pelanggan';
        }
    }

    if (hasUnsavedMenuChanges) {
        simpanDraftLokalSementara(reasonText || 'Perubahan konfigurasi resto');
    } else {
        bersihkanDraftLokalSementara();
    }
}

function jadwalkanAutoPublishKoalesensi(delayMs = 1800, infoLabel = 'Menyimpan perubahan katalog...') {
    if (!isAutoSyncMenuEnabled) return;
    if (coalescedAutoPublishTimer) {
        clearTimeout(coalescedAutoPublishTimer);
    }
    const floatingReason = document.getElementById('floating-unsaved-reason');
    if (floatingReason) {
        floatingReason.innerHTML = `<i class="fa-solid fa-circle-notch fa-spin text-amber-300 mr-1"></i>${infoLabel}`;
    }
    coalescedAutoPublishTimer = setTimeout(() => {
        coalescedAutoPublishTimer = null;
        simpanDanPublikasikanKatalogPenuh({ silentIfUnchanged: true, autoTriggered: true });
    }, delayMs);
}

function perbaruiVisualStatusTokoHeader() {
    const statusDot = document.getElementById('store-live-dot');
    const statusText = document.getElementById('store-live-status-text');
    const modeSubText = document.getElementById('store-live-mode-subtext');
    const toggleSwitch = document.getElementById('toggle-store-open');
    const activeDays = getHariOperasionalAktifDariForm();
    const labelHari = formatLabelHariOperasional(activeDays);
    const jamStr = (document.getElementById('store-input-jam')?.value || '08:00-21:00').trim();
    const parsedJam = uraiRentangJamOperasional(jamStr);

    if (toggleSwitch) {
        toggleSwitch.checked = isStoreOpen;
    }

    if (statusDot && statusText) {
        if (isStoreOpen) {
            statusDot.className = 'w-2 h-2 rounded-full bg-emerald-400 shadow-[0_0_8px_#10b981] animate-pulse shrink-0';
            statusText.innerText = 'BUKA';
            statusText.className = 'text-[0.62rem] font-extrabold text-emerald-400 tracking-wider uppercase leading-none';
        } else {
            statusDot.className = 'w-2 h-2 rounded-full bg-red-400 shrink-0';
            statusText.innerText = 'TUTUP';
            statusText.className = 'text-[0.62rem] font-extrabold text-red-400 tracking-wider uppercase leading-none';
        }
    }

    if (modeSubText) {
        if (isAutoScheduleEnabled) {
            modeSubText.innerText = `AUTO • ${parsedJam.normalized} WIB (${labelHari})`;
            modeSubText.className = 'text-[0.54rem] font-bold text-amber-300 uppercase tracking-tight leading-none truncate';
        } else {
            modeSubText.innerText = `MANUAL • ${parsedJam.normalized} WIB (${labelHari})`;
            modeSubText.className = 'text-[0.54rem] font-bold text-stone-300 uppercase tracking-tight leading-none truncate';
        }
    }

    const displayHoursEl = document.getElementById('luxury-trigger-display-hours');
    if (displayHoursEl) {
        displayHoursEl.textContent = `${parsedJam.startStr} – ${parsedJam.endStr} WIB`;
    }
    const daysBadgeEl = document.getElementById('store-active-days-badge');
    if (daysBadgeEl) {
        daysBadgeEl.textContent = labelHari;
    }

    perbaruiVisualModeJadwalTabLokasi();
}

function perbaruiVisualModeJadwalTabLokasi() {
    const chkAuto = document.getElementById('toggle-auto-schedule');
    if (chkAuto) chkAuto.checked = isAutoScheduleEnabled;

    const btnModeManual = document.getElementById('btn-schedule-mode-manual');
    const btnModeAuto = document.getElementById('btn-schedule-mode-auto');
    if (btnModeManual && btnModeAuto) {
        btnModeManual.className = !isAutoScheduleEnabled
            ? 'py-2 px-2.5 rounded-xl text-[0.62rem] font-extrabold uppercase tracking-wider bg-orange-600 text-white shadow cursor-pointer transition-all flex items-center justify-center gap-1.5'
            : 'py-2 px-2.5 rounded-xl text-[0.62rem] font-bold uppercase tracking-wider bg-[#1A1C20] text-stone-300 border border-white/10 cursor-pointer transition-all flex items-center justify-center gap-1.5';
        btnModeAuto.className = isAutoScheduleEnabled
            ? 'py-2 px-2.5 rounded-xl text-[0.62rem] font-extrabold uppercase tracking-wider bg-emerald-600 text-white shadow cursor-pointer transition-all flex items-center justify-center gap-1.5'
            : 'py-2 px-2.5 rounded-xl text-[0.62rem] font-bold uppercase tracking-wider bg-[#1A1C20] text-stone-300 border border-white/10 cursor-pointer transition-all flex items-center justify-center gap-1.5';
    }

    const evalBox = document.getElementById('schedule-live-eval-box');
    const rawJam = (document.getElementById('store-input-jam')?.value || '08:00-21:00').trim();
    const parsed = uraiRentangJamOperasional(rawJam);
    const activeDays = getHariOperasionalAktifDariForm();
    const labelHari = formatLabelHariOperasional(activeDays);
    const now = new Date();
    const inHours = cekDalamJamOperasional(parsed.normalized, now, activeDays);
    const nowStr = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')} WIB`;

    if (evalBox) {
        if (isAutoScheduleEnabled) {
            evalBox.className = inHours
                ? 'p-2.5 rounded-xl bg-emerald-500/10 border border-emerald-500/35 text-[0.62rem] text-emerald-300 space-y-1'
                : 'p-2.5 rounded-xl bg-amber-500/10 border border-amber-500/35 text-[0.62rem] text-amber-300 space-y-1';
            evalBox.innerHTML = `
                <div class="font-extrabold uppercase flex items-center gap-1.5">
                    <i class="fa-solid fa-robot"></i> Mode Jadwal Otomatis Aktif (${parsed.normalized} • ${labelHari})
                </div>
                <p class="text-stone-300 leading-relaxed">
                    Waktu sekarang <b>${nowStr}</b> berada <b>${inHours ? 'DI DALAM' : 'DI LUAR'}</b> jadwal operasional, sehingga status resto otomatis disetel <b>${inHours ? 'BUKA' : 'TUTUP'}</b>.
                </p>
            `;
        } else {
            evalBox.className = 'p-2.5 rounded-xl bg-orange-500/10 border border-orange-500/30 text-[0.62rem] text-orange-300 space-y-1';
            evalBox.innerHTML = `
                <div class="font-extrabold uppercase flex items-center gap-1.5">
                    <i class="fa-solid fa-hand-pointer"></i> Mode Kendali Saklar Manual Aktif
                </div>
                <p class="text-stone-300 leading-relaxed">
                    Status resto saat ini (<b>${isStoreOpen ? 'BUKA' : 'TUTUP'}</b>) dikendalikan 100% melalui <b>Saklar Buka/Tutup di baris atas</b>. Jam <b>${parsed.normalized} WIB (${labelHari})</b> ditampilkan sebagai info ke pelanggan.
                </p>
            `;
        }
    }
}

export function parseInputJamKetikPintar(rawVal, fallbackH = 8, fallbackM = 0) {
    const str = String(rawVal || '').trim().replace(/[.;]/g, ':');
    if (!str) return { h: fallbackH, m: fallbackM, str: `${String(fallbackH).padStart(2, '0')}:${String(fallbackM).padStart(2, '0')}` };

    const colonMatch = str.match(/^(\d{1,2})\s*:\s*(\d{1,2})$/);
    if (colonMatch) {
        const h = Math.max(0, Math.min(23, parseInt(colonMatch[1], 10) || 0));
        const m = Math.max(0, Math.min(59, parseInt(colonMatch[2], 10) || 0));
        return { h, m, str: `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}` };
    }

    const digitsOnly = str.replace(/\D/g, '');
    if (digitsOnly.length === 4) {
        const h = Math.max(0, Math.min(23, parseInt(digitsOnly.slice(0, 2), 10) || 0));
        const m = Math.max(0, Math.min(59, parseInt(digitsOnly.slice(2, 4), 10) || 0));
        return { h, m, str: `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}` };
    }
    if (digitsOnly.length === 3) {
        const h = Math.max(0, Math.min(23, parseInt(digitsOnly.slice(0, 1), 10) || 0));
        const m = Math.max(0, Math.min(59, parseInt(digitsOnly.slice(1, 3), 10) || 0));
        return { h, m, str: `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}` };
    }
    if (digitsOnly.length >= 1 && digitsOnly.length <= 2) {
        const h = Math.max(0, Math.min(23, parseInt(digitsOnly, 10) || 0));
        return { h, m: 0, str: `${String(h).padStart(2, '0')}:00` };
    }
    return { h: fallbackH, m: fallbackM, str: `${String(fallbackH).padStart(2, '0')}:${String(fallbackM).padStart(2, '0')}` };
}

export function sinkronkanInputTimePickerJam(jamStrInput, rawDaysInput = null) {
    const parsed = uraiRentangJamOperasional(jamStrInput || '08:00-21:00');
    const inpStart = document.getElementById('store-input-jam-mulai');
    const inpEnd = document.getElementById('store-input-jam-selesai');
    const inpRaw = document.getElementById('store-input-jam');
    const inpDays = document.getElementById('store-input-hari-aktif');
    const inlineBuka = document.getElementById('inline-input-jam-buka');
    const inlineTutup = document.getElementById('inline-input-jam-tutup');
    if (inpStart) inpStart.value = parsed.startStr;
    if (inpEnd) inpEnd.value = parsed.endStr;
    if (inpRaw) inpRaw.value = parsed.normalized;
    if (inlineBuka && document.activeElement !== inlineBuka) inlineBuka.value = parsed.startStr;
    if (inlineTutup && document.activeElement !== inlineTutup) inlineTutup.value = parsed.endStr;
    if (rawDaysInput !== null && inpDays) {
        const cleanDays = normalisasiArrayHariOperasional(rawDaysInput);
        inpDays.value = cleanDays.join(',');
    }
    perbaruiVisualStatusTokoHeader();
}

// ==========================================================================
// LOGIKA POPUP JAM & JADWAL MINGGUAN MEWAH (LUXURY TIME & SCHEDULE MODAL)
// ==========================================================================
function formatDuaDigit(n) {
    return String(Math.max(0, Math.min(59, parseInt(n, 10) || 0))).padStart(2, '0');
}

function renderVisualModalJamMewah() {
    const openStr = `${formatDuaDigit(luxuryOpenHour)}:${formatDuaDigit(luxuryOpenMin)}`;
    const closeStr = `${formatDuaDigit(luxuryCloseHour)}:${formatDuaDigit(luxuryCloseMin)}`;

    const elOpenVal = document.getElementById('luxury-clock-open-val');
    const elCloseVal = document.getElementById('luxury-clock-close-val');
    if (elOpenVal) elOpenVal.textContent = openStr;
    if (elCloseVal) elCloseVal.textContent = closeStr;

    const inpOpen = document.getElementById('luxury-input-open-time');
    const inpClose = document.getElementById('luxury-input-close-time');
    if (inpOpen && document.activeElement !== inpOpen) inpOpen.value = openStr;
    if (inpClose && document.activeElement !== inpClose) inpClose.value = closeStr;

    const durBadge = document.getElementById('luxury-clock-duration-badge');
    if (durBadge) {
        const startMins = luxuryOpenHour * 60 + luxuryOpenMin;
        const endMins = luxuryCloseHour * 60 + luxuryCloseMin;
        if (openStr === '00:00' && closeStr === '23:59') {
            durBadge.textContent = 'Buka 24 Jam Penuh';
            durBadge.className = 'text-[0.54rem] font-mono font-bold text-emerald-300 bg-emerald-500/15 px-2 py-0.5 rounded-full border border-emerald-500/35';
        } else {
            let diff = endMins - startMins;
            let crossMidnight = false;
            if (diff <= 0) {
                diff += 24 * 60;
                crossMidnight = true;
            }
            const hrs = Math.floor(diff / 60);
            const mins = diff % 60;
            const durText = `${hrs} Jam${mins > 0 ? ` ${mins} Mnt` : ''}${crossMidnight ? ' • Lintas Malam' : ''}`;
            durBadge.textContent = `Durasi: ${durText}`;
            durBadge.className = 'text-[0.54rem] font-mono font-bold text-amber-300 bg-amber-500/10 px-2 py-0.5 rounded-full border border-amber-500/25';
        }
    }

    // Update tombol hari mingguan dengan kontras tinggi (✓ BUKA vs LIBUR)
    document.querySelectorAll('#luxury-days-container .luxury-day-chip').forEach(chip => {
        const d = parseInt(chip.getAttribute('data-day') || '0', 10);
        const isActive = luxurySelectedDays.includes(d);
        chip.classList.toggle('active', isActive);
        chip.classList.toggle('active-day', isActive);
        const statusEl = chip.querySelector('.day-chip-status');
        if (statusEl) {
            statusEl.textContent = isActive ? '✓ BUKA' : 'LIBUR';
        }
    });

    // Sinkronkan saklar Jadwal Otomatis di dalam modal
    const modalAutoToggle = document.getElementById('modal-toggle-auto-schedule');
    if (modalAutoToggle) {
        modalAutoToggle.checked = isAutoScheduleEnabled;
    }

    const modalEvalInfo = document.getElementById('luxury-modal-auto-eval-info');
    if (modalEvalInfo) {
        const jamRange = `${openStr}-${closeStr}`;
        const labelHari = formatLabelHariOperasional(luxurySelectedDays);
        const inHours = cekDalamJamOperasional(jamRange, new Date(), luxurySelectedDays);
        if (isAutoScheduleEnabled) {
            modalEvalInfo.className = inHours
                ? 'text-[0.56rem] font-bold px-2.5 py-1.5 rounded-xl bg-emerald-500/15 border border-emerald-500/35 text-emerald-300'
                : 'text-[0.56rem] font-bold px-2.5 py-1.5 rounded-xl bg-amber-500/15 border border-amber-500/35 text-amber-300';
            modalEvalInfo.innerHTML = `<i class="fa-solid fa-robot mr-1"></i><b>Jadwal Otomatis Aktif:</b> Buka <b>${openStr}–${closeStr} WIB</b> (${labelHari}) • Status saat ini: <b>${inHours ? 'BUKA OTOMATIS' : 'TUTUP OTOMATIS'}</b>`;
        } else {
            modalEvalInfo.className = 'text-[0.56rem] font-bold px-2.5 py-1.5 rounded-xl bg-white/5 border border-white/10 text-stone-300';
            modalEvalInfo.innerHTML = `<i class="fa-solid fa-hand-pointer mr-1 text-orange-400"></i><b>Mode Saklar Manual:</b> Nyalakan saklar di atas jika ingin toko buka &amp; tutup otomatis sesuai jam <b>${openStr}–${closeStr} WIB</b> (${labelHari}).`;
        }
    }
}

export function bukaModalJamOperasionalMewah(targetMode = 'STORE') {
    luxuryModalTarget = targetMode === 'REG' ? 'REG' : 'STORE';
    luxuryActiveSlot = 'OPEN';

    const rawJam = luxuryModalTarget === 'REG'
        ? (document.getElementById('reg-jam')?.value || '08:00-21:00')
        : (document.getElementById('store-input-jam')?.value || '08:00-21:00');
    const parsed = uraiRentangJamOperasional(rawJam);

    luxuryOpenHour = parsed.startH;
    luxuryOpenMin = parsed.startM;
    luxuryCloseHour = parsed.endH;
    luxuryCloseMin = parsed.endM;
    luxurySelectedDays = luxuryModalTarget === 'REG'
        ? normalisasiArrayHariOperasional(document.getElementById('reg-hari-aktif')?.value || '1,2,3,4,5,6,0')
        : getHariOperasionalAktifDariForm();

    renderVisualModalJamMewah();
    const modal = document.getElementById('japar-luxury-time-modal');
    if (modal) modal.classList.remove('hidden-state');
}

export function sinkronkanTampilanLayananOutlet() {
    const chkDineIn = document.getElementById('toggle-melayani-dinein');
    const chkTakeaway = document.getElementById('toggle-melayani-takeaway');
    const chkKurir = document.getElementById('toggle-kurir-warung');
    const wrapOngkir = document.getElementById('wrap-store-ongkir-input');
    const summaryEl = document.getElementById('service-mode-summary-box');
    const headerServiceBadge = document.getElementById('header-store-service-badge');

    const dineIn = chkDineIn ? Boolean(chkDineIn.checked) : true;
    const takeaway = chkTakeaway ? Boolean(chkTakeaway.checked) : true;
    const kurir = chkKurir ? Boolean(chkKurir.checked) : false;

    if (wrapOngkir) {
        wrapOngkir.classList.toggle('opacity-50', !kurir);
    }

    const activeList = [];
    if (dineIn) activeList.push('Makan di Tempat (Dine-In)');
    if (takeaway) activeList.push('Bungkus / Ambil Sendiri');
    if (kurir) activeList.push('Diantar Kurir Outlet');

    if (headerServiceBadge) {
        if (!dineIn && (kurir || takeaway)) {
            headerServiceBadge.innerHTML = `<i class="fa-solid fa-house-chimney-user mr-0.5"></i>Outlet Rumahan`;
            headerServiceBadge.className = 'text-[0.5rem] font-bold px-1.5 py-0.5 rounded bg-emerald-500/15 text-emerald-300 border border-emerald-500/30 uppercase leading-none';
        } else {
            headerServiceBadge.innerHTML = `<i class="fa-solid fa-utensils mr-0.5"></i>Bisa Dine-In`;
            headerServiceBadge.className = 'text-[0.5rem] font-bold px-1.5 py-0.5 rounded bg-white/5 text-stone-300 border border-white/10 uppercase leading-none';
        }
    }

    const btnPresetResto = document.getElementById('btn-preset-outlet-resto');
    const btnPresetRumahan = document.getElementById('btn-preset-outlet-rumahan');
    if (btnPresetResto && btnPresetRumahan) {
        btnPresetResto.classList.toggle('border-orange-500', dineIn);
        btnPresetResto.classList.toggle('bg-orange-500/20', dineIn);
        btnPresetRumahan.classList.toggle('border-emerald-500', !dineIn);
        btnPresetRumahan.classList.toggle('bg-emerald-500/20', !dineIn);
    }

    if (summaryEl) {
        if (activeList.length === 0) {
            summaryEl.className = 'text-[0.65rem] px-3 py-2 rounded-xl bg-red-500/15 border border-red-500/40 text-red-300 font-bold';
            summaryEl.innerHTML = '<i class="fa-solid fa-triangle-exclamation mr-1"></i>Peringatan: Pilih minimal 1 layanan pesanan agar pelanggan dapat memesan di tempat usaha Anda.';
        } else if (!dineIn) {
            summaryEl.className = 'text-[0.65rem] px-3 py-2 rounded-xl bg-emerald-500/10 border border-emerald-500/30 text-emerald-300';
            summaryEl.innerHTML = `<i class="fa-solid fa-house-chimney-user mr-1"></i><b>Mode Outlet / Dapur Rumahan (Tanpa Makan di Tempat):</b> Pelanggan di aplikasi publik hanya dapat memilih <b>${activeList.join(' &amp; ')}</b>. Opsi Makan di Tempat disembunyikan otomatis.`;
        } else {
            summaryEl.className = 'text-[0.65rem] px-3 py-2 rounded-xl bg-amber-500/10 border border-amber-500/30 text-amber-300';
            summaryEl.innerHTML = `<i class="fa-solid fa-store mr-1"></i><b>Mode Resto / Warung Makan Fisik:</b> Melayani <b>${activeList.join(', ')}</b> di aplikasi pelanggan.`;
        }
    }
}

export function sinkronkanTampilanSaklarWajibDpProfil() {
    const chkWajibDp = document.getElementById('toggle-wajib-dp');
    const dpMinWrap = document.getElementById('store-dp-min-wrap');
    const infoBox = document.getElementById('store-dp-scheme-info');
    const isWajib = chkWajibDp ? Boolean(chkWajibDp.checked) : true;

    if (dpMinWrap) {
        dpMinWrap.classList.toggle('hidden-state', !isWajib);
    }
    if (infoBox) {
        if (isWajib) {
            infoBox.className = 'text-[0.65rem] px-3 py-2 rounded-xl bg-amber-500/10 border border-amber-500/30 text-amber-300';
            infoBox.innerHTML = 'Mode Aktif: <b>Wajib DP / Transfer Awal</b>. Pelanggan wajib mentransfer DP atau bayar lunas. Minimal 1 metode pembayaran wajib diisi.';
        } else {
            infoBox.className = 'text-[0.65rem] px-3 py-2 rounded-xl bg-emerald-500/10 border border-emerald-500/30 text-emerald-300';
            infoBox.innerHTML = 'Mode Aktif: <b>Tanpa DP (Bayar Tunai / COD)</b>. Pelanggan diizinkan memesan tanpa DP. Pengisian QRIS, E-Wallet, dan Rekening Bank bersifat opsional.';
        }
    }
}

function kumpulkanDataProfilDariForm() {
    const activeNode = getActiveNodeContext();
    const activeUser = getActiveMerchantUser();
    const coord = getKoordinatWarungAktif();
    const activeItems = getDaftarMenuAktif();
    const namaToko = (document.getElementById('store-input-nama')?.value || currentMerchantData?.profile?.namaToko || '').trim();
    const pemilik = (document.getElementById('store-input-pemilik')?.value || currentMerchantData?.profile?.pemilik || '').trim();
    const waRaw = (document.getElementById('store-input-wa')?.value || currentMerchantData?.profile?.wa || '').trim().replace(/[^0-9]/g, '');
    const rawKategori = (document.getElementById('store-input-kategori')?.value || currentMerchantData?.profile?.kategori || 'HIDANGAN_UTAMA').trim().toUpperCase();
    const kategori = normalisasiKategoriTokoJapar(rawKategori, activeItems);
    const alamat = (document.getElementById('store-input-alamat')?.value || currentMerchantData?.profile?.alamat || '').trim();
    const parsedJam = uraiRentangJamOperasional(document.getElementById('store-input-jam')?.value || currentMerchantData?.profile?.jamBukaTutup || '08:00-21:00');
    const jamBukaTutup = parsedJam.normalized;
    const hariOperasional = getHariOperasionalAktifDariForm();
    const diskonTokoPersen = Math.min(99, Math.max(0, parseInt(document.getElementById('store-input-diskon')?.value || '0', 10) || 0));
    const skemaDiskonGlobal = getSkemaDiskonGlobalAktif();
    const promoSingkat = (document.getElementById('store-input-promo')?.value || '').trim();
    const fotoTokoPublicId = bersihkanPublicIdCloudinary(document.getElementById('store-input-foto-cloudinary')?.value || currentMerchantData?.profile?.fotoTokoPublicId || '');

    const melayaniDineIn = document.getElementById('toggle-melayani-dinein')
        ? Boolean(document.getElementById('toggle-melayani-dinein').checked)
        : (currentMerchantData?.profile?.melayaniDineIn !== undefined ? Boolean(currentMerchantData.profile.melayaniDineIn) : true);
    const melayaniTakeaway = document.getElementById('toggle-melayani-takeaway')
        ? Boolean(document.getElementById('toggle-melayani-takeaway').checked)
        : (currentMerchantData?.profile?.melayaniTakeaway !== undefined ? Boolean(currentMerchantData.profile.melayaniTakeaway) : true);
    const kurirWarungAktif = document.getElementById('toggle-kurir-warung')
        ? Boolean(document.getElementById('toggle-kurir-warung').checked)
        : Boolean(currentMerchantData?.profile?.kurirWarungAktif);
    const rawTarifOngkir = document.getElementById('store-input-tarif-ongkir')?.value;
    let tarifOngkirNumeric = rawTarifOngkir !== undefined && rawTarifOngkir !== ''
        ? Math.max(0, parseInt(String(rawTarifOngkir).replace(/[^0-9]/g, ''), 10) || 0)
        : null;
    let infoOngkirWarung = (document.getElementById('store-input-info-ongkir-warung')?.value || '').trim().substring(0, 60);
    if (tarifOngkirNumeric === null && infoOngkirWarung) {
        const pureDigits = infoOngkirWarung.match(/^\s*(?:rp\.?\s*)?(\d{1,3}(?:[.,]\d{3})*|\d+)\s*$/i);
        if (pureDigits) {
            tarifOngkirNumeric = parseInt(pureDigits[1].replace(/[.,]/g, ''), 10) || 0;
        }
    }
    if (tarifOngkirNumeric !== null && tarifOngkirNumeric > 0 && (!infoOngkirWarung || /^\s*(?:rp\.?\s*)?(\d{1,3}(?:[.,]\d{3})*|\d+)\s*$/i.test(infoOngkirWarung))) {
        infoOngkirWarung = `Rp ${tarifOngkirNumeric.toLocaleString('id-ID')}`;
    } else if (tarifOngkirNumeric === 0 && !infoOngkirWarung) {
        infoOngkirWarung = 'Gratis Ongkir';
    }

    const wajibDp = document.getElementById('toggle-wajib-dp')
        ? Boolean(document.getElementById('toggle-wajib-dp').checked)
        : Boolean(currentMerchantData?.profile?.wajibDp);
    const dpMin = Math.max(5000, parseInt(document.getElementById('store-input-dp-min')?.value || '10000', 10) || 10000);
    const qrisPublicId = bersihkanPublicIdCloudinary(document.getElementById('store-input-qris-cloudinary')?.value || currentMerchantData?.profile?.qrisPublicId || '');
    const ewalletProvider = (document.getElementById('store-input-ewallet-provider')?.value || '').trim();
    const ewalletNumber = (document.getElementById('store-input-ewallet-number')?.value || '').trim().replace(/[^0-9+]/g, '');
    const ewalletHolder = (document.getElementById('store-input-ewallet-name')?.value || '').trim().substring(0, 60);
    const bankName = (document.getElementById('store-input-bank-name')?.value || '').trim().substring(0, 40);
    const bankNumber = (document.getElementById('store-input-bank-number')?.value || '').trim().replace(/[^0-9-]/g, '').substring(0, 40);
    const bankHolder = (document.getElementById('store-input-bank-holder')?.value || '').trim().substring(0, 60);

    const userEmail = activeUser?.email || currentMerchantData?.profile?.email || '';
    const lockedMethod = currentMerchantData?.profile?.authMethod || getMetodeLoginAktifUntukEmail(userEmail) || 'EMAIL';

    return {
        namaToko: namaToko.substring(0, 60),
        pemilik: pemilik.substring(0, 60),
        email: userEmail,
        authMethod: lockedMethod,
        nodeId: activeNode.nodeId,
        wa: waRaw.startsWith('0') ? ('62' + waRaw.slice(1)) : waRaw,
        kategori: kategori,
        alamat: alamat.substring(0, 120),
        lat: Number(coord.lat),
        lng: Number(coord.lng),
        geohash: String(coord.geohash || '').substring(0, 6),
        isOpen: Boolean(isStoreOpen),
        jamBukaTutup: jamBukaTutup.substring(0, 35),
        hariOperasional: hariOperasional,
        autoSchedule: Boolean(isAutoScheduleEnabled),
        diskonTokoPersen: diskonTokoPersen,
        skemaDiskonGlobal: skemaDiskonGlobal,
        promoSingkat: promoSingkat.substring(0, 60),
        fotoTokoPublicId: fotoTokoPublicId,
        tipeOutlet: melayaniDineIn ? 'RESTO_FISIK' : 'DAPUR_RUMAHAN',
        melayaniDineIn: melayaniDineIn,
        melayaniTakeaway: melayaniTakeaway,
        kurirWarungAktif: kurirWarungAktif,
        tarifOngkir: tarifOngkirNumeric !== null ? tarifOngkirNumeric : 0,
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
    };
}

/**
 * Saklar Buka/Tutup Resto Instan 0-Kuota Firestore:
 * HANYA mengirimkan HTTP PATCH ringan ke RTDB (`{"o": Boolean(isStoreOpen), "as": Boolean(isAutoScheduleEnabled)}`)
 * tanpa memanggil `updateDoc` ke Firestore sehingga menghemat 100% kuota Write & Read Firestore harian.
 */
async function eksekusiToggleBukaTutupInstan(statusBaru, sumber = 'MANUAL') {
    const activeNode = getActiveNodeContext();
    const activeUser = getActiveMerchantUser();
    if (!activeUser) return;

    const now = Date.now();
    if (sumber === 'MANUAL' && (now - lastToggleWriteTs) < 1200) {
        perbaruiVisualStatusTokoHeader();
        return;
    }
    lastToggleWriteTs = now;

    const targetOpen = Boolean(statusBaru);
    let switchedToManual = false;

    if (sumber === 'MANUAL' && isAutoScheduleEnabled) {
        isAutoScheduleEnabled = false;
        switchedToManual = true;
    }

    isStoreOpen = targetOpen;
    perbaruiVisualStatusTokoHeader();

    try {
        const uid = activeUser.uid;
        const idToken = await activeUser.getIdToken(false);
        const baseUrl = String(activeNode.config.databaseURL || '').replace(/\/+$/, '');
        const patchUrl = `${baseUrl}/merchants_index/${encodeURIComponent(uid)}.json?auth=${encodeURIComponent(idToken)}`;

        const patchResp = await fetch(patchUrl, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                o: Boolean(isStoreOpen),
                as: Boolean(isAutoScheduleEnabled)
            })
        });

        if (!patchResp.ok) {
            const errText = await patchResp.text().catch(() => '');
            throw new Error(`RTDB PATCH gagal (${patchResp.status}): ${errText}`);
        }

        if (currentMerchantData && currentMerchantData.profile) {
            currentMerchantData.profile.isOpen = isStoreOpen;
            currentMerchantData.profile.autoSchedule = isAutoScheduleEnabled;
            lastSavedStateSignature = hitungSignatureDataResto(currentMerchantData.profile, getDaftarMenuAktif());
        }
        perbaruiCacheProfilTerverifikasi({
            isOpen: isStoreOpen,
            autoSchedule: isAutoScheduleEnabled
        });

        if (sumber === 'MANUAL') {
            const extraNote = switchedToManual
                ? " (Jadwal Otomatis dialihkan ke Manual agar pilihan Anda terkunci)."
                : ".";
            window.showToast(
                (isStoreOpen
                    ? "Status resto kini BUKA di katalog publik"
                    : "Status resto kini TUTUP sementara") + extraNote,
                isStoreOpen ? "success" : "warning"
            );
        } else if (sumber === 'AUTO_SCHEDULE') {
            window.showToast(
                isStoreOpen
                    ? "Resto dibuka otomatis mengikuti jadwal operasional."
                    : "Resto ditutup otomatis mengikuti jadwal operasional.",
                "info"
            );
        }
    } catch (err) {
        window.alert("Gagal memperbarui status buka/tutup resto: " + err.message, "error");
    }
}

/**
 * Protokol Sinkronisasi 2-Fase (Two-Phase Sync) & Antrean Pemulihan Koneksi (`japar_pending_rtdb_sync_v1`):
 * - Fase 1 (Firestore): Simpan `profile` (termasuk `nodeId`), `items`, dan `v: newVersionTs` ke Firestore `merchants/{uid}`.
 * - Fase 2 (RTDB): Panggil `tulisAmanRtdbIndex(uid, updatedProfile, newVersionTs, itemsList)`.
 * - Jika Fase 1 sukses tetapi Fase 2 gagal karena koneksi terputus, simpan ke `japar_pending_rtdb_sync_v1`.
 */
export async function simpanDanPublikasikanKatalogPenuh(options = {}) {
    const activeNode = getActiveNodeContext();
    const activeUser = getActiveMerchantUser();
    if (!activeUser || isSyncingStore) return;
    if (coalescedAutoPublishTimer) {
        clearTimeout(coalescedAutoPublishTimer);
        coalescedAutoPublishTimer = null;
    }

    const isAuto = Boolean(options && options.autoTriggered);
    if (!isAuto) {
        picuGetarSentuh(18);
        unlockAudioMerchant();
    }

    const updatedProfile = kumpulkanDataProfilDariForm();
    updatedProfile.nodeId = activeNode.nodeId;

    const inpDpMinEl = document.getElementById('store-input-dp-min');
    if (inpDpMinEl) inpDpMinEl.value = String(updatedProfile.dpMin);

    if (!updatedProfile.namaToko || updatedProfile.namaToko.length < 2) {
        return window.alert("Nama Resto minimal 2 karakter.", "warning");
    }
    if (!updatedProfile.alamat || !updatedProfile.wa) {
        return window.alert("Nama Resto, Alamat/Patokan, dan Nomor WhatsApp wajib diisi.", "warning");
    }
    if (!updatedProfile.melayaniDineIn && !updatedProfile.melayaniTakeaway && !updatedProfile.kurirWarungAktif) {
        return window.alert("Pilih minimal 1 layanan pesanan (Makan di Tempat, Ambil Sendiri, atau Kurir Internal) pada tab Profil Resto.", "warning");
    }

    const hasQris = Boolean(updatedProfile.qrisPublicId);
    const hasEwallet = Boolean(updatedProfile.ewallet.provider && updatedProfile.ewallet.number && updatedProfile.ewallet.holder);
    const hasBank = Boolean(updatedProfile.bank.name && updatedProfile.bank.number && updatedProfile.bank.holder);

    if (updatedProfile.wajibDp && !hasQris && !hasEwallet && !hasBank) {
        return window.alert("Karena saklar Wajib DP aktif, Anda wajib mengisi minimal 1 metode pembayaran (Foto QRIS, E-Wallet, atau Rekening Bank) di Profil Resto.", "warning");
    }

    const itemsList = getDaftarMenuAktif().slice(0, 300);

    const candidateSignature = hitungSignatureDataResto(updatedProfile, itemsList);
    if (lastSavedStateSignature && candidateSignature === lastSavedStateSignature && !hasUnsavedMenuChanges) {
        perbaruiIndikatorUnsaved(false);
        if (!options?.silentIfUnchanged) {
            window.showToast("Seluruh data profil dan katalog hidangan sudah berada pada versi terbaru.", "info");
        }
        return;
    }

    const newVersionTs = Date.now();

    isSyncingStore = true;
    const btnPublish = document.getElementById('btn-publish-catalog');
    const btnPublishLabel = document.getElementById('btn-publish-catalog-label');
    if (btnPublish) {
        btnPublish.disabled = true;
        if (btnPublishLabel) btnPublishLabel.textContent = 'MENYIMPAN...';
    }

    try {
        const uid = activeUser.uid;

        // FASE 1 (Firestore): Simpan profile (termasuk nodeId), items, dan v: newVersionTs
        await updateDoc(doc(activeNode.dbFirestore, "merchants", uid), {
            profile: updatedProfile,
            items: itemsList,
            v: newVersionTs
        });

        // FASE 2 (RTDB): Tulis indeks Diet Byte ke RTDB dengan fallback antrean offline
        let rtdbPhaseSucceeded = false;
        try {
            await tulisAmanRtdbIndex(uid, updatedProfile, newVersionTs, itemsList);
            rtdbPhaseSucceeded = true;
            try { localStorage.removeItem(PENDING_RTDB_SYNC_KEY); } catch (e) {}
        } catch (rtdbErr) {
            simpanAntreanSinkronisasiRtdbTertunda({
                uid: uid,
                nodeId: activeNode.nodeId,
                profile: updatedProfile,
                versionTs: newVersionTs,
                items: itemsList,
                savedAt: Date.now()
            });
        }

        if (!currentMerchantData) currentMerchantData = {};
        currentMerchantData.profile = updatedProfile;
        currentMerchantData.items = itemsList;
        currentMerchantData.v = newVersionTs;
        lastSavedStateSignature = candidateSignature;

        catatIkatanMetodeLoginResto(
            updatedProfile.email,
            updatedProfile.authMethod || 'EMAIL',
            uid,
            updatedProfile.namaToko,
            updatedProfile.wa,
            activeNode.nodeId
        );

        const headerTitle = document.getElementById('header-store-name');
        if (headerTitle) headerTitle.innerText = updatedProfile.namaToko;

        const headerCat = document.getElementById('header-store-category');
        if (headerCat) headerCat.innerText = formatLabelKategoriToko(updatedProfile.kategori);

        const coverUrl = bangunUrlGambarCloudinary(updatedProfile.fotoTokoPublicId, 400, updatedProfile.namaToko);
        const storeCoverImg = document.getElementById('store-cover-preview');
        if (storeCoverImg) storeCoverImg.src = coverUrl;
        const profileCoverImg = document.getElementById('store-profile-cover-preview');
        if (profileCoverImg) profileCoverImg.src = coverUrl;

        const storeQrisImg = document.getElementById('store-qris-preview');
        if (storeQrisImg) {
            storeQrisImg.src = bangunUrlGambarCloudinary(updatedProfile.qrisPublicId, 500, 'QRIS');
        }

        sinkronkanTampilanLayananOutlet();
        perbaruiVisualStatusTokoHeader();
        perbaruiCacheProfilTerverifikasi(updatedProfile, itemsList, newVersionTs);
        perbaruiIndikatorUnsaved(false);
        if (typeof window.kunciSemuaBrankasKeamananPanel === 'function') window.kunciSemuaBrankasKeamananPanel();

        if (rtdbPhaseSucceeded) {
            window.showToast(
                isAuto
                    ? `Perubahan katalog (${itemsList.length} menu) otomatis disimpan & ditayangkan ke publik.`
                    : `Katalog & profil resto (${itemsList.length} menu) berhasil disimpan dan ditayangkan.`,
                "success"
            );
        } else {
            window.showToast(
                `Katalog tersimpan di server utama. Indeks publik dimasukkan ke antrean otomatis saat koneksi stabil.`,
                "warning"
            );
        }
    } catch (err) {
        window.alert("Gagal menyimpan dan menayangkan katalog resto: " + err.message, "error");
    } finally {
        isSyncingStore = false;
        if (btnPublish) {
            btnPublish.disabled = false;
        }
        perbaruiIndikatorUnsaved(hasUnsavedMenuChanges);
    }
}

function mulaiPemantauJamOperasionalOtomatis() {
    if (autoScheduleTimer) clearInterval(autoScheduleTimer);
    const jamAwal = (document.getElementById('store-input-jam')?.value || '08:00-21:00').trim();
    const activeDaysAwal = getHariOperasionalAktifDariForm();
    lastAutoScheduleState = cekDalamJamOperasional(jamAwal, new Date(), activeDaysAwal);

    if (isAutoScheduleEnabled && lastAutoScheduleState !== isStoreOpen) {
        eksekusiToggleBukaTutupInstan(lastAutoScheduleState, 'AUTO_SCHEDULE');
    }

    autoScheduleTimer = setInterval(() => {
        perbaruiVisualModeJadwalTabLokasi();
        if (!isAutoScheduleEnabled) return;
        const jamStr = (document.getElementById('store-input-jam')?.value || '08:00-21:00').trim();
        const activeDays = getHariOperasionalAktifDariForm();
        const seharusnyaBuka = cekDalamJamOperasional(jamStr, new Date(), activeDays);
        if (lastAutoScheduleState !== seharusnyaBuka || seharusnyaBuka !== isStoreOpen) {
            lastAutoScheduleState = seharusnyaBuka;
            if (seharusnyaBuka !== isStoreOpen) {
                eksekusiToggleBukaTutupInstan(seharusnyaBuka, 'AUTO_SCHEDULE');
            }
        }
    }, 45 * 1000);
}

function hidrasiDataMerchantKeUI(merchantDoc) {
    currentMerchantData = merchantDoc || {};
    const p = currentMerchantData.profile || {};
    const ewallet = p.ewallet || {};
    const bank = p.bank || {};
    const items = Array.isArray(currentMerchantData.items) ? currentMerchantData.items : [];

    isStoreOpen = Boolean(p.isOpen);
    isAutoScheduleEnabled = Boolean(p.autoSchedule);

    const setVal = (id, val) => {
        const el = document.getElementById(id);
        if (el) el.value = val ?? '';
    };

    const cleanKat = normalisasiKategoriTokoJapar(p.kategori, items);
    if (currentMerchantData.profile) {
        currentMerchantData.profile.kategori = cleanKat;
    }

    const fotoId = bersihkanPublicIdCloudinary(p.fotoTokoPublicId || p.img || '');
    const qrisId = bersihkanPublicIdCloudinary(p.qrisPublicId || '');
    const parsedJam = uraiRentangJamOperasional(p.jamBukaTutup || '08:00-21:00');
    const cleanDays = normalisasiArrayHariOperasional(p.hariOperasional);
    const cleanSkemaDiskon = ['MAX_BEST', 'ITEM_OVERRIDE', 'STACK_ADD'].includes(p.skemaDiskonGlobal)
        ? p.skemaDiskonGlobal
        : 'MAX_BEST';

    setVal('store-input-nama', p.namaToko || '');
    setVal('store-input-pemilik', p.pemilik || '');
    setVal('store-input-wa', p.wa || '');
    setVal('store-input-kategori', cleanKat);
    setVal('store-input-alamat', p.alamat || '');
    setVal('store-input-jam', parsedJam.normalized);
    setVal('store-input-jam-mulai', parsedJam.startStr);
    setVal('store-input-jam-selesai', parsedJam.endStr);
    setVal('inline-input-jam-buka', parsedJam.startStr);
    setVal('inline-input-jam-tutup', parsedJam.endStr);
    setVal('store-input-hari-aktif', cleanDays.join(','));
    setVal('store-input-diskon', p.diskonTokoPersen || 0);
    setVal('store-select-discount-scheme', cleanSkemaDiskon);
    setVal('store-input-promo', p.promoSingkat || '');
    setVal('store-input-foto-cloudinary', fotoId);

    const chkDineIn = document.getElementById('toggle-melayani-dinein');
    if (chkDineIn) {
        chkDineIn.checked = (p.melayaniDineIn !== undefined) ? Boolean(p.melayaniDineIn) : true;
    }
    const chkTakeaway = document.getElementById('toggle-melayani-takeaway');
    if (chkTakeaway) {
        chkTakeaway.checked = (p.melayaniTakeaway !== undefined) ? Boolean(p.melayaniTakeaway) : true;
    }
    const chkKurirWarung = document.getElementById('toggle-kurir-warung');
    if (chkKurirWarung) chkKurirWarung.checked = Boolean(p.kurirWarungAktif);
    setVal('store-input-info-ongkir-warung', p.infoOngkirWarung || '');
    const hydratedTarif = p.tarifOngkir !== undefined
        ? Number(p.tarifOngkir)
        : (() => {
            const m = String(p.infoOngkirWarung || '').match(/(?:rp\.?\s*)?(\d{1,3}(?:[.,]\d{3})+|[1-9]\d{2,6})/i);
            return m ? (parseInt(m[1].replace(/[.,]/g, ''), 10) || 0) : '';
        })();
    setVal('store-input-tarif-ongkir', hydratedTarif);
    sinkronkanTampilanLayananOutlet();

    const chkWajibDp = document.getElementById('toggle-wajib-dp');
    if (chkWajibDp) {
        chkWajibDp.checked = (p.wajibDp !== undefined) ? Boolean(p.wajibDp) : true;
    }
    sinkronkanTampilanSaklarWajibDpProfil();

    setVal('store-input-dp-min', Math.max(5000, parseInt(p.dpMin, 10) || 10000));
    setVal('store-input-qris-cloudinary', qrisId);
    setVal('store-input-ewallet-provider', ewallet.provider || '');
    setVal('store-input-ewallet-number', ewallet.number || '');
    setVal('store-input-ewallet-name', ewallet.holder || '');
    setVal('store-input-bank-name', bank.name || '');
    setVal('store-input-bank-number', bank.number || '');
    setVal('store-input-bank-holder', bank.holder || '');

    const headerTitle = document.getElementById('header-store-name');
    if (headerTitle) headerTitle.innerText = p.namaToko || 'Nama Resto Anda';

    const headerCat = document.getElementById('header-store-category');
    if (headerCat) headerCat.innerText = formatLabelKategoriToko(cleanKat);

    const coverUrl = bangunUrlGambarCloudinary(fotoId, 400, p.namaToko || 'Resto');
    const storeCoverImg = document.getElementById('store-cover-preview');
    if (storeCoverImg) storeCoverImg.src = coverUrl;
    const profileCoverImg = document.getElementById('store-profile-cover-preview');
    if (profileCoverImg) profileCoverImg.src = coverUrl;

    const storeQrisImg = document.getElementById('store-qris-preview');
    if (storeQrisImg) {
        storeQrisImg.src = bangunUrlGambarCloudinary(qrisId, 500, 'QRIS');
    }

    const chkAutoSchedule = document.getElementById('toggle-auto-schedule');
    if (chkAutoSchedule) chkAutoSchedule.checked = isAutoScheduleEnabled;

    const chkBiometric = document.getElementById('toggle-merchant-biometric');
    if (chkBiometric) chkBiometric.checked = !!localStorage.getItem('japar_merchant_bio_id');

    const center = DEFAULT_CENTER_PARE || { lat: -7.768049, lng: 112.196514 };
    perbaruiVisualStatusTokoHeader();
    inisialisasiKoordinatWarung(p.lat ?? center.lat, p.lng ?? center.lng);

    inisialisasiManajemenMenu(
        items,
        p.diskonTokoPersen || 0,
        (updatedItems, reason, detail) => {
            if (reason === 'MODAL_SAVE') {
                const msg = detail?.isEdit
                    ? `Menu "${detail.itemName}" diperbarui`
                    : `Menu baru "${detail?.itemName || 'Hidangan'}" ditambahkan`;
                perbaruiIndikatorUnsaved(true, `${msg} • Menyinkronkan ke katalog...`);
                jadwalkanAutoPublishKoalesensi(900, `${msg} • Menyimpan otomatis ke server...`);
            } else if (reason === 'BULK_JSON_APPLY') {
                const msg = `JSON Diterapkan (${detail?.addedCount || 0} baru, ${detail?.updatedCount || 0} update)`;
                perbaruiIndikatorUnsaved(true, `${msg} • Siap ditayangkan`);
                jadwalkanAutoPublishKoalesensi(2200, `${msg} • Menyinkronkan ke server...`);
            } else if (reason === 'QUICK_PHOTO_UPLOAD') {
                const msg = `Foto "${detail?.itemName || 'Menu'}" dipasang`;
                perbaruiIndikatorUnsaved(true, `${msg} • Menyimpan ke katalog...`);
                jadwalkanAutoPublishKoalesensi(1200, `${msg} • Menyimpan ke server...`);
            } else if (reason === 'DELETE_ITEM') {
                perbaruiIndikatorUnsaved(true, `Menu "${detail?.itemName || ''}" dihapus`);
                jadwalkanAutoPublishKoalesensi(900, `Menyimpan penghapusan menu ke server...`);
            } else if (reason === 'STOCK_TOGGLE') {
                const statusWord = detail?.isReady ? 'SIAP DIPESAN' : 'HABIS HARI INI';
                perbaruiIndikatorUnsaved(true, `Status "${detail?.itemName || 'Menu'}" -> ${statusWord}`);
                jadwalkanAutoPublishKoalesensi(2000, `Menyinkronkan status stok (${statusWord}) ke server...`);
            } else if (reason === 'BULK_STOCK_RESET') {
                perbaruiIndikatorUnsaved(true, `${detail?.count || 0} menu disetel Siap Dipesan`);
                jadwalkanAutoPublishKoalesensi(1200, `Menyinkronkan ${detail?.count || 0} menu siap dipesan ke server...`);
            } else {
                perbaruiIndikatorUnsaved(true, 'Daftar menu telah diubah');
            }
        },
        cleanSkemaDiskon
    );

    const cleanProfileSnapshot = kumpulkanDataProfilDariForm();
    lastSavedStateSignature = hitungSignatureDataResto(cleanProfileSnapshot, getDaftarMenuAktif());
    perbaruiIndikatorUnsaved(false);
    mulaiPemantauJamOperasionalOtomatis();
    terapkanTemaPanel(getPreferensiTemaTersimpan(), false);
    prosesAntreanSinkronisasiRtdbTertunda();
}

window.addEventListener('merchantDataLoaded', (e) => {
    hidrasiDataMerchantKeUI(e.detail);
});

window.addEventListener('beforeunload', (e) => {
    if (hasUnsavedMenuChanges && !isSyncingStore) {
        e.preventDefault();
        e.returnValue = 'Ada perubahan katalog/profil resto yang belum ditayangkan ke database.';
        return e.returnValue;
    }
});

(() => {
    const inisialisasiEventDashboard = () => {
        pasangEventPenentuLokasiWarung(() => {
            perbaruiIndikatorUnsaved(true, 'Titik koordinat / alamat lokasi diubah');
        });
        pasangEventManajemenMenu();
        prosesAntreanSinkronisasiRtdbTertunda();

        if (window.__JAPAR_MERCHANT_DATA_BUFFER) {
            hidrasiDataMerchantKeUI(window.__JAPAR_MERCHANT_DATA_BUFFER);
        }

        document.querySelectorAll('.merchant-tab-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                unlockAudioMerchant();
                picuGetarSentuh(10);
                const targetId = btn.getAttribute('data-tab');
                document.querySelectorAll('.merchant-tab-btn').forEach(b => {
                    b.classList.remove('text-orange-400', 'border-orange-500/45', 'bg-orange-500/15');
                    b.classList.add('text-stone-400', 'border-transparent');
                });
                btn.classList.remove('text-stone-400', 'border-transparent');
                btn.classList.add('text-orange-400', 'border-orange-500/45', 'bg-orange-500/15');

                document.querySelectorAll('.merchant-tab-view').forEach(view => {
                    view.classList.add('hidden-state');
                });
                const activeView = document.getElementById(targetId);
                if (activeView) activeView.classList.remove('hidden-state');

                if (targetId === 'tab-studio-json') {
                    sinkronkanPreviewPromptAiUI();
                    evaluasiDanRenderPreviewStudioJson();
                }
            });
        });

        const chkAutoSyncMenu = document.getElementById('toggle-auto-sync-menu');
        if (chkAutoSyncMenu) {
            chkAutoSyncMenu.checked = isAutoSyncMenuEnabled;
            chkAutoSyncMenu.addEventListener('change', (e) => {
                picuGetarSentuh(10);
                isAutoSyncMenuEnabled = Boolean(e.target.checked);
                window.showToast(
                    isAutoSyncMenuEnabled
                        ? "Auto-Tayang Katalog Aktif: Tambah/ubah menu & saklar stok langsung tersimpan otomatis ke database."
                        : "Auto-Tayang Katalog Nonaktif: Tekan tombol Tayangkan secara manual setelah selesai mengedit.",
                    "info"
                );
            });
        }

        const btnOpenLuxuryTime = document.getElementById('btn-open-luxury-time-picker');
        const btnHeaderOpenTime = document.getElementById('btn-header-open-time-modal');
        const btnRegOpenTime = document.getElementById('btn-open-reg-luxury-time');
        const btnCloseLuxuryTime = document.getElementById('btn-close-luxury-time-modal');
        const btnApplyLuxuryTime = document.getElementById('btn-apply-luxury-time-modal');
        const btnSlotOpen = document.getElementById('luxury-slot-btn-open');
        const btnSlotClose = document.getElementById('luxury-slot-btn-close');

        if (btnOpenLuxuryTime) {
            btnOpenLuxuryTime.addEventListener('click', () => {
                picuGetarSentuh(10);
                bukaModalJamOperasionalMewah('STORE');
            });
        }
        if (btnHeaderOpenTime) {
            btnHeaderOpenTime.addEventListener('click', () => {
                picuGetarSentuh(10);
                bukaModalJamOperasionalMewah('STORE');
            });
        }
        if (btnRegOpenTime) {
            btnRegOpenTime.addEventListener('click', () => {
                picuGetarSentuh(10);
                bukaModalJamOperasionalMewah('REG');
            });
        }
        if (btnCloseLuxuryTime) {
            btnCloseLuxuryTime.addEventListener('click', () => {
                document.getElementById('japar-luxury-time-modal')?.classList.add('hidden-state');
            });
        }
        if (btnSlotOpen) {
            btnSlotOpen.addEventListener('click', () => {
                picuGetarSentuh(8);
                luxuryActiveSlot = 'OPEN';
                renderVisualModalJamMewah();
            });
        }
        if (btnSlotClose) {
            btnSlotClose.addEventListener('click', () => {
                picuGetarSentuh(8);
                luxuryActiveSlot = 'CLOSE';
                renderVisualModalJamMewah();
            });
        }

        document.querySelectorAll('.luxury-min-cell').forEach(btn => {
            btn.addEventListener('click', () => {
                picuGetarSentuh(8);
                const mn = parseInt(btn.getAttribute('data-min') || '0', 10);
                if (luxuryActiveSlot === 'OPEN') {
                    luxuryOpenMin = mn;
                    luxuryActiveSlot = 'CLOSE';
                } else {
                    luxuryCloseMin = mn;
                }
                renderVisualModalJamMewah();
            });
        });

        document.querySelectorAll('.luxury-preset-shift').forEach(btn => {
            btn.addEventListener('click', () => {
                picuGetarSentuh(10);
                const val = btn.getAttribute('data-jam') || '08:00-21:00';
                const parsed = uraiRentangJamOperasional(val);
                luxuryOpenHour = parsed.startH;
                luxuryOpenMin = parsed.startM;
                luxuryCloseHour = parsed.endH;
                luxuryCloseMin = parsed.endM;
                renderVisualModalJamMewah();
            });
        });

        document.querySelectorAll('#luxury-days-container .luxury-day-chip').forEach(chip => {
            chip.addEventListener('click', () => {
                picuGetarSentuh(8);
                const d = parseInt(chip.getAttribute('data-day') || '0', 10);
                if (luxurySelectedDays.includes(d)) {
                    if (luxurySelectedDays.length > 1) {
                        luxurySelectedDays = luxurySelectedDays.filter(x => x !== d);
                    } else {
                        window.showToast('Pilih minimal 1 hari operasional buka dalam seminggu.', 'warning');
                    }
                } else {
                    luxurySelectedDays = normalisasiArrayHariOperasional([...luxurySelectedDays, d]);
                }
                renderVisualModalJamMewah();
            });
        });

        document.getElementById('btn-luxury-days-all')?.addEventListener('click', () => {
            picuGetarSentuh(8);
            luxurySelectedDays = [1, 2, 3, 4, 5, 6, 0];
            renderVisualModalJamMewah();
        });
        document.getElementById('btn-luxury-days-mon-sat')?.addEventListener('click', () => {
            picuGetarSentuh(8);
            luxurySelectedDays = [1, 2, 3, 4, 5, 6];
            renderVisualModalJamMewah();
        });
        document.getElementById('btn-luxury-days-mon-fri')?.addEventListener('click', () => {
            picuGetarSentuh(8);
            luxurySelectedDays = [1, 2, 3, 4, 5];
            renderVisualModalJamMewah();
        });

        // Listener Input Ketik Teks Jam Buka & Jam Tutup di dalam Modal
        const inpModalOpen = document.getElementById('luxury-input-open-time');
        const inpModalClose = document.getElementById('luxury-input-close-time');
        if (inpModalOpen) {
            inpModalOpen.addEventListener('input', (e) => {
                const p = parseInputJamKetikPintar(e.target.value, luxuryOpenHour, luxuryOpenMin);
                luxuryOpenHour = p.h;
                luxuryOpenMin = p.m;
                renderVisualModalJamMewah();
            });
            inpModalOpen.addEventListener('blur', (e) => {
                const p = parseInputJamKetikPintar(e.target.value, luxuryOpenHour, luxuryOpenMin);
                luxuryOpenHour = p.h;
                luxuryOpenMin = p.m;
                e.target.value = p.str;
                renderVisualModalJamMewah();
            });
        }
        if (inpModalClose) {
            inpModalClose.addEventListener('input', (e) => {
                const p = parseInputJamKetikPintar(e.target.value, luxuryCloseHour, luxuryCloseMin);
                luxuryCloseHour = p.h;
                luxuryCloseMin = p.m;
                renderVisualModalJamMewah();
            });
            inpModalClose.addEventListener('blur', (e) => {
                const p = parseInputJamKetikPintar(e.target.value, luxuryCloseHour, luxuryCloseMin);
                luxuryCloseHour = p.h;
                luxuryCloseMin = p.m;
                e.target.value = p.str;
                renderVisualModalJamMewah();
            });
        }

        // Listener Input Ketik Langsung Jam Buka & Jam Tutup di Tab Jam & Peta
        const inlineBuka = document.getElementById('inline-input-jam-buka');
        const inlineTutup = document.getElementById('inline-input-jam-tutup');
        const terapkanPerubahanJamInline = () => {
            const curParsed = uraiRentangJamOperasional(document.getElementById('store-input-jam')?.value || '08:00-21:00');
            const pOpen = parseInputJamKetikPintar(inlineBuka?.value || curParsed.startStr, curParsed.startH, curParsed.startM);
            const pClose = parseInputJamKetikPintar(inlineTutup?.value || curParsed.endStr, curParsed.endH, curParsed.endM);
            if (inlineBuka) inlineBuka.value = pOpen.str;
            if (inlineTutup) inlineTutup.value = pClose.str;
            const newJamStr = `${pOpen.str}-${pClose.str}`;
            sinkronkanInputTimePickerJam(newJamStr);
            perbaruiIndikatorUnsaved(true, `Jam operasional diubah ke ${newJamStr} WIB`);
            if (isAutoScheduleEnabled) {
                const activeDays = getHariOperasionalAktifDariForm();
                const inHours = cekDalamJamOperasional(newJamStr, new Date(), activeDays);
                if (inHours !== isStoreOpen) {
                    eksekusiToggleBukaTutupInstan(inHours, 'AUTO_SCHEDULE');
                }
            }
            jadwalkanAutoPublishKoalesensi(1600, 'Menyimpan jam operasional...');
        };
        if (inlineBuka) {
            inlineBuka.addEventListener('change', terapkanPerubahanJamInline);
            inlineBuka.addEventListener('blur', terapkanPerubahanJamInline);
        }
        if (inlineTutup) {
            inlineTutup.addEventListener('change', terapkanPerubahanJamInline);
            inlineTutup.addEventListener('blur', terapkanPerubahanJamInline);
        }

        if (btnApplyLuxuryTime) {
            btnApplyLuxuryTime.addEventListener('click', () => {
                picuGetarSentuh(15);
                if (inpModalOpen) {
                    const pO = parseInputJamKetikPintar(inpModalOpen.value, luxuryOpenHour, luxuryOpenMin);
                    luxuryOpenHour = pO.h;
                    luxuryOpenMin = pO.m;
                }
                if (inpModalClose) {
                    const pC = parseInputJamKetikPintar(inpModalClose.value, luxuryCloseHour, luxuryCloseMin);
                    luxuryCloseHour = pC.h;
                    luxuryCloseMin = pC.m;
                }
                const newJam = `${formatDuaDigit(luxuryOpenHour)}:${formatDuaDigit(luxuryOpenMin)}-${formatDuaDigit(luxuryCloseHour)}:${formatDuaDigit(luxuryCloseMin)}`;
                const labelHari = formatLabelHariOperasional(luxurySelectedDays);

                if (luxuryModalTarget === 'REG') {
                    const regInp = document.getElementById('reg-jam');
                    const regDaysInp = document.getElementById('reg-hari-aktif');
                    const regDisp = document.getElementById('reg-jam-display-text');
                    if (regInp) regInp.value = newJam;
                    if (regDaysInp) regDaysInp.value = luxurySelectedDays.join(',');
                    if (regDisp) regDisp.textContent = `${newJam.replace('-', ' – ')} WIB (${labelHari})`;
                } else {
                    sinkronkanInputTimePickerJam(newJam, luxurySelectedDays);
                    perbaruiIndikatorUnsaved(true, `Jadwal operasional disetel ke ${newJam} WIB (${labelHari})`);
                    if (isAutoScheduleEnabled) {
                        const inHours = cekDalamJamOperasional(newJam, new Date(), luxurySelectedDays);
                        if (inHours !== isStoreOpen) {
                            eksekusiToggleBukaTutupInstan(inHours, 'AUTO_SCHEDULE');
                        }
                    }
                    jadwalkanAutoPublishKoalesensi(1600, 'Menyimpan jadwal operasional resto...');
                }

                document.getElementById('japar-luxury-time-modal')?.classList.add('hidden-state');
                window.showToast(`Jadwal operasional disetel: ${newJam} WIB (${labelHari}).`, 'success');
            });
        }

        const termsModal = document.getElementById('merchant-terms-modal');
        const closeTermsModal = () => {
            if (termsModal) termsModal.classList.add('hidden-state');
        };
        document.querySelectorAll('.btn-open-terms').forEach(btn => {
            btn.addEventListener('click', () => {
                picuGetarSentuh(10);
                if (termsModal) termsModal.classList.remove('hidden-state');
            });
        });
        const btnCloseTerms = document.getElementById('btn-close-terms-modal');
        if (btnCloseTerms) btnCloseTerms.addEventListener('click', closeTermsModal);
        const btnAcceptTerms = document.getElementById('btn-accept-terms-modal');
        if (btnAcceptTerms) btnAcceptTerms.addEventListener('click', closeTermsModal);

        const toggleOpen = document.getElementById('toggle-store-open');
        if (toggleOpen) {
            toggleOpen.addEventListener('change', (e) => {
                picuGetarSentuh(18);
                eksekusiToggleBukaTutupInstan(e.target.checked, 'MANUAL');
            });
        }

        const setScheduleMode = (enableAuto) => {
            picuGetarSentuh(12);
            isAutoScheduleEnabled = Boolean(enableAuto);
            perbaruiVisualStatusTokoHeader();
            perbaruiIndikatorUnsaved(true, isAutoScheduleEnabled ? 'Mode Jadwal Otomatis diaktifkan' : 'Mode Saklar Manual diaktifkan');
            if (isAutoScheduleEnabled) {
                const jamStr = (document.getElementById('store-input-jam')?.value || '08:00-21:00').trim();
                const activeDays = getHariOperasionalAktifDariForm();
                const inHours = cekDalamJamOperasional(jamStr, new Date(), activeDays);
                lastAutoScheduleState = inHours;
                if (inHours !== isStoreOpen) {
                    eksekusiToggleBukaTutupInstan(inHours, 'AUTO_SCHEDULE');
                }
                window.showToast("Mode Otomatis Aktif: Resto akan buka/tutup mengikuti jam & hari operasional.", "success");
            } else {
                window.showToast("Mode Saklar Manual Aktif: Status buka/tutup resto dikendalikan penuh lewat saklar atas.", "info");
            }
            jadwalkanAutoPublishKoalesensi(1800, 'Menyimpan pengaturan jadwal operasional...');
        };

        const toggleAuto = document.getElementById('toggle-auto-schedule');
        if (toggleAuto) {
            toggleAuto.addEventListener('change', (e) => {
                setScheduleMode(e.target.checked);
                renderVisualModalJamMewah();
            });
        }
        const modalToggleAuto = document.getElementById('modal-toggle-auto-schedule');
        if (modalToggleAuto) {
            modalToggleAuto.addEventListener('change', (e) => {
                setScheduleMode(e.target.checked);
                renderVisualModalJamMewah();
            });
        }

        const btnModeManual = document.getElementById('btn-schedule-mode-manual');
        const btnModeAuto = document.getElementById('btn-schedule-mode-auto');
        if (btnModeManual) btnModeManual.addEventListener('click', () => setScheduleMode(false));
        if (btnModeAuto) btnModeAuto.addEventListener('click', () => setScheduleMode(true));

        document.querySelectorAll('.btn-preset-jam').forEach(btn => {
            btn.addEventListener('click', () => {
                picuGetarSentuh(10);
                const val = btn.getAttribute('data-jam') || '08:00-21:00';
                sinkronkanInputTimePickerJam(val);
                perbaruiIndikatorUnsaved(true, `Jam operasional disetel ke ${val}`);
                if (isAutoScheduleEnabled) {
                    const activeDays = getHariOperasionalAktifDariForm();
                    const inHours = cekDalamJamOperasional(val, new Date(), activeDays);
                    if (inHours !== isStoreOpen) {
                        eksekusiToggleBukaTutupInstan(inHours, 'AUTO_SCHEDULE');
                    }
                }
                jadwalkanAutoPublishKoalesensi(1600, 'Menyimpan jam operasional...');
            });
        });

        const btnPresetResto = document.getElementById('btn-preset-outlet-resto');
        const btnPresetRumahan = document.getElementById('btn-preset-outlet-rumahan');
        if (btnPresetResto) {
            btnPresetResto.addEventListener('click', () => {
                picuGetarSentuh(10);
                const chkDineIn = document.getElementById('toggle-melayani-dinein');
                const chkTakeaway = document.getElementById('toggle-melayani-takeaway');
                if (chkDineIn) chkDineIn.checked = true;
                if (chkTakeaway) chkTakeaway.checked = true;
                sinkronkanTampilanLayananOutlet();
                perbaruiIndikatorUnsaved(true, 'Tipe layanan disetel ke Resto / Warung Fisik (Bisa Makan di Tempat)');
            });
        }
        if (btnPresetRumahan) {
            btnPresetRumahan.addEventListener('click', () => {
                picuGetarSentuh(10);
                const chkDineIn = document.getElementById('toggle-melayani-dinein');
                const chkTakeaway = document.getElementById('toggle-melayani-takeaway');
                const chkKurir = document.getElementById('toggle-kurir-warung');
                if (chkDineIn) chkDineIn.checked = false;
                if (chkTakeaway) chkTakeaway.checked = true;
                if (chkKurir) chkKurir.checked = true;
                sinkronkanTampilanLayananOutlet();
                perbaruiIndikatorUnsaved(true, 'Tipe layanan disetel ke Outlet Rumahan (Tanpa Makan di Tempat)');
            });
        }

        ['toggle-melayani-dinein', 'toggle-melayani-takeaway', 'toggle-kurir-warung'].forEach(id => {
            const el = document.getElementById(id);
            if (el) {
                el.addEventListener('change', () => {
                    picuGetarSentuh(10);
                    sinkronkanTampilanLayananOutlet();
                    perbaruiIndikatorUnsaved(true, 'Opsi layanan pesanan diubah');
                });
            }
        });

        const toggleWajibDp = document.getElementById('toggle-wajib-dp');
        if (toggleWajibDp) {
            toggleWajibDp.addEventListener('change', () => {
                picuGetarSentuh(12);
                sinkronkanTampilanSaklarWajibDpProfil();
                perbaruiIndikatorUnsaved(true, 'Skema pembayaran DP diubah');
            });
        }

        const inpDiskonToko = document.getElementById('store-input-diskon');
        if (inpDiskonToko) {
            inpDiskonToko.addEventListener('input', (e) => {
                const val = Math.min(99, Math.max(0, parseInt(e.target.value || '0', 10) || 0));
                setDiskonTokoGlobalUntukKalkulasi(val);
                perbaruiIndikatorUnsaved(true, `Diskon Resto Global diubah ke ${val}%`);
            });
        }

        const selSkemaDiskon = document.getElementById('store-select-discount-scheme');
        if (selSkemaDiskon) {
            selSkemaDiskon.addEventListener('change', (e) => {
                picuGetarSentuh(10);
                const skema = e.target.value || 'MAX_BEST';
                setSkemaDiskonGlobalUntukKalkulasi(skema);
                perbaruiIndikatorUnsaved(true, 'Aturan perhitungan diskon global diubah');
            });
        }

        const inpDpMin = document.getElementById('store-input-dp-min');
        if (inpDpMin) {
            inpDpMin.addEventListener('change', (e) => {
                const val = Math.max(5000, parseInt(e.target.value || '10000', 10) || 10000);
                e.target.value = String(val);
                perbaruiIndikatorUnsaved(true, `Minimal DP diubah ke Rp ${val.toLocaleString('id-ID')}`);
            });
        }

        const btnUploadStoreFoto = document.getElementById('btn-upload-store-foto');
        const fileStoreFoto = document.getElementById('file-store-foto');
        const inpFotoCloudinary = document.getElementById('store-input-foto-cloudinary');
        const storeCoverImg = document.getElementById('store-cover-preview');
        const profileCoverImg = document.getElementById('store-profile-cover-preview');
        const statusStoreFoto = document.getElementById('status-upload-store-foto');

        if (btnUploadStoreFoto && fileStoreFoto) {
            btnUploadStoreFoto.addEventListener('click', () => {
                picuGetarSentuh(10);
                fileStoreFoto.value = '';
                fileStoreFoto.click();
            });

            fileStoreFoto.addEventListener('change', async (e) => {
                const file = e.target.files && e.target.files[0];
                if (!file) return;

                const origHtml = btnUploadStoreFoto.innerHTML;
                btnUploadStoreFoto.disabled = true;
                btnUploadStoreFoto.innerHTML = `<i class="fa-solid fa-circle-notch fa-spin"></i> Mengunggah...`;
                if (statusStoreFoto) {
                    statusStoreFoto.className = 'text-[0.62rem] text-amber-300 font-bold';
                    statusStoreFoto.textContent = 'Memproses gambar WebP & mengunggah...';
                }

                try {
                    const res = await unggahGambarKeCloudinary(file);
                    if (inpFotoCloudinary) inpFotoCloudinary.value = res.publicId;
                    if (storeCoverImg) storeCoverImg.src = res.previewUrl;
                    if (profileCoverImg) profileCoverImg.src = res.previewUrl;
                    if (statusStoreFoto) {
                        statusStoreFoto.className = 'text-[0.62rem] text-emerald-400 font-bold';
                        statusStoreFoto.textContent = `Foto sampul terunggah (${res.sizeKb} KB${res.fromCache ? ' • Tersimpan Otomatis' : ''})`;
                    }
                    perbaruiIndikatorUnsaved(true, 'Foto sampul resto baru diunggah');
                    jadwalkanAutoPublishKoalesensi(1200, 'Menyimpan foto sampul baru ke server...');
                } catch (err) {
                    if (statusStoreFoto) {
                        statusStoreFoto.className = 'text-[0.62rem] text-red-400 font-bold';
                        statusStoreFoto.textContent = 'Gagal mengunggah foto sampul';
                    }
                    window.alert('Gagal mengunggah foto sampul: ' + (err?.message || err), 'error');
                } finally {
                    btnUploadStoreFoto.disabled = false;
                    btnUploadStoreFoto.innerHTML = origHtml;
                }
            });
        }

        const btnUploadStoreQris = document.getElementById('btn-upload-store-qris');
        const fileStoreQris = document.getElementById('file-store-qris');
        const inpQrisCloudinary = document.getElementById('store-input-qris-cloudinary');
        const storeQrisImg = document.getElementById('store-qris-preview');
        const statusStoreQris = document.getElementById('status-upload-store-qris');

        if (btnUploadStoreQris && fileStoreQris) {
            btnUploadStoreQris.addEventListener('click', () => {
                picuGetarSentuh(10);
                fileStoreQris.value = '';
                fileStoreQris.click();
            });

            fileStoreQris.addEventListener('change', async (e) => {
                const file = e.target.files && e.target.files[0];
                if (!file) return;

                const origHtml = btnUploadStoreQris.innerHTML;
                btnUploadStoreQris.disabled = true;
                btnUploadStoreQris.innerHTML = `<i class="fa-solid fa-circle-notch fa-spin"></i> Mengunggah...`;
                if (statusStoreQris) {
                    statusStoreQris.className = 'text-[0.62rem] text-amber-300 font-bold';
                    statusStoreQris.textContent = 'Memproses gambar WebP & mengunggah...';
                }

                try {
                    const res = await unggahGambarKeCloudinary(file);
                    if (inpQrisCloudinary) inpQrisCloudinary.value = res.publicId;
                    if (storeQrisImg) storeQrisImg.src = res.qrisPreviewUrl;
                    if (statusStoreQris) {
                        statusStoreQris.className = 'text-[0.62rem] text-emerald-400 font-bold';
                        statusStoreQris.textContent = `Foto QRIS terunggah (${res.sizeKb} KB${res.fromCache ? ' • Tersimpan Otomatis' : ''})`;
                    }
                    perbaruiIndikatorUnsaved(true, 'Foto QRIS baru diunggah');
                    jadwalkanAutoPublishKoalesensi(1200, 'Menyimpan foto QRIS baru ke server...');
                } catch (err) {
                    if (statusStoreQris) {
                        statusStoreQris.className = 'text-[0.62rem] text-red-400 font-bold';
                        statusStoreQris.textContent = 'Gagal mengunggah foto QRIS';
                    }
                    window.alert('Gagal mengunggah foto QRIS: ' + (err?.message || err), 'error');
                } finally {
                    btnUploadStoreQris.disabled = false;
                    btnUploadStoreQris.innerHTML = origHtml;
                }
            });
        }

        const inpNamaResto = document.getElementById('store-input-nama');
        if (inpNamaResto) {
            inpNamaResto.addEventListener('input', (e) => {
                const val = e.target.value.trim();
                const headerTitle = document.getElementById('header-store-name');
                if (headerTitle && val) headerTitle.innerText = val;
                sinkronkanPreviewPromptAiUI();
                perbaruiIndikatorUnsaved(true, 'Nama resto diubah');
            });
        }

        const selStoreKategori = document.getElementById('store-input-kategori');
        if (selStoreKategori) {
            selStoreKategori.addEventListener('change', (e) => {
                const normKat = normalisasiKategoriTokoJapar(e.target.value, getDaftarMenuAktif());
                const headerCat = document.getElementById('header-store-category');
                if (headerCat) headerCat.innerText = formatLabelKategoriToko(normKat);
            });
        }

        [
            'store-input-pemilik',
            'store-input-wa',
            'store-input-kategori',
            'store-input-alamat',
            'store-input-promo',
            'store-input-ewallet-provider',
            'store-input-ewallet-number',
            'store-input-ewallet-name',
            'store-input-bank-name',
            'store-input-bank-number',
            'store-input-bank-holder',
            'store-input-info-ongkir-warung'
        ].forEach(id => {
            const el = document.getElementById(id);
            if (el) {
                el.addEventListener('input', () => perbaruiIndikatorUnsaved(true, 'Data profil / promo resto diubah'));
                el.addEventListener('change', () => {
                    sinkronkanPreviewPromptAiUI();
                    perbaruiIndikatorUnsaved(true, 'Data profil / promo resto diubah');
                });
            }
        });

        document.querySelectorAll('.btn-trigger-publish').forEach(btn => {
            btn.addEventListener('click', () => simpanDanPublikasikanKatalogPenuh({ autoTriggered: false }));
        });

        const btnDiscardUnsaved = document.getElementById('btn-discard-unsaved');
        if (btnDiscardUnsaved) {
            btnDiscardUnsaved.addEventListener('click', () => {
                picuGetarSentuh(10);
                if (coalescedAutoPublishTimer) {
                    clearTimeout(coalescedAutoPublishTimer);
                    coalescedAutoPublishTimer = null;
                }
                if (currentMerchantData) {
                    hidrasiDataMerchantKeUI(currentMerchantData);
                    window.showToast("Perubahan yang belum disimpan telah dibatalkan.", "info");
                }
            });
        }

        const chkBio = document.getElementById('toggle-merchant-biometric');
        if (chkBio) {
            chkBio.addEventListener('change', async (e) => {
                const ok = await toggleBiometrikMerchant(e.target.checked);
                if (e.target.checked && !ok) {
                    e.target.checked = false;
                }
            });
        }

        const btnForceSync = document.getElementById('btn-force-sync-server');
        if (btnForceSync) {
            btnForceSync.addEventListener('click', sinkronisasiPaksaProfilDariServer);
        }
    };

    if (document.readyState === "loading") {
        document.addEventListener("DOMContentLoaded", inisialisasiEventDashboard, { once: true });
    } else {
        inisialisasiEventDashboard();
    }
})();


// ==========================================================================
// SISTEM PENGUNCIAN GEMBOK KEAMANAN ALAMAT/LOKASI (ANTI SALAH PENCET SAAT SCROLL)
// + VERIFIKASI CAPTCHA PENJUMLAHAN / KODE ANGKA & NAVBAR BAWAH OTOMATIS BUKA/TUTUP
// ==========================================================================
let captchaExpectedAnswer = '';
let captchaMode = 'MATH'; // 'MATH' | 'CODE'
let captchaSuccessCallback = null;
let isVaultLokasiUnlocked = false;
let isVaultProfilUnlocked = false;

function bangkitkanSoalCaptchaKeamanan(preferMode = null) {
    if (preferMode) captchaMode = preferMode;
    const modeLabelEl = document.getElementById('captcha-challenge-mode-label');
    const dispEl = document.getElementById('captcha-challenge-display');
    const inpEl = document.getElementById('input-captcha-answer');
    const errEl = document.getElementById('captcha-error-text');

    if (errEl) errEl.classList.add('hidden-state');
    if (inpEl) inpEl.value = '';

    if (captchaMode === 'MATH') {
        const a = Math.floor(11 + Math.random() * 19);
        const b = Math.floor(3 + Math.random() * 14);
        captchaExpectedAnswer = String(a + b);
        if (modeLabelEl) modeLabelEl.textContent = 'Verifikasi Penjumlahan Angka';
        if (dispEl) dispEl.textContent = `${a} + ${b} = ?`;
    } else {
        const code4 = String(Math.floor(1000 + Math.random() * 9000));
        captchaExpectedAnswer = code4;
        if (modeLabelEl) modeLabelEl.textContent = 'Verifikasi Kode Angka 4-Digit';
        if (dispEl) dispEl.textContent = `Ketik: ${code4}`;
    }
}

export function mintaVerifikasiCaptchaKeamanan(judul, deskripsi, onVerifiedCallback) {
    const modal = document.getElementById('japar-security-captcha-modal');
    const titleEl = document.getElementById('captcha-modal-title');
    const descEl = document.getElementById('captcha-modal-desc');
    const inpEl = document.getElementById('input-captcha-answer');

    if (!modal) {
        if (typeof onVerifiedCallback === 'function') onVerifiedCallback();
        return;
    }

    if (titleEl && judul) titleEl.textContent = judul;
    if (descEl && deskripsi) descEl.textContent = deskripsi;

    captchaSuccessCallback = onVerifiedCallback;
    bangkitkanSoalCaptchaKeamanan('MATH');
    modal.classList.remove('hidden-state');
    setTimeout(() => {
        if (inpEl) inpEl.focus();
    }, 80);
}
window.mintaVerifikasiCaptchaKeamanan = mintaVerifikasiCaptchaKeamanan;

function aturStatusGembokVaultLokasi(unlocked) {
    isVaultLokasiUnlocked = Boolean(unlocked);
    const vault = document.getElementById('vault-lokasi-peta');
    const badge = document.getElementById('vault-lokasi-status-badge');
    const btn = document.getElementById('btn-toggle-vault-lokasi');
    const fieldIds = [
        'btn-use-device-gps',
        'input-merchant-gmaps-raw',
        'btn-paste-merchant-gmaps',
        'btn-extract-merchant-gmaps',
        'store-input-lat',
        'store-input-lng'
    ];

    if (vault) {
        vault.classList.toggle('is-vault-locked', !isVaultLokasiUnlocked);
        vault.classList.toggle('is-vault-unlocked', isVaultLokasiUnlocked);
    }
    fieldIds.forEach(id => {
        const el = document.getElementById(id);
        if (el) el.disabled = !isVaultLokasiUnlocked;
    });

    if (badge) {
        badge.className = isVaultLokasiUnlocked
            ? 'text-[0.62rem] font-extrabold uppercase text-emerald-400 flex items-center gap-1.5'
            : 'text-[0.62rem] font-extrabold uppercase text-amber-300 flex items-center gap-1.5';
        badge.innerHTML = isVaultLokasiUnlocked
            ? '<i class="fa-solid fa-lock-open text-emerald-400"></i><span>GEMBOK TERBUKA (SILAKAN UBAH TITIK LOKASI)</span>'
            : '<i class="fa-solid fa-lock text-orange-400"></i><span>TERKUNCI AMAN (ANTI SALAH PENCET SAAT SCROLL)</span>';
    }
    if (btn) {
        btn.innerHTML = isVaultLokasiUnlocked
            ? '<i class="fa-solid fa-lock"></i><span>Kunci Kembali</span>'
            : '<i class="fa-solid fa-unlock-keyhole"></i><span>Buka Gembok Lokasi</span>';
    }
}

function aturStatusGembokVaultProfil(unlocked) {
    isVaultProfilUnlocked = Boolean(unlocked);
    const vault = document.getElementById('vault-profil-alamat');
    const badge = document.getElementById('vault-profil-status-badge');
    const btn = document.getElementById('btn-toggle-vault-profil');
    const fieldIds = [
        'store-input-nama',
        'store-input-kategori',
        'store-input-pemilik',
        'store-input-wa',
        'store-input-alamat'
    ];

    if (vault) {
        vault.classList.toggle('is-vault-locked', !isVaultProfilUnlocked);
        vault.classList.toggle('is-vault-unlocked', isVaultProfilUnlocked);
    }
    fieldIds.forEach(id => {
        const el = document.getElementById(id);
        if (el) el.disabled = !isVaultProfilUnlocked;
    });

    if (badge) {
        badge.className = isVaultProfilUnlocked
            ? 'text-[0.62rem] font-extrabold uppercase text-emerald-400 flex items-center gap-1.5'
            : 'text-[0.62rem] font-extrabold uppercase text-amber-300 flex items-center gap-1.5';
        badge.innerHTML = isVaultProfilUnlocked
            ? '<i class="fa-solid fa-lock-open text-emerald-400"></i><span>GEMBOK ALAMAT TERBUKA (MODE EDIT AKTIF)</span>'
            : '<i class="fa-solid fa-lock text-orange-400"></i><span>ALAMAT &amp; IDENTITAS RESTO TERKUNCI AMAN</span>';
    }
    if (btn) {
        btn.innerHTML = isVaultProfilUnlocked
            ? '<i class="fa-solid fa-lock"></i><span>Kunci Alamat</span>'
            : '<i class="fa-solid fa-unlock-keyhole"></i><span>Buka Gembok Alamat</span>';
    }
}

export function kunciSemuaBrankasKeamananPanel() {
    aturStatusGembokVaultLokasi(false);
    aturStatusGembokVaultProfil(false);
}
window.kunciSemuaBrankasKeamananPanel = kunciSemuaBrankasKeamananPanel;

function pasangSistemKeamananDanNavigasiOtomatis() {
    aturStatusGembokVaultLokasi(false);
    aturStatusGembokVaultProfil(false);

    const btnToggleLokasi = document.getElementById('btn-toggle-vault-lokasi');
    if (btnToggleLokasi) {
        btnToggleLokasi.addEventListener('click', () => {
            picuGetarSentuh(12);
            if (isVaultLokasiUnlocked) {
                aturStatusGembokVaultLokasi(false);
                window.showToast('Pengaturan titik koordinat & peta dikunci kembali dengan aman.', 'info');
            } else {
                mintaVerifikasiCaptchaKeamanan(
                    'Buka Gembok Titik Lokasi',
                    'Selesaikan penjumlahan angka ini untuk membuka penguncian titik koordinat & link Google Maps resto:',
                    () => {
                        aturStatusGembokVaultLokasi(true);
                        window.showToast('Gembok lokasi dibuka. Silakan sesuaikan titik koordinat lalu tekan Simpan.', 'success');
                    }
                );
            }
        });
    }

    const btnToggleProfil = document.getElementById('btn-toggle-vault-profil');
    if (btnToggleProfil) {
        btnToggleProfil.addEventListener('click', () => {
            picuGetarSentuh(12);
            if (isVaultProfilUnlocked) {
                aturStatusGembokVaultProfil(false);
                window.showToast('Pengaturan alamat & identitas resto dikunci kembali dengan aman.', 'info');
            } else {
                mintaVerifikasiCaptchaKeamanan(
                    'Buka Gembok Alamat & Profil',
                    'Selesaikan penjumlahan angka ini untuk membuka penguncian Alamat Lengkap, Nama Resto & Nomor WA:',
                    () => {
                        aturStatusGembokVaultProfil(true);
                        window.showToast('Gembok alamat & profil dibuka. Jangan lupa tekan Simpan setelah mengedit.', 'success');
                    }
                );
            }
        });
    }

    const modalCaptcha = document.getElementById('japar-security-captcha-modal');
    const closeCaptcha = () => {
        if (modalCaptcha) modalCaptcha.classList.add('hidden-state');
        captchaSuccessCallback = null;
    };

    document.getElementById('btn-close-captcha-modal')?.addEventListener('click', closeCaptcha);
    document.getElementById('btn-cancel-captcha-modal')?.addEventListener('click', closeCaptcha);
    document.getElementById('btn-switch-captcha-mode')?.addEventListener('click', () => {
        picuGetarSentuh(8);
        const nextMode = captchaMode === 'MATH' ? 'CODE' : 'MATH';
        bangkitkanSoalCaptchaKeamanan(nextMode);
    });

    const eksekusiVerifikasiCaptcha = () => {
        const inpEl = document.getElementById('input-captcha-answer');
        const errEl = document.getElementById('captcha-error-text');
        const userAns = String(inpEl?.value || '').trim();
        if (userAns && userAns === captchaExpectedAnswer) {
            picuGetarSentuh(16);
            const cb = captchaSuccessCallback;
            closeCaptcha();
            if (typeof cb === 'function') cb();
        } else {
            picuGetarSentuh([30, 50, 30]);
            if (errEl) errEl.classList.remove('hidden-state');
            bangkitkanSoalCaptchaKeamanan(captchaMode);
        }
    };

    document.getElementById('btn-submit-captcha-modal')?.addEventListener('click', eksekusiVerifikasiCaptcha);
    document.getElementById('input-captcha-answer')?.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
            e.preventDefault();
            eksekusiVerifikasiCaptcha();
        }
    });

    document.querySelectorAll('.merchant-tab-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            kunciSemuaBrankasKeamananPanel();
        });
    });

    const navBar = document.getElementById('merchant-bottom-nav');
    if (navBar) {
        navBar.classList.remove('is-nav-collapsed');
    }

    const inpTarifOngkir = document.getElementById('store-input-tarif-ongkir');
    if (inpTarifOngkir) {
        inpTarifOngkir.addEventListener('input', () => {
            perbaruiIndikatorUnsaved(true, 'Tarif ongkir kurir resto diubah');
        });
    }
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', pasangSistemKeamananDanNavigasiOtomatis, { once: true });
} else {
    pasangSistemKeamananDanNavigasiOtomatis();
}
