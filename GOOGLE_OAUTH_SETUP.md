# 🔐 Google OAuth Setup — DEPRECATED

## ⚠️ NATIVE GOOGLE OAUTH DESKTOP PKCE HAS BEEN REMOVED

**The application now uses ONLY Firebase Authentication (`signInWithPopup`).**

All native Google OAuth Desktop PKCE code has been removed:
- No more localhost callback server on port 51734
- No more PKCE flow (code_verifier, code_challenge)
- No more manual token exchange
- No more GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET required
- No more custom BrowserWindow for Google OAuth

---

## ✅ NEW: Firebase Authentication

The "Continue with Google" button now uses **Firebase Authentication**:

```javascript
// safenethome.html - already implemented
firebase.auth().signInWithPopup(new firebase.auth.GoogleAuthProvider())
```

### Required Firebase Configuration

Set these in your `.env` file (copied from Firebase Console → Project Settings → General → Web App):

```env
FIREBASE_API_KEY=AIzaSyC_9PqsXO10JLNejXgUgOhu8oYpX3G_ros
FIREBASE_AUTH_DOMAIN=safe-brauzer-cf748.firebaseapp.com
FIREBASE_PROJECT_ID=safe-brauzer-cf748
FIREBASE_STORAGE_BUCKET=safe-brauzer-cf748.firebasestorage.app
FIREBASE_MESSAGING_Sender_ID=781225555534
FIREBASE_APP_ID=1:781225555534:web:2cf9a864e1d7238efb351f
FIREBASE_MEASUREMENT_ID=G-MKJZDEJFPN
```

### Firebase Console Setup

1. Go to [Firebase Console](https://console.firebase.google.com)
2. Select your project (or create new)
3. **Authentication** → **Sign-in method** → **Google** → **Enable**
4. **Project Settings** → **General** → **Your apps** → **Web app** (</>) → Copy config

---

## 🔄 Migration Summary

| Component | Old (Removed) | New (Firebase) |
|-----------|---------------|----------------|
| Auth Flow | PKCE + localhost callback | Firebase `signInWithPopup` |
| Credentials | GOOGLE_CLIENT_ID + SECRET | FIREBASE_API_KEY + config |
| Token Storage | Manual (access_token, refresh_token) | Firebase handles automatically |
| User Profile | Manual `userinfo` endpoint | `firebase.auth().currentUser` |
| Refresh Token | Manual refresh | Automatic by Firebase SDK |
| Client Type | Desktop App (Installed App) | Web App (Firebase) |

---

## ✅ Verification

After migration:
1. Build: `npm run build-win`
2. Install `dist/SafeNet Browser Setup 1.0.0.exe`
3. Launch → Click "Continue with Google" → Firebase popup opens
4. Sign in → Profile loads → Works in production without any `.env` setup for Google OAuth

---

## 📝 Files Modified

- `main.js` - Removed native OAuth PKCE implementation
- `preload.js` - Removed `safenet_auth` bridge, kept Firebase config
- `safenethome.html` - Updated to use Firebase `signInWithPopup`
- `preload.js` - Kept `firebaseConfig` exposure for renderer
- `.env.example` - Removed GOOGLE_CLIENT_ID/SECRET, documented Firebase config
- `GOOGLE_OAUTH_SETUP.md` - This file (deprecated notice)

---

**Note:** If you need the old native OAuth for some reason, it's in Git history. But the Firebase approach is more reliable for Electron apps.