// ==========================================================================
// FILE: js/modules/location-picker.js (JAPAR PANEL v4.1)
// FUNGSI: Ekstraktor Titik Koordinat Resto (Latitude, Longitude, Geohash),
//         Kode Plus (Plus Code), Tautan Pendek Google Maps, & Resolusi Nama Jalan
//         100% Google Maps + Endpoint GAS JAPAR dengan Cache Grid 4 Desimal (~11m)
// ==========================================================================

import { encodeGeohash, parseKoordinatAman } from '../utils/math-engine.js';
import { picuGetarSentuh } from '../utils/ui-components.js';
import { JAPAR_GAS_MAPS_URL, DEFAULT_CENTER_PARE } from '../config/credentials.js';

const GMAPS_LOCAL_CACHE_KEY = 'japar_gmaps_extract_cache_v3';
const MAX_LOCAL_CACHE_ITEMS = 80;
const PLUS_CODE_REGEX = /\b[23456789CFGHJMPQRVWX]{4,8}\+[23456789CFGHJMPQRVWX]{2,4}\b/i;

let currentLat = DEFAULT_CENTER_PARE ? DEFAULT_CENTER_PARE.lat : -7.768049;
let currentLng = DEFAULT_CENTER_PARE ? DEFAULT_CENTER_PARE.lng : 112.196514;
let inflightUnfurlPromises = Object.create(null);
let inflightReversePromises = Object.create(null);

export function isValidIndonesiaCoord(lat, lng) {
    const fLat = parseKoordinatAman(lat);
    const fLng = parseKoordinatAman(lng);
    return (
        typeof fLat === 'number' &&
        typeof fLng === 'number' &&
        !isNaN(fLat) &&
        !isNaN(fLng) &&
        fLat >= -11.5 &&
        fLat <= 6.5 &&
        fLng >= 94.5 &&
        fLng <= 141.5
    );
}

function cleanExtractedAddress(rawText) {
    if (!rawText || typeof rawText !== 'string') return '';
    return rawText
        .replace(/^[23456789CFGHJMPQRVWX]{4,8}\+[23456789CFGHJMPQRVWX]{2,4}\s*,?\s*/i, '')
        .replace(/\b[23456789CFGHJMPQRVWX]{4,8}\+[23456789CFGHJMPQRVWX]{2,4}\b\s*,?\s*/gi, '')
        .replace(/\+/g, ' ')
        .replace(/\s*-\s*Google\s+Maps.*$/i, '')
        .replace(/\s+/g, ' ')
        .replace(/^[,.\s·-]+|[,.\s·-]+$/g, '')
        .trim();
}

function isAddressCompleteWithStreet(addrText = '', placeName = '') {
    const clean = cleanExtractedAddress(addrText);
    if (!clean || clean.length < 10) return false;
    if (PLUS_CODE_REGEX.test(addrText)) return false;
    if (placeName && clean.toLowerCase() === cleanExtractedAddress(placeName).toLowerCase() && !/,/.test(clean)) {
        return false;
    }
    return /\b(jl\.?|jalan|gg\.?|gang|dsn\.?|dusun|ds\.?|desa|kel\.?|kec\.?|rt\.?|rw\.?|kab\.?|kota|pare|kediri)\b/i.test(clean) || clean.includes(',');
}

function readLocalGmapsCache(rawKey) {
    if (!rawKey) return null;
    try {
        const rawStore = localStorage.getItem(GMAPS_LOCAL_CACHE_KEY);
        if (!rawStore) return null;
        const map = JSON.parse(rawStore);
        const item = map && map[rawKey];
        if (item && isValidIndonesiaCoord(item.lat, item.lng)) {
            return { ...item, fromCache: true };
        }
    } catch (e) {}
    return null;
}

function writeLocalGmapsCache(rawKey, resultObj) {
    if (!rawKey || !resultObj || !isValidIndonesiaCoord(resultObj.lat, resultObj.lng)) return;
    try {
        let map = {};
        const rawStore = localStorage.getItem(GMAPS_LOCAL_CACHE_KEY);
        if (rawStore) {
            map = JSON.parse(rawStore) || {};
        }
        const keys = Object.keys(map);
        if (keys.length >= MAX_LOCAL_CACHE_ITEMS) {
            delete map[keys[0]];
        }
        const nLat = parseKoordinatAman(resultObj.lat);
        const nLng = parseKoordinatAman(resultObj.lng);
        const cleanAddr = cleanExtractedAddress(resultObj.address || resultObj.shortStreet || '');
        const cleanShort = cleanExtractedAddress(resultObj.shortStreet || cleanAddr || '');
        map[rawKey] = {
            lat: Number(nLat.toFixed(6)),
            lng: Number(nLng.toFixed(6)),
            geohash: String(resultObj.geohash || encodeGeohash(nLat, nLng, 6)),
            address: cleanAddr,
            shortStreet: cleanShort,
            street: cleanExtractedAddress(resultObj.street || ''),
            subdistrict: cleanExtractedAddress(resultObj.subdistrict || ''),
            city: cleanExtractedAddress(resultObj.city || ''),
            placeName: cleanExtractedAddress(resultObj.placeName || ''),
            method: resultObj.method || 'LOCAL_ZERO_QUOTA',
            ts: Date.now()
        };
        localStorage.setItem(GMAPS_LOCAL_CACHE_KEY, JSON.stringify(map));
    } catch (e) {}
}

/**
 * Resolusi Nama Jalan Otomatis dari Titik Koordinat via Endpoint GAS JAPAR
 * Menggunakan kunci cache grid 4 desimal: `REV_${Number(lat).toFixed(4)}_${Number(lng).toFixed(4)}`
 */
export async function resolusiNamaJalanKoordinatViaGas(lat, lng) {
    const fLat = parseKoordinatAman(lat);
    const fLng = parseKoordinatAman(lng);
    if (!isValidIndonesiaCoord(fLat, fLng)) return null;

    const revCacheKey = `REV_${Number(fLat).toFixed(4)}_${Number(fLng).toFixed(4)}`;
    const cachedRev = readLocalGmapsCache(revCacheKey);
    if (cachedRev && (cachedRev.address || cachedRev.shortStreet)) {
        return {
            ...cachedRev,
            lat: Number(fLat.toFixed(6)),
            lng: Number(fLng.toFixed(6)),
            geohash: encodeGeohash(fLat, fLng, 6),
            fromCache: true
        };
    }

    if (inflightReversePromises[revCacheKey]) {
        return inflightReversePromises[revCacheKey];
    }

    const promise = (async () => {
        try {
            const requestUrl = `${JAPAR_GAS_MAPS_URL}?action=reverse&lat=${encodeURIComponent(fLat)}&lng=${encodeURIComponent(fLng)}`;
            const resp = await fetch(requestUrl, {
                method: 'GET',
                redirect: 'follow'
            });
            if (!resp.ok) return null;
            const data = await resp.json().catch(() => null);
            if (!data) return null;

            const street = cleanExtractedAddress(data.street || '');
            const subdistrict = cleanExtractedAddress(data.subdistrict || '');
            const city = cleanExtractedAddress(data.city || '');
            const computedShort = [street, subdistrict, city].filter(Boolean).join(', ');
            const shortStreet = cleanExtractedAddress(data.shortStreet || computedShort || data.address || '');
            const address = cleanExtractedAddress(data.address || data.formattedAddress || shortStreet || '');

            const resolvedObj = {
                ok: Boolean(address || shortStreet),
                lat: Number(fLat.toFixed(6)),
                lng: Number(fLng.toFixed(6)),
                geohash: String(data.geohash || encodeGeohash(fLat, fLng, 6)),
                address: address || shortStreet,
                shortStreet: shortStreet || address,
                street,
                subdistrict,
                city,
                placeName: cleanExtractedAddress(data.placeName || ''),
                method: 'GAS_REVERSE_4DEC'
            };

            if (resolvedObj.address || resolvedObj.shortStreet) {
                writeLocalGmapsCache(revCacheKey, resolvedObj);
            }
            return resolvedObj;
        } catch (e) {
            return null;
        } finally {
            delete inflightReversePromises[revCacheKey];
        }
    })();

    inflightReversePromises[revCacheKey] = promise;
    return promise;
}
window.resolusiNamaJalanKoordinatViaGas = resolusiNamaJalanKoordinatViaGas;

export function getKoordinatWarungAktif() {
    const inpLat = document.getElementById('store-input-lat');
    const inpLng = document.getElementById('store-input-lng');
    if (inpLat && inpLng && inpLat.value && inpLng.value) {
        const liveLat = parseKoordinatAman(inpLat.value);
        const liveLng = parseKoordinatAman(inpLng.value);
        if (isValidIndonesiaCoord(liveLat, liveLng)) {
            currentLat = Number(liveLat.toFixed(6));
            currentLng = Number(liveLng.toFixed(6));
        }
    }
    return {
        lat: Number(currentLat.toFixed(6)),
        lng: Number(currentLng.toFixed(6)),
        geohash: encodeGeohash(currentLat, currentLng, 6)
    };
}

export function tetapkanTitikLokasi(lat, lng) {
    const fLat = parseKoordinatAman(lat);
    const fLng = parseKoordinatAman(lng);
    if (!isValidIndonesiaCoord(fLat, fLng)) return false;

    currentLat = Number(fLat.toFixed(6));
    currentLng = Number(fLng.toFixed(6));

    const elCoordDisplay = document.getElementById('store-coord-display');
    if (elCoordDisplay) {
        elCoordDisplay.innerText = `${currentLat.toFixed(6)}, ${currentLng.toFixed(6)}`;
    }

    const inpLat = document.getElementById('store-input-lat');
    if (inpLat && document.activeElement !== inpLat) {
        inpLat.value = currentLat.toFixed(6);
    }
    const inpLng = document.getElementById('store-input-lng');
    if (inpLng && document.activeElement !== inpLng) {
        inpLng.value = currentLng.toFixed(6);
    }

    return true;
}

export function setKoordinatWarungAktif(lat, lng) {
    return tetapkanTitikLokasi(lat, lng);
}

export function inisialisasiKoordinatWarung(initialLat, initialLng) {
    const fLat = parseKoordinatAman(initialLat);
    const fLng = parseKoordinatAman(initialLng);
    if (isValidIndonesiaCoord(fLat, fLng)) {
        currentLat = fLat;
        currentLng = fLng;
    }
    tetapkanTitikLokasi(currentLat, currentLng);
}

function parsePlaceAndAddressFromLongUrl(rawUrl) {
    let placeName = '';
    let address = '';
    try {
        const decoded = decodeURIComponent(String(rawUrl || '').replace(/\+/g, ' '));
        const placeMatch = decoded.match(/\/maps\/(?:place|search)\/([^\/@?]+)/i);
        if (placeMatch && placeMatch[1]) {
            const candidate = placeMatch[1].trim();
            if (!/^-?\d{1,2}\.\d+\s*,\s*\d{2,3}\.\d+$/.test(candidate)) {
                const parts = candidate.split(/\s*,\s*/);
                placeName = cleanExtractedAddress(parts[0]);
                if (parts.length >= 2) {
                    address = cleanExtractedAddress(candidate);
                } else {
                    address = placeName;
                }
            }
        }
    } catch (e) {}
    return { placeName, address };
}

/**
 * Ekstraksi Koordinat Lokal 0-Kuota dari URL panjang Google Maps atau angka koordinat
 */
function tryExtractLocalCoordinatesZeroQuota(text) {
    // 1. Pola Pin Akurat !3d<lat>!4d<lng>
    const pin3dMatch = text.match(/!3d(-?\d+\.\d+)!4d(-?\d+\.\d+)/);
    if (pin3dMatch) {
        const lat = parseKoordinatAman(pin3dMatch[1]);
        const lng = parseKoordinatAman(pin3dMatch[2]);
        if (isValidIndonesiaCoord(lat, lng)) {
            const urlMeta = parsePlaceAndAddressFromLongUrl(text);
            return {
                lat: Number(lat.toFixed(6)),
                lng: Number(lng.toFixed(6)),
                geohash: encodeGeohash(lat, lng, 6),
                address: urlMeta.address || urlMeta.placeName || '',
                placeName: urlMeta.placeName || '',
                method: 'LOCAL_PIN_3D4D_ZERO_QUOTA'
            };
        }
    }

    // 1b. Pola Pin !2d<lng>!3d<lat>
    const pin2d3dMatch = text.match(/!2d(-?\d+\.\d+)!3d(-?\d+\.\d+)/);
    if (pin2d3dMatch) {
        const lng = parseKoordinatAman(pin2d3dMatch[1]);
        const lat = parseKoordinatAman(pin2d3dMatch[2]);
        if (isValidIndonesiaCoord(lat, lng)) {
            const urlMeta = parsePlaceAndAddressFromLongUrl(text);
            return {
                lat: Number(lat.toFixed(6)),
                lng: Number(lng.toFixed(6)),
                geohash: encodeGeohash(lat, lng, 6),
                address: urlMeta.address || urlMeta.placeName || '',
                placeName: urlMeta.placeName || '',
                method: 'LOCAL_PIN_2D3D_ZERO_QUOTA'
            };
        }
    }

    // 2. Pola Parameter Query (?q=, ?ll=, ?query=, ?destination=)
    const queryCoordMatch = text.match(/[?&](?:q|ll|query|destination|daddr|saddr)=(-?\d{1,2}\.\d+)(?:,|%2C|\s+)(-?\d{2,3}\.\d+)/i);
    if (queryCoordMatch) {
        const lat = parseKoordinatAman(queryCoordMatch[1]);
        const lng = parseKoordinatAman(queryCoordMatch[2]);
        if (isValidIndonesiaCoord(lat, lng)) {
            const urlMeta = parsePlaceAndAddressFromLongUrl(text);
            return {
                lat: Number(lat.toFixed(6)),
                lng: Number(lng.toFixed(6)),
                geohash: encodeGeohash(lat, lng, 6),
                address: urlMeta.address || urlMeta.placeName || '',
                placeName: urlMeta.placeName || '',
                method: 'LOCAL_QUERY_PARAM_ZERO_QUOTA'
            };
        }
    }

    // 3. Pola Kamera @<lat>,<lng>
    const atCoordMatch = text.match(/@(-?\d{1,2}\.\d+),(-?\d{2,3}\.\d+)/);
    if (atCoordMatch) {
        const lat = parseKoordinatAman(atCoordMatch[1]);
        const lng = parseKoordinatAman(atCoordMatch[2]);
        if (isValidIndonesiaCoord(lat, lng)) {
            const urlMeta = parsePlaceAndAddressFromLongUrl(text);
            return {
                lat: Number(lat.toFixed(6)),
                lng: Number(lng.toFixed(6)),
                geohash: encodeGeohash(lat, lng, 6),
                address: urlMeta.address || urlMeta.placeName || '',
                placeName: urlMeta.placeName || '',
                method: 'LOCAL_AT_COORD_ZERO_QUOTA'
            };
        }
    }

    // 4. Pola Angka Koordinat Langsung (-7.768049, 112.196514)
    const directMatch = text.match(/(-?\d{1,2}[.,]\d{3,15})\s*[,\s;]+\s*(\d{2,3}[.,]\d{3,15})/);
    if (directMatch && !/^https?:\/\//i.test(text)) {
        const lat = parseKoordinatAman(directMatch[1]);
        const lng = parseKoordinatAman(directMatch[2]);
        if (isValidIndonesiaCoord(lat, lng)) {
            return {
                lat: Number(lat.toFixed(6)),
                lng: Number(lng.toFixed(6)),
                geohash: encodeGeohash(lat, lng, 6),
                address: '',
                placeName: '',
                method: 'DIRECT_COORD_ZERO_QUOTA'
            };
        }
    }

    return null;
}

async function panggilUnfurlGasJapar(targetInput) {
    const cleanTarget = String(targetInput || '').trim();
    if (!cleanTarget) return null;

    const cachedByTarget = readLocalGmapsCache(cleanTarget);
    if (cachedByTarget && (cachedByTarget.address || cachedByTarget.shortStreet)) {
        return cachedByTarget;
    }

    if (inflightUnfurlPromises[cleanTarget]) {
        return inflightUnfurlPromises[cleanTarget];
    }

    const promise = (async () => {
        try {
            const requestUrl = `${JAPAR_GAS_MAPS_URL}?action=unfurl&url=${encodeURIComponent(cleanTarget)}`;
            const resp = await fetch(requestUrl, {
                method: 'GET',
                redirect: 'follow'
            });
            if (!resp.ok) return null;
            const data = await resp.json().catch(() => null);
            if (!data) return null;

            const rLat = parseKoordinatAman(data.lat);
            const rLng = parseKoordinatAman(data.lng);
            if (!isValidIndonesiaCoord(rLat, rLng)) return null;

            const urlMeta = parsePlaceAndAddressFromLongUrl(data.finalUrl || data.resolvedUrl || '');
            let street = cleanExtractedAddress(data.street || '');
            let subdistrict = cleanExtractedAddress(data.subdistrict || '');
            let city = cleanExtractedAddress(data.city || '');
            let shortStreet = cleanExtractedAddress(data.shortStreet || [street, subdistrict, city].filter(Boolean).join(', '));
            let finalAddr = cleanExtractedAddress(data.address || data.formattedAddress || shortStreet || urlMeta.address || data.placeName || urlMeta.placeName || '');
            const finalPlace = cleanExtractedAddress(data.placeName || urlMeta.placeName || '');

            if (!isAddressCompleteWithStreet(finalAddr, finalPlace)) {
                const revExtra = await resolusiNamaJalanKoordinatViaGas(rLat, rLng);
                if (revExtra) {
                    street = revExtra.street || street;
                    subdistrict = revExtra.subdistrict || subdistrict;
                    city = revExtra.city || city;
                    shortStreet = revExtra.shortStreet || shortStreet;
                    finalAddr = revExtra.address || revExtra.shortStreet || finalAddr;
                }
            }

            const resolvedObj = {
                lat: Number(rLat.toFixed(6)),
                lng: Number(rLng.toFixed(6)),
                geohash: String(data.geohash || encodeGeohash(rLat, rLng, 6)),
                address: finalAddr || shortStreet || finalPlace,
                shortStreet: shortStreet || finalAddr,
                street,
                subdistrict,
                city,
                placeName: finalPlace,
                method: data.method || 'GAS_UNFURL'
            };

            writeLocalGmapsCache(cleanTarget, resolvedObj);
            return resolvedObj;
        } catch (e) {
            return null;
        } finally {
            delete inflightUnfurlPromises[cleanTarget];
        }
    })();

    inflightUnfurlPromises[cleanTarget] = promise;
    return promise;
}

/**
 * Ekstrak Koordinat & Nama Jalan dari 3 Skenario Input:
 * a) Link Google Maps (`maps.app.goo.gl/...` atau `google.com/maps/...`)
 * b) Kode Plus (`Plus Code`, contoh: `75JX+8J Pare, Kediri`)
 * c) Koordinat Angka (`-7.768049, 112.196514`)
 */
export async function ekstrakKoordinatDariTeksAtauLinkGmaps(rawInput) {
    const text = String(rawInput || '').trim();
    if (!text) return null;

    const cached = readLocalGmapsCache(text);
    if (cached && isAddressCompleteWithStreet(cached.address || cached.shortStreet, cached.placeName)) {
        return cached;
    }

    // Skenario A1 & C: Cek apakah koordinat bisa diekstrak secara lokal (URL panjang Google Maps atau angka koordinat langsung)
    const localResolved = tryExtractLocalCoordinatesZeroQuota(text);
    if (localResolved && isValidIndonesiaCoord(localResolved.lat, localResolved.lng)) {
        if (!isAddressCompleteWithStreet(localResolved.address, localResolved.placeName)) {
            const revData = await resolusiNamaJalanKoordinatViaGas(localResolved.lat, localResolved.lng);
            if (revData) {
                localResolved.address = revData.address || revData.shortStreet || localResolved.address || '';
                localResolved.shortStreet = revData.shortStreet || revData.address || '';
                localResolved.street = revData.street || '';
                localResolved.subdistrict = revData.subdistrict || '';
                localResolved.city = revData.city || '';
                if (!localResolved.placeName && revData.placeName) {
                    localResolved.placeName = revData.placeName;
                }
                localResolved.fromCache = Boolean(revData.fromCache);
            }
        }
        writeLocalGmapsCache(text, localResolved);
        return localResolved;
    }

    // Skenario A2: Input Link Google Maps (khususnya shortlink `maps.app.goo.gl` / `goo.gl/maps`)
    const urlMatch = text.match(/https?:\/\/[^\s"'<>]+/i);
    if (urlMatch) {
        const targetUrl = urlMatch[0];
        const unfurled = await panggilUnfurlGasJapar(targetUrl);
        if (unfurled) {
            writeLocalGmapsCache(text, unfurled);
            return unfurled;
        }
        return null;
    }

    // Skenario B: Input Kode Plus (Plus Code, contoh: `75JX+8J Pare, Kediri`)
    if (PLUS_CODE_REGEX.test(text)) {
        const plusResolved = await panggilUnfurlGasJapar(text);
        if (plusResolved) {
            writeLocalGmapsCache(text, plusResolved);
            return plusResolved;
        }
        return null;
    }

    // Fallback teks nama tempat/jalan jika diketik langsung
    if (text.length >= 4) {
        const textResolved = await panggilUnfurlGasJapar(text);
        if (textResolved) {
            writeLocalGmapsCache(text, textResolved);
            return textResolved;
        }
    }

    return null;
}

export function renderKotakPreviewLokasiGmaps(previewBoxEl, resObj) {
    if (!previewBoxEl || !resObj || !isValidIndonesiaCoord(resObj.lat, resObj.lng)) return;
    const streetText = String(resObj.shortStreet || resObj.address || resObj.placeName || '').trim();
    const fullAddrText = String(resObj.address || resObj.shortStreet || '').trim();
    const detailSub = [resObj.street, resObj.subdistrict, resObj.city].filter(Boolean).join(' • ');

    previewBoxEl.classList.remove('hidden-state');
    previewBoxEl.innerHTML = `
        <div class="flex items-start justify-between gap-2">
            <div class="min-w-0 flex-1">
                <div class="text-emerald-400 font-extrabold text-[0.66rem] uppercase flex items-center gap-1 flex-wrap">
                    <i class="fa-solid fa-circle-check"></i>
                    <span>Titik &amp; Nama Jalan Berhasil Ditemukan</span>
                </div>
                <div class="font-mono text-amber-300 font-bold text-xs mt-0.5">${Number(resObj.lat).toFixed(6)}, ${Number(resObj.lng).toFixed(6)}</div>
                ${streetText ? `<div class="text-white font-bold text-[0.68rem] mt-1"><i class="fa-solid fa-road text-orange-400 mr-1"></i>${streetText}</div>` : ''}
                ${fullAddrText && fullAddrText !== streetText ? `<div class="text-stone-300 text-[0.62rem] mt-0.5 leading-snug"><i class="fa-solid fa-location-dot text-emerald-400 mr-1"></i>${fullAddrText}</div>` : ''}
                ${detailSub ? `<div class="text-stone-400 text-[0.58rem] mt-0.5 font-mono">${detailSub}</div>` : ''}
            </div>
        </div>
    `;
}

export function isikanOtomatisKolomAlamatResto(resObj, targetInputId = 'store-input-alamat') {
    if (!resObj) return '';
    const bestStreetAddr = String(resObj.address || resObj.shortStreet || resObj.placeName || '').trim().substring(0, 120);
    if (!bestStreetAddr) return '';

    const inpAlamat = document.getElementById(targetInputId);
    if (inpAlamat) {
        inpAlamat.value = bestStreetAddr;
        inpAlamat.dispatchEvent(new Event('input', { bubbles: true }));
    }
    return bestStreetAddr;
}

export function pasangEventPenentuLokasiWarung(onCoordChangedCb = null) {
    const btnPasteGmaps = document.getElementById('btn-paste-merchant-gmaps');
    const inpGmapsRaw = document.getElementById('input-merchant-gmaps-raw');
    const btnExtractGmaps = document.getElementById('btn-extract-merchant-gmaps');
    const previewBox = document.getElementById('merchant-gmaps-preview');
    const btnUseDeviceGps = document.getElementById('btn-use-device-gps');
    const inpLat = document.getElementById('store-input-lat');
    const inpLng = document.getElementById('store-input-lng');

    if (btnPasteGmaps && inpGmapsRaw) {
        btnPasteGmaps.addEventListener('click', async () => {
            picuGetarSentuh(10);
            try {
                if (navigator.clipboard && typeof navigator.clipboard.readText === 'function') {
                    const clipText = await navigator.clipboard.readText();
                    if (clipText && clipText.trim()) {
                        inpGmapsRaw.value = clipText.trim();
                        if (btnExtractGmaps) btnExtractGmaps.click();
                        return;
                    }
                }
                if (inpGmapsRaw.value && inpGmapsRaw.value.trim() && btnExtractGmaps) {
                    btnExtractGmaps.click();
                    return;
                }
                inpGmapsRaw.focus();
                window.showToast('Tekan tahan pada kolom lalu pilih Tempel (Paste), kemudian ketuk Ekstrak.', 'info');
            } catch (e) {
                if (inpGmapsRaw.value && inpGmapsRaw.value.trim() && btnExtractGmaps) {
                    btnExtractGmaps.click();
                    return;
                }
                inpGmapsRaw.focus();
                window.showToast('Tekan tahan pada kolom lalu pilih Tempel (Paste), kemudian ketuk Ekstrak.', 'info');
            }
        });
    }

    if (btnExtractGmaps && inpGmapsRaw) {
        btnExtractGmaps.addEventListener('click', async () => {
            picuGetarSentuh(12);
            let rawVal = (inpGmapsRaw.value || '').trim();
            if (!rawVal && navigator.clipboard && typeof navigator.clipboard.readText === 'function') {
                try {
                    const clip = await navigator.clipboard.readText();
                    if (clip && clip.trim()) {
                        rawVal = clip.trim();
                        inpGmapsRaw.value = rawVal;
                    }
                } catch (e) {}
            }
            if (!rawVal) {
                return window.alert('Tempelkan Link Google Maps, Kode Plus (Plus Code), atau angka koordinat terlebih dahulu.', 'warning');
            }

            const origHtml = btnExtractGmaps.innerHTML;
            btnExtractGmaps.disabled = true;
            btnExtractGmaps.innerHTML = `<i class="fa-solid fa-circle-notch fa-spin mr-1"></i> Mengekstrak Jalan...`;

            try {
                const res = await ekstrakKoordinatDariTeksAtauLinkGmaps(rawVal);
                if (res && isValidIndonesiaCoord(res.lat, res.lng)) {
                    tetapkanTitikLokasi(res.lat, res.lng);
                    const autoFilledAddr = isikanOtomatisKolomAlamatResto(res, 'store-input-alamat');
                    renderKotakPreviewLokasiGmaps(previewBox, res);

                    if (typeof onCoordChangedCb === 'function') {
                        onCoordChangedCb(res);
                    }
                    window.showToast(
                        autoFilledAddr
                            ? `Lokasi & Alamat berhasil diisi otomatis: ${autoFilledAddr}`
                            : `Titik lokasi resto ditetapkan: ${res.lat.toFixed(5)}, ${res.lng.toFixed(5)}`,
                        'success'
                    );
                } else {
                    window.alert('Koordinat tidak ditemukan. Pastikan menempelkan Link Bagikan Google Maps (maps.app.goo.gl), Kode Plus (contoh: 75JX+8J Pare, Kediri), atau koordinat -7.768049, 112.196514.', 'warning');
                }
            } finally {
                btnExtractGmaps.disabled = false;
                btnExtractGmaps.innerHTML = origHtml;
            }
        });
    }

    if (btnUseDeviceGps) {
        btnUseDeviceGps.addEventListener('click', () => {
            picuGetarSentuh(14);
            const vault = document.getElementById('vault-lokasi-peta');
            if (vault && vault.classList.contains('is-vault-locked')) {
                if (typeof window.mintaVerifikasiCaptchaKeamanan === 'function') {
                    window.mintaVerifikasiCaptchaKeamanan(
                        'Buka Gembok Titik Lokasi',
                        'Buka gembok keamanan terlebih dahulu sebelum mengambil titik GPS perangkat:',
                        () => {}
                    );
                }
                return;
            }
            if (!navigator.geolocation) {
                return window.alert('Perangkat atau browser ini tidak mendukung sensor GPS.', 'error');
            }
            const origHtml = btnUseDeviceGps.innerHTML;
            btnUseDeviceGps.disabled = true;
            btnUseDeviceGps.innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i> Membaca GPS & Nama Jalan...`;

            navigator.geolocation.getCurrentPosition(
                async (pos) => {
                    try {
                        const lat = pos.coords.latitude;
                        const lng = pos.coords.longitude;
                        if (tetapkanTitikLokasi(lat, lng)) {
                            const revRes = await resolusiNamaJalanKoordinatViaGas(lat, lng);
                            const mergedRes = {
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
                            const filledAddr = isikanOtomatisKolomAlamatResto(mergedRes, 'store-input-alamat');
                            renderKotakPreviewLokasiGmaps(previewBox, mergedRes);

                            if (typeof onCoordChangedCb === 'function') {
                                onCoordChangedCb(mergedRes);
                            }
                            window.showToast(
                                filledAddr
                                    ? `GPS & Nama Jalan diterapkan: ${filledAddr}`
                                    : `Koordinat GPS perangkat diterapkan: ${lat.toFixed(5)}, ${lng.toFixed(5)}`,
                                'success'
                            );
                        } else {
                            window.alert('Koordinat GPS berada di luar cakupan wilayah Indonesia.', 'warning');
                        }
                    } finally {
                        btnUseDeviceGps.disabled = false;
                        btnUseDeviceGps.innerHTML = origHtml;
                    }
                },
                (err) => {
                    btnUseDeviceGps.disabled = false;
                    btnUseDeviceGps.innerHTML = origHtml;
                    window.alert('Gagal membaca sensor GPS perangkat: ' + err.message, 'warning');
                },
                { enableHighAccuracy: true, timeout: 10000, maximumAge: 60000 }
            );
        });
    }

    const handleManualCoordInput = async () => {
        if (!inpLat || !inpLng) return;
        const nLat = parseKoordinatAman(inpLat.value);
        const nLng = parseKoordinatAman(inpLng.value);
        if (isValidIndonesiaCoord(nLat, nLng)) {
            tetapkanTitikLokasi(nLat, nLng);
            const revRes = await resolusiNamaJalanKoordinatViaGas(nLat, nLng);
            const payload = {
                lat: Number(nLat.toFixed(6)),
                lng: Number(nLng.toFixed(6)),
                geohash: encodeGeohash(nLat, nLng, 6),
                address: revRes ? (revRes.address || revRes.shortStreet || '') : '',
                shortStreet: revRes ? (revRes.shortStreet || revRes.address || '') : '',
                street: revRes ? (revRes.street || '') : '',
                subdistrict: revRes ? (revRes.subdistrict || '') : '',
                city: revRes ? (revRes.city || '') : '',
                fromCache: Boolean(revRes && revRes.fromCache)
            };
            if (payload.address || payload.shortStreet) {
                isikanOtomatisKolomAlamatResto(payload, 'store-input-alamat');
                renderKotakPreviewLokasiGmaps(previewBox, payload);
            }
            if (typeof onCoordChangedCb === 'function') {
                onCoordChangedCb(payload);
            }
        }
    };

    if (inpLat) inpLat.addEventListener('change', handleManualCoordInput);
    if (inpLng) inpLng.addEventListener('change', handleManualCoordInput);
}
