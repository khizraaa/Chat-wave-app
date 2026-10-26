// Firebase setup lives in this separate file.
import { initializeApp } from "https://www.gstatic.com/firebasejs/12.3.0/firebase-app.js";
import { getAuth } from "https://www.gstatic.com/firebasejs/12.3.0/firebase-auth.js";
import { getFirestore } from "https://www.gstatic.com/firebasejs/12.3.0/firebase-firestore.js";

const firebaseConfig = {
  apiKey: "AIzaSyBYEJAqSnyxJUq6UkMA0zXK6XKgTDRvfVQ",
  authDomain: "chat-wave-127c3.firebaseapp.com",
  projectId: "chat-wave-127c3",
  storageBucket: "chat-wave-127c3.firebasestorage.app",
  messagingSenderId: "983028684428",
  appId: "1:983028684428:web:1dc847ce94ed8e0772cda9",
  measurementId: "G-25CMGGB5GC"
};

const app = initializeApp(firebaseConfig);

export const auth = getAuth(app);
export const db = getFirestore(app);

   export const CLOUDINARY_CLOUD_NAME = "rohsjeb1";
   export const CLOUDINARY_UPLOAD_PRESET = "CHAT APP";
