import { initializeApp } from "firebase/app";
import { getAuth } from "firebase/auth";

const firebaseConfig = {
    apiKey: "AIzaSyCQfp_-GoSxlcPZOH_0R9PYFs_2hXO66vA",
    authDomain: "assistru-b48da.firebaseapp.com",
    projectId: "assistru-b48da",
    storageBucket: "assistru-b48da.firebasestorage.app",
    messagingSenderId: "211060620295",
    appId: "1:211060620295:web:c14a9daecdf2ec6b47fea2"
};

const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
