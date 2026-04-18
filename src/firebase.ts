import { initializeApp } from 'firebase/app'
import { getAnalytics, isSupported } from 'firebase/analytics'
import { getAuth, GoogleAuthProvider } from 'firebase/auth'
import { getFirestore } from 'firebase/firestore'

const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY ?? '',
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN ?? '',
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID ?? '',
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET ?? '',
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID ?? '',
  appId: import.meta.env.VITE_FIREBASE_APP_ID ?? '',
  measurementId: import.meta.env.VITE_FIREBASE_MEASUREMENT_ID ?? '',
}

const requiredKeys: Array<keyof typeof firebaseConfig> = [
  'apiKey',
  'authDomain',
  'projectId',
  'storageBucket',
  'messagingSenderId',
  'appId',
]

export const firebaseConfigReady = requiredKeys.every((key) => Boolean(firebaseConfig[key]))
export const firebaseConfigError = firebaseConfigReady
  ? ''
  : 'Create a local `.env` or `.env.local` file with the Vite Firebase values before using auth and sync.'

const safeFirebaseConfig = firebaseConfigReady
  ? firebaseConfig
  : {
      apiKey: 'local-only-placeholder',
      authDomain: 'local-only.invalid',
      projectId: 'local-only',
      storageBucket: 'local-only.appspot.com',
      messagingSenderId: '0',
      appId: 'local-only',
      measurementId: '',
    }

export const app = initializeApp(safeFirebaseConfig)
export const auth = getAuth(app)
export const db = getFirestore(app)
export const googleProvider = new GoogleAuthProvider()

googleProvider.setCustomParameters({ prompt: 'select_account' })

if (firebaseConfigReady) {
  isSupported()
    .then((supported) => {
      if (supported) {
        getAnalytics(app)
      }
    })
    .catch(() => undefined)
}
