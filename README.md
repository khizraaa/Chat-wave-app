# ChatWave: Real-Time Chat (Firebase)

Real-time chat built with HTML, CSS, JavaScript and Firebase (Authentication + Firestore).
Users sign up, see all members in the sidebar, and chat privately (1-to-1) or in the Global Lounge.

## Files
- `index.html`: page structure
- `style.css`: styling
- `script.js`: chat logic (auth, users list, private chat, messages)
- `firebase-config.js`: Firebase setup
- `firestore.rules`: Firestore security rules

## Setup
1. Firebase Console > Authentication > Sign-in method > enable **Email/Password**.
2. Firebase Console > Firestore Database > **Create database**.
3. Firestore Database > **Rules** > paste `firestore.rules` > **Publish**.
4. Authentication > Settings > Authorized domains: make sure `localhost` is listed.

## Run
Do not double click `index.html` (ES modules need a server).
- VS Code: install **Live Server**, right click `index.html`, **Open with Live Server** (use `localhost`).
- Or run `python -m http.server 5500` in the folder and open `http://localhost:5500`.

## Test
Open two browsers (one Incognito), sign up two accounts, open each other's name in the sidebar and send messages.

## Data structure
- `users/{uid}`: `uid`, `name`, `lastSeen`
- `messages/{id}`: Global Lounge messages
- `chats/{uidA_uidB}/messages/{id}`: private messages (ids sorted so both users share the same chat)
