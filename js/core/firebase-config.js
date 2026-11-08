// ==========================================================================
// FILE: js/core/firebase-config.js (JAPAR PANEL - DUAL-NODE ZERO-SOCKET ARCHITECTURE)
// FUNGSI:
//   1. Inisialisasi Terisolasi 2 Instance Firebase (JAPAR_N1 & JAPAR_N2)
//   2. Penyedia Konteks Node Aktif Dinamis (`getActiveNodeContext`)
//   3. Manajemen Ikatan Email -> Node (`japar_email_node_map_v1` & `japar_active_node_id`)
// ==========================================================================

import {
    firebaseConfig,
    JAPAR_CLUSTER_NODES,
    ROOT_ADMIN_UID_N1,
    ROOT_ADMIN_UID_N2,
    ROOT_ADMIN_UIDS
} from '../config/credentials.js';
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.8.1/firebase-app.js";
import { getAuth, GoogleAuthProvider } from "https://www.gstatic.com/firebasejs/10.8.1/firebase-auth.js";
import { getFirestore } from "https://www.gstatic.com/firebasejs/10.8.1/firebase-firestore.js";

export const ACTIVE_NODE_STORAGE_KEY = 'japar_active_node_id';
export const EMAIL_NODE_MAP_STORAGE_KEY = 'japar_email_node_map_v1';

const appNode1 = initializeApp(JAPAR_CLUSTER_NODES.N1.config, 'JAPAR_N1');
const appNode2 = initializeApp(JAPAR_CLUSTER_NODES.N2.config, 'JAPAR_N2');

const authNode1 = getAuth(appNode1);
const dbFirestoreNode1 = getFirestore(appNode1);

const authNode2 = getAuth(appNode2);
const dbFirestoreNode2 = getFirestore(appNode2);

const provider = new GoogleAuthProvider();
const dbRealtime = null;
const messaging = null;

export const FIREBASE_NODE_CONTEXTS = {
    N1: {
        nodeId: 'N1',
        label: JAPAR_CLUSTER_NODES.N1.label,
        app: appNode1,
        config: JAPAR_CLUSTER_NODES.N1.config,
        auth: authNode1,
        dbFirestore: dbFirestoreNode1,
        adminUid: JAPAR_CLUSTER_NODES.N1.adminUid || ROOT_ADMIN_UID_N1
    },
    N2: {
        nodeId: 'N2',
        label: JAPAR_CLUSTER_NODES.N2.label,
        app: appNode2,
        config: JAPAR_CLUSTER_NODES.N2.config,
        auth: authNode2,
        dbFirestore: dbFirestoreNode2,
        adminUid: JAPAR_CLUSTER_NODES.N2.adminUid || ROOT_ADMIN_UID_N2
    }
};

export function normalizeNodeId(rawNodeId) {
    const clean = String(rawNodeId || '').trim().toUpperCase();
    return clean === 'N2' ? 'N2' : 'N1';
}

export function getNodeContextById(nodeId) {
    const norm = normalizeNodeId(nodeId);
    return FIREBASE_NODE_CONTEXTS[norm] || FIREBASE_NODE_CONTEXTS.N1;
}

export function bacaPetaNodeEmailLokal() {
    try {
        const raw = localStorage.getItem(EMAIL_NODE_MAP_STORAGE_KEY);
        if (!raw) return {};
        const parsed = JSON.parse(raw);
        return (parsed && typeof parsed === 'object') ? parsed : {};
    } catch (e) {
        return {};
    }
}

export function getNodeTerkunciUntukEmail(email) {
    const cleanEmail = String(email || '').toLowerCase().trim();
    if (!cleanEmail) return null;
    const map = bacaPetaNodeEmailLokal();
    const val = map[cleanEmail];
    if (val === 'N1' || val === 'N2') return val;
    return null;
}

export function setActiveNodeId(nodeId) {
    const norm = normalizeNodeId(nodeId);
    try {
        localStorage.setItem(ACTIVE_NODE_STORAGE_KEY, norm);
    } catch (e) {}
    return FIREBASE_NODE_CONTEXTS[norm];
}

export function kunciIkatanNodeEmail(email, nodeId) {
    const norm = normalizeNodeId(nodeId);
    const cleanEmail = String(email || '').toLowerCase().trim();
    try {
        if (cleanEmail) {
            const map = bacaPetaNodeEmailLokal();
            map[cleanEmail] = norm;
            localStorage.setItem(EMAIL_NODE_MAP_STORAGE_KEY, JSON.stringify(map));
        }
        localStorage.setItem(ACTIVE_NODE_STORAGE_KEY, norm);
    } catch (e) {}
    return FIREBASE_NODE_CONTEXTS[norm];
}

export function isSuperAdminUid(uid) {
    if (!uid) return false;
    const cleanUid = String(uid).trim();
    if (Array.isArray(ROOT_ADMIN_UIDS) && ROOT_ADMIN_UIDS.includes(cleanUid)) {
        return true;
    }
    return cleanUid === ROOT_ADMIN_UID_N1 || cleanUid === ROOT_ADMIN_UID_N2;
}

export function getActiveNodeContext() {
    let savedNodeId = null;
    try {
        savedNodeId = localStorage.getItem(ACTIVE_NODE_STORAGE_KEY);
    } catch (e) {}

    if (savedNodeId === 'N1' || savedNodeId === 'N2') {
        const preferredCtx = FIREBASE_NODE_CONTEXTS[savedNodeId];
        const otherCtx = savedNodeId === 'N1' ? FIREBASE_NODE_CONTEXTS.N2 : FIREBASE_NODE_CONTEXTS.N1;
        if (!preferredCtx.auth.currentUser && otherCtx.auth.currentUser) {
            return otherCtx;
        }
        return preferredCtx;
    }

    if (authNode2.currentUser && !authNode1.currentUser) {
        return FIREBASE_NODE_CONTEXTS.N2;
    }
    if (authNode1.currentUser) {
        return FIREBASE_NODE_CONTEXTS.N1;
    }

    try {
        const rawCache = localStorage.getItem('japar_verified_merchant_cache');
        if (rawCache) {
            const parsed = JSON.parse(rawCache);
            const cachedEmail = String(parsed?.email || '').toLowerCase().trim();
            const cachedNode = parsed?.profileData?.profile?.nodeId || getNodeTerkunciUntukEmail(cachedEmail);
            if (cachedNode === 'N2') return FIREBASE_NODE_CONTEXTS.N2;
        }
    } catch (e) {}

    return FIREBASE_NODE_CONTEXTS.N1;
}

window.getActiveNodeContext = getActiveNodeContext;
window.getNodeContextById = getNodeContextById;

const app = appNode1;
const auth = authNode1;
const dbFirestore = dbFirestoreNode1;

export {
    app,
    appNode1,
    appNode2,
    auth,
    authNode1,
    authNode2,
    dbFirestore,
    dbFirestoreNode1,
    dbFirestoreNode2,
    dbRealtime,
    provider,
    messaging
};
