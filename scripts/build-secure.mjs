// ==========================================================================
// FILE: scripts/build-secure.mjs (JAPAR PANEL COMPILER v4.0 - DUAL-NODE SHARDING)
// FUNGSI:
//   1. Enkripsi Kredensial Multi-Node Server (JAPAR_CLUSTER_NODES, firebaseConfigNode1,
//      firebaseConfigNode2, ROOT_ADMIN_UIDS, cloudinaryConfig, & JAPAR_GAS_MAPS_URL) -> RC4 + XOR Vault
//   2. Bundling 8 Modul JS Panel -> Single-IIFE Closure (dist/js/japar-panel.min.js)
//      tanpa merusak binding event DOM (window/document native)
//   3. Validasi AST & Integritas Sintaksis + Penyalinan Utuh css/style.css dan css/components.css ke dist/css/
// ==========================================================================

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, '..');
const DIST_DIR = path.join(ROOT_DIR, 'dist');

function loadOptionalModule(modName) {
    const searchPaths = [
        ROOT_DIR,
        path.join(ROOT_DIR, 'node_modules'),
        '/usr/share/nodejs',
        '/usr/local/lib/node_modules',
        '/usr/lib/nodejs'
    ];
    for (const base of searchPaths) {
        try {
            const req = createRequire(path.join(base, 'noop.js'));
            return req(modName);
        } catch (e) {}
    }
    return null;
}

const acorn = loadOptionalModule('acorn');
const terser = loadOptionalModule('terser');

function buildRuntimeCredentialsConfig() {
    const firebaseConfigNode1 = {
        apiKey: "AIzaSyBOCoI-PzDg89AZmAWjryioJj1hIBPuLso",
        authDomain: "japar-b1c5d.firebaseapp.com",
        databaseURL: "https://japar-b1c5d-default-rtdb.asia-southeast1.firebasedatabase.app",
        projectId: "japar-b1c5d",
        storageBucket: "japar-b1c5d.firebasestorage.app",
        messagingSenderId: "332026051029",
        appId: "1:332026051029:web:281bc141eb6ff58f9f255c"
    };
    const ROOT_ADMIN_UID_N1 = "90dvLpzZq6RrPXOJm3HoqDAkao73";

    const firebaseConfigNode2 = {
        apiKey: "AIzaSyD1YmNrYAwTOcBGSozKKDztUr8fC0C-lKQ",
        authDomain: "japar-2.firebaseapp.com",
        databaseURL: "https://japar-2-default-rtdb.asia-southeast1.firebasedatabase.app",
        projectId: "japar-2",
        storageBucket: "japar-2.firebasestorage.app",
        messagingSenderId: "805858048959",
        appId: "1:805858048959:web:2f017343aba69c89d67f0a"
    };
    const ROOT_ADMIN_UID_N2 = "q0HllfTc6bOT7Ps8DIvISjEoRjm1";

    const JAPAR_CLUSTER_NODES = {
        N1: { id: "N1", label: "Server 1 (Utama)", config: firebaseConfigNode1, adminUid: ROOT_ADMIN_UID_N1 },
        N2: { id: "N2", label: "Server 2 (Ekspansi)", config: firebaseConfigNode2, adminUid: ROOT_ADMIN_UID_N2 }
    };
    const ROOT_ADMIN_UIDS = [ROOT_ADMIN_UID_N1, ROOT_ADMIN_UID_N2];

    const firebaseConfig = firebaseConfigNode1;

    const cloudinaryConfig = {
        cloudName: "odo6kdaz",
        uploadPreset: "my-archivestory",
        uploadEndpoint: "https://api.cloudinary.com/v1_1/odo6kdaz/image/upload",
        deliveryBaseUrl: "https://res.cloudinary.com/odo6kdaz/image/upload/f_auto,q_auto,w_400/"
    };

    const DEFAULT_CENTER_PARE = { lat: -7.768049, lng: 112.196514 };
    const JAPAR_GAS_MAPS_URL = "https://script.google.com/macros/s/AKfycbwEDdv6dBZ878K93thmk5MgdfqZieEHA_wLXprJfe29EZ5lghRsoP-APysm2HcrK6q8/exec";
    const UNFURL_MAPS_API_URL = JAPAR_GAS_MAPS_URL;
    const ROOT_ADMIN_UID = ROOT_ADMIN_UID_N1;
    const ADMIN_WA_NUMBER = "6282225225141";

    return {
        firebaseConfigNode1,
        ROOT_ADMIN_UID_N1,
        firebaseConfigNode2,
        ROOT_ADMIN_UID_N2,
        JAPAR_CLUSTER_NODES,
        ROOT_ADMIN_UIDS,
        firebaseConfig,
        cloudinaryConfig,
        configMerchant: firebaseConfigNode1,
        configAktif: firebaseConfigNode1,
        DEFAULT_CENTER_PARE,
        JAPAR_GAS_MAPS_URL,
        UNFURL_MAPS_API_URL,
        ROOT_ADMIN_UID,
        ADMIN_WA_NUMBER
    };
}

function rc4XorEncryptBytes(plainTextStr, keyBytes, xorSeed) {
    const inputBytes = Buffer.from(plainTextStr, 'utf8');
    const S = new Uint8Array(256);
    for (let i = 0; i < 256; i++) S[i] = i;
    let j = 0;
    for (let i = 0; i < 256; i++) {
        j = (j + S[i] + keyBytes[i % keyBytes.length]) & 0xff;
        const tmp = S[i];
        S[i] = S[j];
        S[j] = tmp;
    }
    let i = 0;
    j = 0;
    const out = [];
    for (let idx = 0; idx < inputBytes.length; idx++) {
        i = (i + 1) & 0xff;
        j = (j + S[i]) & 0xff;
        const tmp = S[i];
        S[i] = S[j];
        S[j] = tmp;
        const k = S[(S[i] + S[j]) & 0xff];
        const rollingXor = (xorSeed + ((idx * 31) & 0xff)) & 0xff;
        out.push((inputBytes[idx] ^ k ^ rollingXor) & 0xff);
    }
    return out;
}

function generateConfigVaultBlock(configObj) {
    const jsonStr = JSON.stringify(configObj);
    const keyBytes = Array.from(crypto.randomBytes(16));
    const xorSeed = crypto.randomInt(17, 241);
    const encryptedBytes = rc4XorEncryptBytes(jsonStr, keyBytes, xorSeed);

    return `
    const __JAPAR_CONFIG_VAULT__ = [${encryptedBytes.join(',')}];
    const __JAPAR_VAULT_KEY__ = [${keyBytes.join(',')}];
    const __JAPAR_VAULT_SEED__ = ${xorSeed};
    const {
        firebaseConfigNode1,
        ROOT_ADMIN_UID_N1,
        firebaseConfigNode2,
        ROOT_ADMIN_UID_N2,
        JAPAR_CLUSTER_NODES,
        ROOT_ADMIN_UIDS,
        firebaseConfig,
        cloudinaryConfig,
        configMerchant,
        configAktif,
        DEFAULT_CENTER_PARE,
        JAPAR_GAS_MAPS_URL,
        UNFURL_MAPS_API_URL,
        ROOT_ADMIN_UID,
        ADMIN_WA_NUMBER
    } = (function(_v, _k, _seed) {
        const _s = new Uint8Array(256);
        for (let _i = 0; _i < 256; _i++) _s[_i] = _i;
        let _j = 0;
        for (let _i = 0; _i < 256; _i++) {
            _j = (_j + _s[_i] + _k[_i % _k.length]) & 255;
            const _t = _s[_i]; _s[_i] = _s[_j]; _s[_j] = _t;
        }
        let _x = 0; _j = 0;
        const _out = new Uint8Array(_v.length);
        for (let _p = 0; _p < _v.length; _p++) {
            _x = (_x + 1) & 255;
            _j = (_j + _s[_x]) & 255;
            const _t = _s[_x]; _s[_x] = _s[_j]; _s[_j] = _t;
            const _ks = _s[(_s[_x] + _s[_j]) & 255];
            const _rx = (_seed + ((_p * 31) & 255)) & 255;
            _out[_p] = (_v[_p] ^ _ks ^ _rx) & 255;
            _v[_p] = 0;
        }
        _k.fill(0);
        const _raw = new TextDecoder().decode(_out);
        _out.fill(0);
        return JSON.parse(_raw);
    })(__JAPAR_CONFIG_VAULT__, __JAPAR_VAULT_KEY__, __JAPAR_VAULT_SEED__);
`;
}

const PANEL_MODULES_ORDER = [
    'js/config/credentials.js',
    'js/utils/ui-components.js',
    'js/utils/math-engine.js',
    'js/core/firebase-config.js',
    'js/modules/location-picker.js',
    'js/modules/menu-catalog.js',
    'js/core/auth.js',
    'js/modules/dashboard.js'
];

function stripImportsAndExportsPureJs(moduleRelPath, code, cdnImportsMap) {
    const importRegex = /^\s*import\s+\{([\s\S]*?)\}\s+from\s+['"]([^'"]+)['"]\s*;?\s*$/gm;
    let match;
    while ((match = importRegex.exec(code)) !== null) {
        const specBlock = match[1];
        const src = String(match[2] || '').trim();
        if (src.startsWith('https://www.gstatic.com/firebasejs/')) {
            if (!cdnImportsMap.has(src)) {
                cdnImportsMap.set(src, new Map());
            }
            const specMap = cdnImportsMap.get(src);
            const parts = specBlock.split(',').map(s => s.trim()).filter(Boolean);
            for (const part of parts) {
                const asMatch = part.match(/^([A-Za-z0-9_$]+)\s+as\s+([A-Za-z0-9_$]+)$/);
                if (asMatch) {
                    specMap.set(asMatch[2], `${asMatch[1]} as ${asMatch[2]}`);
                } else {
                    specMap.set(part, part);
                }
            }
        }
    }

    let transformed = code
        .replace(/^\s*import\s+[\s\S]*?from\s+['"][^'"]+['"]\s*;?\s*$/gm, '')
        .replace(/^\s*export\s+(?=(?:async\s+)?function\b|(?:const|let|var|class)\b)/gm, '')
        .replace(/^\s*export\s+default\s+/gm, '')
        .replace(/^\s*export\s+\{[^}]*\}\s*;?\s*$/gm, '');

    return `\n// --- [MODULE: ${moduleRelPath}] ---\n` + transformed.trim() + '\n';
}

function stripImportsAndExports(moduleRelPath, code, cdnImportsMap) {
    if (!acorn) {
        return stripImportsAndExportsPureJs(moduleRelPath, code, cdnImportsMap);
    }
    const ast = acorn.parse(code, { ecmaVersion: 'latest', sourceType: 'module' });
    const edits = [];

    for (const node of ast.body) {
        if (node.type === 'ImportDeclaration') {
            const src = String(node.source.value || '');
            if (src.startsWith('https://www.gstatic.com/firebasejs/')) {
                if (!cdnImportsMap.has(src)) {
                    cdnImportsMap.set(src, new Map());
                }
                const specMap = cdnImportsMap.get(src);
                for (const spec of node.specifiers) {
                    if (spec.type === 'ImportSpecifier') {
                        const importedName = spec.imported.name;
                        const localName = spec.local.name;
                        const specKey = importedName === localName
                            ? importedName
                            : `${importedName} as ${localName}`;
                        specMap.set(localName, specKey);
                    }
                }
            }
            edits.push({ start: node.start, end: node.end, replacement: '' });
        } else if (node.type === 'ExportNamedDeclaration') {
            if (node.declaration) {
                edits.push({
                    start: node.start,
                    end: node.declaration.start,
                    replacement: ''
                });
            } else {
                edits.push({
                    start: node.start,
                    end: node.end,
                    replacement: ''
                });
            }
        } else if (node.type === 'ExportDefaultDeclaration') {
            edits.push({
                start: node.start,
                end: node.declaration.start,
                replacement: ''
            });
        }
    }

    edits.sort((a, b) => b.start - a.start);
    let transformed = code;
    for (const ed of edits) {
        transformed = transformed.slice(0, ed.start) + ed.replacement + transformed.slice(ed.end);
    }
    return `\n// --- [MODULE: ${moduleRelPath}] ---\n` + transformed.trim() + '\n';
}

function buildSingleIifeBundleSource() {
    const cdnImportsMap = new Map();
    const runtimeConfig = buildRuntimeCredentialsConfig();
    const moduleBodies = [];

    for (const relPath of PANEL_MODULES_ORDER) {
        if (relPath === 'js/config/credentials.js') {
            moduleBodies.push(generateConfigVaultBlock(runtimeConfig));
            continue;
        }
        const fullPath = path.join(ROOT_DIR, relPath);
        const rawCode = fs.readFileSync(fullPath, 'utf8');
        const cleaned = stripImportsAndExports(relPath, rawCode, cdnImportsMap);
        moduleBodies.push(cleaned);
    }

    const cdnImportLines = [];
    for (const [srcUrl, specMap] of cdnImportsMap.entries()) {
        const specList = Array.from(specMap.values());
        cdnImportLines.push(`import { ${specList.join(', ')} } from "${srcUrl}";`);
    }

    const bundleSource = `
${cdnImportLines.join('\n')}

(function() {
    "use strict";
    ${moduleBodies.join('\n')}
})();
`;
    return bundleSource.trim();
}

function rc4TransformHex(str, key) {
    const s = new Uint8Array(256);
    for (let i = 0; i < 256; i++) s[i] = i;
    let j = 0;
    for (let i = 0; i < 256; i++) {
        j = (j + s[i] + key.charCodeAt(i % key.length)) & 0xff;
        const t = s[i];
        s[i] = s[j];
        s[j] = t;
    }
    const utf8Bytes = Buffer.from(str, 'utf8');
    let i = 0;
    j = 0;
    const out = Buffer.alloc(utf8Bytes.length);
    for (let p = 0; p < utf8Bytes.length; p++) {
        i = (i + 1) & 0xff;
        j = (j + s[i]) & 0xff;
        const t = s[i];
        s[i] = s[j];
        s[j] = t;
        const k = s[(s[i] + s[j]) & 0xff];
        out[p] = utf8Bytes[p] ^ k;
    }
    return out.toString('base64');
}

function applyAstRc4Obfuscation(sourceCode, isModule = true) {
    if (!acorn) {
        return sourceCode;
    }
    const ast = acorn.parse(sourceCode, {
        ecmaVersion: 'latest',
        sourceType: isModule ? 'module' : 'script'
    });

    let codeStartOffset = 0;
    if (isModule) {
        for (const node of ast.body) {
            if (node.type === 'ImportDeclaration') {
                codeStartOffset = Math.max(codeStartOffset, node.end);
            }
        }
    }

    const keyPool = [
        'jpr9K2', 'x7VqP1', 'r4LmN8', 'z2WcF5',
        'k8HtD3', 'p5JnY9', 'm3QsB6', 'v9RxG4'
    ];
    const encryptedPool = [];
    const poolIndexMap = new Map();
    const replacements = [];

    function walk(node, parent, propName) {
        if (!node || typeof node !== 'object') return;

        if (
            node.type === 'Literal' &&
            typeof node.value === 'string' &&
            node.start >= codeStartOffset
        ) {
            const val = node.value;
            const isDirective =
                parent &&
                (parent.type === 'ExpressionStatement' || parent.type === 'Program' || parent.type === 'BlockStatement') &&
                val === 'use strict';
            const isImportSource =
                parent &&
                (parent.type === 'ImportDeclaration' || parent.type === 'ExportNamedDeclaration' || parent.type === 'ExportAllDeclaration' || parent.type === 'ImportExpression') &&
                propName === 'source';

            if (!isDirective && !isImportSource && val.length >= 2 && val.length <= 280) {
                const keyIdx = (encryptedPool.length + val.length) % keyPool.length;
                const rc4Key = keyPool[keyIdx];
                const cacheKey = `${rc4Key}:${val}`;
                let idx;
                if (poolIndexMap.has(cacheKey)) {
                    idx = poolIndexMap.get(cacheKey);
                } else {
                    idx = encryptedPool.length;
                    encryptedPool.push(rc4TransformHex(val, rc4Key));
                    poolIndexMap.set(cacheKey, idx);
                }

                const rawCallExpr = `_0xJprDec(0x${idx.toString(16)},${JSON.stringify(rc4Key)})`;
                const prevChar = node.start > 0 ? sourceCode[node.start - 1] : '';
                const nextChar = node.end < sourceCode.length ? sourceCode[node.end] : '';
                const padLeft = /[A-Za-z0-9_$]/.test(prevChar) ? ' ' : '';
                const padRight = /[A-Za-z0-9_$]/.test(nextChar) ? ' ' : '';
                const safeCallExpr = `${padLeft}${rawCallExpr}${padRight}`;

                if (
                    parent &&
                    parent.type === 'Property' &&
                    parent.key === node &&
                    !parent.computed
                ) {
                    if (parent.kind === 'init') {
                        replacements.push({
                            start: node.start,
                            end: node.end,
                            text: `[${rawCallExpr}]`
                        });
                    }
                } else if (
                    parent &&
                    parent.type === 'MethodDefinition' &&
                    parent.key === node &&
                    !parent.computed
                ) {
                    // Biarkan nama method statis
                } else {
                    replacements.push({
                        start: node.start,
                        end: node.end,
                        text: safeCallExpr
                    });
                }
            }
        }

        for (const key of Object.keys(node)) {
            if (key === 'type' || key === 'start' || key === 'end' || key === 'loc' || key === 'range') continue;
            const child = node[key];
            if (Array.isArray(child)) {
                for (let i = 0; i < child.length; i++) {
                    if (child[i] && typeof child[i].type === 'string') {
                        walk(child[i], node, key);
                    }
                }
            } else if (child && typeof child.type === 'string') {
                walk(child, node, key);
            }
        }
    }

    walk(ast, null, null);

    const totalStrings = encryptedPool.length;
    const shiftOffset = totalStrings > 5 ? (crypto.randomInt(1, totalStrings - 1)) : 0;
    const rotatedPool = totalStrings > 0
        ? encryptedPool.slice(shiftOffset).concat(encryptedPool.slice(0, shiftOffset))
        : [];

    replacements.sort((a, b) => b.start - a.start);
    let mutatedCode = sourceCode;
    for (const rep of replacements) {
        mutatedCode = mutatedCode.slice(0, rep.start) + rep.text + mutatedCode.slice(rep.end);
    }

    const rc4RuntimeHeader = `
const _0xJprArr = ${JSON.stringify(rotatedPool)};
(function(_arr, _rot) {
    const _sh = function(_n) {
        const _len = _arr.length;
        if (_len > 1 && _n > 0) {
            const _k = _n % _len;
            if (_k > 0) _arr.unshift(..._arr.splice(_len - _k, _k));
        }
    };
    _sh(_rot);
})(_0xJprArr, 0x${shiftOffset.toString(16)});
const _0xJprCache = Object.create(null);
function _0xJprDec(_idx, _key) {
    const _ck = _idx + ":" + _key;
    if (_0xJprCache[_ck] !== undefined) return _0xJprCache[_ck];
    const _b64 = _0xJprArr[_idx];
    const _bin = atob(_b64);
    const _len = _bin.length;
    const _s = new Uint8Array(256);
    for (let _i = 0; _i < 256; _i++) _s[_i] = _i;
    let _j = 0;
    for (let _i = 0; _i < 256; _i++) {
        _j = (_j + _s[_i] + _key.charCodeAt(_i % _key.length)) & 255;
        const _t = _s[_i]; _s[_i] = _s[_j]; _s[_j] = _t;
    }
    let _x = 0; _j = 0;
    const _out = new Uint8Array(_len);
    for (let _p = 0; _p < _len; _p++) {
        _x = (_x + 1) & 255;
        _j = (_j + _s[_x]) & 255;
        const _t = _s[_x]; _s[_x] = _s[_j]; _s[_j] = _t;
        const _ks = _s[(_s[_x] + _s[_j]) & 255];
        _out[_p] = _bin.charCodeAt(_p) ^ _ks;
    }
    const _dec = new TextDecoder().decode(_out);
    _0xJprCache[_ck] = _dec;
    return _dec;
}
`;

    if (isModule && codeStartOffset > 0) {
        return (
            mutatedCode.slice(0, codeStartOffset) +
            '\n' +
            rc4RuntimeHeader +
            '\n' +
            mutatedCode.slice(codeStartOffset)
        );
    }
    return rc4RuntimeHeader + '\n' + mutatedCode;
}

async function minifyAndMangleJs(code, isModule = true) {
    if (terser && typeof terser.minify === 'function') {
        const res = await terser.minify(code, {
            module: isModule,
            compress: {
                dead_code: true,
                drop_debugger: true,
                conditionals: true,
                evaluate: true,
                booleans: true,
                loops: true,
                unused: true,
                passes: 2
            },
            mangle: {
                toplevel: false,
                reserved: [
                    "initializeApp",
                    "getAuth", "GoogleAuthProvider", "EmailAuthProvider",
                    "signInWithPopup", "signInWithRedirect", "getRedirectResult", "signInWithCredential",
                    "signInWithEmailAndPassword", "createUserWithEmailAndPassword",
                    "sendPasswordResetEmail", "fetchSignInMethodsForEmail",
                    "linkWithPopup", "linkWithCredential",
                    "signOut", "onAuthStateChanged", "setPersistence", "browserLocalPersistence",
                    "getFirestore", "doc", "getDoc", "setDoc", "updateDoc",
                    "getDatabase", "ref", "set", "update", "get",
                    "getMessaging", "getToken", "onMessage"
                ]
            },
            format: {
                comments: false,
                ascii_only: false
            }
        });
        if (res && res.code) {
            return res.code;
        }
    }
    return code;
}

function verifyCompiledJsIntegrity(label, code, isModule = true) {
    if (/(?:return|else|case|throw|typeof|void|delete)_0xJprDec/.test(code)) {
        throw new Error(`[INTEGRITY FAIL] Token merge corruption detected in ${label}`);
    }
    if (acorn) {
        acorn.parse(code, {
            ecmaVersion: 'latest',
            sourceType: isModule ? 'module' : 'script'
        });
    }
}

function buildSecureServiceWorkerSource() {
    const rawSw = fs.readFileSync(path.join(ROOT_DIR, 'service-worker.js'), 'utf8');
    if (!/const\s+firebaseMesin\s*=\s*\{[\s\S]*?\};/.test(rawSw)) {
        return rawSw;
    }
    const runtimeConfig = buildRuntimeCredentialsConfig();
    const swVaultPayload = {
        utama: runtimeConfig.firebaseConfig,
        nodes: runtimeConfig.JAPAR_CLUSTER_NODES,
        cloudinary: runtimeConfig.cloudinaryConfig
    };
    const swKeyBytes = Array.from(crypto.randomBytes(16));
    const swXorSeed = crypto.randomInt(19, 239);
    const swEncryptedBytes = rc4XorEncryptBytes(JSON.stringify(swVaultPayload), swKeyBytes, swXorSeed);

    const swVaultCode = `
const firebaseMesin = (function(_v, _k, _seed) {
    const _s = new Uint8Array(256);
    for (let _i = 0; _i < 256; _i++) _s[_i] = _i;
    let _j = 0;
    for (let _i = 0; _i < 256; _i++) {
        _j = (_j + _s[_i] + _k[_i % _k.length]) & 255;
        const _t = _s[_i]; _s[_i] = _s[_j]; _s[_j] = _t;
    }
    let _x = 0; _j = 0;
    const _out = new Uint8Array(_v.length);
    for (let _p = 0; _p < _v.length; _p++) {
        _x = (_x + 1) & 255;
        _j = (_j + _s[_x]) & 255;
        const _t = _s[_x]; _s[_x] = _s[_j]; _s[_j] = _t;
        const _ks = _s[(_s[_x] + _s[_j]) & 255];
        const _rx = (_seed + ((_p * 31) & 255)) & 255;
        _out[_p] = (_v[_p] ^ _ks ^ _rx) & 255;
        _v[_p] = 0;
    }
    _k.fill(0);
    return JSON.parse(new TextDecoder().decode(_out));
})([${swEncryptedBytes.join(',')}], [${swKeyBytes.join(',')}], ${swXorSeed});
`;

    return rawSw.replace(
        /const\s+firebaseMesin\s*=\s*\{[\s\S]*?\};/,
        swVaultCode.trim()
    );
}

function minifyCss(cssText) {
    return cssText
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/\s+/g, ' ')
        .replace(/\s*([{}:;,>~])\s*/g, '$1')
        .replace(/;}/g, '}')
        .trim();
}

function minifyHtml(htmlText) {
    let updated = htmlText.replace(
        /<script\s+type=["']module["']\s+src=["'](?:\.\/)?app\.js["']\s*><\/script>/i,
        '<script type="module" src="./js/japar-panel.min.js" defer></script>'
    );
    updated = updated
        .replace(/<!--[\s\S]*?-->/g, '')
        .replace(/>\s+</g, '><')
        .replace(/\s{2,}/g, ' ')
        .trim();
    return updated;
}

function copyExplicitAssets(srcDir, destDir) {
    fs.mkdirSync(destDir, { recursive: true });
    const assetNames = ['logo.png', 'icon-192.png', 'icon-512.png'];
    for (const name of assetNames) {
        const s = path.join(srcDir, name);
        const d = path.join(destDir, name);
        if (fs.existsSync(s)) {
            fs.copyFileSync(s, d);
        }
    }
}

async function runBuild() {
    console.log('[JAPAR PANEL BUILD] Memulai kompilasi produksi Dual-Node Sharding...');
    if (fs.existsSync(DIST_DIR)) {
        fs.rmSync(DIST_DIR, { recursive: true, force: true });
    }
    fs.mkdirSync(path.join(DIST_DIR, 'js'), { recursive: true });
    fs.mkdirSync(path.join(DIST_DIR, 'css'), { recursive: true });
    fs.mkdirSync(path.join(DIST_DIR, 'assets'), { recursive: true });

    const iifeBundleSource = buildSingleIifeBundleSource();
    const obfuscatedBundle = applyAstRc4Obfuscation(iifeBundleSource, true);
    const finalBundle = await minifyAndMangleJs(obfuscatedBundle, true);
    verifyCompiledJsIntegrity('dist/js/japar-panel.min.js', finalBundle, true);
    fs.writeFileSync(path.join(DIST_DIR, 'js', 'japar-panel.min.js'), finalBundle, 'utf8');

    const swSource = buildSecureServiceWorkerSource();
    const obfuscatedSw = applyAstRc4Obfuscation(swSource, false);
    const finalSw = await minifyAndMangleJs(obfuscatedSw, false);
    verifyCompiledJsIntegrity('dist/service-worker.js', finalSw, false);
    fs.writeFileSync(path.join(DIST_DIR, 'service-worker.js'), finalSw, 'utf8');

    const rawHtml = fs.readFileSync(path.join(ROOT_DIR, 'index.html'), 'utf8');
    fs.writeFileSync(path.join(DIST_DIR, 'index.html'), minifyHtml(rawHtml), 'utf8');

    for (const cssFile of ['style.css', 'components.css']) {
        const srcCssPath = path.join(ROOT_DIR, 'css', cssFile);
        if (!fs.existsSync(srcCssPath)) {
            throw new Error(`Berkas CSS wajib tidak ditemukan: css/${cssFile}`);
        }
        const rawCss = fs.readFileSync(srcCssPath, 'utf8');
        fs.writeFileSync(path.join(DIST_DIR, 'css', cssFile), minifyCss(rawCss), 'utf8');
    }

    fs.copyFileSync(path.join(ROOT_DIR, 'manifest.json'), path.join(DIST_DIR, 'manifest.json'));
    copyExplicitAssets(path.join(ROOT_DIR, 'assets'), path.join(DIST_DIR, 'assets'));

    console.log('[JAPAR PANEL BUILD] Selesai! Berkas produksi siap di dist/ (dist/js/japar-panel.min.js, dist/service-worker.js, dist/css/style.css, dist/css/components.css)');
}

runBuild().catch((err) => {
    console.error('[JAPAR PANEL BUILD ERROR]', err);
    process.exit(1);
});
