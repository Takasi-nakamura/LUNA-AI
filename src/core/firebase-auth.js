// Firebase Authentication helpers. Firebase web config is public; never put provider API secrets here.
let sdkPromise;
let authInstance = null;
let appInstance = null;
function sdk() {
  return sdkPromise ??= Promise.all([
    import('https://www.gstatic.com/firebasejs/10.14.1/firebase-app.js'),
    import('https://www.gstatic.com/firebasejs/10.14.1/firebase-auth.js'),
  ]).then(([app, auth]) => ({ app, auth }));
}
export async function configureFirebase(config) {
  if (!config?.apiKey || !config?.authDomain || !config?.projectId || !config?.appId) {
    throw new Error('Firebaseの apiKey / authDomain / projectId / appId を入力してください');
  }
  const { app, auth } = await sdk();
  appInstance = app.getApps().length ? app.getApp() : app.initializeApp(config);
  authInstance = auth.getAuth(appInstance);
  return authInstance;
}
export async function firebaseAuth() {
  if (authInstance) return authInstance;
  throw new Error('先にFirebase設定を保存してください');
}
export async function signInGoogle() {
  const { auth } = await sdk();
  const a = await firebaseAuth();
  return auth.signInWithRedirect(a, new auth.GoogleAuthProvider());
}
export async function signInEmail(email, password, create = false) {
  const { auth } = await sdk();
  const a = await firebaseAuth();
  return create
    ? auth.createUserWithEmailAndPassword(a, email, password)
    : auth.signInWithEmailAndPassword(a, email, password);
}
export async function signOutFirebase() {
  const { auth } = await sdk();
  const a = await firebaseAuth();
  return auth.signOut(a);
}
export async function currentIdToken() {
  if (!authInstance) return null;
  const { auth } = await sdk();
  await authInstance.authStateReady?.();
  return authInstance.currentUser ? await authInstance.currentUser.getIdToken() : null;
}
export async function currentUser() {
  if (!authInstance) return null;
  return (await sdk()).auth.getAuth(appInstance).currentUser;
}
export async function observeAuth(callback) {
  if (!authInstance) return () => {};
  const { auth } = await sdk();
  return auth.onAuthStateChanged(authInstance, callback);
}
