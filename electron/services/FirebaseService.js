const { initializeApp } = require("firebase/app");
const { getFirestore, collection, getDocs, doc, setDoc, deleteDoc } = require("firebase/firestore");

// Configuração fornecida pelo usuário
const firebaseConfig = {
    apiKey: "AIzaSyCQfp_-GoSxlcPZOH_0R9PYFs_2hXO66vA",
    authDomain: "assistru-b48da.firebaseapp.com",
    projectId: "assistru-b48da",
    storageBucket: "assistru-b48da.firebasestorage.app",
    messagingSenderId: "211060620295",
    appId: "1:211060620295:web:c14a9daecdf2ec6b47fea2"
};

class FirebaseService {
    constructor() {
        try {
            this.app = initializeApp(firebaseConfig);
            this.db = getFirestore(this.app);
            this.collectionName = 'personalities';
            console.log('[FirebaseService] Initialized successfully.');
        } catch (error) {
            console.error('[FirebaseService] Initialization failed:', error);
            this.db = null;
        }
    }

    isReady() {
        return this.db !== null;
    }

    async getAllPersonalities() {
        if (!this.isReady()) throw new Error('Firebase not initialized');

        try {
            const querySnapshot = await getDocs(collection(this.db, this.collectionName));
            const personalities = [];
            querySnapshot.forEach((doc) => {
                personalities.push(doc.data());
            });
            return personalities;
        } catch (error) {
            console.error('[FirebaseService] Error fetching personalities:', error);
            throw error;
        }
    }

    async savePersonality(personality) {
        if (!this.isReady()) throw new Error('Firebase not initialized');
        if (!personality.id) throw new Error('Personality must have an ID');

        try {
            await setDoc(doc(this.db, this.collectionName, personality.id), personality);
            console.log(`[FirebaseService] Saved personality: ${personality.id}`);
            return true;
        } catch (error) {
            console.error(`[FirebaseService] Error saving personality ${personality.id}:`, error);
            throw error;
        }
    }

    async deletePersonality(id) {
        if (!this.isReady()) throw new Error('Firebase not initialized');

        try {
            await deleteDoc(doc(this.db, this.collectionName, id));
            console.log(`[FirebaseService] Deleted personality: ${id}`);
            return true;
        } catch (error) {
            console.error(`[FirebaseService] Error deleting personality ${id}:`, error);
            throw error;
        }
    }
}

module.exports = FirebaseService;
