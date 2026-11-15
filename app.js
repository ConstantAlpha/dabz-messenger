import { initializeApp } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js";
import {
  getFirestore, collection, addDoc, onSnapshot, query, orderBy,
  deleteDoc, doc, getDocs, getDoc, setDoc, updateDoc,
  arrayUnion, arrayRemove, where, limit, runTransaction, serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";
import {
  getAuth, onAuthStateChanged, signInWithEmailAndPassword,
  createUserWithEmailAndPassword, GoogleAuthProvider, signInWithPopup,
  signOut as fbSignOut, sendPasswordResetEmail, updateProfile
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";

const firebaseConfig = {
  apiKey: "AIzaSyCXPDgHPp9fCkunGFi2607wDGwh5hIVzf4",
  authDomain: "dabz-6c525.firebaseapp.com",
  projectId: "dabz-6c525",
  storageBucket: "dabz-6c525.firebasestorage.app",
  messagingSenderId: "1075617125423",
  appId: "1:1075617125423:web:e484dc36b9dc18d26a62da"
};
const app = initializeApp(firebaseConfig);
const db = getFirestore(app);
const auth = getAuth(app);

/* ============================================================
   STATE
   ============================================================ */
let myUid = '', myUsername = '', myName = '', myEmail = '', myPhotoURL = '';
let myProfile = null;
let authMode = 'signin';

let profilesByUid = {}, profilesByUsername = {};
let onlineNow = {}, lastSeenMap = {};

let dms = [], groupMsgs = [], groups = [], statuses = [], reels = [];

let chatView = 'list';  // 'list' | 'dm' | 'group'
let dmToUid = null, dmToName = null;
let replyTo = null, groupId = null, pinnedMsg = null;

let typingTimeout = null, isRecording = false, mediaRecorder = null, audioChunks = [];
let snapUnsubs = [], chatBooted = false;
let newsLoaded = false, newsCurrentCat = 'all';

const colors = ["#ef4444","#f97316","#eab308","#22c55e","#06b6d4","#3b82f6","#a855f7","#ec4899"];

/* ============================================================
   HELPERS
   ============================================================ */
function colorFor(s){ let h=0; for(let i=0;i<(s||'').length;i++) h=(h*31+s.charCodeAt(i))>>>0; return colors[h%colors.length]; }
function initials(n){ return (n||'?').trim().slice(0,2).toUpperCase(); }
function escapeHtml(s){ return (s||'').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }
function dmId(a,b){ return [a,b].sort().join('__'); }
function toast(t){
  const el = document.getElementById('toast');
  el.innerText = t; el.style.display = 'block';
  clearTimeout(el._t);
  el._t = setTimeout(()=> el.style.display = 'none', 2200);
}
function playSound(){
  try{
    const ctx = new (window.AudioContext||window.webkitAudioContext)();
    const o = ctx.createOscillator(), g = ctx.createGain();
    o.connect(g); g.connect(ctx.destination);
    o.frequency.value = 880; g.gain.value = 0.06;
    o.start(); o.stop(ctx.currentTime + 0.12);
  }catch(e){}
}
function friendlyAuthError(code){
  const map = {
    'auth/invalid-email': 'That email looks invalid.',
    'auth/user-not-found': 'No account with that email. Try Sign up.',
    'auth/wrong-password': 'Wrong password. Try again.',
    'auth/invalid-credential': 'Wrong email or password.',
    'auth/email-already-in-use': 'That email is already registered. Try Sign in.',
    'auth/weak-password': 'Password must be 6+ characters.',
    'auth/too-many-requests': 'Too many attempts. Wait a minute.',
    'auth/popup-closed-by-user': 'Sign-in popup was closed.',
    'auth/popup-blocked': 'Popup blocked — allow popups for this site.',
    'auth/unauthorized-domain': 'Domain not authorized in Firebase. Add it under Authentication → Settings.',
    'auth/operation-not-allowed': 'Sign-in method disabled in Firebase Console.',
    'auth/missing-initial-state': 'Mobile browser blocked Google Sign-In. Use email/password instead.'
  };
  return map[code] || 'Something went wrong. Try again.';
}

/* ============================================================
   THEME & MOBILE CHECK
   ============================================================ */
window.toggleTheme = function(){
  document.body.classList.toggle('light');
  const l = document.body.classList.contains('light');
  const btn = document.getElementById('themeBtn');
  if(btn) btn.innerText = l ? '🌙' : '☀️';
  localStorage.setItem('dabz-theme', l ? 'light' : 'dark');
};
if(localStorage.getItem('dabz-theme')==='light'){
  document.body.classList.add('light');
  const btn = document.getElementById('themeBtn');
  if(btn) btn.innerText = '🌙';
}

// Hide Google button on mobile to prevent "missing-initial-state" crash
if (/Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent)) {
  const gBtn = document.querySelector('.google-btn');
  const div = document.querySelector('.divider-text');
  if (gBtn) gBtn.style.display = 'none';
  if (div) div.style.display = 'none';
}

/* ============================================================
   PAGE NAVIGATION
   ============================================================ */
window.showPage = function(page){
  document.querySelectorAll('.page').forEach(p => p.classList.toggle('active', p.id === 'page-'+page));
  document.querySelectorAll('#bottomNav button').forEach(b => b.classList.toggle('active', b.dataset.page === page));

  if(page !== 'reels'){
    document.querySelectorAll('#reelsScroll video').forEach(v => { try { v.pause(); } catch(e){} });
  }
  if(page === 'news' && !newsLoaded) loadNews('all');
  if(page === 'status') renderStatuses();
  if(page === 'reels') renderReels();
  if(page === 'profile') renderProfile();
  if(page === 'chats'){
    if(chatView === 'list') renderConversationList();
    else renderMsgs();
  }
};

/* ============================================================
   AUTH
   ============================================================ */
function showAuthScreen(){
  document.getElementById('auth').style.display = 'flex';
  document.getElementById('setup').style.display = 'none';
  document.getElementById('app').style.display = 'none';

  // Reset the submit button state so the user isn't locked out
  const btn = document.getElementById('authSubmit');
  if(btn){
    btn.disabled = false;
    btn.innerText = authMode === 'signup' ? 'Create account' : 'Sign in';
  }
  
  // Clear password fields to avoid confusion
  const pass = document.getElementById('authPass');
  const pass2 = document.getElementById('authPass2');
  if(pass) pass.value = '';
  if(pass2) pass2.value = '';

  const errEl = document.getElementById('authErr');
  if(errEl) errEl.innerText = '';
}

function showSetupScreen(user){
  document.getElementById('auth').style.display = 'none';
  document.getElementById('setup').style.display = 'flex';
  document.getElementById('app').style.display = 'none';
  const name = user.displayName || (user.email ? user.email.split('@')[0] : '');
  document.getElementById('setupName').value = name;
  document.getElementById('setupAbout').value = '';
  document.getElementById('setupUsername').value = '';
  document.getElementById('setupErr').innerText = '';
  const av = document.getElementById('setupAvatar');
  if(user.photoURL){ av.innerHTML = `<img src="${user.photoURL}" alt="">`; }
  else { av.innerHTML = ''; av.style.background = colorFor(name); av.innerText = initials(name||'?'); }
}

window.toggleAuthMode = function(){
  authMode = authMode === 'signin' ? 'signup' : 'signin';
  const isSignup = authMode === 'signup';
  
  document.getElementById('authPass2').style.display = isSignup ? 'block' : 'none';
  
  // Ensure the button is re-enabled when switching modes
  const btn = document.getElementById('authSubmit');
  btn.innerText = isSignup ? 'Create account' : 'Sign in';
  btn.disabled = false; 
  
  document.getElementById('authModeText').innerText = isSignup ? 'Already have an account?' : 'New to Dabz?';
  document.getElementById('authModeLink').innerText = isSignup ? 'Sign in' : 'Create account';
  document.getElementById('forgotWrap').style.display = isSignup ? 'none' : 'block';
  document.getElementById('authErr').innerText = '';
};

window.submitAuth = async function(){
  const email = document.getElementById('authEmail').value.trim();
  const pass  = document.getElementById('authPass').value;
  const pass2 = document.getElementById('authPass2').value;
  const errEl = document.getElementById('authErr');
  const btn   = document.getElementById('authSubmit');
  
  errEl.innerText = '';
  if(!email || !pass){ errEl.innerText = 'Fill in both email and password.'; return; }
  if(authMode === 'signup' && pass !== pass2){ errEl.innerText = 'Passwords do not match.'; return; }
  if(pass.length < 6){ errEl.innerText = 'Password must be 6+ characters.'; return; }

  btn.disabled = true;
  btn.innerText = authMode === 'signup' ? 'Creating…' : 'Signing in…';

  try{
    if(authMode === 'signup') await createUserWithEmailAndPassword(auth, email, pass);
    else                       await signInWithEmailAndPassword(auth, email, pass);
    
    // Safety net: If Firebase hangs, re-enable the button after 3 seconds
    setTimeout(() => {
      if(btn.disabled){
        btn.disabled = false;
        btn.innerText = authMode === 'signup' ? 'Create account' : 'Sign in';
      }
    }, 3000);

  }catch(e){
    console.error('[Auth Error]', e.code, e.message);
    errEl.innerText = friendlyAuthError(e.code);
    btn.disabled = false;
    btn.innerText = authMode === 'signup' ? 'Create account' : 'Sign in';
  }
};

window.googleSignIn = async function(){
  const errEl = document.getElementById('authErr');
  errEl.innerText = '';
  try{ 
    await signInWithPopup(auth, new GoogleAuthProvider()); 
  }catch(e){ 
    console.error('[Google Auth Error]', e.code, e.message);
    
    // Catch mobile blocking errors
    if (e.code === 'auth/missing-initial-state' || e.code === 'auth/popup-blocked' || e.code === 'auth/cancelled-popup-request') {
      errEl.innerText = "Google Sign-In is blocked by this mobile browser. Please use your email and password below.";
      // Hide Google button permanently for this session
      const gBtn = document.querySelector('.google-btn');
      const div = document.querySelector('.divider-text');
      if(gBtn) gBtn.style.display = 'none';
      if(div) div.style.display = 'none';
    } else {
      errEl.innerText = friendlyAuthError(e.code); 
    }
  }
};

window.forgotPassword = async function(){
  const email = document.getElementById('authEmail').value.trim();
  const errEl = document.getElementById('authErr');
  if(!email){ errEl.innerText = 'Type your email first.'; return; }
  try{ 
    await sendPasswordResetEmail(auth, email); 
    toast('Reset link sent to ' + email); 
  }
  catch(e){ errEl.innerText = friendlyAuthError(e.code); }
};

window.handleSignOut = async function(){
  if(!confirm('Sign out of Dabz?')) return;
  try{
    teardownChat();
    localStorage.removeItem('dabz-pin');
    await fbSignOut(auth);
  }catch(e){
    console.error('[Signout Error]', e);
    showAuthScreen(); // Force UI reset if Firebase throws an error
  }
};

/* ============================================================
   SETUP (username)
   ============================================================ */
let usernameDebounce = null;
document.getElementById('setupUsername')?.addEventListener('input', e => {
  const v = e.target.value.toLowerCase().replace(/[^a-z0-9_]/g,'');
  e.target.value = v;
  const status = document.getElementById('usernameStatus');
  clearTimeout(usernameDebounce);
  if(!v){ status.innerText = 'Letters, numbers, underscore only'; status.style.color = ''; return; }
  if(v.length < 3){ status.innerText = 'Too short (min 3)'; status.style.color = ''; return; }
  if(v.length > 20){ status.innerText = 'Too long (max 20)'; status.style.color = ''; return; }
  status.innerText = 'Checking…'; status.style.color = '';
  usernameDebounce = setTimeout(async () => {
    try{
      const snap = await getDoc(doc(db,'usernames',v));
      if(snap.exists() && snap.data().uid !== myUid){
        status.innerText = '✗ @' + v + ' is taken';
        status.style.color = '#ef4444';
      } else {
        status.innerText = '✓ @' + v + ' is available';
        status.style.color = '#34C759';
      }
    }catch(e){ status.innerText = 'Could not check'; status.style.color = ''; }
  }, 350);
});

window.completeSetup = async function(){
  const name     = document.getElementById('setupName').value.trim();
  const username = document.getElementById('setupUsername').value.trim().toLowerCase();
  const about    = document.getElementById('setupAbout').value.trim();
  const errEl    = document.getElementById('setupErr');
  const btn      = document.getElementById('setupSubmit');
  errEl.innerText = '';
  if(name.length < 2){ errEl.innerText = 'Enter a display name (2+ characters).'; return; }
  if(!/^[a-z0-9_]{3,20}$/.test(username)){ errEl.innerText = 'Username: 3–20 chars, a–z 0–9 _ only.'; return; }
  if(!myUid){ errEl.innerText = 'Not signed in — refresh.'; return; }
  btn.disabled = true; btn.innerText = 'Saving…';
  try{
    await runTransaction(db, async tx => {
      const unRef = doc(db, 'usernames', username);
      const unSnap = await tx.get(unRef);
      if(unSnap.exists() && unSnap.data().uid !== myUid) throw new Error('USERNAME_TAKEN');
      tx.set(unRef, { uid: myUid, createdAt: Date.now() });
      tx.set(doc(db,'profiles',myUid), {
        username, name,
        about: about || "Hey! I'm on Dabz",
        bio: '',
        color: colorFor(username),
        email: myEmail,
        photoURL: auth.currentUser?.photoURL || '',
        createdAt: serverTimestamp()
      });
    });
    try { await updateProfile(auth.currentUser, { displayName: name }); } catch(e){}
    const p = await getDoc(doc(db,'profiles',myUid));
    myProfile = p.data();
    myUsername = p.data().username;
    myName = p.data().name;
    bootChat();
    showPage('news');
  }catch(e){
    console.error(e);
    errEl.innerText = e.message === 'USERNAME_TAKEN'
      ? 'That username is taken — pick another.'
      : 'Save failed — check Firestore rules.';
    btn.disabled = false; btn.innerText = 'Continue →';
  }
};

/* ============================================================
   AUTH STATE
   ============================================================ */
onAuthStateChanged(auth, async user => {
  console.log('[Dabz Auth]', user ? 'signed in: ' + user.uid : 'signed out');
  document.body.removeAttribute('data-loading');
  
  if(!user){
    teardownChat();
    myUid = ''; myUsername = ''; myName = ''; myEmail = ''; myPhotoURL = ''; myProfile = null;
    showAuthScreen();
    return;
  }
  myUid = user.uid;
  myEmail = user.email || '';
  myPhotoURL = user.photoURL || '';
  
  try{
    const snap = await getDoc(doc(db,'profiles',myUid));
    if(snap.exists() && snap.data().username){
      myProfile = snap.data();
      myUsername = myProfile.username;
      myName = myProfile.name;
      bootChat();
      showPage('news');
    } else {
      showSetupScreen(user);
    }
  }catch(e){
    console.error('[Dabz Auth] profile load failed:', e);
    toast('Could not load profile — ' + (e.code || e.message));
    showAuthScreen();
  }
});

/* ============================================================
   BOOT / TEARDOWN CHAT
   ============================================================ */
function bootChat(){
  teardownChat();
  chatBooted = true;
  document.getElementById('auth').style.display = 'none';
  document.getElementById('setup').style.display = 'none';
  document.getElementById('app').style.display = 'flex';
  updateChatHeader();

  const goOnline = () => setDoc(doc(db,'online',myUid), { name: myName, lastSeen: Date.now() }, { merge: true });
  goOnline();
  const hb = setInterval(goOnline, 10000);
  snapUnsubs.push(() => clearInterval(hb));

  snapUnsubs.push(onSnapshot(collection(db,'online'), snap => {
    onlineNow = {}; lastSeenMap = {};
    snap.forEach(d => {
      lastSeenMap[d.id] = d.data().lastSeen;
      if(Date.now() - d.data().lastSeen < 20000) onlineNow[d.id] = d.data().name;
    });
    if(chatView === 'list') renderConversationList();
    else if(chatView === 'dm' && dmToUid) updateChatHeader();
  }));

  snapUnsubs.push(onSnapshot(collection(db,'typing'), snap => {
    const others = [];
    snap.forEach(d => {
      if(d.id !== myUid && Date.now() - (d.data().at || 0) < 3000){
        if(chatView === 'dm' && d.id === dmToUid) others.push(d.data().name || 'Someone');
        if(chatView === 'group') others.push(d.data().name || 'Someone');
      }
    });
    const typingEl = document.getElementById('typing');
    if(typingEl) typingEl.innerText = others.length ? others.join(', ') + ' is typing…' : '';
  }));

  snapUnsubs.push(onSnapshot(collection(db,'profiles'), snap => {
    profilesByUid = {}; profilesByUsername = {};
    snap.forEach(d => {
      const p = d.data();
      profilesByUid[d.id] = { uid: d.id, ...p };
      if(p.username) profilesByUsername[p.username] = { uid: d.id, ...p };
    });
    if(chatView === 'list') renderConversationList();
    else renderMsgs();
    if(document.getElementById('page-status').classList.contains('active')) renderStatuses();
    if(document.getElementById('page-profile').classList.contains('active')) renderProfile();
  }));

  snapUnsubs.push(onSnapshot(collection(db,'groups'), snap => {
    groups = [];
    snap.forEach(d => groups.push({ id: d.id, data: d.data() }));
    if(chatView === 'list') renderConversationList();
  }));

  snapUnsubs.push(onSnapshot(query(collection(db,'dms'), orderBy('time','asc')), snap => {
    dms = [];
    snap.forEach(d => dms.push({ id: d.id, data: d.data() }));
    if(chatView === 'list') renderConversationList();
    else if(chatView === 'dm') renderMsgs();
    updateChatBadge();
  }));

  snapUnsubs.push(onSnapshot(query(collection(db,'groupMsgs'), orderBy('time','asc')), snap => {
    groupMsgs = [];
    snap.forEach(d => groupMsgs.push({ id: d.id, data: d.data() }));
    if(chatView === 'list') renderConversationList();
    else if(chatView === 'group') renderMsgs();
  }));

  snapUnsubs.push(onSnapshot(query(collection(db,'statuses'), orderBy('createdAt','desc'), limit(100)), snap => {
    statuses = [];
    const cutoff = Date.now() - 24*60*60*1000;
    snap.forEach(d => {
      const s = d.data();
      if(s.createdAt && s.createdAt >= cutoff) statuses.push({ id: d.id, data: s });
    });
    if(document.getElementById('page-status').classList.contains('active')) renderStatuses();
  }));

  snapUnsubs.push(onSnapshot(query(collection(db,'reels'), orderBy('createdAt','desc'), limit(50)), snap => {
    reels = [];
    snap.forEach(d => reels.push({ id: d.id, data: d.data() }));
    if(document.getElementById('page-reels').classList.contains('active')) renderReels();
  }));

  updatePinBar();
}

function teardownChat(){
  snapUnsubs.forEach(fn => { try { fn(); } catch(e){} });
  snapUnsubs = [];
  dms = []; groupMsgs = []; groups = []; statuses = []; reels = [];
  profilesByUid = {}; profilesByUsername = {};
  onlineNow = {}; lastSeenMap = {};
  dmToUid = null; dmToName = null; replyTo = null; groupId = null;
  chatView = 'list';
  try { cancelReply(); } catch(e){}
  chatBooted = false;
}

function updateChatBadge(){
  const badge = document.getElementById('chatBadge');
  if(!badge) return;
  const unread = dms.filter(m => {
    const d = m.data;
    return d.to === myUid && d.uid !== myUid && !(d.readBy || []).includes(myUid);
  }).length;
  if(unread > 0){ badge.innerText = unread > 99 ? '99+' : unread; badge.style.display = 'grid'; }
  else badge.style.display = 'none';
}

function updateChatHeader(){
  const back = document.getElementById('chatBackBtn');
  const avatar = document.getElementById('chatAvatar');
  const title = document.getElementById('chatTitle');
  const actions = document.getElementById('chatHeaderActions');
  if(!back || !avatar || !title) return;

  if(chatView === 'list'){
    back.style.display = 'none';
    avatar.style.display = 'grid';
    avatar.innerHTML = myPhotoURL ? `<img src="${myPhotoURL}" alt="">` : initials(myName);
    avatar.onclick = () => showPage('profile');
    title.innerText = 'Dabz';
    actions.innerHTML = `<button onclick="openNewChatMenu()" title="New">＋</button>`;
  } else if(chatView === 'dm'){
    back.style.display = 'grid';
    avatar.style.display = 'none';
    const p = profilesByUid[dmToUid] || {};
    title.innerText = p.name || dmToName || 'Chat';
    actions.innerHTML = `<button onclick="openDMInfo()" title="Info">ⓘ</button>`;
  } else if(chatView === 'group'){
    back.style.display = 'grid';
    avatar.style.display = 'none';
    const g = groups.find(x => x.id === groupId);
    title.innerText = '# ' + (g?.data.name || 'Group');
    actions.innerHTML = '';
  }
}

window.backToChatList = function(){
  chatView = 'list';
  dmToUid = null; dmToName = null; groupId = null;
  document.getElementById('chatListView').style.display = 'block';
  document.getElementById('chatView').style.display = 'none';
  document.getElementById('searchBar').style.display = 'none';
  document.getElementById('searchInput').value = '';
  cancelReply();
  updateChatHeader();
  renderConversationList();
  updatePinBar();
};

/* ============================================================
   CONVERSATION LIST
   ============================================================ */
function buildConversationList(){
  const convs = {};

  dms.forEach(m => {
    const d = m.data;
    if(!d.uid || !d.to) return;
    let otherUid = null;
    if(d.uid === myUid && d.to !== myUid) otherUid = d.to;
    else if(d.to === myUid && d.uid !== myUid) otherUid = d.uid;
    if(!otherUid) return;
    const cid = 'dm_' + otherUid;
    const t = d.time?.seconds || 0;
    if(!convs[cid] || t > convs[cid].lastTime){
      convs[cid] = { type: 'dm', targetUid: otherUid, lastMsg: d, lastTime: t };
    }
  });

  groups.forEach(g => {
    const msgs = groupMsgs.filter(m => m.data.groupId === g.id);
    const last = msgs.length ? msgs[msgs.length - 1].data : null;
    const lastTime = last?.time?.seconds || (g.data.createdAt ? g.data.createdAt / 1000 : 0);
    convs['grp_' + g.id] = {
      type: 'group', groupId: g.id, groupName: g.data.name || 'Group',
      lastMsg: last, lastTime
    };
  });

  return Object.values(convs).sort((a,b) => b.lastTime - a.lastTime);
}

function renderConversationList(){
  const box = document.getElementById('conversationList');
  if(!box) return;
  const list = buildConversationList();

  if(!list.length){
    box.innerHTML = `<div class="conv-empty">
      <div class="big">💬</div>
      <p>No chats yet.<br>Start a new one!</p>
      <button class="btn" style="max-width:220px;margin:0 auto" onclick="openNewChatMenu()">New Chat</button>
    </div>`;
    return;
  }

  box.innerHTML = list.map(c => {
    if(c.type === 'dm'){
      const p = profilesByUid[c.targetUid] || {};
      const name = p.name || 'User';
      const isOnline = !!onlineNow[c.targetUid];
      const av = p.photoURL ? `<img src="${p.photoURL}" alt="">` : initials(name);
      const avBg = p.photoURL ? 'transparent' : (p.color || colorFor(c.targetUid));
      const unread = c.lastMsg && c.lastMsg.uid !== myUid && !(c.lastMsg.readBy || []).includes(myUid);
      const preview = c.lastMsg
        ? (c.lastMsg.text ? (c.lastMsg.uid === myUid ? 'You: ' + c.lastMsg.text : c.lastMsg.text)
           : c.lastMsg.image ? '📷 Photo'
           : c.lastMsg.audio ? '🎤 Voice'
           : 'Tap to chat')
        : 'Tap to chat';
      const time = c.lastMsg?.time ? new Date(c.lastMsg.time.seconds*1000).toLocaleTimeString([], {hour:'2-digit', minute:'2-digit', hour12:false}) : '';
      return `<div class="conv-row" onclick="openDMConversation('${c.targetUid}')">
        <div class="conv-avatar" style="background:${avBg}">
          ${av}${isOnline ? '<span class="online-dot"></span>' : ''}
        </div>
        <div class="conv-body">
          <div class="conv-top">
            <span class="conv-name">${escapeHtml(name)}</span>
            <span class="conv-time">${time}</span>
          </div>
          <div class="conv-preview ${unread ? 'unread' : ''}">${escapeHtml(preview)}</div>
        </div>
        ${unread ? `<div class="conv-unread-badge">•</div>` : ''}
      </div>`;
    } else {
      const name = c.groupName;
      const preview = c.lastMsg?.text
        ? (c.lastMsg.name ? `${c.lastMsg.name.split(' ')[0]}: ${c.lastMsg.text}` : c.lastMsg.text)
        : 'Group';
      const time = c.lastMsg?.time ? new Date(c.lastMsg.time.seconds*1000).toLocaleTimeString([], {hour:'2-digit', minute:'2-digit', hour12:false}) : '';
      return `<div class="conv-row" onclick="openGroupConversation('${c.groupId}')">
        <div class="conv-avatar" style="background:var(--primary-dark)">
          <span style="font-size:20px">👥</span>
        </div>
        <div class="conv-body">
          <div class="conv-top">
            <span class="conv-name">${escapeHtml(name)}</span>
            <span class="conv-time">${time}</span>
          </div>
          <div class="conv-preview">${escapeHtml(preview)}</div>
        </div>
      </div>`;
    }
  }).join('');
}

/* ============================================================
   OPEN / CLOSE CONVERSATION
   ============================================================ */
window.openDMConversation = function(uid){
  if(!uid || uid === myUid) return;
  dmToUid = uid;
  dmToName = profilesByUid[uid]?.name || 'User';
  groupId = null;
  chatView = 'dm';
  document.getElementById('chatListView').style.display = 'none';
  document.getElementById('chatView').style.display = 'flex';
  document.getElementById('msgInput').placeholder = 'Message ' + dmToName + '…';
  updateChatHeader();
  renderMsgs();
  updatePinBar();
  setTimeout(() => document.getElementById('msgInput')?.focus(), 100);
};

window.openGroupConversation = function(gid){
  if(!gid) return;
  groupId = gid;
  dmToUid = null; dmToName = null;
  chatView = 'group';
  document.getElementById('chatListView').style.display = 'none';
  document.getElementById('chatView').style.display = 'flex';
  document.getElementById('msgInput').placeholder = 'Message group…';
  updateChatHeader();
  renderMsgs();
  updatePinBar();
  setTimeout(() => document.getElementById('msgInput')?.focus(), 100);
};

/* ============================================================
   NEW CHAT / NEW GROUP
   ============================================================ */
window.openNewChatMenu = function(){
  document.getElementById('newChatMenuModal').style.display = 'flex';
};
window.openNewDMModal = function(){
  document.getElementById('newDMModal').style.display = 'flex';
  document.getElementById('dmUsername').value = '';
  document.getElementById('dmSearchResults').innerHTML = '';
  setTimeout(() => document.getElementById('dmUsername').focus(), 50);
};

let dmSearchDebounce = null;
window.searchDMUser = function(){
  clearTimeout(dmSearchDebounce);
  dmSearchDebounce = setTimeout(doSearchDMUser, 350);
};

async function doSearchDMUser(){
  const q = document.getElementById('dmUsername').value.trim().toLowerCase().replace(/^@/,'');
  const results = document.getElementById('dmSearchResults');
  if(!q || q.length < 2){ results.innerHTML = ''; return; }
  try{
    const snap = await getDoc(doc(db,'usernames',q));
    if(!snap.exists()){
      results.innerHTML = `<p class="hint" style="margin-top:12px">No user with @${escapeHtml(q)}</p>`;
      return;
    }
    const uid = snap.data().uid;
    if(uid === myUid){
      results.innerHTML = `<p class="hint" style="margin-top:12px">That's you! 😄</p>`;
      return;
    }
    const p = profilesByUid[uid];
    if(!p){
      results.innerHTML = `<p class="hint">Loading…</p>`;
      setTimeout(doSearchDMUser, 500);
      return;
    }
    const av = p.photoURL ? `<img src="${p.photoURL}" alt="">` : initials(p.name);
    const avBg = p.photoURL ? 'transparent' : (p.color || colorFor(uid));
    results.innerHTML = `
      <div class="friend-result" style="cursor:pointer" onclick="startNewDM('${uid}')">
        <div class="av" style="background:${avBg}">${av}</div>
        <div class="info">
          <b>${escapeHtml(p.name)}</b>
          <small>@${escapeHtml(p.username)}</small>
        </div>
        <button class="btn2" style="background:var(--primary);color:#fff">Chat</button>
      </div>`;
  }catch(e){ console.error(e); }
}

window.startNewDM = function(uid){
  closeModal('newDMModal');
  openDMConversation(uid);
};

window.openCreateGroup = function(){
  document.getElementById('groupModal').style.display = 'flex';
};
window.createGroup = async function(){
  const name = document.getElementById('groupName').value.trim();
  if(!name){ toast('Type group name'); return; }
  const desc = document.getElementById('groupDesc').value.trim();
  const ref = await addDoc(collection(db,'groups'), {
    name, desc, createdBy: myName, createdByUid: myUid, createdAt: Date.now()
  });
  closeModal('groupModal');
  document.getElementById('groupName').value = '';
  document.getElementById('groupDesc').value = '';
  toast('Group created 👥');
  openGroupConversation(ref.id);
};

window.openDMInfo = function(){
  if(!dmToUid) return;
  openProfile(dmToUid);
};

/* ============================================================
   MESSAGES RENDERING
   ============================================================ */
function currentCollection(){
  if(chatView === 'dm') return 'dms';
  if(chatView === 'group') return 'groupMsgs';
  return null;
}
function currentMessages(){
  if(chatView === 'dm') return dms.filter(m => m.data.dmId === dmId(myUid, dmToUid));
  if(chatView === 'group') return groupMsgs.filter(m => m.data.groupId === groupId);
  return [];
}

function ticksSvg(read){
  return `<svg class="msg-tick ${read ? 'read' : ''}" viewBox="0 0 16 11" fill="none"
    stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
    <path d="M1 6l3 3 6-7"/>
    ${read ? '<path d="M8 9l1 1 6-7"/>' : ''}
  </svg>`;
}
function formatDate(d){
  const t = new Date(); const y = new Date(t); y.setDate(y.getDate() - 1);
  if(d.toDateString() === t.toDateString()) return 'Today';
  if(d.toDateString() === y.toDateString()) return 'Yesterday';
  return d.toLocaleDateString([], {day:'numeric', month:'short', year:'numeric'});
}
function msgAvatarHtml(uid, name){
  const p = profilesByUid[uid] || {};
  const col = p.color || colorFor(name || uid);
  const inner = p.photoURL ? `<img src="${p.photoURL}" alt="">` : initials(name || '?');
  return `<div class="msg-avatar" style="background:${p.photoURL ? 'transparent' : col}" onclick="event.stopPropagation();openProfile('${uid}')" title="${escapeHtml(name || '')}">${inner}</div>`;
}
function renderReactions(coll, id, reactions){
  if(!reactions) return '';
  const keys = Object.keys(reactions);
  if(!keys.length) return '';
  let html = '<div class="reactions">';
  keys.forEach(emoji => {
    const users = reactions[emoji];
    const mine = users.includes(myUid);
    html += `<button class="react ${mine ? 'mine' : ''}" onclick="event.stopPropagation();reactTo('${coll}','${id}','${emoji}')">${emoji} ${users.length}</button>`;
  });
  return html + '</div>';
}
function msgHtml(item, coll, grouped){
  const m = item.data, id = item.id;
  const time = m.time ? new Date(m.time.seconds * 1000).toLocaleTimeString([], {hour:'2-digit', minute:'2-digit', hour12:false}) : '';
  const mine = m.uid === myUid;
  const p = profilesByUid[m.uid] || {};
  const col = p.color || colorFor(m.name || m.uid || '?');
  const readByOthers = (m.readBy || []).some(u => u !== myUid);

  const quote = m.replyTo
    ? `<div class="replyQuote"><b>${escapeHtml(m.replyTo.name)}</b>${escapeHtml((m.replyTo.text || '📷 / 🎤').slice(0,60))}</div>`
    : '';
  const img = m.image ? `<img src="${m.image}" alt="">` : '';
  const aud = m.audio ? `<audio controls src="${m.audio}"></audio>` : '';
  const textBlock = m.text ? `<span class="msg-text">${escapeHtml(m.text)}</span>` : '';

  const showName = !mine && chatView === 'group' && !grouped;
  const avatar = (mine || (chatView === 'dm' && !showName)) ? '' : msgAvatarHtml(m.uid, m.name);
  const nameHtml = showName
    ? `<div class="msg-name" style="color:${col}" onclick="event.stopPropagation();openProfile('${m.uid}')">${escapeHtml(m.name || 'User')}</div>`
    : '';

  const reactions = renderReactions(coll, id, m.reactions);
  const actions = `<div class="msg-actions">
    <button title="Love" onclick="event.stopPropagation();reactTo('${coll}','${id}','❤️')">❤️</button>
    <button title="Fire" onclick="event.stopPropagation();reactTo('${coll}','${id}','🔥')">🔥</button>
    <button title="Laugh" onclick="event.stopPropagation();reactTo('${coll}','${id}','😂')">😂</button>
    <button title="Like" onclick="event.stopPropagation();reactTo('${coll}','${id}','👍')">👍</button>
    <button title="Reply" onclick="event.stopPropagation();setReply('${id}')">↩</button>
    ${mine ? `<button title="Unsend" onclick="event.stopPropagation();deleteMsg('${id}')">🤫</button>` : ''}
  </div>`;

  return `<div class="msg ${mine ? 'mine' : 'other'}${grouped ? ' grouped' : ''}">
    ${avatar}
    <div class="msg-bubble">
      ${nameHtml}${quote}${textBlock}${img}${aud}
      <div class="msg-meta">${time}${mine ? ticksSvg(readByOthers) : ''}</div>
      ${reactions}${actions}
    </div>
  </div>`;
}

function renderMsgs(){
  if(chatView === 'list') return;
  const box = document.getElementById('msgs');
  const search = document.getElementById('searchInput').value.trim().toLowerCase();
  const coll = currentCollection();
  let list = currentMessages();

  if(search) list = list.filter(x =>
    (x.data.text || '').toLowerCase().includes(search) ||
    (x.data.name || '').toLowerCase().includes(search));

  if(!list.length){
    box.innerHTML = search
      ? `<div style="text-align:center;color:var(--text-2);padding:20px">No results for "${escapeHtml(search)}"</div>`
      : `<div style="text-align:center;color:var(--text-2);padding:60px 20px">
           <div style="font-size:42px;margin-bottom:10px">👋</div>
           <div>${chatView === 'dm' ? 'Say hi to ' + escapeHtml(dmToName || '') : 'Start the group chat!'}</div>
         </div>`;
    return;
  }

  let html = '', lastDate = '';
  list.forEach((item, i) => {
    if(item.data.time){
      const d = new Date(item.data.time.seconds * 1000);
      const ds = d.toDateString();
      if(ds !== lastDate){ lastDate = ds; html += `<div class="wa-date">${formatDate(d)}</div>`; }
    }
    const prev = i > 0 ? list[i-1] : null;
    const grouped = !!(prev && prev.data.uid === item.data.uid &&
      item.data.time && prev.data.time &&
      Math.abs(item.data.time.seconds - prev.data.time.seconds) < 120);
    html += msgHtml(item, coll, grouped);
  });
  box.innerHTML = html;
  box.scrollTop = box.scrollHeight;
  markAsRead(list, coll);
}

async function markAsRead(list, coll){
  for(const item of list){
    const m = item.data;
    if(m.uid === myUid) continue;
    if(m.readBy && m.readBy.includes(myUid)) continue;
    try{ await updateDoc(doc(db, coll, item.id), {readBy: arrayUnion(myUid)}); }catch(e){}
  }
}

/* ============================================================
   COMPOSER / REPLY / EMOJI / SEARCH
   ============================================================ */
window.toggleSearch = function(){
  const b = document.getElementById('searchBar');
  b.style.display = b.style.display === 'block' ? 'none' : 'block';
  if(b.style.display === 'block') document.getElementById('searchInput').focus();
  else { document.getElementById('searchInput').value = ''; renderMsgs(); }
};

const emojis = ["😀","😂","😍","🔥","❤️","👍","👏","😮","😢","😡","🎉","💯","🙏","😎","🤔","🥳","🇰🇪","⚽","🎵","💬"];
window.toggleEmoji = function(){
  const bar = document.getElementById('emojiBar');
  if(bar.style.display === 'flex'){ bar.style.display = 'none'; return; }
  bar.innerHTML = ''; bar.style.display = 'flex';
  emojis.forEach(e => {
    const b = document.createElement('button');
    b.innerText = e;
    b.onclick = () => { document.getElementById('msgInput').value += e; document.getElementById('msgInput').focus(); };
    bar.appendChild(b);
  });
};

window.setReply = function(id){
  const list = currentMessages();
  const found = list.find(x => x.id === id);
  if(!found) return;
  replyTo = { id, uid: found.data.uid, name: found.data.name, text: found.data.text || '' };
  document.getElementById('replyBar').style.display = 'flex';
  document.getElementById('replyText').innerHTML = `Replying to <b style="font-weight:500">${escapeHtml(replyTo.name)}</b>: ${escapeHtml(replyTo.text.slice(0,40))}`;
  document.getElementById('msgInput').focus();
};
window.cancelReply = function(){
  replyTo = null;
  const bar = document.getElementById('replyBar');
  if(bar) bar.style.display = 'none';
};

window.onTyping = function(){
  if(!myUid) return;
  setDoc(doc(db,'typing',myUid), { name: myName, at: Date.now() }, { merge: true });
  clearTimeout(typingTimeout);
  typingTimeout = setTimeout(() => setDoc(doc(db,'typing',myUid), { at: 0 }, { merge: true }), 2500);
};

/* ============================================================
   SEND
   ============================================================ */
window.sendMsg = async function(){
  const t = document.getElementById('msgInput').value.trim();
  if(!t) return;
  if(chatView !== 'dm' && chatView !== 'group') return;

  const payload = {
    uid: myUid, name: myName, username: myUsername,
    text: t, time: serverTimestamp(),
    replyTo: replyTo || null, reactions: {}, readBy: [myUid]
  };
  if(chatView === 'dm'){
    if(!dmToUid) return;
    payload.dmId = dmId(myUid, dmToUid);
    payload.to = dmToUid;
    await addDoc(collection(db,'dms'), payload);
  } else {
    if(!groupId) return;
    payload.groupId = groupId;
    await addDoc(collection(db,'groupMsgs'), payload);
  }
  document.getElementById('msgInput').value = '';
  document.getElementById('emojiBar').style.display = 'none';
  cancelReply();
  setDoc(doc(db,'typing',myUid), { at: 0 }, { merge: true });
};

window.sendImage = function(input){
  const file = input.files[0];
  if(!file) return;
  if(file.size > 700000){ toast('Image too large (>700KB)'); input.value = ''; return; }
  const reader = new FileReader();
  reader.onload = async e => {
    const payload = {
      uid: myUid, name: myName, username: myUsername,
      text: '', image: e.target.result,
      time: serverTimestamp(), replyTo: replyTo || null,
      reactions: {}, readBy: [myUid]
    };
    if(chatView === 'dm' && dmToUid){ payload.dmId = dmId(myUid, dmToUid); payload.to = dmToUid; await addDoc(collection(db,'dms'), payload); }
    else if(chatView === 'group' && groupId){ payload.groupId = groupId; await addDoc(collection(db,'groupMsgs'), payload); }
    else return;
    toast('Photo sent 📷');
    cancelReply();
  };
  reader.readAsDataURL(file);
  input.value = '';
};

window.toggleVoice = async function(){
  const btn = document.getElementById('voiceBtn');
  if(chatView !== 'dm' && chatView !== 'group') return;
  if(!isRecording){
    try{
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      mediaRecorder = new MediaRecorder(stream);
      audioChunks = [];
      isRecording = true;
      btn.classList.add('rec');
      btn.innerText = '⏹️';
      toast('Recording… Tap again to send 🎤');
      mediaRecorder.ondataavailable = e => audioChunks.push(e.data);
      mediaRecorder.onstop = async () => {
        const blob = new Blob(audioChunks, { type: 'audio/webm' });
        const reader = new FileReader();
        reader.onload = async e => {
          const payload = {
            uid: myUid, name: myName, username: myUsername,
            text: '', audio: e.target.result,
            time: serverTimestamp(), replyTo: replyTo || null,
            reactions: {}, readBy: [myUid]
          };
          if(chatView === 'dm' && dmToUid){ payload.dmId = dmId(myUid, dmToUid); payload.to = dmToUid; await addDoc(collection(db,'dms'), payload); }
          else if(chatView === 'group' && groupId){ payload.groupId = groupId; await addDoc(collection(db,'groupMsgs'), payload); }
          toast('Voice note sent 🎤');
        };
        reader.readAsDataURL(blob);
        stream.getTracks().forEach(t => t.stop());
      };
      mediaRecorder.start();
    }catch(e){ toast('Mic blocked — allow microphone'); }
  } else {
    isRecording = false;
    btn.classList.remove('rec');
    btn.innerText = '🎤';
    mediaRecorder.stop();
  }
};

/* ============================================================
   REACTIONS / DELETE / PIN
   ============================================================ */
window.reactTo = async function(coll, id, emoji){
  try{
    const ref = doc(db, coll, id);
    const snap = await getDoc(ref);
    if(!snap.exists()) return;
    const data = snap.data();
    const reactions = data.reactions || {};
    let list = reactions[emoji] || [];
    if(list.includes(myUid)) list = list.filter(u => u !== myUid);
    else list.push(myUid);
    if(list.length === 0) delete reactions[emoji];
    else reactions[emoji] = list;
    await updateDoc(ref, { reactions });
  }catch(e){ console.error(e); }
};

window.deleteMsg = async function(id){
  const coll = currentCollection();
  if(!coll) return;
  const list = currentMessages();
  const found = list.find(x => x.id === id);
  if(!found) return;
  if(found.data.uid !== myUid){ toast('You can only unsend your own messages'); return; }
  const othersSeen = (found.data.readBy || []).filter(u => u !== myUid);
  const msg = othersSeen.length === 0
    ? 'Unsend this message?\nNobody has seen it yet — it will vanish completely.'
    : `Delete? ${othersSeen.length} person(s) already saw it, but it will still disappear.`;
  if(!confirm(msg)) return;
  await deleteDoc(doc(db, coll, id));
  toast('Unsent silently 🤫');
};

window.pinMsg = function(id){
  const list = currentMessages();
  const found = list.find(x => x.id === id);
  if(!found) return;
  pinnedMsg = {
    tab: chatView,
    groupId,
    dmId: dmToUid ? dmId(myUid, dmToUid) : null,
    text: found.data.text || '📷 / 🎤',
    name: found.data.name, id
  };
  localStorage.setItem('dabz-pin', JSON.stringify(pinnedMsg));
  updatePinBar();
  toast('Pinned 📌');
};
window.unpin = function(){ pinnedMsg = null; localStorage.removeItem('dabz-pin'); updatePinBar(); };

function updatePinBar(){
  const saved = localStorage.getItem('dabz-pin');
  if(saved) try{ pinnedMsg = JSON.parse(saved); }catch(e){}
  const bar = document.getElementById('pinBar');
  if(!bar) return;
  let show = false;
  if(pinnedMsg){
    if(chatView === 'dm' && pinnedMsg.tab === 'dm' && pinnedMsg.dmId === dmId(myUid, dmToUid || '')) show = true;
    if(chatView === 'group' && pinnedMsg.tab === 'group' && pinnedMsg.groupId === groupId) show = true;
  }
  if(show){
    bar.style.display = 'flex';
    document.getElementById('pinText').innerHTML = `📌 <b style="font-weight:500">${escapeHtml(pinnedMsg.name)}:</b> ${escapeHtml(pinnedMsg.text.slice(0,60))}`;
  } else bar.style.display = 'none';
}

/* ============================================================
   STATUS
   ============================================================ */
let statusComposerType = 'text', statusBgColor = '#0A84FF', statusImageData = null;

window.openStatusComposer = function(){
  document.getElementById('statusComposerModal').style.display = 'flex';
  statusComposerType = 'text';
  statusBgColor = '#0A84FF';
  statusImageData = null;
  document.getElementById('statusText').value = '';
  document.getElementById('statusCaption').value = '';
  document.getElementById('statusImagePreview').style.display = 'none';
  document.getElementById('statusImagePreview').src = '';
  const prev = document.getElementById('statusPreview');
  prev.innerText = 'Your status here…';
  prev.style.background = '#0A84FF';
  document.getElementById('statusComposerErr').innerText = '';
  statusType('text');
  buildColorGrid();
};

function buildColorGrid(){
  const statusColors = ['#0A84FF','#34C759','#FF9500','#FF3B30','#AF52DE','#5856D6','#00C7BE','#FF2D55','#FFCC00','#111827','#667781','#8B5CF6'];
  document.getElementById('statusColorGrid').innerHTML = statusColors.map(c =>
    `<button style="background:${c}" class="${c === statusBgColor ? 'sel' : ''}" onclick="selectStatusColor('${c}')"></button>`
  ).join('');
}
window.selectStatusColor = function(c){
  statusBgColor = c;
  document.getElementById('statusPreview').style.background = c;
  buildColorGrid();
};
window.statusType = function(t){
  statusComposerType = t;
  document.getElementById('stTextBtn').classList.toggle('active', t === 'text');
  document.getElementById('stImageBtn').classList.toggle('active', t === 'image');
  document.getElementById('stTextPanel').style.display = t === 'text' ? 'block' : 'none';
  document.getElementById('stImagePanel').style.display = t === 'image' ? 'block' : 'none';
};
window.updateStatusPreview = function(){
  const v = document.getElementById('statusText').value || 'Your status here…';
  document.getElementById('statusPreview').innerText = v;
};
window.previewStatusImage = function(input){
  const file = input.files[0];
  if(!file) return;
  if(file.size > 600000){ toast('Image too large (>600KB)'); input.value = ''; return; }
  const reader = new FileReader();
  reader.onload = e => {
    statusImageData = e.target.result;
    const img = document.getElementById('statusImagePreview');
    img.src = statusImageData;
    img.style.display = 'block';
  };
  reader.readAsDataURL(file);
};
window.postStatus = async function(){
  const err = document.getElementById('statusComposerErr');
  err.innerText = '';
  const payload = { uid: myUid, name: myName, username: myUsername, createdAt: Date.now(), viewers: [] };
  if(statusComposerType === 'text'){
    const text = document.getElementById('statusText').value.trim();
    if(!text){ err.innerText = 'Write something first.'; return; }
    payload.type = 'text'; payload.text = text; payload.bgColor = statusBgColor;
  } else {
    if(!statusImageData){ err.innerText = 'Choose an image.'; return; }
    payload.type = 'image';
    payload.image = statusImageData;
    payload.caption = document.getElementById('statusCaption').value.trim();
  }
  try{
    await addDoc(collection(db,'statuses'), payload);
    toast('Status posted ✓');
    closeModal('statusComposerModal');
  }catch(e){ console.error(e); err.innerText = 'Post failed'; }
};

function renderStatuses(){
  const myItems = statuses.filter(s => s.data.uid === myUid).sort((a,b) => b.data.createdAt - a.data.createdAt);
  const others = statuses.filter(s => s.data.uid !== myUid);
  const byUser = {};
  others.forEach(s => { if(!byUser[s.data.uid]) byUser[s.data.uid] = []; byUser[s.data.uid].push(s); });

  const recentUsers = [], viewedUsers = [];
  Object.keys(byUser).forEach(uid => {
    const items = byUser[uid];
    const allViewed = items.every(s => (s.data.viewers || []).includes(myUid));
    if(allViewed) viewedUsers.push(uid); else recentUsers.push(uid);
  });

  const myRow = document.getElementById('myStatusRow');
  if(myItems.length){
    const d = myItems[0].data;
    const thumb = d.type === 'image' && d.image
      ? `<img src="${d.image}" style="width:100%;height:100%;object-fit:cover">`
      : `<div style="width:100%;height:100%;background:${d.bgColor || '#0A84FF'};display:grid;place-items:center;color:#fff;font-size:10px;border-radius:50%">Status</div>`;
    myRow.innerHTML = `<div class="status-circle" onclick="viewStatus('${myUid}')">
      <div class="status-ring mine">${thumb}</div><small>My status</small></div>`;
  } else {
    myRow.innerHTML = `<div class="status-circle" onclick="openStatusComposer()">
      <div class="status-ring mine" style="background:var(--divider)"><div class="status-inner">＋</div></div>
      <small>Add status</small></div>`;
  }

  const circleFor = uid => {
    const p = profilesByUid[uid] || {};
    const items = byUser[uid];
    const allViewed = items.every(s => (s.data.viewers || []).includes(myUid));
    const av = p.photoURL ? `<img src="${p.photoURL}">` : initials(p.name || '?');
    return `<div class="status-circle" onclick="viewStatus('${uid}')">
      <div class="status-ring ${allViewed ? 'viewed' : ''}">
        <div class="status-inner" style="background:${p.photoURL ? 'transparent' : (p.color || colorFor(uid))}">${av}</div>
      </div>
      <small>${escapeHtml(p.name || 'User')}</small>
    </div>`;
  };
  document.getElementById('recentStatusRow').innerHTML = recentUsers.length ? recentUsers.map(circleFor).join('') : '<p class="hint">No recent updates</p>';
  document.getElementById('viewedStatusRow').innerHTML = viewedUsers.length ? viewedUsers.map(circleFor).join('') : '<p class="hint">No viewed updates</p>';
}

let statusViewerState = null;
window.viewStatus = function(uid){
  const items = statuses.filter(s => s.data.uid === uid).sort((a,b) => a.data.createdAt - b.data.createdAt);
  if(!items.length) return;
  statusViewerState = { uid, items, index: 0, timer: null };
  document.getElementById('statusViewer').classList.add('show');
  renderStatusViewer();
};
function renderStatusViewer(){
  const s = statusViewerState;
  if(!s) return;
  const item = s.items[s.index];
  if(!item){ closeStatusViewer(); return; }
  const d = item.data;
  const p = profilesByUid[d.uid] || {};
  const av = document.getElementById('svAvatar');
  av.innerHTML = p.photoURL ? `<img src="${p.photoURL}">` : initials(p.name || d.name);
  document.getElementById('svName').innerText = (p.name || d.name || 'User') + ' · ' + new Date(d.createdAt).toLocaleTimeString([], {hour:'2-digit', minute:'2-digit'});
  document.getElementById('svProgress').innerHTML = s.items.map((_, i) => {
    const cls = i < s.index ? 'viewed' : i === s.index ? 'active' : '';
    return `<div class="${cls}"></div>`;
  }).join('');
  const content = document.getElementById('svContent');
  if(d.type === 'image' && d.image){ content.innerHTML = `<img src="${d.image}">`; }
  else { content.innerHTML = `<div class="bg-text" style="background:${d.bgColor || '#0A84FF'}">${escapeHtml(d.text || '')}</div>`; }
  clearTimeout(s.timer);
  s.timer = setTimeout(() => statusNav(1), 5000);
  markStatusViewed(item.id);
}
window.statusNav = function(dir){
  const s = statusViewerState;
  if(!s) return;
  s.index += dir;
  if(s.index < 0) s.index = 0;
  if(s.index >= s.items.length){ closeStatusViewer(); return; }
  renderStatusViewer();
};
window.closeStatusViewer = function(){
  const s = statusViewerState;
  if(s) clearTimeout(s.timer);
  statusViewerState = null;
  document.getElementById('statusViewer').classList.remove('show');
};
async function markStatusViewed(statusId){
  try{
    const ref = doc(db,'statuses',statusId);
    const snap = await getDoc(ref);
    if(!snap.exists()) return;
    if(snap.data().uid === myUid) return;
    if((snap.data().viewers || []).includes(myUid)) return;
    await updateDoc(ref, { viewers: arrayUnion(myUid) });
  }catch(e){}
}

/* ============================================================
   REELS
   ============================================================ */
let reelVideoData = null, reelObserver = null;

window.openReelComposer = function(){
  document.getElementById('reelComposerModal').style.display = 'flex';
  reelVideoData = null;
  document.getElementById('reelVideoPreview').style.display = 'none';
  document.getElementById('reelVideoPreview').src = '';
  document.getElementById('reelVideo').value = '';
  document.getElementById('reelCaption').value = '';
  document.getElementById('reelComposerErr').innerText = '';
};
window.previewReelVideo = function(input){
  const file = input.files[0];
  if(!file) return;
  if(file.size > 550000){ toast('Video too large (>550KB)'); input.value = ''; return; }
  const reader = new FileReader();
  reader.onload = e => {
    reelVideoData = e.target.result;
    const v = document.getElementById('reelVideoPreview');
    v.src = reelVideoData;
    v.style.display = 'block';
  };
  reader.readAsDataURL(file);
};
window.postReel = async function(){
  const err = document.getElementById('reelComposerErr');
  err.innerText = '';
  if(!reelVideoData){ err.innerText = 'Choose a video.'; return; }
  try{
    await addDoc(collection(db,'reels'), {
      uid: myUid, name: myName, username: myUsername,
      video: reelVideoData,
      caption: document.getElementById('reelCaption').value.trim(),
      likes: [], createdAt: Date.now()
    });
    toast('Reel posted 🎬');
    closeModal('reelComposerModal');
    showPage('reels');
  }catch(e){ console.error(e); err.innerText = 'Post failed'; }
};

function renderReels(){
  const scroll = document.getElementById('reelsScroll');
  if(!reels.length){
    scroll.innerHTML = `<div class="reel-empty">No reels yet.<br><br><button class="btn2" style="background:var(--primary);color:#fff;padding:10px 20px" onclick="openReelComposer()">Upload a reel 🎬</button></div>`;
    return;
  }
  scroll.innerHTML = reels.map(r => {
    const d = r.data;
    const liked = (d.likes || []).includes(myUid);
    const p = profilesByUid[d.uid] || {};
    return `<div class="reel" data-reel-id="${r.id}">
      <video src="${d.video}" loop playsinline muted preload="metadata"></video>
      <div class="reel-info">
        <div class="uname">@${escapeHtml(p.username || d.username || 'user')}</div>
        <div class="cap">${escapeHtml(d.caption || '')}</div>
      </div>
      <div class="reel-actions">
        <button class="${liked ? 'liked' : ''}" onclick="likeReel('${r.id}')">
          ${liked ? '❤️' : '🤍'}
          <span class="reel-count">${(d.likes || []).length}</span>
        </button>
      </div>
    </div>`;
  }).join('');
  attachReelObservers();
}

function attachReelObservers(){
  if(reelObserver) reelObserver.disconnect();
  reelObserver = new IntersectionObserver(entries => {
    entries.forEach(entry => {
      const v = entry.target;
      if(entry.isIntersecting && entry.intersectionRatio > 0.6){ v.muted = false; v.play().catch(()=>{}); }
      else { try { v.pause(); } catch(e){} }
    });
  }, { threshold: [0, 0.6, 1] });
  document.querySelectorAll('#reelsScroll video').forEach(v => reelObserver.observe(v));
}

window.likeReel = async function(reelId){
  try{
    const ref = doc(db,'reels',reelId);
    const snap = await getDoc(ref);
    if(!snap.exists()) return;
    const likes = snap.data().likes || [];
    if(likes.includes(myUid)) await updateDoc(ref, { likes: arrayRemove(myUid) });
    else await updateDoc(ref, { likes: arrayUnion(myUid) });
  }catch(e){}
};

/* ============================================================
   PROFILE
   ============================================================ */
function renderProfile(){
  if(!myProfile) return;
  const p = myProfile;
  const av = p.photoURL ? `<img src="${p.photoURL}">` : initials(p.name);
  const statusCount = statuses.filter(s => s.data.uid === myUid).length;
  const reelsCount = reels.filter(r => r.data.uid === myUid).length;
  const dmCount = new Set(
    dms
      .filter(m => m.data.uid === myUid || m.data.to === myUid)
      .map(m => m.data.uid === myUid ? m.data.to : m.data.uid)
      .filter(u => u && u !== myUid)
  ).size;
  document.getElementById('profileHero').innerHTML = `
    <div class="av" style="background:${p.photoURL ? 'transparent' : (p.color || colorFor(p.username || myUid))}">${av}</div>
    <h2>${escapeHtml(p.name)}</h2>
    <div class="username">@${escapeHtml(p.username)}</div>
    <div class="bio">${escapeHtml(p.bio || p.about || "Hey! I'm on Dabz")}</div>
    <div class="profile-stats">
      <div><div class="n">${dmCount}</div><div class="l">Chats</div></div>
      <div><div class="n">${statusCount}</div><div class="l">Status</div></div>
      <div><div class="n">${reelsCount}</div><div class="l">Reels</div></div>
    </div>`;
}

window.openEditProfile = function(){
  if(!myProfile) return;
  document.getElementById('editDisplayName').value = myProfile.name || '';
  document.getElementById('editAbout').value = myProfile.about || '';
  document.getElementById('editBio').value = myProfile.bio || '';
  document.getElementById('editColor').innerHTML = colors.map(c =>
    `<option value="${c}" ${c === myProfile.color ? 'selected' : ''}>${c}</option>`
  ).join('');
  document.getElementById('editProfileErr').innerText = '';
  document.getElementById('editProfileModal').style.display = 'flex';
};

window.saveProfile = async function(){
  const name = document.getElementById('editDisplayName').value.trim();
  const about = document.getElementById('editAbout').value.trim();
  const bio = document.getElementById('editBio').value.trim();
  const color = document.getElementById('editColor').value;
  const err = document.getElementById('editProfileErr');
  err.innerText = '';
  if(name.length < 2){ err.innerText = 'Name too short'; return; }
  try{
    await updateDoc(doc(db,'profiles',myUid), { name, about, bio, color });
    myProfile = { ...myProfile, name, about, bio, color };
    myName = name;
    toast('Profile saved ✓');
    closeModal('editProfileModal');
    renderProfile();
    updateChatHeader();
  }catch(e){ console.error(e); err.innerText = 'Save failed'; }
};

window.openProfile = async function(uid){
  if(!uid) return;
  try{
    const snap = await getDoc(doc(db,'profiles',uid));
    const p = snap.exists() ? snap.data() : { name:'User', username:'' };
    const isMe = uid === myUid;
    const isOnline = !!onlineNow[uid];
    const content = document.getElementById('profileContent');
    content.innerHTML = `
      <div class="profileHead">
        <div class="bigAv" style="background:${p.photoURL ? 'transparent' : (p.color || colorFor(uid))}">
          ${p.photoURL ? `<img src="${p.photoURL}">` : initials(p.name || '?')}
        </div>
        <h2 style="margin:10px 0 4px;font-weight:500">${escapeHtml(p.name || 'User')}</h2>
        <p style="color:var(--text-2);margin:0">@${escapeHtml(p.username || '')}</p>
        <p style="color:${isOnline ? '#34C759' : 'var(--text-2)'};margin:4px 0 0">${isOnline ? '● Online' : '○ Offline'}</p>
        ${p.about ? `<p style="color:var(--text-2);margin:6px 0 0">${escapeHtml(p.about)}</p>` : ''}
      </div>
      ${isMe ? '' : `
        <div style="margin-top:16px">
          <button class="btn" onclick="closeModal('profileModal');openDMConversation('${uid}')">💬 Message</button>
        </div>
      `}`;
    document.getElementById('profileModal').style.display = 'flex';
  }catch(e){ console.error(e); }
};

/* ============================================================
   MODALS & NEWS
   ============================================================ */
window.closeModal = function(id){ document.getElementById(id).style.display = 'none'; };

const NEWS_FEEDS = {
  all:     ['https://feeds.bbci.co.uk/news/world/rss.xml','https://feeds.bbci.co.uk/news/rss.xml'],
  sports:  ['https://feeds.bbci.co.uk/sport/rss.xml'],
  finance: ['https://feeds.bbci.co.uk/news/business/rss.xml'],
  tech:    ['https://feeds.bbci.co.uk/news/technology/rss.xml']
};

window.loadNews = async function(cat){
  newsCurrentCat = cat;
  newsLoaded = true;
  document.querySelectorAll('#newsCats button').forEach(b => b.classList.toggle('active', b.dataset.cat === cat));
  const body = document.getElementById('newsBody');
  body.innerHTML = '<div class="news-empty">Loading news…</div>';
  try{
    const feeds = NEWS_FEEDS[cat] || NEWS_FEEDS.all;
    const allItems = [];
    for(const feedUrl of feeds){
      try{
        const apiUrl = `https://api.rss2json.com/v1/api.json?rss_url=${encodeURIComponent(feedUrl)}&count=15`;
        const res = await fetch(apiUrl);
        const data = await res.json();
        if(data.status === 'ok' && Array.isArray(data.items)) allItems.push(...data.items);
      }catch(e){ console.warn('feed failed', feedUrl, e); }
    }
    if(!allItems.length){
      body.innerHTML = '<div class="news-empty">Could not load news. Check your connection.</div>';
      return;
    }
    allItems.sort((a,b) => new Date(b.pubDate) - new Date(a.pubDate));
    body.innerHTML = allItems.map(item => {
      let img = item.thumbnail || item.enclosure?.link || '';
      if(!img){
        const m = (item.description || '').match(/<img[^>]+src="([^"]+)"/i);
        if(m) img = m[1];
      }
      const desc = (item.description || '').replace(/<[^>]+>/g,'').slice(0,200);
      const link = escapeHtml(item.link || '#');
      return `
        <div class="news-card" onclick="window.open('${link}','_blank','noopener')">
          ${img ? `<img src="${escapeHtml(img)}" onerror="this.style.display='none'">` : ''}
          <div class="news-card-body">
            <div class="news-card-title">${escapeHtml(item.title || '')}</div>
            <p class="news-card-desc">${escapeHtml(desc)}</p>
            <div class="news-card-meta">
              <span>${escapeHtml(item.author || 'BBC')}</span>
              <span>·</span>
              <span>${new Date(item.pubDate).toLocaleDateString()}</span>
            </div>
          </div>
        </div>`;
    }).join('');
  }catch(e){
    console.error(e);
    body.innerHTML = '<div class="news-empty">Could not load news.</div>';
  }
};
window.refreshNews = function(){ loadNews(newsCurrentCat); };

/* ============================================================
   FINAL INIT
   ============================================================ */
showPage('news');
