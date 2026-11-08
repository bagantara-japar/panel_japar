// ==========================================================================
// FILE: js/config/credentials.js (JAPAR PANEL - DUAL-NODE FEDERATED SHARDING)
// FUNGSI: Penyedia Kredensial Runtime Multi-Node Firebase (N1 & N2),
//         Cloudinary & Endpoint GAS Google Maps (Dienkripsi ke RC4 + XOR Vault saat Build)
// ==========================================================================

export const firebaseConfigNode1 = {
  apiKey: "AIzaSyBOCoI-PzDg89AZmAWjryioJj1hIBPuLso",
  authDomain: "japar-b1c5d.firebaseapp.com",
  databaseURL: "https://japar-b1c5d-default-rtdb.asia-southeast1.firebasedatabase.app",
  projectId: "japar-b1c5d",
  storageBucket: "japar-b1c5d.firebasestorage.app",
  messagingSenderId: "332026051029",
  appId: "1:332026051029:web:281bc141eb6ff58f9f255c"
};

export const ROOT_ADMIN_UID_N1 = "90dvLpzZq6RrPXOJm3HoqDAkao73";

export const firebaseConfigNode2 = {
  apiKey: "AIzaSyD1YmNrYAwTOcBGSozKKDztUr8fC0C-lKQ",
  authDomain: "japar-2.firebaseapp.com",
  databaseURL: "https://japar-2-default-rtdb.asia-southeast1.firebasedatabase.app",
  projectId: "japar-2",
  storageBucket: "japar-2.firebasestorage.app",
  messagingSenderId: "805858048959",
  appId: "1:805858048959:web:2f017343aba69c89d67f0a"
};

export const ROOT_ADMIN_UID_N2 = "q0HllfTc6bOT7Ps8DIvISjEoRjm1";

export const JAPAR_CLUSTER_NODES = {
  N1: { id: "N1", label: "Server 1 (Utama)", config: firebaseConfigNode1, adminUid: ROOT_ADMIN_UID_N1 },
  N2: { id: "N2", label: "Server 2 (Ekspansi)", config: firebaseConfigNode2, adminUid: ROOT_ADMIN_UID_N2 }
};

export const ROOT_ADMIN_UIDS = [ROOT_ADMIN_UID_N1, ROOT_ADMIN_UID_N2];

export const firebaseConfig = firebaseConfigNode1;

export const cloudinaryConfig = {
  cloudName: "odo6kdaz",
  uploadPreset: "my-archivestory",
  uploadEndpoint: "https://api.cloudinary.com/v1_1/odo6kdaz/image/upload",
  deliveryBaseUrl: "https://res.cloudinary.com/odo6kdaz/image/upload/f_auto,q_auto,w_400/"
};

export const configMerchant = firebaseConfigNode1;
export const configAktif = firebaseConfigNode1;

export const DEFAULT_CENTER_PARE = { lat: -7.768049, lng: 112.196514 };
export const JAPAR_GAS_MAPS_URL = "https://script.google.com/macros/s/AKfycbwEDdv6dBZ878K93thmk5MgdfqZieEHA_wLXprJfe29EZ5lghRsoP-APysm2HcrK6q8/exec";
export const UNFURL_MAPS_API_URL = JAPAR_GAS_MAPS_URL;
export const ROOT_ADMIN_UID = ROOT_ADMIN_UID_N1;
export const ADMIN_WA_NUMBER = "6282225225141";
