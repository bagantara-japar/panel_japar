// ==========================================================================
// FILE: js/utils/math-engine.js (JAPAR PANEL v3.7)
// FUNGSI: Rumus Matematika Haversine, Geohash 6 Karakter, Kompresi Gambar WebP <canvas>
//         & Unggah Langsung ke Cloudinary (Dilengkapi Deduplikasi Hash Lokal Hemat Kuota),
//         Evaluator Jam & Hari Operasional Presisi, serta Mesin Kalkulasi Diskon Multi-Skema
// ==========================================================================

import { cloudinaryConfig } from '../config/credentials.js';

const CLOUDINARY_DEDUP_CACHE_KEY = 'japar_cloudinary_dedup_v1';
const MAX_CLOUDINARY_CACHE_ENTRIES = 80;

export function parseKoordinatAman(rawVal) {
    if (typeof rawVal === 'number') return rawVal;
    if (rawVal === null || rawVal === undefined) return NaN;
    const str = String(rawVal).trim().replace(/,/g, '.');
    if (!str) return NaN;
    return parseFloat(str);
}

export function hitungJarakHaversine(lat1, lon1, lat2, lon2) {
    const R = 6371000;
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLon = (lon2 - lon1) * Math.PI / 180;
    const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
              Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
              Math.sin(dLon / 2) * Math.sin(dLon / 2);
    return R * (2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a)));
}

export function encodeGeohash(lat, lon, precision = 6) {
    const BASE32 = "0123456789bcdefghjkmnpqrstuvwxyz";
    let idx = 0, bit = 0, evenBit = true, hash = "";
    let latMin = -90, latMax = 90, lonMin = -180, lonMax = 180;

    while (hash.length < precision) {
        if (evenBit) {
            const lonMid = (lonMin + lonMax) / 2;
            if (lon >= lonMid) { idx = idx * 2 + 1; lonMin = lonMid; }
            else { idx = idx * 2; lonMax = lonMid; }
        } else {
            const latMid = (latMin + latMax) / 2;
            if (lat >= latMid) { idx = idx * 2 + 1; latMin = latMid; }
            else { idx = idx * 2; latMax = latMid; }
        }
        evenBit = !evenBit;
        if (++bit === 5) { hash += BASE32[idx]; bit = 0; idx = 0; }
    }
    return hash;
}

export function bersihkanPublicIdCloudinary(rawInput) {
    if (!rawInput) return '';
    let str = String(rawInput).trim();
    if (!str) return '';
    if (/^https?:\/\/res\.cloudinary\.com\//i.test(str)) {
        const m = str.match(/\/image\/upload\/(?:f_auto,q_auto,w_\d+\/)?(?:v\d+\/)?(.+)$/i);
        if (m && m[1]) {
            str = m[1];
        }
    }
    if (/^https?:\/\//i.test(str)) return '';
    return str.replace(/^\/+/, '');
}

export function bangunUrlGambarCloudinary(publicId, width = 400, fallbackAvatarName = 'JAPAR') {
    const fallbackUrl = `https://ui-avatars.com/api/?name=${encodeURIComponent(fallbackAvatarName || 'JAPAR')}&background=1A1C20&color=F59E0B&bold=true`;
    const cleanId = bersihkanPublicIdCloudinary(publicId);
    if (!cleanId) return fallbackUrl;

    if (cloudinaryConfig && cloudinaryConfig.deliveryBaseUrl) {
        return cloudinaryConfig.deliveryBaseUrl + cleanId;
    }
    const cloudName = (cloudinaryConfig && cloudinaryConfig.cloudName) ? cloudinaryConfig.cloudName : 'odo6kdaz';
    return `https://res.cloudinary.com/${cloudName}/image/upload/f_auto,q_auto,w_400/${cleanId}`;
}

function getFileFingerprintKey(fileObj) {
    if (!fileObj) return '';
    const name = String(fileObj.name || 'img').trim().toLowerCase();
    const size = Number(fileObj.size || 0);
    const mtime = Number(fileObj.lastModified || 0);
    if (!size) return '';
    return `${name}_${size}_${mtime}`;
}

function readCloudinaryDedupCache(fingerprint) {
    if (!fingerprint) return null;
    try {
        const raw = localStorage.getItem(CLOUDINARY_DEDUP_CACHE_KEY);
        if (!raw) return null;
        const map = JSON.parse(raw);
        const entry = map && map[fingerprint];
        if (entry && entry.publicId) {
            return entry;
        }
    } catch (e) {}
    return null;
}

function writeCloudinaryDedupCache(fingerprint, dataObj) {
    if (!fingerprint || !dataObj || !dataObj.publicId) return;
    try {
        let map = {};
        const raw = localStorage.getItem(CLOUDINARY_DEDUP_CACHE_KEY);
        if (raw) {
            map = JSON.parse(raw) || {};
        }
        const keys = Object.keys(map);
        if (keys.length >= MAX_CLOUDINARY_CACHE_ENTRIES) {
            delete map[keys[0]];
        }
        map[fingerprint] = {
            publicId: dataObj.publicId,
            sizeKb: dataObj.sizeKb || 35,
            ts: Date.now()
        };
        localStorage.setItem(CLOUDINARY_DEDUP_CACHE_KEY, JSON.stringify(map));
    } catch (e) {}
}

export function kompresGambarKeWebp(fileObj, maxSide = 760, initialQuality = 0.74) {
    return new Promise((resolve, reject) => {
        if (!fileObj || !fileObj.type || !fileObj.type.startsWith('image/')) {
            return reject(new Error('Pilih berkas gambar yang valid (JPG, PNG, atau WebP).'));
        }

        const reader = new FileReader();
        reader.onerror = () => reject(new Error('Gagal membaca berkas gambar dari perangkat.'));
        reader.onload = (evt) => {
            const img = new Image();
            img.onerror = () => reject(new Error('Format gambar tidak dapat diproses.'));
            img.onload = () => {
                let width = img.naturalWidth || img.width || 760;
                let height = img.naturalHeight || img.height || 760;

                if (width > maxSide || height > maxSide) {
                    if (width >= height) {
                        height = Math.max(1, Math.round((height * maxSide) / width));
                        width = maxSide;
                    } else {
                        width = Math.max(1, Math.round((width * maxSide) / height));
                        height = maxSide;
                    }
                }

                const canvas = document.createElement('canvas');
                canvas.width = width;
                canvas.height = height;
                const ctx = canvas.getContext('2d');
                if (!ctx) {
                    return reject(new Error('Browser tidak mendukung pemrosesan Canvas 2D.'));
                }
                ctx.imageSmoothingEnabled = true;
                ctx.imageSmoothingQuality = 'high';
                ctx.drawImage(img, 0, 0, width, height);

                const encodeWithQuality = (q) => {
                    canvas.toBlob(
                        (blob) => {
                            if (!blob) {
                                return reject(new Error('Gagal mengonversi gambar ke format WebP.'));
                            }
                            if (blob.size > 58 * 1024 && q > 0.50) {
                                encodeWithQuality(Number((q - 0.1).toFixed(2)));
                            } else {
                                resolve(blob);
                            }
                        },
                        'image/webp',
                        q
                    );
                };

                encodeWithQuality(initialQuality);
            };
            img.src = evt.target.result;
        };
        reader.readAsDataURL(fileObj);
    });
}

export async function unggahGambarKeCloudinary(fileObj) {
    const fingerprint = getFileFingerprintKey(fileObj);
    const cachedHit = readCloudinaryDedupCache(fingerprint);
    if (cachedHit && cachedHit.publicId) {
        const cleanId = bersihkanPublicIdCloudinary(cachedHit.publicId);
        if (cleanId) {
            return {
                publicId: cleanId,
                previewUrl: bangunUrlGambarCloudinary(cleanId, 400, 'JAPAR'),
                qrisPreviewUrl: bangunUrlGambarCloudinary(cleanId, 500, 'QRIS'),
                sizeKb: cachedHit.sizeKb || 32,
                fromCache: true
            };
        }
    }

    const webpBlob = await kompresGambarKeWebp(fileObj, 760, 0.74);
    const endpoint = (cloudinaryConfig && cloudinaryConfig.uploadEndpoint)
        ? cloudinaryConfig.uploadEndpoint
        : 'https://api.cloudinary.com/v1_1/odo6kdaz/image/upload';
    const preset = (cloudinaryConfig && cloudinaryConfig.uploadPreset)
        ? cloudinaryConfig.uploadPreset
        : 'my-archivestory';

    const formData = new FormData();
    formData.append('file', webpBlob, `japar_${Date.now()}.webp`);
    formData.append('upload_preset', preset);

    const response = await fetch(endpoint, {
        method: 'POST',
        body: formData
    });

    const data = await response.json().catch(() => null);
    if (!response.ok || !data || !data.public_id) {
        const errMsg = data?.error?.message || `Gagal mengunggah gambar (HTTP ${response.status})`;
        throw new Error(errMsg);
    }

    const publicId = String(data.public_id).trim();
    const sizeKb = Math.max(1, Math.round(webpBlob.size / 1024));
    writeCloudinaryDedupCache(fingerprint, { publicId, sizeKb });

    return {
        publicId,
        previewUrl: bangunUrlGambarCloudinary(publicId, 400, 'JAPAR'),
        qrisPreviewUrl: bangunUrlGambarCloudinary(publicId, 500, 'QRIS'),
        sizeKb,
        fromCache: false
    };
}

export function normalisasiArrayHariOperasional(rawDaysInput) {
    const defaultDays = [1, 2, 3, 4, 5, 6, 0];
    if (!rawDaysInput) return defaultDays;
    let arr = [];
    if (Array.isArray(rawDaysInput)) {
        arr = rawDaysInput;
    } else if (typeof rawDaysInput === 'string') {
        arr = rawDaysInput.split(',').map(s => s.trim()).filter(Boolean);
    }
    const validSet = new Set();
    arr.forEach(v => {
        const n = parseInt(v, 10);
        if (!isNaN(n) && n >= 0 && n <= 6) {
            validSet.add(n);
        }
    });
    if (validSet.size === 0) return defaultDays;
    const order = [1, 2, 3, 4, 5, 6, 0];
    return order.filter(d => validSet.has(d));
}

export function formatLabelHariOperasional(rawDaysInput) {
    const days = normalisasiArrayHariOperasional(rawDaysInput);
    if (days.length >= 7) return 'Setiap Hari';
    const hasSun = days.includes(0);
    const hasSat = days.includes(6);
    if (days.length === 6 && !hasSun) return 'Senin - Sabtu';
    if (days.length === 5 && !hasSat && !hasSun) return 'Senin - Jumat';
    const mapLabel = { 1: 'Sen', 2: 'Sel', 3: 'Rab', 4: 'Kam', 5: 'Jum', 6: 'Sab', 0: 'Min' };
    return days.map(d => mapLabel[d] || '').filter(Boolean).join(', ');
}

export function uraiRentangJamOperasional(jamBukaTutupStr) {
    const raw = String(jamBukaTutupStr || '08:00-21:00').trim();
    if (/24\s*jam/i.test(raw) || raw === '00:00-24:00' || raw === '00:00-23:59') {
        return {
            valid: true,
            is24Hours: true,
            startH: 0,
            startM: 0,
            endH: 23,
            endM: 59,
            startStr: '00:00',
            endStr: '23:59',
            normalized: '00:00-23:59'
        };
    }

    const match = raw.match(/(\d{1,2})[:.](\d{2})\s*[-–—s/d]+\s*(\d{1,2})[:.](\d{2})/i);
    if (!match) {
        return {
            valid: false,
            is24Hours: false,
            startH: 8,
            startM: 0,
            endH: 21,
            endM: 0,
            startStr: '08:00',
            endStr: '21:00',
            normalized: '08:00-21:00'
        };
    }

    const startH = Math.min(23, Math.max(0, parseInt(match[1], 10) || 0));
    const startM = Math.min(59, Math.max(0, parseInt(match[2], 10) || 0));
    const endH = Math.min(23, Math.max(0, parseInt(match[3], 10) || 0));
    const endM = Math.min(59, Math.max(0, parseInt(match[4], 10) || 0));

    const pad = (n) => String(n).padStart(2, '0');
    const startStr = `${pad(startH)}:${pad(startM)}`;
    const endStr = `${pad(endH)}:${pad(endM)}`;
    const is24Hours = (startH === endH && startM === endM) || (startStr === '00:00' && endStr === '23:59');

    return {
        valid: true,
        is24Hours,
        startH,
        startM,
        endH,
        endM,
        startStr,
        endStr,
        normalized: `${startStr}-${endStr}`
    };
}

export function getWaktuWibPresisi(nowDate = new Date()) {
    try {
        const d = (nowDate instanceof Date && !isNaN(nowDate.getTime())) ? nowDate : new Date();
        const utcMs = d.getTime() + (d.getTimezoneOffset() * 60000);
        const wibDate = new Date(utcMs + (7 * 3600000));
        return {
            hours: wibDate.getHours(),
            minutes: wibDate.getMinutes(),
            day: wibDate.getDay()
        };
    } catch (e) {
        return {
            hours: nowDate.getHours(),
            minutes: nowDate.getMinutes(),
            day: nowDate.getDay()
        };
    }
}

export function cekDalamJamOperasional(jamBukaTutupStr, nowDate = new Date(), activeDaysInput = null) {
    const wib = getWaktuWibPresisi(nowDate);
    const activeDays = activeDaysInput ? normalisasiArrayHariOperasional(activeDaysInput) : [1, 2, 3, 4, 5, 6, 0];

    if (!jamBukaTutupStr || typeof jamBukaTutupStr !== 'string') {
        return activeDays.includes(wib.day);
    }
    const parsed = uraiRentangJamOperasional(jamBukaTutupStr);
    if (!parsed.valid || parsed.is24Hours) {
        return activeDays.includes(wib.day);
    }

    const currentMinutes = wib.hours * 60 + wib.minutes;
    const startMinutes = parsed.startH * 60 + parsed.startM;
    const endMinutes = parsed.endH * 60 + parsed.endM;

    if (startMinutes === endMinutes) return activeDays.includes(wib.day);
    if (startMinutes < endMinutes) {
        if (!activeDays.includes(wib.day)) return false;
        return currentMinutes >= startMinutes && currentMinutes <= endMinutes;
    }
    if (currentMinutes >= startMinutes) {
        return activeDays.includes(wib.day);
    }
    if (currentMinutes <= endMinutes) {
        const yesterday = (wib.day + 6) % 7;
        return activeDays.includes(yesterday);
    }
    return false;
}

export function hitungHargaFinalMenu(hargaNormal, diskonItemPersen = 0, diskonTokoPersen = 0, skemaDiskon = 'MAX_BEST') {
    const hargaAsli = Math.max(0, Math.round(Number(hargaNormal) || 0));
    const dItem = Math.min(99, Math.max(0, parseInt(diskonItemPersen, 10) || 0));
    const dToko = Math.min(99, Math.max(0, parseInt(diskonTokoPersen, 10) || 0));
    const mode = ['MAX_BEST', 'ITEM_OVERRIDE', 'STACK_ADD'].includes(skemaDiskon) ? skemaDiskon : 'MAX_BEST';

    let diskonAktif = 0;
    let sumberDiskon = 'NONE';
    let labelSumber = '';

    if (mode === 'STACK_ADD') {
        diskonAktif = Math.min(90, dItem + dToko);
        if (dItem > 0 && dToko > 0) {
            sumberDiskon = 'STACKED';
            labelSumber = `Menu ${dItem}% + Global ${dToko}%`;
        } else if (dItem > 0) {
            sumberDiskon = 'ITEM';
            labelSumber = 'Diskon Menu';
        } else if (dToko > 0) {
            sumberDiskon = 'GLOBAL';
            labelSumber = 'Diskon Global';
        }
    } else if (mode === 'ITEM_OVERRIDE') {
        if (dItem > 0) {
            diskonAktif = dItem;
            sumberDiskon = 'ITEM';
            labelSumber = 'Diskon Menu';
        } else if (dToko > 0) {
            diskonAktif = dToko;
            sumberDiskon = 'GLOBAL';
            labelSumber = 'Diskon Global';
        }
    } else {
        if (dItem >= dToko && dItem > 0) {
            diskonAktif = dItem;
            sumberDiskon = 'ITEM';
            labelSumber = dToko > 0 && dItem > dToko ? 'Promo Menu (Tertinggi)' : 'Diskon Menu';
        } else if (dToko > dItem && dToko > 0) {
            diskonAktif = dToko;
            sumberDiskon = 'GLOBAL';
            labelSumber = dItem > 0 ? 'Ikut Global (Tertinggi)' : 'Diskon Global';
        }
    }

    if (diskonAktif <= 0) {
        return {
            hargaAsli,
            hargaFinal: hargaAsli,
            diskonPersen: 0,
            hematNominal: 0,
            sumberDiskon: 'NONE',
            labelSumber: '',
            dItem,
            dToko,
            skema: mode
        };
    }

    const potongan = Math.round((hargaAsli * diskonAktif) / 100);
    const hargaFinal = Math.max(0, hargaAsli - potongan);
    return {
        hargaAsli,
        hargaFinal,
        diskonPersen: diskonAktif,
        hematNominal: potongan,
        sumberDiskon,
        labelSumber,
        dItem,
        dToko,
        skema: mode
    };
}

export function getTrueTime() {
    return Date.now();
}

window.parseKoordinatAman = parseKoordinatAman;
window.bersihkanPublicIdCloudinary = bersihkanPublicIdCloudinary;
window.bangunUrlGambarCloudinary = bangunUrlGambarCloudinary;
window.kompresGambarKeWebp = kompresGambarKeWebp;
window.unggahGambarKeCloudinary = unggahGambarKeCloudinary;
window.normalisasiArrayHariOperasional = normalisasiArrayHariOperasional;
window.formatLabelHariOperasional = formatLabelHariOperasional;
window.uraiRentangJamOperasional = uraiRentangJamOperasional;
window.cekDalamJamOperasional = cekDalamJamOperasional;
window.hitungHargaFinalMenu = hitungHargaFinalMenu;
window.getTrueTime = getTrueTime;
