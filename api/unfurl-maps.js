// ==========================================================================
// FILE: api/unfurl-maps.js (FALLBACK ENDPOINT - JAPAR PANEL)
// FUNGSI: Cadangan apabila endpoint utama Google Apps Script (JAPAR_GAS_MAPS_URL)
//         sedang mengalami gangguan jaringan.
// ==========================================================================

const JAPAR_GAS_ENDPOINT = "https://script.google.com/macros/s/AKfycbwEDdv6dBZ878K93thmk5MgdfqZieEHA_wLXprJfe29EZ5lghRsoP-APysm2HcrK6q8/exec";

function isValidIndonesiaCoord(lat, lng) {
    return (
        typeof lat === 'number' &&
        typeof lng === 'number' &&
        !isNaN(lat) &&
        !isNaN(lng) &&
        lat >= -11.5 &&
        lat <= 6.5 &&
        lng >= 94.5 &&
        lng <= 141.5
    );
}

export default async function handler(req, res) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    res.setHeader('Cache-Control', 'public, s-maxage=86400, stale-while-revalidate=604800');

    if (req.method === 'OPTIONS') {
        return res.status(200).end();
    }

    const shortUrl = String(req.query?.url || req.body?.url || '').trim();
    if (!shortUrl) {
        return res.status(400).json({ ok: false, error: 'Parameter url diperlukan' });
    }

    try {
        const gasRes = await fetch(`${JAPAR_GAS_ENDPOINT}?action=unfurl&url=${encodeURIComponent(shortUrl)}`, {
            method: 'GET',
            redirect: 'follow'
        });
        if (gasRes.ok) {
            const data = await gasRes.json().catch(() => null);
            if (data && data.ok && isValidIndonesiaCoord(Number(data.lat), Number(data.lng))) {
                return res.status(200).json(data);
            }
        }
    } catch (e) {}

    return res.status(422).json({
        ok: false,
        error: 'Koordinat dan alamat belum ditemukan pada tautan tersebut.'
    });
}
