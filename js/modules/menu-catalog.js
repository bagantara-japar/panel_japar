// ==========================================================================
// FILE: js/modules/menu-catalog.js (JAPAR PANEL v3.9 - MULTI-GROUP VARIANT & AUTO-ARTICULATION ENGINE)
// FUNGSI:
//   1. Manajemen Katalog Hidangan Resto (Array JSON `items`) dengan Standarisasi
//      5 Kelompok Menu Baku (`Hidangan Utama`, `Minuman & Kopi`, `Camilan & Jajanan`,
//      `Roti, Kue & Oleh-Oleh`, `Paket Hemat & Combo`)
//   2. Penyusun Paket Hemat & Mesin Otomasi Artikulir Varian Multi-Grup (Ala GoFood / GrabFood):
//      Komposisi Isi Makanan (`desc` maks 160), Pilihan Minuman Paket (`drk` maks 160),
//      & Multi-Grup Varian/Level/Saus/Penyajian/Extra Topping (`var` maks 280)
//      dengan 0 Byte Overhead untuk menu biasa
//   3. Studio JSON & AI Menu Pintar Generasi Baru + Ekspander Rentang Level Otomatis
//   4. Unggah Foto Cepat 1-Klik Langsung dari Thumbnail Kartu Menu
// ==========================================================================

import {
    bersihkanPublicIdCloudinary,
    bangunUrlGambarCloudinary,
    unggahGambarKeCloudinary,
    hitungHargaFinalMenu
} from '../utils/math-engine.js';
import { formatRupiah, picuGetarSentuh } from '../utils/ui-components.js';

export const STANDAR_KELOMPOK_MENU_JAPAR = [
    'Hidangan Utama',
    'Minuman & Kopi',
    'Camilan & Jajanan',
    'Roti, Kue & Oleh-Oleh',
    'Paket Hemat & Combo'
];

let daftarMenuAktif = [];
let diskonTokoGlobalPersen = 0;
let skemaDiskonGlobal = 'MAX_BEST';
let filterSubKategori = 'ALL';
let filterStatusStok = 'ALL'; // 'ALL' | 'READY' | 'OUT' | 'NO_PHOTO'
let kataKunciCariMenu = '';
let onMenuChangedCallback = null;
let studioPreviewCandidateItems = [];
let quickUploadTargetItemId = null;
let studioInputMode = 'AI'; // 'AI' | 'NOTES'
let isPackageBuilderExpanded = false;

const SAMPLE_NOTES_TEMPLATE = `[Hidangan Utama]
Mie Pedas Gurih Jangkrik (Level 0 - 3) - 10.900
Nasi Ayam Penyet - 16rb (diskon 5% | Opsi: Dada, Paha)
Nasi Pecel Madiun 13.000
Rawon Daging Spesial Rp 18.000

[Paket Hemat & Combo]
Paket Ayam Bakar Hemat (Isi: 1x Nasi Putih + 1x Ayam Bakar Madu + Tahu Tempe + Sambal | Minum: Es Teh Manis, Teh Hangat, Es Jeruk (+2000) | Opsi: Dada, Paha) - 19rb
Paket Kenyang Penyetan (Isi: 1x Nasi Putih + 1x Nasi Ayam Penyet + Kerupuk | Minum: Es Teh Manis, Air Mineral) - 18.500

[Minuman & Kopi]
Es Teh Manis 4000
Kopi Susu Gula Aren 12.5rb diskon 10%
Es Jeruk Peras 6k

[Camilan & Jajanan]
Tahu Walik Crispy 10rb
Tempe Mendoan Hangat 8000

[Roti, Kue & Oleh-Oleh]
Donat Kentang Gula Halus 12rb`;

const SAMPLE_JSON_TEMPLATE = [
    {
        "n": "Paket Ayam Bakar Hemat",
        "p": 19000,
        "d": 0,
        "kat": "Paket Hemat & Combo",
        "s": true,
        "desc": "1x Nasi Putih + 1x Ayam Bakar Madu + Tahu Tempe + Sambal Lalapan",
        "drk": "Es Teh Manis, Teh Manis Hangat, Es Jeruk (+2000)",
        "var": "Bagian Lauk: Dada, Paha Atas, Paha Bawah | Pilihan Sambal: Sambal Bawang, Sambal Terasi"
    },
    {
        "n": "Nasi Ayam Penyet",
        "p": 16000,
        "d": 5,
        "kat": "Hidangan Utama",
        "s": true,
        "var": "Dada, Paha"
    },
    {
        "n": "Nasi Pecel Madiun",
        "p": 13000,
        "d": 0,
        "kat": "Hidangan Utama",
        "s": true
    },
    {
        "n": "Es Teh Manis",
        "p": 4000,
        "d": 0,
        "kat": "Minuman & Kopi",
        "s": true
    },
    {
        "n": "Kopi Susu Gula Aren",
        "p": 12500,
        "d": 10,
        "kat": "Minuman & Kopi",
        "s": true
    },
    {
        "n": "Tahu Walik Crispy",
        "p": 10000,
        "d": 0,
        "kat": "Camilan & Jajanan",
        "s": true
    },
    {
        "n": "Donat Kentang Gula Halus",
        "p": 12000,
        "d": 0,
        "kat": "Roti, Kue & Oleh-Oleh",
        "s": true
    }
];

function escapeHtmlAman(str = '') {
    return String(str || '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

export function normalisasiFormatTambahanHargaMinuman(rawStr = '', maxLen = 160) {
    let str = String(rawStr ?? '').replace(/\s+/g, ' ').trim();
    if (!str) return '';

    // 1. Normalisasi tambahan harga di dalam kurung seperti (+2rb), (+2.5k), (+4.000), (+ 2000), (+Rp 4.000) -> (+2000), (+4000)
    str = str.replace(
        /\(\s*\+\s*(?:rp\.?\s*)?(\d+(?:[.,]\d+)?\s*(?:rb|ribu|k)|\d{1,3}(?:[.,]\d{3})+|\d{3,6})\s*\)/gi,
        (_, rawNum) => {
            const nom = parseNominalHargaPintar(rawNum);
            return nom > 0 ? `(+${nom})` : `(+${String(rawNum).trim()})`;
        }
    );

    // 2. Normalisasi tambahan harga tanpa kurung seperti "+2000", "+2rb", "+4.000" (tanpa menyentuh penanda grup multi-pilih "[+]")
    str = str.replace(
        /([A-Za-z0-9)])\s*\+\s*(?:rp\.?\s*)?(\d+(?:[.,]\d+)?\s*(?:rb|ribu|k)\b|\d{1,3}(?:[.,]\d{3})+\b|\d{3,6}\b)(?!\s*\)|\s*\])/gi,
        (_, prefixChar, rawNum) => {
            const nom = parseNominalHargaPintar(rawNum);
            return nom > 0 ? `${prefixChar} (+${nom})` : `${prefixChar} (+${String(rawNum).trim()})`;
        }
    );

    // 3. Normalisasi spasi di sekitar pemisah multi-grup `|`
    if (str.includes('|')) {
        str = str
            .split('|')
            .map(seg => seg.trim())
            .filter(Boolean)
            .join(' | ');
    }

    return str.trim().substring(0, maxLen);
}

export function bersihkanFieldPaketOpsional(rawDesc = '', rawDrk = '', rawVar = '') {
    const desc = String(rawDesc ?? '').replace(/\s+/g, ' ').trim().substring(0, 160);
    const drk = normalisasiFormatTambahanHargaMinuman(rawDrk ?? '', 160);
    const varOpt = normalisasiFormatTambahanHargaMinuman(rawVar ?? '', 280);
    return { desc, drk, var: varOpt };
}

function kanonisasiKunciGrupVarian(rawHeader = '') {
    const clean = String(rawHeader || '')
        .replace(/\s*\[\+\]\s*$/, '')
        .trim()
        .toLowerCase();
    if (!clean) return '';
    if (/\b(level|lvl|lv|pedas|kepedasan)\b/.test(clean)) return 'level_pedas';
    if (/\b(saus|sauce|bumbu)\b/.test(clean)) return 'pilihan_saus';
    if (/\b(sambal|sambel)\b/.test(clean)) return 'pilihan_sambal';
    if (/\b(penyajian|metode|masak|olahan)\b/.test(clean)) return 'penyajian';
    if (/\b(suhu|dingin|panas|es|ice|hot)\b/.test(clean)) return 'suhu_saji';
    if (/\b(bagian|lauk|potongan)\b/.test(clean)) return 'bagian_lauk';
    if (/\b(extra|topping|toping|tambahan|add[\s-]*on)\b/.test(clean)) return 'extra_topping';
    return clean;
}

function ekspansiRentangLevelDariTeks(teks = '') {
    const str = String(teks || '');
    if (!str) return '';
    const match = str.match(/\b(?:level|lvl|lv)\.?\s*(\d{1,2})\s*(?:[-–—]|s\/d|sampai|to)\s*(\d{1,2})\b/i);
    if (!match) return '';
    const start = parseInt(match[1], 10);
    const end = parseInt(match[2], 10);
    if (!Number.isFinite(start) || !Number.isFinite(end) || start > end || (end - start) > 15) {
        return '';
    }
    const levels = [];
    for (let lv = start; lv <= end; lv++) {
        levels.push(`Level ${lv}`);
    }
    return `Level Pedas: ${levels.join(', ')}`;
}

function gabungkanGrupVarianPintar(existingVar = '', incomingVar = '', replaceSameGroup = true) {
    const cleanExisting = normalisasiFormatTambahanHargaMinuman(existingVar, 280);
    const cleanIncoming = normalisasiFormatTambahanHargaMinuman(incomingVar, 280);

    if (!cleanExisting) return cleanIncoming;
    if (!cleanIncoming) return cleanExisting;

    const hasGroupSyntax = cleanExisting.includes(':') || cleanExisting.includes('|') || cleanIncoming.includes(':') || cleanIncoming.includes('|');

    if (!hasGroupSyntax) {
        const existingSet = new Set(cleanExisting.split(/\s*,\s*/).map(s => s.trim().toLowerCase()).filter(Boolean));
        const currentList = cleanExisting.split(/\s*,\s*/).map(s => s.trim()).filter(Boolean);
        cleanIncoming.split(/\s*,\s*/).map(s => s.trim()).filter(Boolean).forEach(opt => {
            if (!existingSet.has(opt.toLowerCase())) {
                existingSet.add(opt.toLowerCase());
                currentList.push(opt);
            }
        });
        return normalisasiFormatTambahanHargaMinuman(currentList.join(', '), 280);
    }

    const existingSegs = cleanExisting.split(/\s*\|\s*/).map(s => s.trim()).filter(Boolean);
    const incomingSegs = cleanIncoming.split(/\s*\|\s*/).map(s => s.trim()).filter(Boolean);

    incomingSegs.forEach(inSeg => {
        const colonIdx = inSeg.indexOf(':');
        if (colonIdx !== -1) {
            const inHeader = inSeg.slice(0, colonIdx).trim();
            const inKey = kanonisasiKunciGrupVarian(inHeader);

            const matchIdx = existingSegs.findIndex(exSeg => {
                const exColon = exSeg.indexOf(':');
                if (exColon === -1) return false;
                return kanonisasiKunciGrupVarian(exSeg.slice(0, exColon)) === inKey;
            });

            if (matchIdx !== -1) {
                if (replaceSameGroup) {
                    existingSegs[matchIdx] = inSeg;
                }
            } else {
                // Jika ada Extra Topping [+] di posisi akhir dan grup baru adalah grup utama, sisipkan sebelum Extra Topping
                const extraIdx = existingSegs.findIndex(exSeg => {
                    const exColon = exSeg.indexOf(':');
                    return exColon !== -1 && kanonisasiKunciGrupVarian(exSeg.slice(0, exColon)) === 'extra_topping';
                });
                if (inKey !== 'extra_topping' && extraIdx !== -1) {
                    existingSegs.splice(extraIdx, 0, inSeg);
                } else {
                    existingSegs.push(inSeg);
                }
            }
        } else {
            const flatIdx = existingSegs.findIndex(exSeg => !exSeg.includes(':'));
            if (flatIdx !== -1) {
                const existingOpts = existingSegs[flatIdx].split(/\s*,\s*/).map(s => s.trim()).filter(Boolean);
                const lowerSet = new Set(existingOpts.map(s => s.toLowerCase()));
                inSeg.split(/\s*,\s*/).map(s => s.trim()).filter(Boolean).forEach(opt => {
                    if (!lowerSet.has(opt.toLowerCase())) {
                        lowerSet.add(opt.toLowerCase());
                        existingOpts.push(opt);
                    }
                });
                existingSegs[flatIdx] = existingOpts.join(', ');
            } else {
                existingSegs.push(inSeg);
            }
        }
    });

    return normalisasiFormatTambahanHargaMinuman(existingSegs.join(' | '), 280);
}

/**
 * Mesin Otomasi Artikulir Varian dari Nama Menu & Deskripsi:
 * 1. Ekspansi rentang level otomatis: (Level 0 - 3), Level 4 - 6, Lv 1-5, Level 1 s/d 5, Lvl 0-5
 * 2. Deteksi metode masak / suhu saji garis miring (/): Tim/Goreng, Ice/Hot, Kuah/Goreng, Bakar/Goreng
 * 3. Deteksi pilihan saus / sambal dari deskripsi atau nama: (Pilihan Sauce: BBQ, Blackpepper, Thai Hot)
 */
export function artikulasiOtomatisVarianDariMenu(namaMenu = '', rawVar = '', rawDesc = '', rawKat = '') {
    const cleanName = String(namaMenu || '').trim();
    const cleanDesc = String(rawDesc || '').trim();
    let workingVar = normalisasiFormatTambahanHargaMinuman(rawVar || '', 280);

    // Jika di dalam rawVar sendiri terdapat rentang level belum diekspansi (misal "Level 0 - 3"), ekspansi langsung
    if (workingVar) {
        const expandedFromRawVar = ekspansiRentangLevelDariTeks(workingVar);
        if (expandedFromRawVar) {
            const varSegs = workingVar.split(/\s*\|\s*/).map(seg => {
                if (/\b(?:level|lvl|lv)\.?\s*(\d{1,2})\s*(?:[-–—]|s\/d|sampai|to)\s*(\d{1,2})\b/i.test(seg)) {
                    return expandedFromRawVar;
                }
                return seg;
            });
            workingVar = normalisasiFormatTambahanHargaMinuman(varSegs.join(' | '), 280);
        }
    }

    const detectedGroups = [];

    // 1. Ekspansi Rentang Level Otomatis dari Nama Menu atau Deskripsi
    const levelGroup = ekspansiRentangLevelDariTeks(cleanName) || ekspansiRentangLevelDariTeks(cleanDesc);
    if (levelGroup) {
        detectedGroups.push(levelGroup);
    }

    // 2. Deteksi Metode Masak / Suhu Saji Garis Miring (/) pada Nama Menu
    if (
        /\b(tim|kukus)\s*\/\s*goreng\b/i.test(cleanName) ||
        /\bgoreng\s*\/\s*(tim|kukus)\b/i.test(cleanName)
    ) {
        detectedGroups.push('Penyajian: Tim (Kukus), Goreng');
    }

    if (
        /\b(ice|es|dingin)\s*\/\s*(hot|panas|hangat)\b/i.test(cleanName) ||
        /\b(hot|panas|hangat)\s*\/\s*(ice|es|dingin)\b/i.test(cleanName)
    ) {
        detectedGroups.push('Suhu Saji: Ice (Dingin), Hot (Panas)');
    }

    if (
        /\b(kuah)\s*\/\s*(goreng)\b/i.test(cleanName) ||
        /\b(goreng)\s*\/\s*(kuah)\b/i.test(cleanName)
    ) {
        detectedGroups.push('Penyajian: Kuah, Goreng');
    }

    if (
        /\b(bakar)\s*\/\s*(goreng)\b/i.test(cleanName) ||
        /\b(goreng)\s*\/\s*(bakar)\b/i.test(cleanName)
    ) {
        detectedGroups.push('Penyajian: Bakar, Goreng');
    }

    // 3. Deteksi Pilihan Saus / Sambal dari Deskripsi atau Nama Menu
    const combinedSource = `${cleanName} | ${cleanDesc}`;
    const sauceMatch = combinedSource.match(/(?:\bpilihan\s+)?(?:sauce|saus)\s*[:=-]\s*([^)|;\n]+)/i);
    if (sauceMatch && sauceMatch[1]) {
        const sauceList = sauceMatch[1]
            .replace(/[()]/g, '')
            .replace(/\b(?:atau|or|dan)\b/gi, ',')
            .split(/\s*[,/]\s*/)
            .map(s => s.replace(/^[.\s-]+|[.\s-]+$/g, '').trim())
            .filter(Boolean);
        if (sauceList.length > 0) {
            detectedGroups.push(`Pilihan Saus: ${sauceList.join(', ')}`);
        }
    }

    const sambalMatch = combinedSource.match(/(?:\bpilihan\s+)?sambal\s*[:=-]\s*([^)|;\n]+)/i);
    if (sambalMatch && sambalMatch[1]) {
        const sambalList = sambalMatch[1]
            .replace(/[()]/g, '')
            .replace(/\b(?:atau|or|dan)\b/gi, ',')
            .split(/\s*[,/]\s*/)
            .map(s => s.replace(/^[.\s-]+|[.\s-]+$/g, '').trim())
            .filter(Boolean);
        if (sambalList.length > 0) {
            detectedGroups.push(`Pilihan Sambal: ${sambalList.join(', ')}`);
        }
    }

    if (detectedGroups.length === 0) {
        return workingVar;
    }

    let resultVar = workingVar;
    for (const grp of detectedGroups) {
        resultVar = gabungkanGrupVarianPintar(resultVar, grp, false);
    }

    return normalisasiFormatTambahanHargaMinuman(resultVar, 280);
}

if (typeof window !== 'undefined') {
    window.artikulasiOtomatisVarianDariMenu = artikulasiOtomatisVarianDariMenu;
}

export function bentukObjekItemMenuHematKuota(rawObj = {}, fallbackIdx = 0) {
    const rawName = String(rawObj.n || rawObj.name || 'Hidangan Resto').trim().substring(0, 80);
    const katNorm = klasifikasiKategoriMenuPintar(rawName, rawObj.kat || '');
    const opt = bersihkanFieldPaketOpsional(
        rawObj.desc ?? rawObj.isi ?? rawObj.deskripsi ?? rawObj.komposisi ?? '',
        rawObj.drk ?? rawObj.minum ?? rawObj.minuman ?? rawObj.opsiMinum ?? '',
        rawObj.var ?? rawObj.varian ?? rawObj.opsi ?? rawObj.lauk ?? ''
    );

    const finalVar = !opt.var
        ? artikulasiOtomatisVarianDariMenu(rawName, opt.var, opt.desc, katNorm)
        : normalisasiFormatTambahanHargaMinuman(opt.var, 280);

    const itemObj = {
        id: String(rawObj.id || `m_${Date.now()}_${fallbackIdx}`),
        n: rawName,
        p: Math.max(0, parseInt(rawObj.p !== undefined ? rawObj.p : rawObj.price, 10) || 0),
        d: Math.min(99, Math.max(0, parseInt(rawObj.d !== undefined ? rawObj.d : rawObj.discount, 10) || 0)),
        img: bersihkanPublicIdCloudinary(rawObj.img || ''),
        s: rawObj.s !== undefined ? Boolean(rawObj.s) : true,
        kat: katNorm
    };

    if (opt.desc) itemObj.desc = opt.desc;
    if (opt.drk) itemObj.drk = opt.drk;
    if (finalVar) itemObj.var = finalVar;

    return itemObj;
}

export function autoArtikulasiSeluruhMenuAktif() {
    if (!Array.isArray(daftarMenuAktif) || daftarMenuAktif.length === 0) {
        if (typeof window !== 'undefined' && typeof window.showToast === 'function') {
            window.showToast('Belum ada menu di katalog untuk diartikulasi.', 'warning');
        }
        return 0;
    }

    let updatedCount = 0;
    daftarMenuAktif = daftarMenuAktif.map((item, idx) => {
        const prevVar = String(item.var || '').trim();
        const articulatedVar = artikulasiOtomatisVarianDariMenu(
            item.n || '',
            prevVar,
            item.desc || '',
            item.kat || ''
        );
        if (articulatedVar && articulatedVar !== prevVar) {
            updatedCount++;
            return bentukObjekItemMenuHematKuota({
                ...item,
                var: articulatedVar
            }, idx);
        }
        return bentukObjekItemMenuHematKuota(item, idx);
    });

    renderFilterSubKategoriChips();
    renderDaftarMenuUI();
    sinkronkanEditorStudioJsonDariMenuAktif(false);

    if (updatedCount > 0) {
        if (typeof onMenuChangedCallback === 'function') {
            onMenuChangedCallback(daftarMenuAktif, 'BULK_JSON_APPLY', {
                addedCount: 0,
                updatedCount,
                totalCount: daftarMenuAktif.length
            });
        }
        if (typeof window !== 'undefined' && typeof window.showToast === 'function') {
            window.showToast(
                `Berhasil melengkapi varian/level otomatis pada ${updatedCount} menu!`,
                'success'
            );
        }
    } else if (typeof window !== 'undefined' && typeof window.showToast === 'function') {
        window.showToast(
            'Seluruh menu di katalog sudah memiliki rincian varian/level yang optimal.',
            'info'
        );
    }

    return updatedCount;
}

if (typeof window !== 'undefined') {
    window.autoArtikulasiSeluruhMenuAktif = autoArtikulasiSeluruhMenuAktif;
}

export function getDaftarMenuAktif() {
    return daftarMenuAktif.map((it, idx) => bentukObjekItemMenuHematKuota(it, idx));
}

export function getSkemaDiskonGlobalAktif() {
    return skemaDiskonGlobal;
}

export function setDiskonTokoGlobalUntukKalkulasi(pct, skema = null) {
    diskonTokoGlobalPersen = Math.min(99, Math.max(0, parseInt(pct, 10) || 0));
    if (skema && ['MAX_BEST', 'ITEM_OVERRIDE', 'STACK_ADD'].includes(skema)) {
        skemaDiskonGlobal = skema;
    }
    perbaruiPenjelasanSkemaDiskonUI();
    renderDaftarMenuUI();
}

export function setSkemaDiskonGlobalUntukKalkulasi(skema) {
    if (['MAX_BEST', 'ITEM_OVERRIDE', 'STACK_ADD'].includes(skema)) {
        skemaDiskonGlobal = skema;
    }
    perbaruiPenjelasanSkemaDiskonUI();
    renderDaftarMenuUI();
}

export function perbaruiPenjelasanSkemaDiskonUI() {
    const descEl = document.getElementById('discount-scheme-live-hint');
    if (!descEl) return;

    const dGlobal = diskonTokoGlobalPersen;
    if (skemaDiskonGlobal === 'STACK_ADD') {
        descEl.innerHTML = `<i class="fa-solid fa-layer-group text-amber-400 mr-1"></i><b>Mode Akumulasi (Tambah Diskon):</b> Menu yang sudah punya diskon khusus akan <b>ditambah lagi</b> dengan Diskon Global (${dGlobal}%), maksimal total 90%.`;
    } else if (skemaDiskonGlobal === 'ITEM_OVERRIDE') {
        descEl.innerHTML = `<i class="fa-solid fa-tag text-emerald-400 mr-1"></i><b>Mode Khusus Menu Normal:</b> Diskon Global (${dGlobal}%) hanya berlaku pada menu tanpa diskon khusus (0%). Menu yang sudah punya diskon sendiri tetap memakai diskon khususnya.`;
    } else {
        descEl.innerHTML = `<i class="fa-solid fa-shield-halved text-orange-400 mr-1"></i><b>Mode Diskon Terbesar / Tidak Double (Aman):</b> Diskon Global (${dGlobal}%) <b>tidak dijumlahkan</b> dengan diskon menu. Sistem otomatis memilih potongan tertinggi antara Diskon Menu vs Diskon Global.`;
    }
}

/**
 * Menormalisasi kelompok menu ke salah satu dari 5 kelompok standar:
 * 1. "Hidangan Utama"
 * 2. "Minuman & Kopi"
 * 3. "Camilan & Jajanan"
 * 4. "Roti, Kue & Oleh-Oleh"
 * 5. "Paket Hemat & Combo"
 */
export function klasifikasiKategoriMenuPintar(namaMenu = '', kategoriInput = '') {
    const cleanName = String(namaMenu || '').trim();
    const lowerName = cleanName.toLowerCase();
    const cleanKat = String(kategoriInput || '').trim();
    const lowerKat = cleanKat.toLowerCase();

    // Deteksi prioritas kata kunci Paket pada nama menu atau input kategori paket
    if (
        /\b(paket|combo|hemat|tumpeng|nasi\s*kotak|hampers)\b/i.test(lowerName) ||
        /\b(paket|combo|hemat|spesial|nasi\s*kotak|katering|hampers)\b/i.test(lowerKat) ||
        cleanKat === 'Paket Hemat & Combo' ||
        cleanKat === 'Paket & Spesial' ||
        cleanKat === 'Paket Hemat'
    ) {
        return 'Paket Hemat & Combo';
    }

    // Jika kategoriInput diberikan secara eksplisit, petakan ke 5 kelompok standar
    if (cleanKat.length >= 2) {
        if (
            cleanKat === 'Minuman & Kopi' ||
            /\b(minuman|minum|kopi|coffee|es|jus|juice|teh|tea|wedang|susu|beverage|drink)\b/i.test(lowerKat)
        ) {
            return 'Minuman & Kopi';
        }
        if (
            cleanKat === 'Camilan & Jajanan' ||
            /\b(camilan|cemilan|jajanan|kebab|snack|gorengan|kentang|dimsum|martabak)\b/i.test(lowerKat)
        ) {
            return 'Camilan & Jajanan';
        }
        if (
            cleanKat === 'Roti, Kue & Oleh-Oleh' ||
            /\b(donat|donut|roti|kue|oleh[\s-]*oleh|bakery|pastry|cake|bolu|brownies|dessert)\b/i.test(lowerKat)
        ) {
            return 'Roti, Kue & Oleh-Oleh';
        }
        if (
            cleanKat === 'Hidangan Utama' ||
            /\b(hidangan\s*utama|makanan\s*utama|makanan|nasi|mie|lauk|berkuah|utama|penyetan|soto|bakso|rawon)\b/i.test(lowerKat)
        ) {
            return 'Hidangan Utama';
        }
    }

    // Deteksi otomatis berdasarkan nama menu
    if (/\b(es|teh|kopi|coffee|jus|juice|jeruk|susu|wedang|coklat|matcha|taro|boba|latte|americano|cappuccino|sirup|soda|mineral|air|minuman|float|shake|tea|thai\s*tea|lemon)\b/i.test(lowerName)) {
        return 'Minuman & Kopi';
    }
    if (/\b(donat|donut|roti|bakery|kue|bolu|brownies|pastry|croissant|bomboloni|cromboloni|waffle|pancake|pukis|terang\s*bulan|tart|cake|cookies|biskuit|dessert|oleh[\s-]*oleh|lapis|bakpia|pia|keripik|kripik)\b/i.test(lowerName)) {
        return 'Roti, Kue & Oleh-Oleh';
    }
    if (/\b(kebab|burger|hotdog|shawarma|tortilla|maryam|canai|martabak|tahu|tempe|mendoan|kentang|pisang|cireng|sosis|kerupuk|krupuk|peyek|dimsum|gorengan|camilan|snack|jajanan|pentol|cilok|sempol|lumpia|risol|takoyaki|corndog|seblak|cimol|batagor|siomay)\b/i.test(lowerName)) {
        return 'Camilan & Jajanan';
    }
    return 'Hidangan Utama';
}

/**
 * Mesin Pengenalan 9 Subtipe Kuliner Presisi (deteksiSubtipeKulinerMenu):
 * 1. 'MINUMAN_PANAS'        : Minuman mengandung \b(hot|hangat|panas|wedang)\b tanpa \b(ice|es|dingin)\b
 * 2. 'MINUMAN_DINGIN'       : Semua item kategori Minuman & Kopi lainnya
 * 3. 'ROTI_KUE_OLEH_OLEH'   : Kategori Roti, Kue & Oleh-Oleh (donat, roti, kue, brownies, bolu, pastry, oleh-oleh)
 * 4. 'DIMSUM_CAMILAN_GURIH' : Kategori Camilan & Jajanan (dimsum, ekkado, wonton, siomay, batagor, gorengan, tahu walik, tempe mendoan, kentang, kebab, burger)
 * 5. 'NASGOR_MIE_GORENG'    : Mengandung \b(nasi\s*goreng|nasgor|mie\s*goreng|mi\s*goreng|bakmi\s*goreng|kwetiau\s*goreng|kwitiau\s*goreng|bihun\s*goreng)\b
 * 6. 'HIDANGAN_BERKUAH'     : Secara EKSPLISIT mengandung kata berkuah: \b(bakso|soto|rawon|sop|sup|ramen|seblak|gulai|lontong|tongseng|mie\s*kuah|mi\s*kuah|mie\s*rebus|mi\s*rebus|mie\s*nyemek|mi\s*nyemek|kwetiau\s*kuah|bihun\s*kuah|kuah)\b
 * 7. 'MIE_KERING_LEVEL'     : Mengandung \b(mie|mi|cwie|bakmi|yamin|kwetiau|kwitiau|bihun|spaghetti|pasta)\b tetapi BUKAN 'NASGOR_MIE_GORENG' dan BUKAN 'HIDANGAN_BERKUAH' (Mie kering tanpa kuah!)
 * 8. 'AYAM_SAUS_RICEBOWL'   : Mengandung \b(ricebowl|rice\s*bowl|ayam\s*celup|chicken\s*wings|fire\s*wings|katsu|teriyaki|blackpepper|bbq|mentai|keju|thai\s*hot)\b
 * 9. 'NASI_LALAPAN_PENYETAN': Hidangan utama nasi/lauk lainnya
 */
export function deteksiSubtipeKulinerMenu(namaMenu = '', kategoriMenu = '', rawDesc = '', rawVar = '') {
    const cleanName = String(namaMenu || '').trim();
    const cleanKat = klasifikasiKategoriMenuPintar(cleanName, kategoriMenu || '');
    const cleanDesc = String(rawDesc || '').trim();
    const cleanVar = String(rawVar || '').trim();
    const combinedText = `${cleanName} ${cleanDesc}`.toLowerCase();
    const lowerName = cleanName.toLowerCase();

    // 1 & 2. Kategori Minuman & Kopi -> 'MINUMAN_PANAS' vs 'MINUMAN_DINGIN'
    if (cleanKat === 'Minuman & Kopi') {
        const hasHot = /\b(hot|hangat|panas|wedang)\b/i.test(lowerName) || /\b(hot|hangat|panas|wedang)\b/i.test(cleanDesc);
        const hasCold = /\b(ice|es|dingin)\b/i.test(lowerName) || /\b(ice|es|dingin)\b/i.test(cleanDesc);
        if (hasHot && !hasCold) {
            return 'MINUMAN_PANAS';
        }
        return 'MINUMAN_DINGIN';
    }

    // 3. Kategori Roti, Kue & Oleh-Oleh -> 'ROTI_KUE_OLEH_OLEH'
    if (
        cleanKat === 'Roti, Kue & Oleh-Oleh' ||
        /\b(donat|donut|roti|kue|brownies|bolu|pastry|oleh[\s-]*oleh|croissant|bomboloni|cromboloni|tart|cake|bakpia|pia)\b/i.test(lowerName)
    ) {
        return 'ROTI_KUE_OLEH_OLEH';
    }

    // 4. Kategori Camilan & Jajanan -> 'DIMSUM_CAMILAN_GURIH' (kecuali seblak yang secara eksplisit berkuah di Hidangan Utama)
    if (
        cleanKat === 'Camilan & Jajanan' &&
        !/\b(seblak|bakso|soto|rawon|sop|sup|ramen|gulai|lontong|tongseng|kuah)\b/i.test(lowerName)
    ) {
        return 'DIMSUM_CAMILAN_GURIH';
    }
    if (
        /\b(dimsum|ekkado|wonton|siomay|batagor|gorengan|tahu\s*walik|tempe\s*mendoan|mendoan|kentang|kebab|burger|cireng|pentol|cilok|sempol|risol|lumpia|takoyaki|corndog)\b/i.test(lowerName) &&
        !/\b(nasi|mie|mi|bakso|soto|rawon|sop|sup|ramen|seblak|kuah|ricebowl|rice\s*bowl)\b/i.test(lowerName)
    ) {
        return 'DIMSUM_CAMILAN_GURIH';
    }

    // 5. 'NASGOR_MIE_GORENG'
    if (/\b(nasi\s*goreng|nasgor|mie\s*goreng|mi\s*goreng|bakmi\s*goreng|kwetiau\s*goreng|kwitiau\s*goreng|bihun\s*goreng)\b/i.test(combinedText)) {
        return 'NASGOR_MIE_GORENG';
    }

    // 6. 'HIDANGAN_BERKUAH' (Eksplisit mengandung kata berkuah)
    if (/\b(bakso|soto|rawon|sop|sup|ramen|seblak|gulai|lontong|tongseng|mie\s*kuah|mi\s*kuah|mie\s*rebus|mi\s*rebus|mie\s*nyemek|mi\s*nyemek|kwetiau\s*kuah|bihun\s*kuah|kuah)\b/i.test(combinedText)) {
        return 'HIDANGAN_BERKUAH';
    }

    // 7. 'MIE_KERING_LEVEL' (Mie kering tanpa kuah: mengandung mie/mi/cwie/bakmi/yamin/kwetiau/bihun/spaghetti/pasta, BUKAN NASGOR_MIE_GORENG dan BUKAN HIDANGAN_BERKUAH)
    if (/\b(mie|mi|cwie|bakmi|yamin|kwetiau|kwitiau|bihun|spaghetti|pasta)\b/i.test(combinedText)) {
        return 'MIE_KERING_LEVEL';
    }

    // 8. 'AYAM_SAUS_RICEBOWL'
    if (/\b(ricebowl|rice\s*bowl|ayam\s*celup|chicken\s*wings|fire\s*wings|katsu|teriyaki|blackpepper|bbq|mentai|keju|thai\s*hot)\b/i.test(combinedText) ||
        /\b(bbq|blackpepper|thai\s*hot|teriyaki|mentai)\b/i.test(cleanVar)) {
        return 'AYAM_SAUS_RICEBOWL';
    }

    // 9. 'NASI_LALAPAN_PENYETAN'
    return 'NASI_LALAPAN_PENYETAN';
}

if (typeof window !== 'undefined') {
    window.deteksiSubtipeKulinerMenu = deteksiSubtipeKulinerMenu;
}

export function parseNominalHargaPintar(rawVal) {
    if (typeof rawVal === 'number' && Number.isFinite(rawVal)) {
        if (rawVal <= 0) return 0;
        // Jika angka < 500 (seperti 10, 12.5, 15, 25, 125), otomatis kalikan 1000 (satuan ribuan buku menu)
        if (rawVal > 0 && rawVal < 500) {
            return Math.round(rawVal * 1000);
        }
        return Math.round(rawVal);
    }

    let str = String(rawVal ?? '').trim().toLowerCase();
    if (!str) return 0;

    // Bersihkan awalan "rp", akhiran ",-", "/porsi", "/pcs", dll.
    str = str
        .replace(/^rp\.?\s*/i, '')
        .replace(/,-$/i, '')
        .replace(/\/(porsi|pcs|cup|gelas|bungkus|paket|item)$/i, '')
        .trim();

    // 1. Format dengan akhiran k / rb / ribu (dengan atau tanpa spasi: "10k", "10 k", "10rb", "10 rb", "12.5k", "12,5 rb")
    const rbMatch = str.match(/(\d+(?:[.,]\d+)?)\s*(?:rb|ribu|k)\b/i);
    if (rbMatch) {
        const num = parseFloat(rbMatch[1].replace(',', '.'));
        if (Number.isFinite(num) && num > 0) {
            return Math.round(num * 1000);
        }
    }

    // 2. Format ribuan dengan 3 digit di belakang titik/koma ("10.000", "15,000", "1.250.000")
    if (/^\d{1,3}([.,]\d{3})+$/.test(str)) {
        const parsedThousand = parseInt(str.replace(/[^\d]/g, ''), 10);
        return Number.isFinite(parsedThousand) ? parsedThousand : 0;
    }

    // 3. Format pecahan desimal ribuan tanpa akhiran k/rb ("12.5", "12,5", "7.5", "17.50")
    if (/^\d{1,3}[.,]\d{1,2}$/.test(str)) {
        const numDec = parseFloat(str.replace(',', '.'));
        if (Number.isFinite(numDec) && numDec > 0 && numDec < 500) {
            return Math.round(numDec * 1000);
        }
    }

    // 4. Angka bulat murni ("10", "15", "125", "10000")
    if (/^\d+$/.test(str)) {
        const numInt = parseInt(str, 10);
        if (!Number.isFinite(numInt) || numInt <= 0) return 0;
        if (numInt >= 1 && numInt < 500) return numInt * 1000;
        return numInt;
    }

    // 5. Fallback untuk teks campuran
    const cleanDigits = str.replace(/rp\.?\s*/gi, '').replace(/[.,](\d{3})\b/g, '$1');
    const decFallback = cleanDigits.match(/(\d+[.,]\d{1,2})/);
    if (decFallback) {
        const valDec = parseFloat(decFallback[1].replace(',', '.'));
        if (Number.isFinite(valDec) && valDec > 0 && valDec < 500) {
            return Math.round(valDec * 1000);
        }
    }
    const plainMatch = cleanDigits.match(/(\d+)/);
    if (plainMatch) {
        const val = parseInt(plainMatch[1], 10);
        if (Number.isFinite(val) && val > 0) {
            if (val >= 1 && val < 500) return val * 1000;
            return val;
        }
    }
    return 0;
}

function uraiSegmenRincianPaketDariTeks(rawBlock = '') {
    let desc = '';
    let drk = '';
    const varGroups = [];

    const segments = String(rawBlock || '')
        .split(/\s*\|\s*|\s*;\s*/)
        .map(s => s.trim())
        .filter(Boolean);

    segments.forEach((seg, idx) => {
        const mDesc = seg.match(/^(?:isi|komposisi|deskripsi|makanan|menu)\s*[:=-]\s*(.+)$/i);
        const mDrk = seg.match(/^(?:minum(?:an)?|opsi\s*minum(?:an)?|pilihan\s*minum(?:an)?|drk)\s*[:=-]\s*(.+)$/i);
        const mGenericVar = seg.match(/^(?:opsi|varian|var)\s*[:=-]\s*(.+)$/i);
        const mSauceGroup = seg.match(/^(?:pilihan\s*)?(?:sauce|saus)\s*[:=-]\s*(.+)$/i);
        const mSambalGroup = seg.match(/^(?:pilihan\s*)?sambal\s*[:=-]\s*(.+)$/i);
        const mNamedVarGroup = seg.match(/^([A-Za-zÀ-ÿ\s/]+?(?:\s*\[\+\])?)\s*:\s*(.+)$/);

        if (mDesc) {
            desc = mDesc[1].trim();
        } else if (mDrk) {
            drk = normalisasiFormatTambahanHargaMinuman(mDrk[1], 160);
        } else if (mSauceGroup) {
            varGroups.push(`Pilihan Saus: ${mSauceGroup[1].trim()}`);
        } else if (mSambalGroup) {
            varGroups.push(`Pilihan Sambal: ${mSambalGroup[1].trim()}`);
        } else if (mGenericVar) {
            varGroups.push(mGenericVar[1].trim());
        } else if (mNamedVarGroup) {
            const grpTitle = mNamedVarGroup[1].trim();
            const grpOpts = mNamedVarGroup[2].trim();
            if (/^(?:lauk|pilihan|level)$/i.test(grpTitle)) {
                varGroups.push(grpOpts);
            } else {
                varGroups.push(`${grpTitle}: ${grpOpts}`);
            }
        } else if (idx === 0 && !desc && (seg.includes('+') || /\b(\d+x|nasi|ayam|mie|ikan|sambal|tahu|tempe)\b/i.test(seg))) {
            desc = seg;
        }
    });

    const joinedVar = varGroups.join(' | ');
    return bersihkanFieldPaketOpsional(desc, drk, joinedVar);
}

export function konversiCatatanTeksKeArrayMenu(rawNotesText = '') {
    const lines = String(rawNotesText || '').split(/\r?\n/);
    let currentCategory = '';
    const parsedItems = [];

    for (let rawLine of lines) {
        let line = rawLine.trim();
        if (!line) continue;
        if (line.startsWith('//')) continue;

        const bracketCat = line.match(/^(?:\[|===+\s*|###*\s*|kategori\s*[:=-]\s*)([^\]=#]+?)(?:\]|\s*===+|:)?$/i);
        if (bracketCat && !/\d{3,}|\d+\s*(?:rb|ribu|k)\b/i.test(line)) {
            currentCategory = klasifikasiKategoriMenuPintar('', bracketCat[1].trim());
            continue;
        }
        const colonCat = line.match(/^([A-Za-zÀ-ÿ\s&/,-]{3,36}):$/);
        if (colonCat && !/\d/.test(colonCat[1])) {
            currentCategory = klasifikasiKategoriMenuPintar('', colonCat[1].trim());
            continue;
        }

        line = line.replace(/^(?:\d+[.)]\s*|[-•*+]\s*)/, '').trim();
        if (!line) continue;

        let isReady = true;
        if (/(?:\[|\(|\b)(habis|kosong|sold\s*out|nonaktif)(?:\]|\)|\b)/i.test(line)) {
            isReady = false;
            line = line.replace(/(?:\[|\()?\b(?:stok\s*)?(?:habis|kosong|sold\s*out|nonaktif)\b(?:\]|\))?/gi, ' ').trim();
        }

        let discountPct = 0;
        const discMatch = line.match(/(?:\(|\b)?(?:diskon|disc|promo|potongan)\s*(\d{1,2})\s*%(?:\))?/i) || line.match(/\((\d{1,2})\s*%\)/);
        if (discMatch) {
            discountPct = Math.min(99, Math.max(0, parseInt(discMatch[1], 10) || 0));
            line = line.replace(discMatch[0], ' ').trim();
        }

        // Ekstrak rincian paket di dalam kurung (...) atau pemisah `|` sebelum ekstraksi harga
        // agar angka seperti (+2000) di dalam opsi minuman/topping tidak salah terbaca sebagai harga utama
        let extractedDesc = '';
        let extractedDrk = '';
        let extractedVar = '';

        const parenMatches = Array.from(line.matchAll(/\(([^()]{4,})\)/g));
        for (const pm of parenMatches) {
            const inner = pm[1].trim();
            if (
                inner.includes('|') ||
                /\b(?:isi|komposisi|deskripsi|minum|minuman|opsi|varian|lauk|saus|sauce|sambal|penyajian|suhu\s*saji|extra\s*topping)\s*[:=-]/i.test(inner) ||
                (/\+/.test(inner) && !/^\+\s*\d+$/.test(inner))
            ) {
                const parsedPkg = uraiSegmenRincianPaketDariTeks(inner);
                if (parsedPkg.desc) extractedDesc = parsedPkg.desc;
                if (parsedPkg.drk) extractedDrk = parsedPkg.drk;
                if (parsedPkg.var) {
                    extractedVar = extractedVar
                        ? gabungkanGrupVarianPintar(extractedVar, parsedPkg.var, true)
                        : parsedPkg.var;
                }
                line = line.replace(pm[0], ' ').trim();
            }
        }

        if (line.includes('|') && /\b(?:isi|komposisi|minum|minuman|opsi|varian|lauk|level|saus|sauce|sambal|penyajian|suhu|topping)\b/i.test(line)) {
            const pipeParts = line.split('|').map(s => s.trim()).filter(Boolean);
            const keptParts = [];
            const detailParts = [];
            pipeParts.forEach((pt, idx) => {
                if (idx > 0 && /^(?:isi|komposisi|deskripsi|minum(?:an)?|opsi|varian|lauk|level(?:\s*pedas)?|pilihan\s*(?:saus|sauce|sambal)|saus|sauce|sambal|penyajian|suhu\s*saji|bagian\s*lauk|extra\s*topping(?:\s*\[\+\])?)\s*[:=-]/i.test(pt)) {
                    const tailPriceMatch = pt.match(/^(.*?)\s+[-–—:]\s*((?:rp\.?\s*)?\d+(?:[.,]\d+)?\s*(?:rb|ribu|k)?)\s*$/i);
                    if (tailPriceMatch) {
                        detailParts.push(tailPriceMatch[1].trim());
                        keptParts.push(tailPriceMatch[2].trim());
                    } else {
                        detailParts.push(pt);
                    }
                } else {
                    keptParts.push(pt);
                }
            });
            if (detailParts.length > 0) {
                const parsedPipePkg = uraiSegmenRincianPaketDariTeks(detailParts.join(' | '));
                if (parsedPipePkg.desc && !extractedDesc) extractedDesc = parsedPipePkg.desc;
                if (parsedPipePkg.drk && !extractedDrk) extractedDrk = parsedPipePkg.drk;
                if (parsedPipePkg.var) {
                    extractedVar = extractedVar
                        ? gabungkanGrupVarianPintar(extractedVar, parsedPipePkg.var, true)
                        : parsedPipePkg.var;
                }
                line = keptParts.join(' - ').trim();
            }
        }

        let inlineCat = '';
        const inlineCatMatch = line.match(/\[([A-Za-zÀ-ÿ\s&,-]{3,32})\]/);
        if (inlineCatMatch) {
            inlineCat = inlineCatMatch[1].trim();
            line = line.replace(inlineCatMatch[0], ' ').trim();
        }

        let priceVal = 0;
        let itemName = line;

        const rbRegex = /(?:[-–—:|•]\s*)?(?:rp\.?\s*)?(\d+(?:[.,]\d+)?)\s*(?:rb|ribu|k)\b/i;
        const mRb = line.match(rbRegex);
        if (mRb) {
            priceVal = parseNominalHargaPintar(mRb[0]);
            itemName = line.replace(mRb[0], ' ').trim();
        } else {
            const numRegex = /(?:[-–—:|•]\s*)?(?:rp\.?\s*)?(\d{1,3}(?:[.,]\d{3})+|\d{3,6})\b/i;
            const mNum = line.match(numRegex);
            if (mNum) {
                priceVal = parseNominalHargaPintar(mNum[1]);
                itemName = line.replace(mNum[0], ' ').trim();
            } else {
                const tailShort = line.match(/^(.*?)\s+[-–—:|]?\s*(?:rp\.?\s*)?(\d{1,3}(?:[.,]\d{1,2})?)\s*$/i);
                if (tailShort && tailShort[1].trim().length >= 2) {
                    priceVal = parseNominalHargaPintar(tailShort[2]);
                    itemName = tailShort[1].trim();
                }
            }
        }

        itemName = itemName
            .replace(/^[-–—:|•,.\s]+|[-–—:|•,.\s]+$/g, '')
            .replace(/\s{2,}/g, ' ')
            .trim();

        if (itemName.length >= 2 && priceVal >= 500) {
            const effectiveRawKat = (extractedDesc && extractedDrk && !inlineCat && !currentCategory)
                ? 'Paket Hemat & Combo'
                : (inlineCat || currentCategory);
            const resolvedKat = klasifikasiKategoriMenuPintar(itemName, effectiveRawKat);
            const cleanOpt = bersihkanFieldPaketOpsional(extractedDesc, extractedDrk, extractedVar);
            const articulatedVar = artikulasiOtomatisVarianDariMenu(
                itemName,
                cleanOpt.var,
                cleanOpt.desc,
                resolvedKat
            );
            const itemObj = {
                n: itemName.substring(0, 80),
                p: priceVal,
                d: discountPct,
                kat: resolvedKat,
                s: isReady,
                img: ''
            };
            if (cleanOpt.desc) itemObj.desc = cleanOpt.desc;
            if (cleanOpt.drk) itemObj.drk = cleanOpt.drk;
            if (articulatedVar) itemObj.var = articulatedVar;
            parsedItems.push(itemObj);
        }
    }

    return parsedItems;
}

export function parseDanValidasiJsonMenu(rawJsonText = '') {
    let text = String(rawJsonText || '').trim();
    if (!text) {
        return { ok: false, error: 'Kolom JSON masih kosong. Tempelkan format JSON atau konversi dari catatan teks.', items: [] };
    }

    text = text.replace(/^```(?:json|javascript|js)?\s*/i, '').replace(/\s*```$/i, '').trim();
    const healedText = text.replace(/,\s*([\]}])/g, '$1');

    let parsedRaw = null;
    try {
        parsedRaw = JSON.parse(healedText);
    } catch (errFirst) {
        if (healedText.startsWith('{') && healedText.endsWith('}') && /}\s*,\s*\{/.test(healedText)) {
            try {
                parsedRaw = JSON.parse(`[${healedText}]`);
            } catch (errSecond) {
                return {
                    ok: false,
                    error: `Format JSON belum tepat (${errFirst.message}). Gunakan tombol "Cek & Rapikan" atau "Konversi Catatan ke JSON".`,
                    items: []
                };
            }
        } else {
            return {
                ok: false,
                error: `Format JSON belum tepat (${errFirst.message}). Pastikan tanda kutip dan kurung siku [...] lengkap.`,
                items: []
            };
        }
    }

    let rawArray = [];
    if (Array.isArray(parsedRaw)) {
        rawArray = parsedRaw;
    } else if (parsedRaw && typeof parsedRaw === 'object') {
        if (Array.isArray(parsedRaw.items)) rawArray = parsedRaw.items;
        else if (Array.isArray(parsedRaw.menu)) rawArray = parsedRaw.menu;
        else if (Array.isArray(parsedRaw.data)) rawArray = parsedRaw.data;
        else if (Array.isArray(parsedRaw.daftarMenu)) rawArray = parsedRaw.daftarMenu;
        else rawArray = [parsedRaw];
    }

    if (!Array.isArray(rawArray) || rawArray.length === 0) {
        return { ok: false, error: 'Tidak ditemukan daftar item menu di dalam JSON tersebut.', items: [] };
    }

    const validItems = [];
    const warnings = [];
    const seenNames = new Set();

    rawArray.slice(0, 300).forEach((rawIt, idx) => {
        if (!rawIt || typeof rawIt !== 'object') return;

        const rawName = String(rawIt.n ?? rawIt.nama ?? rawIt.name ?? rawIt.menu ?? rawIt.judul ?? '').trim();
        if (!rawName || rawName.length < 2) {
            warnings.push(`Baris #${idx + 1} dilewati karena nama menu kosong.`);
            return;
        }

        const rawPrice = rawIt.p ?? rawIt.harga ?? rawIt.price ?? rawIt.nominal ?? 0;
        const priceVal = parseNominalHargaPintar(rawPrice);
        if (priceVal <= 0) {
            warnings.push(`Menu "${rawName}" dilewati karena harga belum diisi (Rp 0).`);
            return;
        }

        const rawDisc = rawIt.d ?? rawIt.diskon ?? rawIt.discount ?? rawIt.promo ?? 0;
        const discVal = Math.min(99, Math.max(0, parseInt(String(rawDisc).replace(/[^0-9]/g, ''), 10) || 0));

        const cleanOpt = bersihkanFieldPaketOpsional(
            rawIt.desc ?? rawIt.isi ?? rawIt.deskripsi ?? rawIt.komposisi ?? '',
            rawIt.drk ?? rawIt.minum ?? rawIt.minuman ?? rawIt.opsiMinum ?? '',
            rawIt.var ?? rawIt.varian ?? rawIt.opsi ?? rawIt.lauk ?? ''
        );

        const rawKat = rawIt.kat ?? rawIt.kategori ?? rawIt.category ?? rawIt.kelompok ?? '';
        const katVal = klasifikasiKategoriMenuPintar(
            rawName,
            (cleanOpt.desc && cleanOpt.drk && !rawKat) ? 'Paket Hemat & Combo' : rawKat
        );

        const articulatedVar = artikulasiOtomatisVarianDariMenu(
            rawName,
            cleanOpt.var,
            cleanOpt.desc,
            katVal
        );

        let stockVal = true;
        const rawStock = rawIt.s ?? rawIt.stok ?? rawIt.ready ?? rawIt.tersedia;
        if (rawStock !== undefined) {
            if (typeof rawStock === 'boolean') stockVal = rawStock;
            else if (typeof rawStock === 'string') {
                stockVal = !/^(false|0|habis|kosong|tidak)$/i.test(rawStock.trim());
            } else {
                stockVal = Boolean(rawStock);
            }
        }

        const cleanImg = bersihkanPublicIdCloudinary(rawIt.img ?? rawIt.foto ?? rawIt.image ?? '');
        const normKey = rawName.toLowerCase();

        const nextEntry = {
            id: rawIt.id ? String(rawIt.id) : '',
            n: rawName.substring(0, 80),
            p: priceVal,
            d: discVal,
            kat: katVal,
            s: stockVal,
            img: cleanImg
        };
        if (cleanOpt.desc) nextEntry.desc = cleanOpt.desc;
        if (cleanOpt.drk) nextEntry.drk = cleanOpt.drk;
        if (articulatedVar) nextEntry.var = articulatedVar;

        if (seenNames.has(normKey)) {
            warnings.push(`Nama menu "${rawName}" terdeteksi ganda di dalam JSON (otomatis digabungkan).`);
            const existingIdx = validItems.findIndex(v => v.n.toLowerCase() === normKey);
            if (existingIdx !== -1) {
                const prev = validItems[existingIdx];
                const mergedEntry = {
                    id: nextEntry.id || prev.id,
                    n: nextEntry.n,
                    p: nextEntry.p,
                    d: nextEntry.d,
                    kat: nextEntry.kat,
                    s: nextEntry.s,
                    img: nextEntry.img || prev.img
                };
                const finalDesc = nextEntry.desc || prev.desc || '';
                const finalDrk = nextEntry.drk || prev.drk || '';
                const finalVar = (prev.var && nextEntry.var)
                    ? gabungkanGrupVarianPintar(prev.var, nextEntry.var, true)
                    : (nextEntry.var || prev.var || '');
                if (finalDesc) mergedEntry.desc = finalDesc;
                if (finalDrk) mergedEntry.drk = finalDrk;
                if (finalVar) mergedEntry.var = finalVar;
                validItems[existingIdx] = mergedEntry;
            }
            return;
        }
        seenNames.add(normKey);
        validItems.push(nextEntry);
    });

    if (validItems.length === 0) {
        return {
            ok: false,
            error: warnings.length > 0 ? warnings.join(' ') : 'Tidak ada item menu valid (pastikan setiap item memiliki nama "n" dan harga "p" > 0).',
            items: []
        };
    }

    return {
        ok: true,
        items: validItems,
        warnings
    };
}

/**
 * Generator Prompt AI Generasi Baru (Multi-Grup Varian, Level Expander, Saus/Sambal & Extra Topping Berbayar)
 */
export function bangunTeksPromptAiPresisi() {
    const defaultDisc = parseInt(document.getElementById('studio-prompt-default-disc')?.value || '0', 10) || 0;
    const storeName = (document.getElementById('store-input-nama')?.value || 'Resto Kuliner JAPAR').trim();
    const storeCategory = (document.getElementById('store-input-kategori')?.value || 'HIDANGAN_UTAMA').trim();

    const discRuleText = defaultDisc > 0
        ? `- "d" (number integer, WAJIB): Persentase diskon menu (0 s/d 99). Jika di foto buku menu tertulis diskon spesifik, gunakan angka tersebut. Jika tidak tertulis diskon spesifik, isi default ${defaultDisc} (karena sedang ada promo ${defaultDisc}%).`
        : `- "d" (number integer, WAJIB): Persentase diskon khusus menu dalam angka bulat (0 s/d 99) tanpa simbol %. Isi 0 jika menu dijual dengan harga normal.`;

    return `Anda adalah Sistem Ekstraktor Foto Buku Menu & Konverter Katalog Presisi Tinggi Generasi Baru untuk aplikasi **JAPAR Resto Panel**.
Tugas Anda adalah mengekstrak seluruh daftar menu beserta harga, karakter kuliner (9 Subtipe Kuliner), rentang level pedas, pilihan saus/sambal, metode penyajian, dan extra topping dari **FOTO BUKU MENU / BANNER / DAFTAR HARGA** milik **${storeName}** (${storeCategory}) yang saya lampirkan, lalu mengubahnya secara otomatis menjadi **JSON Array murni** yang sah dan siap diimpor langsung ke sistem tanpa error.

==================================================
TUGAS EKSTRAKSI FOTO BUKU MENU, PENGENALAN 9 SUBTIPE KULINER & KONVERSI HARGA OTOMATIS:
==================================================
1. Baca seluruh teks nama makanan, minuman, camilan, roti/oleh-oleh, paket hemat, hingga kotak keterangan saus/topping yang terlihat pada foto referensi secara teliti dari atas ke bawah.
2. DETEKSI & KONVERSI HARGA VARIATIF SECARA OTOMATIS:
   Anda WAJIB mengonversi seluruh variasi penulisan harga pada foto menjadi **Integer Rupiah Penuh** pada kunci \`"p"\` (angka bulat murni TANPA titik, TANPA koma, dan TANPA simbol "Rp"):
   - Angka puluhan/satuan ribuan: \`10\` -> \`10000\` | \`10.9\` -> \`10900\` | \`15\` -> \`15000\` | \`25\` -> \`25000\`.
   - Huruf "k" / "K" / "rb" / "ribu": \`10k\` / \`10 rb\` -> \`10000\` | \`12.5k\` / \`12,5 rb\` -> \`12500\`.
   - Pemisah ribuan atau simbol Rp: \`10.900\` / \`Rp 18.000,-\` -> \`10900\` / \`18000\`.
3. KENALI KARAKTER ITEM SECARA AKURAT (9 SUBTIPE KULINER JAPAR):
   Anda WAJIB mengenali karakter setiap hidangan secara presisi (JANGAN mencampuradukkan Mie Level Kering dengan Hidangan Berkuah!):
   - **MIE_KERING_LEVEL (Mie Level Kering Tanpa Kuah)**: Menu seperti \`Mie Pedas Gurih Jangkrik (Level 0 - 3)\`, \`Mie Pedas Manis\`, \`Cwie Mie\`, \`Bakmi\`, \`Yamin\` adalah **mie kering berbumbu tanpa kuah** (BUKAN hidangan berkuah dan BUKAN mie goreng kecap biasa). DILARANG menambahkan kata "Kuah" pada deskripsi/varian mie kering level!
   - **HIDANGAN_BERKUAH**: Hanya untuk menu yang secara EKSPLISIT berkuah (\`Bakso\`, \`Soto\`, \`Rawon\`, \`Sop/Sup\`, \`Ramen\`, \`Seblak\`, \`Gulai\`, \`Lontong\`, \`Tongseng\`, \`Mie Kuah / Mie Rebus / Mie Nyemek\`).
   - **NASGOR_MIE_GORENG**: \`Nasi Goreng\`, \`Mie Goreng\`, \`Bakmi Goreng\`, \`Kwetiau Goreng\`, \`Bihun Goreng\`.
   - **AYAM_SAUS_RICEBOWL**: \`Ricebowl\`, \`Ayam Celup\`, \`Chicken Wings / Fire Wings\`, \`Chicken Katsu\`, serta menu bersaus (\`Teriyaki\`, \`Blackpepper\`, \`BBQ\`, \`Mentai\`, \`Keju\`, \`Thai Hot\`).
   - **NASI_LALAPAN_PENYETAN**: Hidangan nasi, penyetan, lalapan, ayam/bebek/ikan bakar/goreng lainnya.
   - **DIMSUM_CAMILAN_GURIH**: \`Dimsum\`, \`Ekkado\`, \`Wonton\`, \`Siomay\`, \`Batagor\`, \`Gorengan\`, \`Tahu Walik\`, \`Tempe Mendoan\`, \`Kentang\`, \`Kebab\`, \`Burger\`.
   - **ROTI_KUE_OLEH_OLEH**: \`Donat\`, \`Roti\`, \`Kue\`, \`Brownies\`, \`Bolu\`, \`Pastry\`, \`Oleh-Oleh\`.
   - **MINUMAN_PANAS** vs **MINUMAN_DINGIN**: Bedakan minuman panas (\`Hot\`, \`Hangat\`, \`Panas\`, \`Wedang\` tanpa es) dan minuman dingin/es.
4. ATURAN WAJIB ARTIKULASI VARIAN MULTI-GRUP PADA FIELD \`"var"\` (MAKS 280 KARAKTER):
   - **Ekspansi Rentang Level Otomatis**:
     Anda WAJIB mengekspansi setiap rentang level di foto buku menu (misal \`Mie Pedas Gurih Jangkrik (Level 0 - 3) : 10.900\`, \`Level 4 - 6 : 11.900\`, \`Level 7 - 9 : 12.900\`) menjadi deret level eksplisit pada \`"var"\`:
     • \`Level 0 - 3\` -> \`"var": "Level Pedas: Level 0, Level 1, Level 2, Level 3"\`
     • \`Level 4 - 6\` -> \`"var": "Level Pedas: Level 4, Level 5, Level 6"\`
     • \`Level 7 - 9\` -> \`"var": "Level Pedas: Level 7, Level 8, Level 9"\`
   - **Sematkan Pilihan Saus pada Menu Ayam Celup / Ricebowl / Wings**:
     Jika di foto terdapat keterangan saus kategori (seperti \`Pilihan Sauce: BBQ, Blackpepper, Thai Hot\` pada kelompok Ayam Celup / Ricebowl / Chicken Wings), Anda WAJIB menyematkan \`"Pilihan Saus: BBQ, Blackpepper, Thai Hot"\` ke dalam \`"var"\` pada setiap item di kelompok tersebut.
   - **Deteksi Menu Opsi Garis Miring (\`/\`)**:
     Jika ada menu dengan opsi penyajian/suhu garis miring seperti \`Ekkado Tim / Goreng\` atau \`Ice / Hot Tea\`, isi \`"var": "Penyajian: Tim (Kukus), Goreng"\` atau \`"var": "Suhu Saji: Ice (Dingin), Hot (Panas)"\`.
   - **Deteksi Menu dengan 2 Harga Berbeda (Panas/Dingin atau Ukuran)**:
     Jika 1 menu memiliki 2 harga berbeda seperti \`Dutch Chocolate Hot 18.000 / Ice 20.000\`, satukan secara cerdas dengan harga dasar \`"p": 18000\` serta \`"var": "Suhu Saji: Hot (Panas), Ice (Dingin) (+2000)"\`.
   - **Integrasi Kotak Extra Topping [+] Berbayar**:
     Jika di foto terdapat kotak \`Extra / Topping\` berbayar (seperti \`+ Topping Ayam Tabur 2.000\`, \`+ Extra Sauce 4.000\`, \`+ Wonton Goreng 4.000\`, \`+ Telur Ceplok 4.000\`), sematkan sebagai grup multi-pilih \`"Extra Topping [+]: Topping Ayam Tabur (+2000), Extra Sauce (+4000), Wonton Goreng (+4000), Telur Ceplok (+4000)"\` pada \`"var"\` menu utama yang relevan (Mie Level Kering / Nasi Goreng / Ricebowl / Ayam Celup) menggunakan pemisah \` | \`, selain tetap mendaftarkan item topping tersebut sebagai item tersendiri.

==================================================
SPESIFIKASI SKEMA JSON WAJIB:
==================================================
1. Untuk **Menu Biasa tanpa varian/paket**, keluarkan 5 kunci baku (\`n\`, \`p\`, \`d\`, \`kat\`, \`s\`) — 0-byte overhead.
2. Untuk **Menu Bervarian / Level / Saus / Topping / Paket Hemat**, sertakan kunci opsional \`"desc"\` (maks 160 karakter), \`"drk"\` (maks 160 karakter), dan \`"var"\` (mendukung sintaks multi-grup dengan pemisah \` | \` dan penanda multi-pilih \`[+]\`, maks 280 karakter):
[
  {
    "n": "Mie Pedas Gurih Jangkrik (Level 0 - 3)",
    "p": 10900,
    "d": ${defaultDisc},
    "kat": "Hidangan Utama",
    "s": true,
    "var": "Level Pedas: Level 0, Level 1, Level 2, Level 3 | Extra Topping [+]: Topping Ayam Tabur (+2000), Extra Sauce (+4000), Wonton Goreng (+4000), Telur Ceplok (+4000)"
  },
  {
    "n": "Chicken Ricebowl Spesial",
    "p": 16000,
    "d": ${defaultDisc},
    "kat": "Hidangan Utama",
    "s": true,
    "var": "Pilihan Saus: BBQ, Blackpepper, Thai Hot | Extra Topping [+]: Telur Ceplok (+4000), Extra Sauce (+4000)"
  },
  {
    "n": "Dutch Chocolate",
    "p": 18000,
    "d": ${defaultDisc},
    "kat": "Minuman & Kopi",
    "s": true,
    "var": "Suhu Saji: Hot (Panas), Ice (Dingin) (+2000)"
  },
  {
    "n": "Paket Ayam Bakar Hemat",
    "p": 19000,
    "d": ${defaultDisc},
    "kat": "Paket Hemat & Combo",
    "s": true,
    "desc": "1x Nasi Putih + 1x Ayam Bakar Madu + Tahu Tempe + Sambal Lalapan",
    "drk": "Es Teh Manis, Teh Manis Hangat, Es Jeruk (+2000)",
    "var": "Bagian Lauk: Dada, Paha Atas, Paha Bawah | Pilihan Sambal: Sambal Bawang, Sambal Korek"
  }
]

==================================================
8 ATURAN KETAT & PRESISI (WAJIB DIIKUTI 100%):
==================================================
1. HANYA KELUARKAN JSON ARRAY MURNI:
   - Keluarkan HANYA kode JSON yang diawali \`[\` dan diakhiri \`]\`.
   - DILARANG menambahkan kalimat pembuka, penutup, catatan kaki, atau komentar \`//\` di dalam JSON.

2. ATURAN KUNCI "n" (Nama Hidangan - String):
   - Gunakan huruf kapital di awal kata (Title Case) yang rapi (maksimal 80 karakter, tanpa nomor urut di depan nama).

3. ATURAN KUNCI "p" (Harga Normal - Integer Rupiah Murni Hasil Konversi Otomatis):
   - WAJIB berupa angka bulat (integer) dalam satuan Rupiah penuh hasil konversi otomatis dari format harga di foto (\`10\` / \`10 k\` / \`10 rb\` / \`10.000\` -> \`10000\`; \`10.900\` -> \`10900\`; \`12.5\` -> \`12500\`).

4. ATURAN KUNCI "d" (Diskon Persen - Integer 0 s/d 99):
   ${discRuleText}

5. ATURAN KUNCI "kat" (5 Kelompok Menu Standar JAPAR):
   - WAJIB gunakan salah satu dari 5 kelompok menu standar berikut secara presisi:
     • "Hidangan Utama" (nasi, mie kering level, mie goreng, ricebowl, ayam celup, bakso, soto, rawon, penyetan, lauk utama)
     • "Minuman & Kopi" (es, teh, kopi, coklat, jus, wedang, susu, minuman dingin/panas)
     • "Camilan & Jajanan" (dimsum, ekkado, wonton, siomay, batagor, kebab, burger, gorengan, tahu walik, tempe mendoan, kentang)
     • "Roti, Kue & Oleh-Oleh" (donat, roti, bakery, kue, brownies, bolu, pastry, oleh-oleh kemasan)
     • "Paket Hemat & Combo" (paket makan + minum, combo hemat, nasi kotak, tumpeng, hampers)

6. ATURAN KUNCI "s" (Status Ketersediaan Stok - Boolean):
   - Isi \`true\` jika menu tersedia / siap dipesan, atau \`false\` jika tertulis habis/kosong.

7. ATURAN KUNCI OPSIONAL PAKET & VARIAN MULTI-GRUP ("desc", "drk", "var"):
   - "desc": Rincian komposisi isi makanan dalam paket atau deskripsi singkat (maks 160 karakter). Ingat: bedakan secara tegas Mie Level Kering (tanpa kuah) vs Hidangan Berkuah!
   - "drk": Pilihan minuman paket dipisah koma (maks 160 karakter, contoh: "Es Teh Manis, Teh Manis Hangat, Es Jeruk (+2000)").
   - "var": Opsi kustomisasi menu (maks 280 karakter). Gunakan format grup \`NamaGrup: Opsi1, Opsi2 (+nominal)\` dan pisahkan antar grup dengan \` | \`. Tambahkan \`[+]\` pada nama grup jika pelanggan boleh memilih lebih dari 1 (contoh: \`Extra Topping [+]: Topping Ayam Tabur (+2000), Telur Ceplok (+4000)\`).

8. ANTI-DUPLIKASI:
   - Pastikan tidak ada nama menu "n" yang persis sama dua kali.

==================================================
INSTRUKSI EKSEKUSI:
==================================================
Silakan baca Foto Buku Menu / Banner yang saya lampirkan bersama pesan ini, kenali subtipe kulinernya (bedakan Mie Level Kering vs Hidangan Berkuah), ekspansi seluruh rentang level (\`Level 0 - 3\`), sematkan \`Pilihan Saus\` pada menu Ayam Celup/Ricebowl/Wings, serta \`Extra Topping [+]\` berbayar pada menu utama yang relevan, dan keluarkan hasil JSON Array murninya sekarang!`;
}

export function sinkronkanPreviewPromptAiUI() {
    const preEl = document.getElementById('studio-ai-prompt-preview-text');
    if (preEl) {
        preEl.textContent = bangunTeksPromptAiPresisi();
    }
}

export function setModeInputStudioJson(mode = 'AI') {
    studioInputMode = (mode === 'NOTES') ? 'NOTES' : 'AI';
    const btnAi = document.getElementById('btn-studio-mode-ai');
    const btnNotes = document.getElementById('btn-studio-mode-notes');
    const panelAi = document.getElementById('studio-panel-mode-ai');
    const panelNotes = document.getElementById('studio-panel-mode-notes');

    if (btnAi && btnNotes) {
        btnAi.className = studioInputMode === 'AI'
            ? 'py-2 px-2.5 rounded-xl text-[0.62rem] font-extrabold uppercase tracking-wider bg-amber-500 text-black shadow cursor-pointer transition-all flex items-center justify-center gap-1.5'
            : 'py-2 px-2.5 rounded-xl text-[0.62rem] font-bold uppercase tracking-wider text-stone-300 hover:bg-white/5 cursor-pointer transition-all flex items-center justify-center gap-1.5';
        btnNotes.className = studioInputMode === 'NOTES'
            ? 'py-2 px-2.5 rounded-xl text-[0.62rem] font-extrabold uppercase tracking-wider bg-orange-600 text-white shadow cursor-pointer transition-all flex items-center justify-center gap-1.5'
            : 'py-2 px-2.5 rounded-xl text-[0.62rem] font-bold uppercase tracking-wider text-stone-300 hover:bg-white/5 cursor-pointer transition-all flex items-center justify-center gap-1.5';
    }

    if (panelAi) panelAi.classList.toggle('hidden-state', studioInputMode !== 'AI');
    if (panelNotes) panelNotes.classList.toggle('hidden-state', studioInputMode !== 'NOTES');
}

export function inisialisasiManajemenMenu(initialItems = [], diskonToko = 0, onChangeCb = null, initialSkema = 'MAX_BEST') {
    daftarMenuAktif = Array.isArray(initialItems)
        ? initialItems.map((it, idx) => bentukObjekItemMenuHematKuota(it, idx))
        : [];
    diskonTokoGlobalPersen = Math.min(99, Math.max(0, parseInt(diskonToko, 10) || 0));
    skemaDiskonGlobal = ['MAX_BEST', 'ITEM_OVERRIDE', 'STACK_ADD'].includes(initialSkema) ? initialSkema : 'MAX_BEST';
    onMenuChangedCallback = onChangeCb;
    filterStatusStok = 'ALL';
    perbaruiPenjelasanSkemaDiskonUI();
    renderFilterSubKategoriChips();
    renderDaftarMenuUI();
    sinkronkanEditorStudioJsonDariMenuAktif(false);
    sinkronkanPreviewPromptAiUI();
}

function perbaruiAsistenAiLiteDiagnostikUI() {
    const boxEl = document.getElementById('ai-lite-menu-assistant-box');
    const studioStatsEl = document.getElementById('studio-ai-quota-diagnostics');

    const total = daftarMenuAktif.length;
    const noPhotoCount = daftarMenuAktif.filter(m => !m.img).length;
    const withPhotoCount = total - noPhotoCount;
    const outCount = daftarMenuAktif.filter(m => m.s === false).length;
    const pkgCount = daftarMenuAktif.filter(m => m.kat === 'Paket Hemat & Combo' || (m.desc && m.drk)).length;
    const jsonBytes = new Blob([JSON.stringify(getDaftarMenuAktif())]).size;
    const sizeKb = (jsonBytes / 1024).toFixed(1);

    if (studioStatsEl) {
        studioStatsEl.innerHTML = `
            <span class="px-2 py-0.5 rounded bg-emerald-500/15 border border-emerald-500/30 text-emerald-300 font-mono text-[0.58rem] font-bold">
                <i class="fa-solid fa-wand-magic-sparkles mr-1"></i>Pemrosesan Pintar Otomatis
            </span>
            <span class="px-2 py-0.5 rounded bg-amber-500/15 border border-amber-500/30 text-amber-300 font-mono text-[0.58rem] font-bold">
                Total Menu: ${total}/300 item (${pkgCount} paket • ${sizeKb} KB)
            </span>
            <span class="px-2 py-0.5 rounded bg-white/5 border border-white/10 text-stone-300 font-mono text-[0.58rem] font-bold">
                Foto Lengkap: ${withPhotoCount}/${total}
            </span>
        `;
    }

    if (!boxEl) return;

    if (total === 0) {
        boxEl.className = 'p-3 rounded-2xl bg-gradient-to-r from-orange-500/15 to-amber-500/10 border border-orange-500/35 flex flex-col sm:flex-row sm:items-center justify-between gap-2.5';
        boxEl.innerHTML = `
            <div class="text-[0.64rem] text-stone-200 leading-relaxed">
                <div class="font-extrabold text-amber-300 uppercase flex items-center gap-1.5 mb-0.5">
                    <i class="fa-solid fa-wand-magic-sparkles text-orange-400"></i> Resto Baru? Input Puluhan Menu &amp; Paket Hemat dalam 10 Detik!
                </div>
                Gunakan <b>Studio JSON &amp; AI</b> untuk menempelkan daftar menu dari AI / Catatan HP sekaligus, atau tekan <b>+ Tambah Menu</b> untuk menyusun Paket Hemat &amp; Varian Multi-Grup ala GoFood.
            </div>
            <button type="button" id="btn-open-studio-from-empty-banner" class="px-3 py-2 rounded-xl bg-gradient-to-r from-orange-600 to-amber-500 text-white text-[0.62rem] font-extrabold uppercase tracking-wider shrink-0 cursor-pointer shadow-md flex items-center justify-center gap-1.5">
                <i class="fa-solid fa-bolt"></i> Buka Studio JSON
            </button>
        `;
        document.getElementById('btn-open-studio-from-empty-banner')?.addEventListener('click', () => {
            picuGetarSentuh(10);
            bukaTabStudioJsonPintar();
        });
        return;
    }

    if (noPhotoCount > 0) {
        const isFilteringNoPhoto = filterStatusStok === 'NO_PHOTO';
        boxEl.className = 'p-2.5 rounded-2xl bg-amber-500/10 border border-amber-500/35 flex flex-col sm:flex-row sm:items-center justify-between gap-2';
        boxEl.innerHTML = `
            <div class="text-[0.62rem] text-stone-200 leading-snug">
                <b class="text-amber-300"><i class="fa-solid fa-camera-retro mr-1"></i>Asisten Dapur:</b> Ada <b>${noPhotoCount} dari ${total} menu</b> belum berfoto (${pkgCount > 0 ? `${pkgCount} Paket Hemat • ` : ''}${outCount > 0 ? `${outCount} habis • ` : ''}Data hemat <b>${sizeKb} KB</b>). Ketuk kotak <b>"+ Foto"</b> di sebelah kiri kartu menu untuk langsung memilih foto.
            </div>
            <div class="flex items-center gap-1.5 shrink-0">
                <button type="button" id="btn-filter-no-photo-assistant" class="px-2.5 py-1.5 rounded-xl ${isFilteringNoPhoto ? 'bg-amber-500 text-black' : 'bg-[#121316] text-amber-300 border border-amber-500/40'} text-[0.58rem] font-extrabold uppercase tracking-wider cursor-pointer">
                    <i class="fa-solid fa-filter mr-1"></i>${isFilteringNoPhoto ? 'Semua Menu' : `Belum Foto (${noPhotoCount})`}
                </button>
                <button type="button" id="btn-open-studio-from-assistant" class="px-2.5 py-1.5 rounded-xl bg-orange-500/20 border border-orange-500/40 text-orange-300 text-[0.58rem] font-extrabold uppercase tracking-wider cursor-pointer">
                    <i class="fa-solid fa-code mr-1"></i>Studio JSON
                </button>
            </div>
        `;
        document.getElementById('btn-filter-no-photo-assistant')?.addEventListener('click', () => {
            picuGetarSentuh(8);
            filterStatusStok = (filterStatusStok === 'NO_PHOTO') ? 'ALL' : 'NO_PHOTO';
            renderFilterSubKategoriChips();
            renderDaftarMenuUI();
        });
        document.getElementById('btn-open-studio-from-assistant')?.addEventListener('click', () => {
            picuGetarSentuh(10);
            bukaTabStudioJsonPintar();
        });
    } else {
        boxEl.className = 'p-2.5 rounded-2xl bg-emerald-500/10 border border-emerald-500/30 flex items-center justify-between gap-2 flex-wrap';
        boxEl.innerHTML = `
            <div class="text-[0.62rem] text-emerald-300">
                <i class="fa-solid fa-circle-check mr-1"></i><b>Katalog Optimal 100%:</b> Seluruh <b>${total} menu</b> (${pkgCount} paket hemat) telah dilengkapi foto WebP ringan (Ukuran Data: <b>${sizeKb} KB</b>).
            </div>
            <button type="button" id="btn-open-studio-from-assistant" class="px-2.5 py-1 rounded-lg bg-[#121316] border border-white/15 text-amber-300 text-[0.58rem] font-extrabold uppercase cursor-pointer">
                <i class="fa-solid fa-code mr-1"></i>Edit Massal / Backup JSON
            </button>
        `;
        document.getElementById('btn-open-studio-from-assistant')?.addEventListener('click', () => {
            picuGetarSentuh(10);
            bukaTabStudioJsonPintar();
        });
    }
}

export function bukaTabStudioJsonPintar() {
    const tabBtn = document.querySelector('.merchant-tab-btn[data-tab="tab-studio-json"]');
    if (tabBtn) {
        tabBtn.click();
    } else {
        document.querySelectorAll('.merchant-tab-view').forEach(v => v.classList.add('hidden-state'));
        const target = document.getElementById('tab-studio-json');
        if (target) target.classList.remove('hidden-state');
        sinkronkanPreviewPromptAiUI();
        evaluasiDanRenderPreviewStudioJson();
    }
}

function perbaruiStatistikKatalogHeader() {
    const total = daftarMenuAktif.length;
    const avail = daftarMenuAktif.filter(m => m.s !== false).length;
    const out = Math.max(0, total - avail);

    const elTotal = document.getElementById('stat-total-menu');
    const elAvail = document.getElementById('stat-avail-menu');
    const elOut = document.getElementById('stat-out-menu');
    const elDisc = document.getElementById('stat-store-discount');

    if (elTotal) elTotal.innerText = String(total);
    if (elAvail) elAvail.innerText = String(avail);
    if (elOut) elOut.innerText = String(out);
    if (elDisc) elDisc.innerText = `${diskonTokoGlobalPersen}%`;

    const btnResetStock = document.getElementById('btn-reset-all-stock-ready');
    const bannerOutNotice = document.getElementById('stock-out-helper-banner');
    if (btnResetStock) {
        btnResetStock.classList.toggle('hidden-state', out === 0);
    }
    if (bannerOutNotice) {
        bannerOutNotice.classList.toggle('hidden-state', out === 0);
        const countSpan = document.getElementById('stock-out-helper-count');
        if (countSpan) countSpan.innerText = String(out);
    }

    document.querySelectorAll('[data-stat-filter]').forEach(box => {
        const mode = box.getAttribute('data-stat-filter');
        const active = (mode === filterStatusStok);
        box.classList.toggle('ring-2', active);
        box.classList.toggle('ring-orange-500', active);
    });

    perbaruiAsistenAiLiteDiagnostikUI();
}

function renderFilterSubKategoriChips() {
    const chipContainer = document.getElementById('menu-subcat-chips');
    if (!chipContainer) return;

    const existingCats = new Set(daftarMenuAktif.map(m => m.kat || 'Hidangan Utama'));
    const orderedCats = STANDAR_KELOMPOK_MENU_JAPAR.filter(c => existingCats.has(c));
    existingCats.forEach(c => {
        if (!orderedCats.includes(c)) orderedCats.push(c);
    });
    const allCats = ['ALL', ...orderedCats];

    chipContainer.innerHTML = '';

    const outCount = daftarMenuAktif.filter(m => m.s === false).length;
    const noPhotoCount = daftarMenuAktif.filter(m => !m.img).length;

    allCats.forEach(cat => {
        const btn = document.createElement('button');
        btn.type = 'button';
        const isActive = (filterSubKategori === cat && filterStatusStok === 'ALL');
        btn.className = isActive
            ? 'px-2.5 py-1 rounded-full text-[0.6rem] font-extrabold uppercase tracking-wider bg-orange-600 text-white shadow-sm shrink-0 cursor-pointer transition-all'
            : 'px-2.5 py-1 rounded-full text-[0.6rem] font-bold uppercase tracking-wider bg-[#121316] text-stone-300 border border-white/10 hover:bg-white/10 shrink-0 cursor-pointer transition-all';
        btn.textContent = cat === 'ALL' ? `Semua (${daftarMenuAktif.length})` : cat;
        btn.addEventListener('click', () => {
            picuGetarSentuh(8);
            filterSubKategori = cat;
            filterStatusStok = 'ALL';
            renderFilterSubKategoriChips();
            renderDaftarMenuUI();
        });
        chipContainer.appendChild(btn);
    });

    if (noPhotoCount > 0) {
        const btnNoPhoto = document.createElement('button');
        btnNoPhoto.type = 'button';
        const isNoPhotoActive = (filterStatusStok === 'NO_PHOTO');
        btnNoPhoto.className = isNoPhotoActive
            ? 'px-2.5 py-1 rounded-full text-[0.6rem] font-extrabold uppercase tracking-wider bg-amber-500 text-black shadow-sm shrink-0 cursor-pointer transition-all'
            : 'px-2.5 py-1 rounded-full text-[0.6rem] font-bold uppercase tracking-wider bg-amber-500/15 text-amber-300 border border-amber-500/40 shrink-0 cursor-pointer transition-all';
        btnNoPhoto.innerHTML = `<i class="fa-solid fa-camera mr-1"></i>Belum Foto (${noPhotoCount})`;
        btnNoPhoto.addEventListener('click', () => {
            picuGetarSentuh(8);
            filterStatusStok = (filterStatusStok === 'NO_PHOTO') ? 'ALL' : 'NO_PHOTO';
            renderFilterSubKategoriChips();
            renderDaftarMenuUI();
        });
        chipContainer.appendChild(btnNoPhoto);
    }

    if (outCount > 0) {
        const btnOut = document.createElement('button');
        btnOut.type = 'button';
        const isOutActive = (filterStatusStok === 'OUT');
        btnOut.className = isOutActive
            ? 'px-2.5 py-1 rounded-full text-[0.6rem] font-extrabold uppercase tracking-wider bg-red-600 text-white shadow-sm shrink-0 cursor-pointer transition-all'
            : 'px-2.5 py-1 rounded-full text-[0.6rem] font-bold uppercase tracking-wider bg-red-500/10 text-red-400 border border-red-500/30 shrink-0 cursor-pointer transition-all';
        btnOut.innerHTML = `<i class="fa-solid fa-ban mr-1"></i>Habis (${outCount})`;
        btnOut.addEventListener('click', () => {
            picuGetarSentuh(8);
            filterStatusStok = (filterStatusStok === 'OUT') ? 'ALL' : 'OUT';
            renderFilterSubKategoriChips();
            renderDaftarMenuUI();
        });
        chipContainer.appendChild(btnOut);
    }
}

export function renderDaftarMenuUI() {
    perbaruiStatistikKatalogHeader();
    const listEl = document.getElementById('merchant-menu-list');
    const countBadge = document.getElementById('merchant-menu-count-badge');
    if (!listEl) return;

    const totalTersedia = daftarMenuAktif.filter(m => m.s !== false).length;
    if (countBadge) {
        countBadge.innerText = `${totalTersedia}/${daftarMenuAktif.length} SIAP DIPESAN`;
    }

    const filtered = daftarMenuAktif.filter(item => {
        const isReady = item.s !== false;
        const hasPhoto = Boolean(item.img && String(item.img).trim());
        const matchStock =
            filterStatusStok === 'ALL' ||
            (filterStatusStok === 'READY' && isReady) ||
            (filterStatusStok === 'OUT' && !isReady) ||
            (filterStatusStok === 'NO_PHOTO' && !hasPhoto);
        const matchCat = filterSubKategori === 'ALL' || item.kat === filterSubKategori;
        const matchQuery = !kataKunciCariMenu ||
            item.n.toLowerCase().includes(kataKunciCariMenu) ||
            (item.kat || '').toLowerCase().includes(kataKunciCariMenu) ||
            (item.desc || '').toLowerCase().includes(kataKunciCariMenu) ||
            (item.drk || '').toLowerCase().includes(kataKunciCariMenu) ||
            (item.var || '').toLowerCase().includes(kataKunciCariMenu);
        return matchStock && matchCat && matchQuery;
    });

    listEl.innerHTML = '';

    if (filtered.length === 0) {
        const isFiltering = filterStatusStok !== 'ALL' || filterSubKategori !== 'ALL' || Boolean(kataKunciCariMenu);
        listEl.innerHTML = `
            <div class="p-5 rounded-2xl bg-[#121316] border border-dashed border-white/15 text-center flex flex-col items-center gap-2">
                <i class="fa-solid fa-bowl-food text-2xl text-orange-400/70"></i>
                <div class="text-xs font-bold text-stone-200">${isFiltering ? 'Tidak Ada Menu yang Cocok dengan Filter' : 'Belum Ada Hidangan di Katalog'}</div>
                <p class="text-[0.65rem] text-stone-400 max-w-xs">${isFiltering ? 'Coba ubah kata kunci pencarian atau tekan tombol Semua untuk menampilkan seluruh hidangan.' : 'Tekan tombol <b>+ Tambah Menu</b> atau gunakan <b>Import JSON / AI</b> untuk memasukkan daftar menu sekaligus.'}</p>
            </div>
        `;
        return;
    }

    filtered.forEach(item => {
        const hargaInfo = hitungHargaFinalMenu(item.p, item.d, diskonTokoGlobalPersen, skemaDiskonGlobal);
        const hasCustomPhoto = Boolean(item.img && String(item.img).trim());
        const fotoUrl = bangunUrlGambarCloudinary(item.img, 400, item.n);
        const isAvailable = item.s !== false;

        const card = document.createElement('div');
        card.className = `dish-item-card flex items-center gap-2.5 ${
            isAvailable
                ? 'bg-[#121316] border-white/10 shadow-sm'
                : 'bg-[#121316]/60 border-red-500/35 opacity-85'
        }`;

        const hargaMarkup = hargaInfo.diskonPersen > 0
            ? `<div class="flex items-center gap-1.5 flex-wrap mt-1">
                 <span class="text-[0.6rem] line-through text-stone-400 font-mono">${formatRupiah(hargaInfo.hargaAsli)}</span>
                 <span class="text-xs font-extrabold text-emerald-400 font-mono">${formatRupiah(hargaInfo.hargaFinal)}</span>
                 <span class="px-1.5 py-0.5 rounded bg-emerald-500/20 border border-emerald-500/40 text-emerald-300 text-[0.52rem] font-extrabold uppercase">-${hargaInfo.diskonPersen}%</span>
               </div>`
            : `<div class="text-xs font-extrabold text-amber-400 font-mono mt-1">${formatRupiah(hargaInfo.hargaAsli)}</div>`;

        const statusPillMarkup = isAvailable
            ? `<span class="text-[0.48rem] font-extrabold uppercase tracking-wider px-1.5 py-0.5 rounded bg-emerald-500/15 text-emerald-400 border border-emerald-500/30">SIAP</span>`
            : `<span class="text-[0.48rem] font-extrabold uppercase tracking-wider px-1.5 py-0.5 rounded bg-red-500/15 text-red-400 border border-red-500/35">HABIS</span>`;

        const photoStatusBadge = !hasCustomPhoto
            ? `<span class="text-[0.46rem] font-extrabold uppercase px-1.5 py-0.5 rounded bg-amber-500/20 text-amber-300 border border-amber-500/40"><i class="fa-solid fa-camera mr-0.5"></i>+Foto</span>`
            : '';

        const pkgDetailsMarkup = `
            ${item.desc ? `<div class="text-[0.58rem] text-stone-300 mt-0.5 line-clamp-2"><i class="fa-solid fa-utensils text-orange-400 mr-1"></i><b>Isi:</b> ${escapeHtmlAman(item.desc)}</div>` : ''}
            ${item.drk ? `<div class="text-[0.56rem] text-emerald-300 mt-0.5 truncate"><i class="fa-solid fa-glass-water mr-1"></i><b>Minum:</b> ${escapeHtmlAman(item.drk)}</div>` : ''}
            ${item.var ? `<div class="text-[0.54rem] text-amber-300 mt-0.5 line-clamp-2"><i class="fa-solid fa-sliders mr-1"></i><b>Opsi:</b> ${escapeHtmlAman(item.var)}</div>` : ''}
        `;

        card.innerHTML = `
            <div class="btn-quick-card-photo relative w-14 h-14 rounded-xl overflow-hidden shrink-0 border ${hasCustomPhoto ? 'border-white/15' : 'border-amber-500/60'} bg-[#1A1C20] cursor-pointer group" title="Ketuk untuk langsung memilih atau mengganti foto hidangan ini">
                <img src="${fotoUrl}" referrerpolicy="no-referrer" loading="lazy" alt="Hidangan" draggable="false" oncontextmenu="return false;" class="w-full h-full object-cover pointer-events-none select-none">
                <div class="absolute inset-x-0 bottom-0 bg-black/75 py-0.5 text-center text-[0.46rem] font-extrabold ${hasCustomPhoto ? 'text-stone-200' : 'text-amber-300'} uppercase tracking-tighter z-10">
                    <i class="fa-solid fa-camera mr-0.5"></i>${hasCustomPhoto ? 'Ganti' : '+ Foto'}
                </div>
                ${!isAvailable ? '<div class="absolute inset-0 bg-black/80 flex flex-col items-center justify-center z-20 p-1 text-center"><span class="text-[0.48rem] font-black text-red-400 uppercase tracking-wider px-1 py-0.5 border border-red-400/60 rounded bg-red-950/80">HABIS</span></div>' : ''}
            </div>
            <div class="flex-1 min-w-0">
                <div class="text-[0.76rem] sm:text-xs font-extrabold text-white line-clamp-2-title item-title-el"></div>
                ${pkgDetailsMarkup}
                <div class="flex items-center gap-1 flex-wrap mt-0.5">
                    <span class="item-cat-badge text-[0.48rem] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded bg-orange-500/10 text-orange-300 border border-orange-500/25 truncate max-w-[135px]"></span>
                    ${statusPillMarkup}
                    ${photoStatusBadge}
                </div>
                ${hargaMarkup}
            </div>
            <div class="flex flex-col items-end justify-between gap-2 shrink-0 pl-1">
                <label class="bgt-toggle-label flex items-center gap-1" title="Saklar Ketersediaan: Nyalakan jika menu Siap Dipesan, matikan jika Habis Hari Ini">
                    <span class="text-[0.5rem] font-extrabold uppercase ${isAvailable ? 'text-emerald-400' : 'text-red-400'}">${isAvailable ? 'SIAP' : 'HABIS'}</span>
                    <input type="checkbox" class="bgt-toggle-input item-stock-toggle" ${isAvailable ? 'checked' : ''}>
                    <div class="bgt-toggle-track"></div>
                </label>
                <div class="flex items-center gap-1">
                    <button type="button" class="btn-edit-item w-7 h-7 rounded-lg bg-white/5 hover:bg-orange-500/20 border border-white/10 text-amber-400 flex items-center justify-center text-xs cursor-pointer" title="Ubah Rincian Hidangan / Paket">
                        <i class="fa-solid fa-pen"></i>
                    </button>
                    <button type="button" class="btn-del-item w-7 h-7 rounded-lg bg-red-500/10 hover:bg-red-500/25 border border-red-500/30 text-red-400 flex items-center justify-center text-xs cursor-pointer" title="Hapus Hidangan Permanen">
                        <i class="fa-solid fa-trash-can"></i>
                    </button>
                </div>
            </div>
        `;

        const catBadgeEl = card.querySelector('.item-cat-badge');
        if (catBadgeEl) catBadgeEl.textContent = item.kat || 'Hidangan Utama';
        const titleEl = card.querySelector('.item-title-el');
        if (titleEl) titleEl.textContent = item.n;

        const triggerQuickPhoto = () => {
            picuGetarSentuh(10);
            quickUploadTargetItemId = item.id;
            const quickFileInp = document.getElementById('file-quick-card-foto');
            if (quickFileInp) {
                quickFileInp.value = '';
                quickFileInp.click();
            } else {
                bukaModalEditorMenu(item);
            }
        };

        const photoBoxBtn = card.querySelector('.btn-quick-card-photo');
        if (photoBoxBtn) photoBoxBtn.addEventListener('click', triggerQuickPhoto);

        const stockToggle = card.querySelector('.item-stock-toggle');
        if (stockToggle) {
            stockToggle.addEventListener('change', (e) => {
                picuGetarSentuh(12);
                const idx = daftarMenuAktif.findIndex(m => m.id === item.id);
                if (idx !== -1) {
                    const isNowReady = Boolean(e.target.checked);
                    daftarMenuAktif[idx].s = isNowReady;
                    renderFilterSubKategoriChips();
                    renderDaftarMenuUI();
                    if (typeof onMenuChangedCallback === 'function') {
                        onMenuChangedCallback(daftarMenuAktif, 'STOCK_TOGGLE', {
                            itemName: daftarMenuAktif[idx].n,
                            isReady: isNowReady
                        });
                    }
                }
            });
        }

        const btnEdit = card.querySelector('.btn-edit-item');
        if (btnEdit) {
            btnEdit.addEventListener('click', () => {
                picuGetarSentuh(10);
                bukaModalEditorMenu(item);
            });
        }

        const btnDel = card.querySelector('.btn-del-item');
        if (btnDel) {
            btnDel.addEventListener('click', async () => {
                picuGetarSentuh(15);
                const yakin = await window.showConfirm(
                    'HAPUS HIDANGAN PERMANEN',
                    `Hapus "${item.n}" dari katalog resto? (Tips: Jika menu hanya habis hari ini dan besok dijual lagi, cukup matikan saklar ke posisi HABIS tanpa menghapusnya).`,
                    'Ya, Hapus Permanen',
                    true
                );
                if (!yakin) return;
                const deletedName = item.n;
                daftarMenuAktif = daftarMenuAktif.filter(m => m.id !== item.id);
                renderFilterSubKategoriChips();
                renderDaftarMenuUI();
                if (typeof onMenuChangedCallback === 'function') {
                    onMenuChangedCallback(daftarMenuAktif, 'DELETE_ITEM', { itemName: deletedName });
                }
            });
        }

        listEl.appendChild(card);
    });
}

// ==========================================================================
// LOGIKA PENYUSUN PAKET HEMAT & KUSTOMISASI MENU MULTI-GRUP (ALA GOFOOD)
// ==========================================================================
function sinkronkanVisualTombolPresetKategoriModal() {
    const katInp = document.getElementById('item-form-kat');
    const currentKat = String(katInp?.value || 'Hidangan Utama').trim();
    document.querySelectorAll('.btn-preset-item-kat').forEach(btn => {
        const targetKat = btn.getAttribute('data-kat') || '';
        const isActive = targetKat === currentKat;
        btn.classList.toggle('border-orange-500', isActive);
        btn.classList.toggle('bg-orange-500/20', isActive);
        btn.classList.toggle('text-orange-300', isActive);
        btn.classList.toggle('font-extrabold', isActive);
    });
}

function aturBukaTutupPanelPaketModal(openState, isHighlightPackage = false) {
    isPackageBuilderExpanded = Boolean(openState);
    const wrapEl = document.getElementById('item-package-builder-wrap');
    const bodyEl = document.getElementById('item-package-builder-body');
    const badgeEl = document.getElementById('item-package-builder-badge');
    const chevronEl = document.getElementById('item-package-builder-chevron');

    if (bodyEl) {
        bodyEl.classList.toggle('hidden-state', !isPackageBuilderExpanded);
    }
    if (chevronEl) {
        chevronEl.className = isPackageBuilderExpanded
            ? 'fa-solid fa-chevron-up text-[0.6rem] text-amber-300 transition-transform'
            : 'fa-solid fa-chevron-down text-[0.6rem] text-stone-400 transition-transform';
    }
    if (wrapEl) {
        wrapEl.className = isHighlightPackage
            ? 'bg-[#121316] border-2 border-amber-500/60 rounded-2xl p-2.5 space-y-2.5 shadow-[0_0_16px_rgba(245,158,11,0.12)] transition-all'
            : 'bg-[#121316] border border-white/15 rounded-2xl p-2.5 space-y-2.5 transition-all';
    }
    if (badgeEl) {
        if (isHighlightPackage) {
            badgeEl.textContent = 'MODE PAKET AKTIF';
            badgeEl.className = 'px-1.5 py-0.5 rounded bg-amber-500 text-black text-[0.48rem] font-extrabold uppercase tracking-wider shrink-0';
        } else {
            badgeEl.textContent = isPackageBuilderExpanded ? 'TERBUKA' : 'OPSIONAL';
            badgeEl.className = 'px-1.5 py-0.5 rounded bg-white/10 text-stone-300 text-[0.48rem] font-bold uppercase tracking-wider shrink-0';
        }
    }
}

function tambahkanMakananKeKomposisiPaket(foodName) {
    const descInp = document.getElementById('item-form-desc');
    if (!descInp || !foodName) return;

    const cleanFood = String(foodName).trim();
    const curVal = String(descInp.value || '').trim();

    if (!curVal) {
        descInp.value = `1x ${cleanFood}`.substring(0, 160);
        perbaruiKalkulatorHargaPaketModal();
        return;
    }

    const parts = curVal.split(/\s*\+\s*/).map(s => s.trim()).filter(Boolean);
    let foundIdx = -1;
    for (let i = 0; i < parts.length; i++) {
        const m = parts[i].match(/^(\d+)x\s+(.+)$/i);
        const itemLabel = m ? m[2].trim() : parts[i];
        if (itemLabel.toLowerCase() === cleanFood.toLowerCase()) {
            foundIdx = i;
            const nextQty = (m ? parseInt(m[1], 10) : 1) + 1;
            parts[i] = `${nextQty}x ${itemLabel}`;
            break;
        }
    }

    if (foundIdx === -1) {
        parts.push(`1x ${cleanFood}`);
    }

    const joined = parts.join(' + ');
    if (joined.length <= 160) {
        descInp.value = joined;
    } else {
        window.showToast('Batas maksimal 160 karakter komposisi paket tercapai.', 'warning');
    }
    perbaruiKalkulatorHargaPaketModal();
}

function tambahkanMinumanKeOpsiPaket(drinkLabel) {
    const drkInp = document.getElementById('item-form-drk');
    if (!drkInp || !drinkLabel) return;

    const cleanDrink = normalisasiFormatTambahanHargaMinuman(drinkLabel, 160);
    const curVal = String(drkInp.value || '').trim();

    if (!curVal) {
        drkInp.value = cleanDrink.substring(0, 160);
        perbaruiKalkulatorHargaPaketModal();
        return;
    }

    const parts = curVal.split(/\s*,\s*/).map(s => s.trim()).filter(Boolean);
    const exists = parts.some(p => p.toLowerCase() === cleanDrink.toLowerCase());
    if (!exists) {
        parts.push(cleanDrink);
    }

    const joined = parts.join(', ');
    if (joined.length <= 160) {
        drkInp.value = joined;
    } else {
        window.showToast('Batas maksimal 160 karakter opsi minuman paket tercapai.', 'warning');
    }
    perbaruiKalkulatorHargaPaketModal();
}

export function tambahkanVarianKeOpsiMenu(varPreset) {
    const varInp = document.getElementById('item-form-var');
    if (!varInp || !varPreset) return;

    const cleanPreset = String(varPreset).trim();
    const curVal = String(varInp.value || '').trim();

    if (!curVal) {
        varInp.value = normalisasiFormatTambahanHargaMinuman(cleanPreset, 280);
        return;
    }

    const merged = gabungkanGrupVarianPintar(curVal, cleanPreset, true);
    if (merged.length <= 280) {
        varInp.value = merged;
    } else if (typeof window !== 'undefined' && typeof window.showToast === 'function') {
        window.showToast('Batas maksimal 280 karakter opsi varian/topping tercapai.', 'warning');
    }
}

function renderPickerMenuAktifUntukPaket(editingItemId = '') {
    const foodPickerEl = document.getElementById('item-package-food-picker');
    const drinkDynamicEl = document.getElementById('item-package-dynamic-drink-chips');

    const activeFoodItems = daftarMenuAktif.filter(it =>
        it &&
        it.s !== false &&
        it.id !== editingItemId &&
        ['Hidangan Utama', 'Camilan & Jajanan', 'Roti, Kue & Oleh-Oleh'].includes(klasifikasiKategoriMenuPintar(it.n, it.kat))
    );

    const activeDrinkItems = daftarMenuAktif.filter(it =>
        it &&
        it.s !== false &&
        it.id !== editingItemId &&
        klasifikasiKategoriMenuPintar(it.n, it.kat) === 'Minuman & Kopi'
    );

    if (foodPickerEl) {
        foodPickerEl.innerHTML = '';

        const staplePresets = [
            { n: 'Nasi Putih', p: 4000, isStaple: true },
            { n: 'Tahu + Tempe', p: 3000, isStaple: true },
            { n: 'Sambal + Lalapan', p: 2000, isStaple: true }
        ];

        const existingNamesLower = new Set(activeFoodItems.map(f => f.n.toLowerCase()));
        const combinedFoods = [
            ...activeFoodItems.slice(0, 18).map(f => ({ n: f.n, p: f.p, isStaple: false })),
            ...staplePresets.filter(st => !existingNamesLower.has(st.n.toLowerCase()))
        ];

        combinedFoods.forEach(food => {
            const chip = document.createElement('button');
            chip.type = 'button';
            chip.className = food.isStaple
                ? 'px-2 py-0.5 rounded-lg bg-white/5 hover:bg-orange-500/20 border border-white/15 text-stone-200 text-[0.52rem] font-bold cursor-pointer transition-all flex items-center gap-1'
                : 'px-2 py-0.5 rounded-lg bg-orange-500/15 hover:bg-orange-500/30 border border-orange-500/40 text-orange-300 text-[0.52rem] font-extrabold cursor-pointer transition-all flex items-center gap-1';
            chip.innerHTML = `<i class="fa-solid fa-plus text-[0.46rem]"></i><span>${escapeHtmlAman(food.n)}</span><span class="text-[0.46rem] opacity-75 font-mono">(${Math.round(food.p / 1000)}rb)</span>`;
            chip.addEventListener('click', () => {
                picuGetarSentuh(8);
                tambahkanMakananKeKomposisiPaket(food.n);
            });
            foodPickerEl.appendChild(chip);
        });
    }

    if (drinkDynamicEl) {
        drinkDynamicEl.innerHTML = '';
        const staticDrinkLower = new Set([
            'es teh manis',
            'teh manis hangat',
            'es jeruk',
            'es jeruk (+2000)',
            'air mineral',
            'es kopi susu (+3000)'
        ]);

        activeDrinkItems.slice(0, 12).forEach(drkItem => {
            if (staticDrinkLower.has(drkItem.n.toLowerCase())) return;
            const btn = document.createElement('button');
            btn.type = 'button';
            btn.setAttribute('data-drink', drkItem.n);
            btn.className = 'btn-preset-pkg-drink px-2 py-0.5 rounded-lg bg-emerald-500/15 hover:bg-emerald-500/30 border border-emerald-500/40 text-emerald-300 text-[0.52rem] font-extrabold cursor-pointer transition-all';
            btn.innerHTML = `<i class="fa-solid fa-mug-hot mr-0.5 text-[0.46rem]"></i>${escapeHtmlAman(drkItem.n)}`;
            btn.addEventListener('click', () => {
                picuGetarSentuh(8);
                tambahkanMinumanKeOpsiPaket(drkItem.n);
            });
            drinkDynamicEl.appendChild(btn);
        });
    }
}

export function perbaruiKalkulatorHargaPaketModal() {
    const calcEl = document.getElementById('item-package-calc-hint');
    if (!calcEl) return;

    const descVal = String(document.getElementById('item-form-desc')?.value || '').trim();
    const drkVal = String(document.getElementById('item-form-drk')?.value || '').trim();
    const pkgPriceVal = Math.max(0, parseInt(document.getElementById('item-form-price')?.value || '0', 10) || 0);

    if (!descVal && !drkVal) {
        calcEl.classList.add('hidden-state');
        calcEl.innerHTML = '';
        return;
    }

    const menuPriceMap = new Map();
    daftarMenuAktif.forEach(it => {
        if (it && it.n && it.p > 0) {
            menuPriceMap.set(it.n.toLowerCase().trim(), it.p);
        }
    });

    const fallbackPriceMap = new Map([
        ['nasi putih', 4000],
        ['nasi', 4000],
        ['tahu + tempe', 3000],
        ['tahu tempe', 3000],
        ['sambal + lalapan', 2000],
        ['sambal lalapan', 2000],
        ['sambal', 1500],
        ['kerupuk', 2000],
        ['es teh manis', 4000],
        ['teh manis hangat', 4000],
        ['teh hangat', 4000],
        ['es jeruk', 6000],
        ['air mineral', 4000]
    ]);

    const cariHargaSatuan = (rawLabel) => {
        const clean = String(rawLabel || '')
            .replace(/\(\s*\+\s*\d+\s*\)/g, '')
            .trim()
            .toLowerCase();
        if (!clean) return 0;
        if (menuPriceMap.has(clean)) return menuPriceMap.get(clean);
        for (const [k, v] of menuPriceMap.entries()) {
            if (k.includes(clean) || clean.includes(k)) return v;
        }
        if (fallbackPriceMap.has(clean)) return fallbackPriceMap.get(clean);
        return 0;
    };

    let totalSatuan = 0;
    let matchedCount = 0;

    if (descVal) {
        const parts = descVal.split(/\s*\+\s*|\s*,\s*/).map(s => s.trim()).filter(Boolean);
        parts.forEach(pt => {
            const mQty = pt.match(/^(\d+)\s*x\s+(.+)$/i);
            const qty = mQty ? Math.max(1, parseInt(mQty[1], 10) || 1) : 1;
            const nameOnly = mQty ? mQty[2].trim() : pt;
            const unitP = cariHargaSatuan(nameOnly);
            if (unitP > 0) {
                totalSatuan += qty * unitP;
                matchedCount++;
            }
        });
    }

    if (drkVal) {
        const firstDrink = drkVal.split(/\s*,\s*/)[0]?.trim() || '';
        const mQtyDrk = firstDrink.match(/^(\d+)\s*x\s+(.+)$/i);
        const qtyDrk = mQtyDrk ? Math.max(1, parseInt(mQtyDrk[1], 10) || 1) : 1;
        const drinkName = mQtyDrk ? mQtyDrk[2].trim() : firstDrink;
        const drinkUnitP = cariHargaSatuan(drinkName);
        if (drinkUnitP > 0) {
            totalSatuan += qtyDrk * drinkUnitP;
            matchedCount++;
        }
    }

    if (totalSatuan <= 0 || matchedCount === 0) {
        calcEl.classList.add('hidden-state');
        calcEl.innerHTML = '';
        return;
    }

    calcEl.classList.remove('hidden-state');
    if (pkgPriceVal > 0) {
        const hemat = totalSatuan - pkgPriceVal;
        if (hemat > 0) {
            calcEl.className = 'text-[0.58rem] px-2.5 py-1.5 rounded-xl bg-emerald-500/15 border border-emerald-500/40 text-emerald-300 font-bold mt-1';
            calcEl.innerHTML = `<i class="fa-solid fa-calculator mr-1"></i>Total Harga Satuan: <b>${formatRupiah(totalSatuan)}</b> &rarr; Harga Paket: <b>${formatRupiah(pkgPriceVal)}</b> <span class="text-amber-300">(Pelanggan Hemat ${formatRupiah(hemat)})</span>`;
        } else if (hemat === 0) {
            calcEl.className = 'text-[0.58rem] px-2.5 py-1.5 rounded-xl bg-amber-500/10 border border-amber-500/35 text-amber-300 font-bold mt-1';
            calcEl.innerHTML = `<i class="fa-solid fa-calculator mr-1"></i>Total Harga Satuan: <b>${formatRupiah(totalSatuan)}</b> &rarr; Harga Paket: <b>${formatRupiah(pkgPriceVal)}</b> (Sama dengan Harga Satuan)`;
        } else {
            calcEl.className = 'text-[0.58rem] px-2.5 py-1.5 rounded-xl bg-orange-500/15 border border-orange-500/40 text-orange-300 font-bold mt-1';
            calcEl.innerHTML = `<i class="fa-solid fa-calculator mr-1"></i>Total Harga Satuan: <b>${formatRupiah(totalSatuan)}</b> &rarr; Harga Paket: <b>${formatRupiah(pkgPriceVal)}</b> (+${formatRupiah(Math.abs(hemat))} untuk kemasan/lauk ekstra)`;
        }
    } else {
        const saranHemat = Math.max(1000, Math.round((totalSatuan * 0.85) / 500) * 500);
        calcEl.className = 'text-[0.58rem] px-2.5 py-1.5 rounded-xl bg-amber-500/10 border border-amber-500/35 text-amber-300 font-bold mt-1';
        calcEl.innerHTML = `<i class="fa-solid fa-calculator mr-1"></i>Total Harga Satuan: <b>${formatRupiah(totalSatuan)}</b> &rarr; Saran Harga Paket Hemat: <b>${formatRupiah(saranHemat)}</b>`;
    }
}

export function bukaModalEditorMenu(existingItem = null) {
    const modal = document.getElementById('merchant-item-modal');
    if (!modal) return;

    const titleEl = document.getElementById('item-modal-title');
    const idInp = document.getElementById('item-form-id');
    const nameInp = document.getElementById('item-form-name');
    const katInp = document.getElementById('item-form-kat');
    const priceInp = document.getElementById('item-form-price');
    const discInp = document.getElementById('item-form-discount');
    const cloudinaryInp = document.getElementById('item-form-cloudinary');
    const stockInp = document.getElementById('item-form-stock');
    const previewImg = document.getElementById('item-form-img-preview');
    const statusUploadEl = document.getElementById('status-upload-item-foto');
    const descInp = document.getElementById('item-form-desc');
    const drkInp = document.getElementById('item-form-drk');
    const varInp = document.getElementById('item-form-var');

    if (statusUploadEl) {
        statusUploadEl.className = 'text-[0.6rem] text-stone-400';
        statusUploadEl.textContent = 'Format WebP maks. 760px (Ukuran Optimal)';
    }

    if (existingItem) {
        const normKat = klasifikasiKategoriMenuPintar(existingItem.n || '', existingItem.kat || 'Hidangan Utama');
        const articulatedVar = existingItem.var
            ? existingItem.var
            : artikulasiOtomatisVarianDariMenu(existingItem.n || '', '', existingItem.desc || '', normKat);

        if (titleEl) titleEl.innerText = 'UBAH RINCIAN HIDANGAN';
        if (idInp) idInp.value = existingItem.id;
        if (nameInp) nameInp.value = existingItem.n || '';
        if (katInp) katInp.value = normKat;
        if (priceInp) priceInp.value = existingItem.p || 0;
        if (discInp) discInp.value = existingItem.d || 0;
        if (cloudinaryInp) cloudinaryInp.value = existingItem.img || '';
        if (stockInp) stockInp.checked = existingItem.s !== false;
        if (previewImg) previewImg.src = bangunUrlGambarCloudinary(existingItem.img, 400, existingItem.n);
        if (descInp) descInp.value = existingItem.desc || '';
        if (drkInp) drkInp.value = existingItem.drk || '';
        if (varInp) varInp.value = articulatedVar || '';

        const isPkg = normKat === 'Paket Hemat & Combo' || /\b(paket|combo)\b/i.test(existingItem.n || '');
        const hasExtra = Boolean(existingItem.desc || existingItem.drk || articulatedVar);
        renderPickerMenuAktifUntukPaket(existingItem.id);
        aturBukaTutupPanelPaketModal(isPkg || hasExtra, isPkg);
    } else {
        if (titleEl) titleEl.innerText = 'TAMBAH HIDANGAN BARU';
        if (idInp) idInp.value = '';
        if (nameInp) nameInp.value = '';
        if (katInp) katInp.value = 'Hidangan Utama';
        if (priceInp) priceInp.value = '';
        if (discInp) discInp.value = '0';
        if (cloudinaryInp) cloudinaryInp.value = '';
        if (stockInp) stockInp.checked = true;
        if (previewImg) previewImg.src = bangunUrlGambarCloudinary('', 400, 'Hidangan');
        if (descInp) descInp.value = '';
        if (drkInp) drkInp.value = '';
        if (varInp) varInp.value = '';

        renderPickerMenuAktifUntukPaket('');
        aturBukaTutupPanelPaketModal(false, false);
    }

    sinkronkanVisualTombolPresetKategoriModal();
    perbaruiPreviewHargaModalMenu();
    perbaruiKalkulatorHargaPaketModal();
    modal.classList.remove('hidden-state');
}

function perbaruiPreviewHargaModalMenu() {
    const priceVal = parseInt(document.getElementById('item-form-price')?.value || '0', 10) || 0;
    const discVal = parseInt(document.getElementById('item-form-discount')?.value || '0', 10) || 0;
    const infoEl = document.getElementById('item-form-final-price-preview');
    if (!infoEl) return;

    const calc = hitungHargaFinalMenu(priceVal, discVal, diskonTokoGlobalPersen, skemaDiskonGlobal);
    if (calc.diskonPersen > 0) {
        infoEl.innerHTML = `
            <div class="flex flex-col gap-0.5">
                <div>Harga Tayang di Pelanggan: <b class="text-emerald-400 font-mono text-sm">${formatRupiah(calc.hargaFinal)}</b> <span class="line-through text-stone-400 text-[0.65rem] font-mono ml-1">${formatRupiah(calc.hargaAsli)}</span></div>
                <div class="text-[0.62rem] text-amber-300">Potongan Aktif: <b>-${calc.diskonPersen}% (${calc.labelSumber})</b> • Hemat ${formatRupiah(calc.hematNominal)}</div>
            </div>
        `;
    } else {
        infoEl.innerHTML = `Harga Tayang di Pelanggan: <b class="text-amber-400 font-mono text-sm">${formatRupiah(calc.hargaFinal)}</b> <span class="text-[0.62rem] text-stone-400">(Harga Normal)</span>`;
    }
    perbaruiKalkulatorHargaPaketModal();
}

export function apakahIsiEditorAdalahContohSimulasi(rawText = '') {
    const clean = String(rawText || '').trim();
    if (!clean) return false;
    return (
        clean.includes('"Paket Ayam Bakar Hemat"') &&
        clean.includes('"Nasi Pecel Madiun"') &&
        clean.includes('"Tahu Walik Crispy"')
    );
}

export function perbaruiBannerStatusContohJsonUI() {
    const jsonTa = document.getElementById('studio-json-textarea');
    const bannerEl = document.getElementById('studio-sample-json-banner');
    const titleEl = document.getElementById('studio-sample-banner-title');
    const descEl = document.getElementById('studio-sample-banner-desc');
    const btnBannerClear = document.getElementById('btn-banner-clear-sample-json');
    const btnClearLabel = document.getElementById('btn-studio-clear-label');

    if (!jsonTa || !bannerEl) return;
    const rawText = jsonTa.value.trim();
    const isSample = apakahIsiEditorAdalahContohSimulasi(rawText);

    if (!rawText) {
        bannerEl.className = 'p-2.5 rounded-xl bg-emerald-500/10 border border-emerald-500/35 flex items-start justify-between gap-2.5';
        if (titleEl) {
            titleEl.className = 'text-[0.6rem] font-extrabold text-emerald-400 uppercase tracking-wide flex items-center gap-1.5';
            titleEl.innerHTML = '<i class="fa-solid fa-paste"></i><span>KOTAK JSON BERSIH &amp; SIAP DITEMPEL DATA MENU ANDA</span>';
        }
        if (descEl) {
            descEl.className = 'text-[0.58rem] text-stone-200 mt-1 leading-relaxed';
            descEl.innerHTML = 'Silakan klik tombol <b>"Tempel JSON"</b> di bawah untuk memasukkan hasil ekstrak menu dari ChatGPT/Gemini, atau klik <b>"Lihat Contoh"</b> jika ingin melihat contoh format JSON kembali.';
        }
        if (btnBannerClear) btnBannerClear.classList.add('hidden-state');
        if (btnClearLabel) btnClearLabel.textContent = 'Kosongkan';
        return;
    }

    if (isSample) {
        bannerEl.className = 'p-2.5 rounded-xl bg-amber-500/15 border border-amber-500/40 flex items-start justify-between gap-2.5';
        if (titleEl) {
            titleEl.className = 'text-[0.6rem] font-extrabold text-amber-300 uppercase tracking-wide flex items-center gap-1.5';
            titleEl.innerHTML = '<i class="fa-solid fa-triangle-exclamation text-orange-400"></i><span>INFORMASI: INI ADALAH FORMAT CONTOH (SIMULASI)</span>';
        }
        if (descEl) {
            descEl.className = 'text-[0.58rem] text-stone-200 mt-1 leading-relaxed';
            descEl.innerHTML = 'Data 7 menu di bawah ini hanyalah <b>contoh bentuk format JSON</b> agar Anda tidak bingung. Tekan tombol <b>"Hapus Contoh"</b> untuk mengosongkan kotak sebelum menempelkan daftar menu warung Anda.';
        }
        if (btnBannerClear) btnBannerClear.classList.remove('hidden-state');
        if (btnClearLabel) btnClearLabel.textContent = 'Hapus Contoh';
    } else {
        bannerEl.className = 'p-2.5 rounded-xl bg-emerald-500/10 border border-emerald-500/35 flex items-start justify-between gap-2.5';
        if (titleEl) {
            titleEl.className = 'text-[0.6rem] font-extrabold text-emerald-400 uppercase tracking-wide flex items-center gap-1.5';
            titleEl.innerHTML = '<i class="fa-solid fa-circle-check"></i><span>DATA MENU RESTO ANDA SIAP DITERAPKAN</span>';
        }
        if (descEl) {
            descEl.className = 'text-[0.58rem] text-stone-200 mt-1 leading-relaxed';
            descEl.innerHTML = 'Periksa daftar pratinjau menu di bawah ini. Jika sudah sesuai, gulir ke bawah lalu tekan tombol <b>"Terapkan ke Daftar Menu Sekarang"</b> pada Langkah C.';
        }
        if (btnBannerClear) btnBannerClear.classList.add('hidden-state');
        if (btnClearLabel) btnClearLabel.textContent = 'Hapus Isi';
    }
}

export function evaluasiDanRenderPreviewStudioJson() {
    const jsonTa = document.getElementById('studio-json-textarea');
    const statusBox = document.getElementById('studio-json-validation-status');
    const previewContainer = document.getElementById('studio-json-preview-list');
    const countBadge = document.getElementById('studio-json-detected-count');
    const btnApply = document.getElementById('btn-apply-studio-json-to-menu');

    if (!jsonTa) return;
    perbaruiBannerStatusContohJsonUI();
    const rawText = jsonTa.value.trim();

    if (!rawText) {
        studioPreviewCandidateItems = [];
        if (countBadge) countBadge.textContent = '0 Menu Valid';
        if (statusBox) {
            statusBox.className = 'p-2.5 rounded-xl bg-white/5 border border-white/10 text-[0.63rem] text-stone-300';
            statusBox.innerHTML = `<i class="fa-solid fa-circle-info text-orange-400 mr-1"></i>Salin Prompt AI di atas ke ChatGPT/Gemini lalu tekan <b>Tempel JSON</b>, atau gunakan mode <b>Ketik Per Baris</b>.`;
        }
        if (previewContainer) previewContainer.innerHTML = '';
        if (btnApply) btnApply.disabled = true;
        return;
    }

    const res = parseDanValidasiJsonMenu(rawText);
    if (!res.ok) {
        studioPreviewCandidateItems = [];
        if (countBadge) countBadge.textContent = 'JSON Belum Valid';
        if (statusBox) {
            statusBox.className = 'p-2.5 rounded-xl bg-red-500/15 border border-red-500/40 text-[0.64rem] text-red-300';
            statusBox.innerHTML = `<i class="fa-solid fa-triangle-exclamation mr-1"></i><b>Perlu Perbaikan Format:</b> ${res.error}`;
        }
        if (previewContainer) previewContainer.innerHTML = '';
        if (btnApply) btnApply.disabled = true;
        return;
    }

    studioPreviewCandidateItems = res.items;

    const existingMap = new Map(daftarMenuAktif.map(m => [m.n.toLowerCase().trim(), m]));
    let newCount = 0;
    let updateCount = 0;
    let preservedPhotoCount = 0;

    res.items.forEach(cand => {
        const match = existingMap.get(cand.n.toLowerCase().trim());
        if (match) {
            updateCount++;
            if (match.img && !cand.img) preservedPhotoCount++;
        } else {
            newCount++;
        }
    });

    const isSampleNow = apakahIsiEditorAdalahContohSimulasi(rawText);
    if (countBadge) {
        countBadge.textContent = isSampleNow ? `Contoh (${res.items.length} Menu)` : `${res.items.length} Menu Siap`;
    }
    if (btnApply) {
        btnApply.disabled = false;
    }

    if (statusBox) {
        const warnHtml = res.warnings && res.warnings.length > 0
            ? `<div class="mt-1 text-amber-300 text-[0.58rem]"><i class="fa-solid fa-circle-exclamation mr-1"></i>${res.warnings.join(' • ')}</div>`
            : '';
        if (isSampleNow) {
            statusBox.className = 'p-2.5 rounded-xl bg-amber-500/15 border border-amber-500/40 text-[0.63rem] text-amber-300';
            statusBox.innerHTML = `
                <div>
                    <i class="fa-solid fa-eye mr-1"></i><b>Sedang Menampilkan Format Contoh (${res.items.length} Menu Simulasi):</b>
                    Klik tombol <b>"Hapus Contoh"</b> di atas untuk mengosongkan editor sebelum menempelkan JSON menu warung Anda.
                </div>
                ${warnHtml}
            `;
        } else {
            statusBox.className = 'p-2.5 rounded-xl bg-emerald-500/10 border border-emerald-500/35 text-[0.63rem] text-emerald-300';
            statusBox.innerHTML = `
                <div>
                    <i class="fa-solid fa-circle-check mr-1"></i><b>JSON Terverifikasi Presisi (${res.items.length} Hidangan):</b>
                    <b>${newCount} Menu Baru</b> &amp; <b>${updateCount} Update</b>${preservedPhotoCount > 0 ? ` (${preservedPhotoCount} foto lama aman)` : ''}. Langkah selanjutnya: tekan tombol <b>"Terapkan ke Daftar Menu Sekarang"</b> di bawah.
                </div>
                ${warnHtml}
            `;
        }
    }

    if (previewContainer) {
        previewContainer.innerHTML = res.items.map((it, idx) => {
            const matchOld = existingMap.get(it.n.toLowerCase().trim());
            const isUpdate = Boolean(matchOld);
            const hasPhoto = Boolean(it.img || (matchOld && matchOld.img));
            const extraPkgInfo = `
                ${it.desc ? `<div class="text-[0.54rem] text-stone-300 truncate mt-0.5"><i class="fa-solid fa-utensils text-orange-400 mr-1"></i><b>Isi:</b> ${escapeHtmlAman(it.desc)}</div>` : ''}
                ${it.drk ? `<div class="text-[0.52rem] text-emerald-300 truncate"><i class="fa-solid fa-glass-water mr-1"></i><b>Minum:</b> ${escapeHtmlAman(it.drk)}</div>` : ''}
                ${it.var ? `<div class="text-[0.52rem] text-amber-300 line-clamp-2"><i class="fa-solid fa-sliders mr-1"></i><b>Opsi:</b> ${escapeHtmlAman(it.var)}</div>` : ''}
            `;
            return `
                <div class="flex items-center justify-between gap-2 px-2.5 py-1.5 rounded-xl bg-[#1A1C20] border border-white/10 text-[0.63rem]">
                    <div class="min-w-0 flex-1">
                        <div class="flex items-center gap-1.5 flex-wrap">
                            <span class="font-mono text-stone-400">${idx + 1}.</span>
                            <span class="font-bold text-white truncate">${escapeHtmlAman(it.n)}</span>
                            <span class="px-1.5 py-0.5 rounded bg-orange-500/15 text-orange-300 text-[0.5rem] font-bold uppercase">${escapeHtmlAman(it.kat)}</span>
                            <span class="px-1.5 py-0.5 rounded ${isUpdate ? 'bg-blue-500/15 text-blue-300' : 'bg-emerald-500/15 text-emerald-300'} text-[0.48rem] font-extrabold uppercase">${isUpdate ? 'Update' : 'Baru'}</span>
                            ${hasPhoto ? '<span class="text-[0.48rem] text-emerald-400 font-bold"><i class="fa-solid fa-image"></i> Foto Aman</span>' : '<span class="text-[0.48rem] text-amber-300 font-bold"><i class="fa-solid fa-camera"></i> +Foto Nanti</span>'}
                        </div>
                        ${extraPkgInfo}
                    </div>
                    <div class="text-right shrink-0 font-mono">
                        <span class="font-bold text-amber-300">${formatRupiah(it.p)}</span>
                        ${it.d > 0 ? `<span class="ml-1 text-[0.52rem] text-emerald-400 font-bold">(-${it.d}%)</span>` : ''}
                        ${!it.s ? `<span class="ml-1 text-[0.5rem] text-red-400 font-bold">[HABIS]</span>` : ''}
                    </div>
                </div>
            `;
        }).join('');
    }
}

function formatItemUntukEksporJsonStudio(it) {
    const out = {
        n: it.n,
        p: it.p,
        d: it.d || 0,
        kat: klasifikasiKategoriMenuPintar(it.n, it.kat || 'Hidangan Utama'),
        s: it.s !== false
    };
    if (it.desc) out.desc = String(it.desc).substring(0, 160);
    if (it.drk) out.drk = normalisasiFormatTambahanHargaMinuman(it.drk, 160);
    if (it.var) out.var = normalisasiFormatTambahanHargaMinuman(it.var, 280);
    if (it.img) out.img = it.img;
    return out;
}

export function sinkronkanEditorStudioJsonDariMenuAktif(overwriteIfNotEmpty = true) {
    const jsonTa = document.getElementById('studio-json-textarea');
    if (!jsonTa) return;
    if (!overwriteIfNotEmpty && jsonTa.value.trim().length > 0) {
        evaluasiDanRenderPreviewStudioJson();
        return;
    }

    if (daftarMenuAktif.length > 0) {
        const cleanExport = daftarMenuAktif.map(it => formatItemUntukEksporJsonStudio(it));
        jsonTa.value = JSON.stringify(cleanExport, null, 2);
    } else {
        jsonTa.value = JSON.stringify(SAMPLE_JSON_TEMPLATE, null, 2);
    }
    evaluasiDanRenderPreviewStudioJson();
}

export function terapkanArrayStudioKeDaftarMenu(mode = 'MERGE') {
    const jsonTa = document.getElementById('studio-json-textarea');
    if (!jsonTa) return;

    const parsed = parseDanValidasiJsonMenu(jsonTa.value);
    if (!parsed.ok || parsed.items.length === 0) {
        return window.alert(parsed.error || 'Format JSON belum valid.', 'warning');
    }

    const existingByName = new Map();
    const existingById = new Map();
    daftarMenuAktif.forEach(item => {
        existingByName.set(item.n.toLowerCase().trim(), item);
        if (item.id) existingById.set(item.id, item);
    });

    let addedCount = 0;
    let updatedCount = 0;
    const nowTs = Date.now();

    if (mode === 'REPLACE') {
        const nextList = [];
        parsed.items.slice(0, 300).forEach((cand, idx) => {
            const oldMatch = (cand.id && existingById.get(cand.id)) || existingByName.get(cand.n.toLowerCase().trim());
            if (oldMatch) updatedCount++;
            else addedCount++;

            nextList.push(bentukObjekItemMenuHematKuota({
                id: oldMatch ? oldMatch.id : (cand.id || `m_${nowTs}_${idx}`),
                n: cand.n,
                p: cand.p,
                d: cand.d,
                img: cand.img || (oldMatch ? oldMatch.img : ''),
                s: cand.s !== false,
                kat: cand.kat || 'Hidangan Utama',
                desc: cand.desc || '',
                drk: cand.drk || '',
                var: cand.var || ''
            }, idx));
        });
        daftarMenuAktif = nextList;
    } else {
        const mergedList = daftarMenuAktif.map((it, idx) => bentukObjekItemMenuHematKuota(it, idx));
        const mergedIndexByName = new Map();
        mergedList.forEach((it, idx) => mergedIndexByName.set(it.n.toLowerCase().trim(), idx));

        parsed.items.forEach((cand, idx) => {
            const key = cand.n.toLowerCase().trim();
            if (mergedIndexByName.has(key)) {
                const targetIdx = mergedIndexByName.get(key);
                const oldItem = mergedList[targetIdx];
                mergedList[targetIdx] = bentukObjekItemMenuHematKuota({
                    ...oldItem,
                    n: cand.n,
                    p: cand.p,
                    d: cand.d,
                    kat: cand.kat || oldItem.kat || 'Hidangan Utama',
                    s: cand.s !== undefined ? Boolean(cand.s) : oldItem.s,
                    img: cand.img || oldItem.img || '',
                    desc: cand.desc !== undefined ? cand.desc : (oldItem.desc || ''),
                    drk: cand.drk !== undefined ? cand.drk : (oldItem.drk || ''),
                    var: cand.var !== undefined ? cand.var : (oldItem.var || '')
                }, targetIdx);
                updatedCount++;
            } else if (mergedList.length < 300) {
                mergedList.push(bentukObjekItemMenuHematKuota({
                    id: cand.id || `m_${nowTs}_${idx}_${Math.random().toString(36).substring(2, 5)}`,
                    n: cand.n,
                    p: cand.p,
                    d: cand.d,
                    img: cand.img || '',
                    s: cand.s !== false,
                    kat: cand.kat || 'Hidangan Utama',
                    desc: cand.desc || '',
                    drk: cand.drk || '',
                    var: cand.var || ''
                }, idx));
                mergedIndexByName.set(key, mergedList.length - 1);
                addedCount++;
            }
        });
        daftarMenuAktif = mergedList;
    }

    picuGetarSentuh(18);
    filterSubKategori = 'ALL';
    filterStatusStok = 'ALL';
    renderFilterSubKategoriChips();
    renderDaftarMenuUI();

    if (typeof onMenuChangedCallback === 'function') {
        onMenuChangedCallback(daftarMenuAktif, 'BULK_JSON_APPLY', {
            addedCount,
            updatedCount,
            totalCount: daftarMenuAktif.length
        });
    }

    const tabKatalogBtn = document.querySelector('.merchant-tab-btn[data-tab="tab-katalog-menu"]');
    if (tabKatalogBtn) {
        tabKatalogBtn.click();
    }

    const noPhotoRemaining = daftarMenuAktif.filter(m => !m.img).length;
    window.showToast(
        `Berhasil menerapkan JSON: ${addedCount} menu baru ditambahkan & ${updatedCount} menu diperbarui.${noPhotoRemaining > 0 ? ` Tinggal ketuk "+ Foto" pada ${noPhotoRemaining} menu.` : ''}`,
        'success'
    );
}

export function pasangEventManajemenMenu() {
    const btnAddMenu = document.getElementById('btn-add-new-menu-item');
    if (btnAddMenu) {
        btnAddMenu.addEventListener('click', () => {
            picuGetarSentuh(12);
            bukaModalEditorMenu(null);
        });
    }

    const btnOpenStudioShortcut = document.getElementById('btn-open-studio-json-shortcut');
    if (btnOpenStudioShortcut) {
        btnOpenStudioShortcut.addEventListener('click', () => {
            picuGetarSentuh(10);
            bukaTabStudioJsonPintar();
        });
    }

    const btnAutoArticulateAll = document.getElementById('btn-auto-articulate-all-catalog');
    if (btnAutoArticulateAll) {
        btnAutoArticulateAll.addEventListener('click', () => {
            picuGetarSentuh(14);
            autoArtikulasiSeluruhMenuAktif();
        });
    }

    const fileQuickCardFoto = document.getElementById('file-quick-card-foto');
    if (fileQuickCardFoto) {
        fileQuickCardFoto.addEventListener('change', async (e) => {
            const file = e.target.files && e.target.files[0];
            if (!file || !quickUploadTargetItemId) return;

            const targetId = quickUploadTargetItemId;
            const itemIdx = daftarMenuAktif.findIndex(m => m.id === targetId);
            if (itemIdx === -1) return;

            const targetName = daftarMenuAktif[itemIdx].n;
            window.showToast(`Memproses & mengunggah foto untuk "${targetName}"...`, 'info');

            try {
                const res = await unggahGambarKeCloudinary(file);
                const latestIdx = daftarMenuAktif.findIndex(m => m.id === targetId);
                if (latestIdx !== -1) {
                    daftarMenuAktif[latestIdx].img = res.publicId;
                    renderFilterSubKategoriChips();
                    renderDaftarMenuUI();
                    if (typeof onMenuChangedCallback === 'function') {
                        onMenuChangedCallback(daftarMenuAktif, 'QUICK_PHOTO_UPLOAD', {
                            itemName: targetName,
                            fromCache: Boolean(res.fromCache)
                        });
                    }
                    window.showToast(
                        `Foto "${targetName}" berhasil dipasang (${res.sizeKb} KB${res.fromCache ? ' • Tersimpan Otomatis' : ''}).`,
                        'success'
                    );
                }
            } catch (err) {
                window.alert(`Gagal mengunggah foto "${targetName}": ` + (err?.message || err), 'error');
            } finally {
                quickUploadTargetItemId = null;
            }
        });
    }

    // Event Mode Switcher di Studio JSON (Mode 1: AI vs Mode 2: Ketik Baris)
    const btnModeAi = document.getElementById('btn-studio-mode-ai');
    const btnModeNotes = document.getElementById('btn-studio-mode-notes');
    if (btnModeAi) {
        btnModeAi.addEventListener('click', () => {
            picuGetarSentuh(8);
            setModeInputStudioJson('AI');
        });
    }
    if (btnModeNotes) {
        btnModeNotes.addEventListener('click', () => {
            picuGetarSentuh(8);
            setModeInputStudioJson('NOTES');
        });
    }

    // Event Konfigurasi Prompt AI Presisi
    const selPromptSource = document.getElementById('studio-prompt-source-type');
    const selPromptDisc = document.getElementById('studio-prompt-default-disc');
    const btnTogglePromptPreview = document.getElementById('btn-studio-toggle-prompt-preview');
    const wrapPromptPreview = document.getElementById('studio-ai-prompt-preview-wrap');

    if (selPromptSource) {
        selPromptSource.addEventListener('change', () => {
            picuGetarSentuh(8);
            sinkronkanPreviewPromptAiUI();
        });
    }
    if (selPromptDisc) {
        selPromptDisc.addEventListener('change', () => {
            picuGetarSentuh(8);
            sinkronkanPreviewPromptAiUI();
        });
    }
    if (btnTogglePromptPreview && wrapPromptPreview) {
        btnTogglePromptPreview.addEventListener('click', () => {
            picuGetarSentuh(8);
            sinkronkanPreviewPromptAiUI();
            const isHidden = wrapPromptPreview.classList.toggle('hidden-state');
            btnTogglePromptPreview.innerHTML = isHidden
                ? `<i class="fa-solid fa-eye mr-1"></i>Lihat Prompt`
                : `<i class="fa-solid fa-eye-slash mr-1"></i>Tutup Prompt`;
        });
    }

    const notesTa = document.getElementById('studio-notes-textarea');
    const jsonTa = document.getElementById('studio-json-textarea');
    const btnLoadSampleNotes = document.getElementById('btn-studio-load-sample-notes');
    const btnConvertNotesToJson = document.getElementById('btn-studio-convert-notes-to-json');
    const btnPasteJson = document.getElementById('btn-studio-paste-json');
    const btnClearJson = document.getElementById('btn-studio-clear-json');
    const btnBannerClearSample = document.getElementById('btn-banner-clear-sample-json');
    const btnLoadSampleJson = document.getElementById('btn-studio-load-sample-json');
    const btnLoadCurrentMenuToJson = document.getElementById('btn-studio-load-active-menu');
    const btnFormatValidateJson = document.getElementById('btn-studio-format-json');
    const btnCopyAiPrompt = document.getElementById('btn-studio-copy-ai-prompt');
    const btnCopyJsonText = document.getElementById('btn-studio-copy-json');
    const btnApplyJsonToMenu = document.getElementById('btn-apply-studio-json-to-menu');

    const eksekusiHapusContohAtauKosongkanJson = () => {
        if (!jsonTa) return;
        picuGetarSentuh(10);
        const wasSample = apakahIsiEditorAdalahContohSimulasi(jsonTa.value);
        jsonTa.value = '';
        evaluasiDanRenderPreviewStudioJson();
        jsonTa.focus();
        window.showToast(
            wasSample
                ? 'Format Contoh berhasil dihapus! Sekarang silakan tekan "Tempel JSON" untuk memasukkan data menu Anda.'
                : 'Kotak editor JSON berhasil dikosongkan.',
            'info'
        );
    };

    if (btnClearJson) {
        btnClearJson.addEventListener('click', eksekusiHapusContohAtauKosongkanJson);
    }
    if (btnBannerClearSample) {
        btnBannerClearSample.addEventListener('click', eksekusiHapusContohAtauKosongkanJson);
    }
    if (btnLoadSampleJson && jsonTa) {
        btnLoadSampleJson.addEventListener('click', () => {
            picuGetarSentuh(10);
            jsonTa.value = JSON.stringify(SAMPLE_JSON_TEMPLATE, null, 2);
            evaluasiDanRenderPreviewStudioJson();
            window.showToast('Format Contoh (Simulasi) ditampilkan sebagai referensi. Klik "Hapus Contoh" jika ingin mengosongkan.', 'info');
        });
    }

    if (btnLoadSampleNotes && notesTa) {
        btnLoadSampleNotes.addEventListener('click', () => {
            picuGetarSentuh(10);
            notesTa.value = SAMPLE_NOTES_TEMPLATE;
            const converted = konversiCatatanTeksKeArrayMenu(SAMPLE_NOTES_TEMPLATE);
            if (jsonTa && converted.length > 0) {
                jsonTa.value = JSON.stringify(converted.map(it => formatItemUntukEksporJsonStudio(it)), null, 2);
                evaluasiDanRenderPreviewStudioJson();
            }
            window.showToast('Contoh catatan menu & Paket Hemat berhasil dimuat ke JSON.', 'info');
        });
    }

    if (btnConvertNotesToJson && notesTa && jsonTa) {
        btnConvertNotesToJson.addEventListener('click', () => {
            picuGetarSentuh(14);
            const rawNotes = notesTa.value.trim();
            if (!rawNotes) {
                return window.alert('Ketik atau tempelkan daftar menu di kotak Catatan terlebih dahulu.', 'warning');
            }
            const items = konversiCatatanTeksKeArrayMenu(rawNotes);
            if (items.length === 0) {
                return window.alert('Belum ada baris menu yang terbaca. Pastikan setiap baris memiliki nama menu dan angka harga (contoh: Nasi Pecel 13000 atau Es Teh 4rb).', 'warning');
            }
            jsonTa.value = JSON.stringify(items.map(it => formatItemUntukEksporJsonStudio(it)), null, 2);
            evaluasiDanRenderPreviewStudioJson();
            jsonTa.scrollIntoView({ behavior: 'smooth', block: 'center' });
            window.showToast(`${items.length} menu berhasil dikonversi ke JSON! Periksa di bawah lalu klik Terapkan.`, 'success');
        });
    }

    if (btnPasteJson && jsonTa) {
        btnPasteJson.addEventListener('click', async () => {
            picuGetarSentuh(12);
            try {
                const clipText = await navigator.clipboard.readText();
                if (!clipText || !clipText.trim()) {
                    jsonTa.focus();
                    return window.showToast('Clipboard kosong. Silakan tempel manual di kotak JSON.', 'warning');
                }
                jsonTa.value = clipText.trim();
                const res = parseDanValidasiJsonMenu(jsonTa.value);
                if (res.ok) {
                    const cleanFormatted = res.items.map(it => formatItemUntukEksporJsonStudio(it));
                    jsonTa.value = JSON.stringify(cleanFormatted, null, 2);
                    window.showToast(`JSON dari Clipboard berhasil ditempel & divalidasi (${cleanFormatted.length} menu siap diterapkan)!`, 'success');
                } else {
                    window.showToast('Teks ditempel. Periksa format JSON pada kotak di bawah.', 'info');
                }
                evaluasiDanRenderPreviewStudioJson();
            } catch (e) {
                jsonTa.focus();
                window.showToast('Tekan tahan pada kotak JSON lalu pilih "Tempel / Paste".', 'info');
            }
        });
    }

    if (jsonTa) {
        jsonTa.addEventListener('input', () => {
            evaluasiDanRenderPreviewStudioJson();
        });
    }

    if (btnLoadCurrentMenuToJson) {
        btnLoadCurrentMenuToJson.addEventListener('click', () => {
            picuGetarSentuh(10);
            sinkronkanEditorStudioJsonDariMenuAktif(true);
            window.showToast(
                daftarMenuAktif.length > 0
                    ? `${daftarMenuAktif.length} menu aktif berhasil dimuat ke editor JSON.`
                    : 'Contoh format JSON berhasil dimuat ke editor.',
                'info'
            );
        });
    }

    if (btnFormatValidateJson && jsonTa) {
        btnFormatValidateJson.addEventListener('click', () => {
            picuGetarSentuh(10);
            const res = parseDanValidasiJsonMenu(jsonTa.value);
            if (!res.ok) {
                evaluasiDanRenderPreviewStudioJson();
                return window.alert(res.error, 'warning');
            }
            const cleanFormatted = res.items.map(it => formatItemUntukEksporJsonStudio(it));
            jsonTa.value = JSON.stringify(cleanFormatted, null, 2);
            evaluasiDanRenderPreviewStudioJson();
            window.showToast(`JSON berhasil dirapikan & divalidasi (${cleanFormatted.length} menu).`, 'success');
        });
    }

    if (btnCopyAiPrompt) {
        btnCopyAiPrompt.addEventListener('click', async () => {
            picuGetarSentuh(14);
            sinkronkanPreviewPromptAiUI();
            const promptText = bangunTeksPromptAiPresisi();
            try {
                await navigator.clipboard.writeText(promptText);
                window.showToast('Prompt AI Super Presisi berhasil disalin! Tempelkan ke ChatGPT / Gemini bersama foto atau daftar menu Anda.', 'success');
            } catch (e) {
                if (wrapPromptPreview) wrapPromptPreview.classList.remove('hidden-state');
                window.alert('Salin teks prompt dari kotak pratinjau yang telah dibuka.', 'info');
            }
        });
    }

    if (btnCopyJsonText && jsonTa) {
        btnCopyJsonText.addEventListener('click', async () => {
            picuGetarSentuh(10);
            const val = jsonTa.value.trim();
            if (!val) return window.alert('Editor JSON masih kosong.', 'warning');
            try {
                await navigator.clipboard.writeText(val);
                window.showToast('Kode JSON daftar menu berhasil disalin ke clipboard (Backup).', 'success');
            } catch (e) {
                jsonTa.select();
                document.execCommand('copy');
                window.showToast('Kode JSON daftar menu berhasil disalin.', 'success');
            }
        });
    }

    if (btnApplyJsonToMenu) {
        btnApplyJsonToMenu.addEventListener('click', async () => {
            if (jsonTa && apakahIsiEditorAdalahContohSimulasi(jsonTa.value)) {
                const yakinContoh = await window.showConfirm(
                    'INI MASIH DATA FORMAT CONTOH (SIMULASI)',
                    'Kotak JSON saat ini masih berisi 7 menu Format Contoh (Simulasi). Jika Anda ingin memasukkan menu warung Anda sendiri, tekan "Batal" lalu klik tombol "Hapus Contoh". Tetap terapkan menu contoh ini?',
                    'Ya, Terapkan Contoh',
                    false
                );
                if (!yakinContoh) return;
            }
            const modeRadio = document.querySelector('input[name="studioApplyMode"]:checked');
            const selectedMode = modeRadio ? modeRadio.value : 'MERGE';
            if (selectedMode === 'REPLACE' && daftarMenuAktif.length > 0) {
                const yakin = await window.showConfirm(
                    'GANTI SELURUH DAFTAR MENU?',
                    `Anda memilih mode "Ganti Semua Menu". ${daftarMenuAktif.length} menu lama akan digantikan dengan daftar dari JSON (foto pada menu yang namanya sama tetap dipertahankan otomatis). Lanjutkan?`,
                    'Ya, Terapkan JSON',
                    false
                );
                if (!yakin) return;
            }
            terapkanArrayStudioKeDaftarMenu(selectedMode);
        });
    }

    const btnResetAllReady = document.getElementById('btn-reset-all-stock-ready');
    if (btnResetAllReady) {
        btnResetAllReady.addEventListener('click', () => {
            picuGetarSentuh(14);
            let changed = 0;
            daftarMenuAktif.forEach(item => {
                if (item.s === false) {
                    item.s = true;
                    changed++;
                }
            });
            if (changed > 0) {
                filterStatusStok = 'ALL';
                renderFilterSubKategoriChips();
                renderDaftarMenuUI();
                if (typeof onMenuChangedCallback === 'function') {
                    onMenuChangedCallback(daftarMenuAktif, 'BULK_STOCK_RESET', { count: changed });
                }
            }
        });
    }

    document.querySelectorAll('[data-stat-filter]').forEach(box => {
        box.addEventListener('click', () => {
            picuGetarSentuh(8);
            const targetFilter = box.getAttribute('data-stat-filter') || 'ALL';
            filterStatusStok = (filterStatusStok === targetFilter && targetFilter !== 'ALL') ? 'ALL' : targetFilter;
            renderFilterSubKategoriChips();
            renderDaftarMenuUI();
        });
    });

    const searchInp = document.getElementById('input-search-merchant-menu');
    if (searchInp) {
        searchInp.addEventListener('input', (e) => {
            kataKunciCariMenu = String(e.target.value || '').trim().toLowerCase();
            renderDaftarMenuUI();
        });
    }

    const btnCloseModal = document.getElementById('btn-close-item-modal');
    const modal = document.getElementById('merchant-item-modal');
    if (btnCloseModal && modal) {
        btnCloseModal.addEventListener('click', () => {
            modal.classList.add('hidden-state');
        });
    }

    const priceInp = document.getElementById('item-form-price');
    const discInp = document.getElementById('item-form-discount');
    if (priceInp) priceInp.addEventListener('input', perbaruiPreviewHargaModalMenu);
    if (discInp) discInp.addEventListener('input', perbaruiPreviewHargaModalMenu);

    const nameInp = document.getElementById('item-form-name');
    const katInp = document.getElementById('item-form-kat');
    const descInp = document.getElementById('item-form-desc');
    const drkInp = document.getElementById('item-form-drk');
    const varInp = document.getElementById('item-form-var');

    if (nameInp) {
        nameInp.addEventListener('input', () => {
            const val = String(nameInp.value || '').trim();
            if (/\b(paket|combo|nasi\s*kotak|tumpeng|hampers)\b/i.test(val)) {
                if (katInp) katInp.value = 'Paket Hemat & Combo';
                sinkronkanVisualTombolPresetKategoriModal();
                aturBukaTutupPanelPaketModal(true, true);
            }
        });

        nameInp.addEventListener('change', () => {
            const val = String(nameInp.value || '').trim();
            if (!val || !varInp) return;
            const currentVar = String(varInp.value || '').trim();
            if (!currentVar) {
                const autoVar = artikulasiOtomatisVarianDariMenu(
                    val,
                    '',
                    descInp?.value || '',
                    katInp?.value || ''
                );
                if (autoVar) {
                    varInp.value = autoVar;
                    const isPkg = (katInp?.value || '').trim() === 'Paket Hemat & Combo';
                    aturBukaTutupPanelPaketModal(true, isPkg);
                }
            }
        });
    }

    if (katInp) {
        katInp.addEventListener('input', () => {
            const isPkg = katInp.value.trim() === 'Paket Hemat & Combo' || /\b(paket|combo)\b/i.test(katInp.value);
            sinkronkanVisualTombolPresetKategoriModal();
            if (isPkg) aturBukaTutupPanelPaketModal(true, true);
        });
    }

    document.querySelectorAll('.btn-preset-item-kat').forEach(btn => {
        btn.addEventListener('click', () => {
            picuGetarSentuh(8);
            const katVal = btn.getAttribute('data-kat') || 'Hidangan Utama';
            if (katInp) katInp.value = katVal;
            sinkronkanVisualTombolPresetKategoriModal();
            const isPkg = katVal === 'Paket Hemat & Combo';
            if (isPkg) {
                aturBukaTutupPanelPaketModal(true, true);
            } else {
                const hasContent = Boolean(
                    descInp?.value.trim() ||
                    drkInp?.value.trim() ||
                    varInp?.value.trim()
                );
                aturBukaTutupPanelPaketModal(hasContent, false);
            }
        });
    });

    // Event Toggle Header Panel Penyusun Paket Hemat & Kustomisasi
    const btnTogglePkgBuilder = document.getElementById('btn-toggle-item-package-builder');
    if (btnTogglePkgBuilder) {
        btnTogglePkgBuilder.addEventListener('click', () => {
            picuGetarSentuh(8);
            const isPkgKat = (document.getElementById('item-form-kat')?.value || '').trim() === 'Paket Hemat & Combo';
            aturBukaTutupPanelPaketModal(!isPackageBuilderExpanded, isPkgKat);
        });
    }

    if (descInp) descInp.addEventListener('input', perbaruiKalkulatorHargaPaketModal);
    if (drkInp) drkInp.addEventListener('input', perbaruiKalkulatorHargaPaketModal);

    document.getElementById('btn-clear-package-desc')?.addEventListener('click', () => {
        picuGetarSentuh(8);
        if (descInp) descInp.value = '';
        perbaruiKalkulatorHargaPaketModal();
    });

    document.getElementById('btn-clear-package-drk')?.addEventListener('click', () => {
        picuGetarSentuh(8);
        if (drkInp) drkInp.value = '';
        perbaruiKalkulatorHargaPaketModal();
    });

    document.getElementById('btn-clear-package-var')?.addEventListener('click', () => {
        picuGetarSentuh(8);
        if (varInp) varInp.value = '';
    });

    const btnAutoArticulateItemVar = document.getElementById('btn-auto-articulate-item-var');
    if (btnAutoArticulateItemVar) {
        btnAutoArticulateItemVar.addEventListener('click', () => {
            picuGetarSentuh(10);
            const rawName = String(nameInp?.value || '').trim();
            const rawDesc = String(descInp?.value || '').trim();
            const rawKat = String(katInp?.value || '').trim();
            const curVar = String(varInp?.value || '').trim();

            if (!rawName && !rawDesc && !curVar) {
                return window.showToast('Ketik Nama Hidangan terlebih dahulu (contoh: Mie Pedas Level 0 - 3) atau pilih preset di bawah.', 'warning');
            }

            const resultVar = artikulasiOtomatisVarianDariMenu(rawName, curVar, rawDesc, rawKat);
            if (resultVar && varInp) {
                varInp.value = resultVar;
                const isPkg = rawKat === 'Paket Hemat & Combo';
                aturBukaTutupPanelPaketModal(true, isPkg);
                window.showToast(`Varian otomatis terdeteksi: ${resultVar}`, 'success');
            } else {
                window.showToast('Tidak ditemukan pola level/penyajian/saus pada nama menu. Silakan ketuk tombol preset di bawah.', 'info');
            }
        });
    }

    document.querySelectorAll('.btn-preset-pkg-drink').forEach(btn => {
        btn.addEventListener('click', () => {
            picuGetarSentuh(8);
            const drinkVal = btn.getAttribute('data-drink') || '';
            tambahkanMinumanKeOpsiPaket(drinkVal);
        });
    });

    document.querySelectorAll('.btn-preset-pkg-var').forEach(btn => {
        btn.addEventListener('click', () => {
            picuGetarSentuh(8);
            const varVal = btn.getAttribute('data-var') || '';
            tambahkanVarianKeOpsiMenu(varVal);
        });
    });

    const btnUploadMenuFoto = document.getElementById('btn-upload-item-foto');
    const fileItemFoto = document.getElementById('file-item-foto');
    const cloudinaryInp = document.getElementById('item-form-cloudinary');
    const previewImg = document.getElementById('item-form-img-preview');
    const statusUploadEl = document.getElementById('status-upload-item-foto');

    if (btnUploadMenuFoto && fileItemFoto) {
        btnUploadMenuFoto.addEventListener('click', () => {
            picuGetarSentuh(10);
            fileItemFoto.value = '';
            fileItemFoto.click();
        });

        fileItemFoto.addEventListener('change', async (e) => {
            const file = e.target.files && e.target.files[0];
            if (!file) return;

            const origHtml = btnUploadMenuFoto.innerHTML;
            btnUploadMenuFoto.disabled = true;
            btnUploadMenuFoto.innerHTML = `<i class="fa-solid fa-circle-notch fa-spin"></i> Mengunggah...`;
            if (statusUploadEl) {
                statusUploadEl.className = 'text-[0.6rem] text-amber-400 font-bold';
                statusUploadEl.textContent = 'Memproses gambar WebP & mengunggah...';
            }

            try {
                const res = await unggahGambarKeCloudinary(file);
                if (cloudinaryInp) cloudinaryInp.value = res.publicId;
                if (previewImg) previewImg.src = res.previewUrl;
                if (statusUploadEl) {
                    statusUploadEl.className = 'text-[0.6rem] text-emerald-400 font-bold';
                    statusUploadEl.textContent = `Foto hidangan terunggah (${res.sizeKb} KB${res.fromCache ? ' • Tersimpan Otomatis' : ''})`;
                }
                window.showToast(`Foto hidangan berhasil diunggah (${res.sizeKb} KB).`, 'success');
            } catch (err) {
                if (statusUploadEl) {
                    statusUploadEl.className = 'text-[0.6rem] text-red-400 font-bold';
                    statusUploadEl.textContent = 'Gagal mengunggah foto hidangan';
                }
                window.alert('Gagal mengunggah foto hidangan: ' + (err?.message || err), 'error');
            } finally {
                btnUploadMenuFoto.disabled = false;
                btnUploadMenuFoto.innerHTML = origHtml;
            }
        });
    }

    const btnSaveItem = document.getElementById('btn-save-item-modal');
    if (btnSaveItem && modal) {
        btnSaveItem.addEventListener('click', () => {
            const idVal = (document.getElementById('item-form-id')?.value || '').trim();
            const nameVal = (document.getElementById('item-form-name')?.value || '').trim();
            const rawKatVal = (document.getElementById('item-form-kat')?.value || '').trim();
            const katVal = klasifikasiKategoriMenuPintar(nameVal, rawKatVal);
            const priceVal = Math.max(0, parseInt(document.getElementById('item-form-price')?.value || '0', 10) || 0);
            const discVal = Math.min(99, Math.max(0, parseInt(document.getElementById('item-form-discount')?.value || '0', 10) || 0));
            const cleanPublicId = bersihkanPublicIdCloudinary(document.getElementById('item-form-cloudinary')?.value || '');
            const stockVal = Boolean(document.getElementById('item-form-stock')?.checked);

            const cleanOpt = bersihkanFieldPaketOpsional(
                document.getElementById('item-form-desc')?.value || '',
                document.getElementById('item-form-drk')?.value || '',
                document.getElementById('item-form-var')?.value || ''
            );

            if (!nameVal) {
                return window.alert("Nama hidangan wajib diisi.", "warning");
            }
            if (priceVal <= 0) {
                return window.alert("Harga normal hidangan harus lebih dari Rp 0.", "warning");
            }
            if (katVal === 'Paket Hemat & Combo' && !cleanOpt.desc) {
                aturBukaTutupPanelPaketModal(true, true);
                document.getElementById('item-form-desc')?.focus();
                return window.alert(
                    "Untuk menu kelompok \"Paket Hemat & Combo\", silakan isi rincian Komposisi Isi Makanan Paket terlebih dahulu (contoh: 1x Nasi Putih + 1x Ayam Bakar + Tahu Tempe) supaya pelanggan tidak bingung.",
                    "warning"
                );
            }
            if (daftarMenuAktif.length >= 300 && !idVal) {
                return window.alert("Maksimal 300 hidangan dalam 1 dokumen katalog resto.", "warning");
            }

            const newItemObj = bentukObjekItemMenuHematKuota({
                id: idVal || `m_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
                n: nameVal.substring(0, 80),
                p: priceVal,
                d: discVal,
                img: cleanPublicId,
                s: stockVal,
                kat: katVal,
                desc: cleanOpt.desc,
                drk: cleanOpt.drk,
                var: cleanOpt.var
            });

            const existingIdx = daftarMenuAktif.findIndex(m => m.id === newItemObj.id);
            const isEdit = existingIdx !== -1;
            if (isEdit) {
                daftarMenuAktif[existingIdx] = newItemObj;
            } else {
                daftarMenuAktif.unshift(newItemObj);
            }

            picuGetarSentuh(15);
            modal.classList.add('hidden-state');
            renderFilterSubKategoriChips();
            renderDaftarMenuUI();

            if (typeof onMenuChangedCallback === 'function') {
                onMenuChangedCallback(daftarMenuAktif, 'MODAL_SAVE', {
                    itemName: newItemObj.n,
                    isEdit
                });
            }
        });
    }
}
