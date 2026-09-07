// Import the functions you need from the SDKs you need
import { initializeApp } from "firebase/app";
// TODO: Add SDKs for Firebase products that you want to use
// https://firebase.google.com/docs/web/setup#available-libraries

// Your web app's Firebase configuration
const firebaseConfig = {
  apiKey: "AIzaSyCGULWqvYXrTOIDrqJzXZc8SFIGe1PRQfA",
  authDomain: "farkle-9d1cd.firebaseapp.com",
  databaseURL: "https://farkle-9d1cd-default-rtdb.firebaseio.com",
  projectId: "farkle-9d1cd",
  storageBucket: "farkle-9d1cd.firebasestorage.app",
  messagingSenderId: "587918580333",
  appId: "1:587918580333:web:74803285bc5f97825bbd64",
};

// Initialize Firebase
const app = initializeApp(firebaseConfig);
export default app;
