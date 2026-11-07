// ==========================================================================
// FILE: js/utils/ui-components.js (JAPAR PANEL)
// FUNGSI: Pengendali UI (#panel-notice-banner Multi-Baris Anti-Terpotong,
//         Modal Konfirmasi, Getar Sentuh, & Format Rupiah)
// ==========================================================================

let noticeBannerTimer = null;
let noticeHideTransitionTimer = null;
let activeModalResolver = null;

export function picuGetarSentuh(pola = 12) {
    try {
        if (typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function') {
            navigator.vibrate(pola);
        }
    } catch (e) {}
}
window.picuGetarSentuh = picuGetarSentuh;

export function formatRupiah(angka) {
    const num = Math.max(0, Math.round(Number(angka) || 0));
    return 'Rp ' + num.toLocaleString('id-ID');
}
window.formatRupiah = formatRupiah;

export function tutupNotifikasiPanel() {
    const banner = document.getElementById('panel-notice-banner');
    if (!banner) return;

    clearTimeout(noticeBannerTimer);
    clearTimeout(noticeHideTransitionTimer);

    banner.classList.add('opacity-0', '-translate-y-2');
    banner.classList.remove('opacity-100', 'translate-y-0');

    noticeHideTransitionTimer = setTimeout(() => {
        banner.classList.add('hidden-state');
    }, 260);
}
window.tutupNotifikasiPanel = tutupNotifikasiPanel;

export function showToast(message, type = 'info') {
    const banner = document.getElementById('panel-notice-banner');
    const card = document.getElementById('panel-notice-card');
    const iconWrap = document.getElementById('panel-notice-icon-wrap');
    const icon = document.getElementById('panel-notice-icon');
    const titleEl = document.getElementById('panel-notice-title');
    const msgEl = document.getElementById('panel-notice-msg');

    if (!banner || !card || !iconWrap || !icon || !msgEl) return;

    clearTimeout(noticeBannerTimer);
    clearTimeout(noticeHideTransitionTimer);

    let titleText = 'Informasi';
    let iconClass = 'fa-circle-info';
    let accentTextClass = 'text-amber-400';
    let iconBgClass = 'bg-amber-500/15 border border-amber-500/35';
    let borderClass = 'border-amber-500/40';

    if (type === 'success') {
        titleText = 'Berhasil';
        iconClass = 'fa-circle-check';
        accentTextClass = 'text-emerald-400';
        iconBgClass = 'bg-emerald-500/15 border border-emerald-500/35';
        borderClass = 'border-emerald-500/45';
    } else if (type === 'error') {
        titleText = 'Kesalahan';
        iconClass = 'fa-triangle-exclamation';
        accentTextClass = 'text-red-400';
        iconBgClass = 'bg-red-500/15 border border-red-500/35';
        borderClass = 'border-red-500/45';
    } else if (type === 'warning') {
        titleText = 'Perhatian';
        iconClass = 'fa-circle-exclamation';
        accentTextClass = 'text-amber-400';
        iconBgClass = 'bg-amber-500/15 border border-amber-500/35';
        borderClass = 'border-amber-500/45';
    } else {
        titleText = 'Informasi';
        iconClass = 'fa-circle-info';
        accentTextClass = 'text-orange-400';
        iconBgClass = 'bg-orange-500/15 border border-orange-500/35';
        borderClass = 'border-orange-500/40';
    }

    card.className = `pointer-events-auto flex items-start gap-3 px-4 py-3 rounded-2xl border ${borderClass} shadow-2xl`;
    iconWrap.className = `w-8 h-8 rounded-xl ${iconBgClass} flex items-center justify-center shrink-0 mt-0.5`;
    icon.className = `fa-solid ${iconClass} ${accentTextClass} text-sm`;

    if (titleEl) {
        titleEl.className = `text-[0.66rem] font-extrabold uppercase tracking-wider mb-0.5 ${accentTextClass}`;
        titleEl.textContent = titleText;
    }

    msgEl.textContent = String(message || '').trim();

    banner.classList.remove('hidden-state');
    requestAnimationFrame(() => {
        banner.classList.remove('opacity-0', '-translate-y-2');
        banner.classList.add('opacity-100', 'translate-y-0');
    });

    const durationMs = (type === 'error' || type === 'warning') ? 5200 : 4000;
    noticeBannerTimer = setTimeout(() => {
        tutupNotifikasiPanel();
    }, durationMs);
}
window.showToast = showToast;

function tutupModalDOM() {
    const modal = document.getElementById('app-modal');
    const boxEl = document.getElementById('app-modal-box');
    const btnCancel = document.getElementById('btn-cancel-modal');
    if (modal && boxEl) {
        modal.classList.add('opacity-0');
        boxEl.classList.add('scale-95');
        setTimeout(() => {
            modal.classList.add('hidden-state');
            if (btnCancel) btnCancel.classList.add('hidden-state');
        }, 260);
    }
}

export function showModal(title, message, iconClass = 'fa-circle-info text-theme-gold', isError = false) {
    const modal = document.getElementById('app-modal');
    const titleEl = document.getElementById('app-modal-title');
    const msgEl = document.getElementById('app-modal-msg');
    const iconEl = document.getElementById('app-modal-icon');
    const boxEl = document.getElementById('app-modal-box');
    const btnClose = document.getElementById('btn-close-modal');
    const btnCancel = document.getElementById('btn-cancel-modal');

    if (!modal || !titleEl || !msgEl || !iconEl || !boxEl || !btnClose) return;

    if (activeModalResolver) {
        activeModalResolver(false);
        activeModalResolver = null;
    }

    if (btnCancel) btnCancel.classList.add('hidden-state');
    btnClose.innerText = 'Mengerti';

    titleEl.innerText = title || 'PEMBERITAHUAN';
    msgEl.innerText = message || '';
    iconEl.innerHTML = `<i class="fa-solid ${iconClass}"></i>`;

    if (isError) {
        titleEl.className = 'font-bold text-lg mb-2 text-red-400 font-display';
        iconEl.className = 'text-4xl mb-3 text-red-500';
        btnClose.className = 'bg-red-500/20 text-red-400 border border-red-500/50 rounded-xl py-3.5 px-5 font-semibold uppercase tracking-wider flex-1 w-full text-sm cursor-pointer transition-all';
    } else {
        titleEl.className = 'font-bold text-lg mb-2 text-white font-display';
        iconEl.className = 'text-4xl mb-3 text-theme-gold';
        btnClose.className = 'btn-primary flex-1 w-full text-sm cursor-pointer';
    }

    modal.classList.remove('hidden-state');
    requestAnimationFrame(() => {
        modal.classList.remove('opacity-0');
        boxEl.classList.remove('scale-95');
    });
}
window.showModal = showModal;

export function showConfirm(title, message, confirmText = 'Ya, Lanjutkan', isDanger = true) {
    return new Promise((resolve) => {
        const modal = document.getElementById('app-modal');
        const titleEl = document.getElementById('app-modal-title');
        const msgEl = document.getElementById('app-modal-msg');
        const iconEl = document.getElementById('app-modal-icon');
        const boxEl = document.getElementById('app-modal-box');
        const btnClose = document.getElementById('btn-close-modal');
        const btnCancel = document.getElementById('btn-cancel-modal');

        if (!modal || !titleEl || !msgEl || !iconEl || !boxEl || !btnClose || !btnCancel) {
            resolve(false);
            return;
        }

        if (activeModalResolver) {
            activeModalResolver(false);
        }
        activeModalResolver = resolve;

        titleEl.innerText = title || 'KONFIRMASI';
        msgEl.innerText = message || '';
        btnClose.innerText = confirmText;
        btnCancel.innerText = 'Batal';
        btnCancel.classList.remove('hidden-state');

        if (isDanger) {
            titleEl.className = 'font-bold text-lg mb-2 text-red-400 font-display';
            iconEl.className = 'text-4xl mb-3 text-red-500';
            iconEl.innerHTML = '<i class="fa-solid fa-triangle-exclamation"></i>';
            btnClose.className = 'bg-red-500/20 hover:bg-red-500/30 text-red-400 border border-red-500/50 rounded-xl py-3.5 px-4 font-bold uppercase tracking-wider flex-1 text-xs cursor-pointer transition-all';
        } else {
            titleEl.className = 'font-bold text-lg mb-2 text-white font-display';
            iconEl.className = 'text-4xl mb-3 text-theme-gold';
            iconEl.innerHTML = '<i class="fa-solid fa-circle-question"></i>';
            btnClose.className = 'btn-primary flex-1 text-xs cursor-pointer';
        }

        modal.classList.remove('hidden-state');
        requestAnimationFrame(() => {
            modal.classList.remove('opacity-0');
            boxEl.classList.remove('scale-95');
        });
    });
}
window.showConfirm = showConfirm;

window.alert = function(message, type = 'info') {
    const cleanMsg = String(message || '').trim();
    if (document.getElementById('panel-notice-banner')) {
        showToast(cleanMsg, type);
    } else {
        const isErr = (type === 'error' || type === 'warning');
        const icon = isErr ? 'fa-triangle-exclamation text-red-500' : 'fa-circle-info text-theme-gold';
        showModal(isErr ? 'PERINGATAN' : 'PEMBERITAHUAN', cleanMsg, icon, isErr);
    }
};

(() => {
    const inisialisasiKomponenUI = () => {
        const btnCloseNotice = document.getElementById('btn-close-notice-banner');
        if (btnCloseNotice) {
            btnCloseNotice.addEventListener('click', () => {
                picuGetarSentuh(8);
                tutupNotifikasiPanel();
            });
        }

        const btnCloseModal = document.getElementById('btn-close-modal');
        const btnCancelModal = document.getElementById('btn-cancel-modal');

        if (btnCloseModal) {
            btnCloseModal.addEventListener('click', () => {
                tutupModalDOM();
                if (activeModalResolver) {
                    const r = activeModalResolver;
                    activeModalResolver = null;
                    r(true);
                }
            });
        }

        if (btnCancelModal) {
            btnCancelModal.addEventListener('click', () => {
                tutupModalDOM();
                if (activeModalResolver) {
                    const r = activeModalResolver;
                    activeModalResolver = null;
                    r(false);
                }
            });
        }
    };

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', inisialisasiKomponenUI, { once: true });
    } else {
        inisialisasiKomponenUI();
    }
})();
