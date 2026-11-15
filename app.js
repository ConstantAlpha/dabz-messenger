import { initializeApp } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js";
import {
  getFirestore, collection, addDoc, onSnapshot, query, orderBy,
  deleteDoc, doc, getDocs, setDoc, getDoc, updateDoc,
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
const db  = getFirestore(app);
const auth = getAuth(app);

/* ============================================================
   STATE
   ============================================================ */
let myUid = '', myUsername = '', myName = '', myEmail = '', myPhotoURL = '';
let myProfile = null;
let authMode = 'signin';

let profilesByUid = {}, profilesByUsername = {};
let myFriends = [], friendAcceptIn = [], friendAcceptOut = [], incomingRequests = [];
let onlineNow = {}, lastSeenMap = {};

let messages = [], dms = [], groupMsgs = [], groups = [], statuses = [], reels = [];

let currentTab = 'global';
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
function timeAgo(ts){
  if(!ts) return 'never';
  const d = Date.now()-ts;
  if(d<15000) return 'Online now';
  if(d<60000) return 'Just now';
  if(d<3600000) return Math.floor(d/60000)+'m ago';
  if(d<86400000) return Math.floor(d/3600000)+'h ago';
  return new Date(ts).toLocaleDateString();
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
function toast(t){
  const el = document.getElementById('toast');
  el.innerText = t; el.style.display = 'block';
  clearTimeout(el._t);
  el._t = setTimeout(()=> el.style.display = 'none', 2200);
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
    'auth/operation-not-allowed': 'Sign-in method disabled in Firebase Console.'
  };
  return map[code] || 'Something went wrong. Try again.';
}

/* ============================================================
   THEME
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

/* ============================================================
   PAGE NAVIGATION
   ============================================================ */
window.showPage = function(page){
  document.querySelectorAll('.page').forEach(p => p.classList.toggle('active', p.id === 'page-'+page));
  document.querySelectorAll('#bottomNav button').forEach(b => b.classList.toggle('active', b.dataset.page === page));

  if(page !== 'reels'){
    document.querySelectorAll('#reelsScroll video').forEach(v => { try { v.pause(); } catch(e){} });
  }
  if(page === 'news' && !newsLoaded){ loadNews('all'); }
  if(page === 'status'){ renderStatuses(); }
  if(page === 'reels'){ renderReels(); }
  if(page === 'profile'){ renderProfile(); }
};

/* ============================================================
   AUTH UI
   ============================================================ */
function showAuthScreen(){
  document.getElementById('auth').style.display = 'flex';
  document.getElementById('setup').style.display = 'none';
  document.getElementById('app').style.display = 'none';
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
  if(user.photoURL){
    av.innerHTML = `<img src="${user.photoURL}" alt="">`;
  } else {
    av.innerHTML = '';
    av.style.background = colorFor(name);
    av.innerText = initials(name||'?');
  }
}

window.toggleAuthMode = function(){
  authMode = authMode === 'signin' ? 'signup' : 'signin';
  const isSignup = authMode === 'signup';
  document.getElementById('authPass2').style.display = isSignup ? 'block' : 'none';
  document.getElementById('authSubmit').innerText = isSignup ? 'Create account' : 'Sign in';
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
  }catch(e){
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
  }catch(e){ errEl.innerText = friendlyAuthError(e.code); }
};

window.forgotPassword = async function(){
  const email = document.getElementById('authEmail').value.trim();
  const errEl = document.getElementById('authErr');
  if(!email){ errEl.innerText = 'Type your email first.'; return; }
  try{
    await sendPasswordResetEmail(auth, email);
    toast('Reset link sent to ' + email);
  }catch(e){ errEl.innerText = friendlyAuthError(e.code); }
};

/* ============================================================
   SETUP (username claim)
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
      if(unSnap.exists() && unSnap.data().uid !== myUid){
        throw new Error('USERNAME_TAKEN');
      }
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

window.handleSignOut = async function(){
  if(!confirm('Sign out of Dabz?')) return;
  teardownChat();
  localStorage.removeItem('dabz-pin');
  try{ await fbSignOut(auth); }catch(e){ console.error(e); }
};

/* ============================================================
   AUTH STATE
   ============================================================ */
onAuthStateChanged(auth, async user => {
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
    console.error(e);
    toast('Could not load profile — check Firestore rules');
    showAuthScreen();
  }
});

/* ============================================================
   CHAT BOOT / TEARDOWN
   ============================================================ */
function bootChat(){
  teardownChat();
  chatBooted = true;
  document.getElementById('auth').style.display = 'none';
  document.getElementById('setup').style.display = 'none';
  document.getElementById('app').style.display = 'flex';
  setHeaderAvatars();

  const goOnline = () => setDoc(doc(db,'online',myUid), { name: myName, lastSeen: Date.now() }, { merge: true });
  goOnline();
  const hb = setInterval(goOnline, 10000);
  snapUnsubs.push(() => clearInterval(hb));

  snapUnsubs.push(onSnapshot(collection(db,'online'), snap => {
    onlineNow = {};
    snap.forEach(d => {
      lastSeenMap[d.id] = d.data().lastSeen;
      if(Date.now() - d.data().lastSeen < 20000) onlineNow[d.id] = d.data().name;
    });
    renderOnline();
  }));

  snapUnsubs.push(onSnapshot(collection(db,'typing'), snap => {
    const others = [];
    snap.forEach(d => {
      if(d.id !== myUid && Date.now() - (d.data().at || 0) < 3000){
        others.push(d.data().name || profilesByUid[d.id]?.name || 'Someone');
      }
    });
    document.getElementById('typing').innerText = others.length ? others.join(', ') + ' is typing…' : '';
  }));

  snapUnsubs.push(onSnapshot(collection(db,'profiles'), snap => {
    profilesByUid = {}; profilesByUsername = {};
    snap.forEach(d => {
      const p = d.data();
      profilesByUid[d.id] = { uid: d.id, ...p };
      if(p.username) profilesByUsername[p.username] = { uid: d.id, ...p };
    });
    renderOnline();
    if(document.getElementById('page-chats').classList.contains('active')) renderMsgs();
    if(document.getElementById('page-status').classList.contains('active')) renderStatuses();
    if(document.getElementById('page-profile').classList.contains('active')) renderProfile();
  }));

  snapUnsubs.push(onSnapshot(query(collection(db,'friendRequests'), where('to','==',myUid)), snap => {
    friendAcceptIn = []; incomingRequests = [];
    snap.forEach(d => {
      const r = d.data();
      if(r.status === 'accepted') friendAcceptIn.push(r.from);
      else if(r.status === 'pending') incomingRequests.push({ id: d.id, from: r.from });
    });
    recomputeFriends(); updateChatBadge();
  }));
  snapUnsubs.push(onSnapshot(query(collection(db,'friendRequests'), where('from','==',myUid)), snap => {
    friendAcceptOut = [];
    snap.forEach(d => { if(d.data().status === 'accepted') friendAcceptOut.push(d.data().to); });
    recomputeFriends();
  }));

  snapUnsubs.push(onSnapshot(collection(db,'groups'), snap => {
    groups = [];
    snap.forEach(d => groups.push({ id: d.id, data: d.data() }));
    renderGroups();
  }));

  snapUnsubs.push(onSnapshot(query(collection(db,'messages'), orderBy('time','asc')), snap => {
    messages = [];
    snap.forEach(d => messages.push({ id: d.id, data: d.data() }));
    if(currentTab === 'global') renderMsgs();
  }));
  snapUnsubs.push(onSnapshot(query(collection(db,'dms'), orderBy('time','asc')), snap => {
    dms = [];
    snap.forEach(d => dms.push({ id: d.id, data: d.data() }));
    if(currentTab === 'friends') renderMsgs();
    updateChatBadge();
  }));
  snapUnsubs.push(onSnapshot(query(collection(db,'groupMsgs'), orderBy('time','asc')), snap => {
    groupMsgs = [];
    snap.forEach(d => groupMsgs.push({ id: d.id, data: d.data() }));
    if(currentTab === 'group') renderMsgs();
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
  messages = []; dms = []; groupMsgs = []; groups = []; statuses = []; reels = [];
  profilesByUid = {}; profilesByUsername = {};
  myFriends = []; friendAcceptIn = []; friendAcceptOut = []; incomingRequests = [];
  onlineNow = {}; lastSeenMap = {};
  dmToUid = null; dmToName = null; replyTo = null; groupId = null;
  try { cancelReply(); } catch(e){}
  chatBooted = false;
}

function setHeaderAvatars(){
  const html = myPhotoURL ? `<img src="${myPhotoURL}" alt="">` : initials(myName);
  const a = document.getElementById('newsAvatar');
  const b = document.getElementById('chatAvatar');
  if(a) a.innerHTML = html;
  if(b) b.innerHTML = html;
}

function recomputeFriends(){
  myFriends = [...new Set([...friendAcceptIn, ...friendAcceptOut])];
  renderOnline();
  if(currentTab === 'friends') renderMsgs();
}

function updateChatBadge(){
  const badge = document.getElementById('chatBadge');
  if(!badge) return;
  const unread = dms.filter(m => {
    const d = m.data;
    return d.to === myUid && d.uid !== myUid && !(d.readBy || []).includes(myUid);
  }).length + incomingRequests.length;
  if(unread > 0){
    badge.innerText = unread > 99 ? '99+' : unread;
    badge.style.display = 'grid';
  } else {
    badge.style.display = 'none';
  }
}

/* ============================================================
   NEWS
   ============================================================ */
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
   CHAT TABS
   ============================================================ */
window.switchTab = function(tab){
  currentTab = tab;
  ['global','friends','group'].forEach(t => {
    const el = document.getElementById('tab' + t.charAt(0).toUpperCase() + t.slice(1));
    if(el) el.classList.toggle('active', tab === t);
  });
  document.getElementById('groupBar').style.display = tab === 'group' ? 'flex' : 'none';
  const input = document.getElementById('msgInput');
  if(tab === 'global'){ dmToUid = null; groupId = null; input.placeholder = 'Message everyone…'; }
  if(tab === 'friends'){ input.placeholder = dmToUid ? 'Message ' + dmToName + '…' : 'Pick a friend…'; }
  if(tab === 'group'){ input.placeholder = groupId ? 'Message this group…' : 'Pick or create a group…'; }
  renderMsgs(); renderGroups(); renderOnline(); updatePinBar();
};

window.startDM = function(uid, name){
  if(uid === myUid) return;
  if(dmToUid === uid){
    dmToUid = null; dmToName = null;
    toast('Closed chat');
    renderOnline(); renderMsgs();
    return;
  }
  dmToUid = uid; dmToName = name;
  if(currentTab !== 'friends') currentTab = 'friends';
  document.querySelectorAll('#chatTabs .tab').forEach(b => b.classList.toggle('active', b.id === 'tabFriends'));
  document.getElementById('msgInput').placeholder = 'Message ' + name + '…';
  renderOnline(); renderMsgs();
};

/* ============================================================
   ONLINE BAR
   ============================================================ */
function renderOnline(){
  const bar = document.getElementById('onlineBar');
  if(!bar) return;
  if(currentTab === 'group'){ bar.style.display = 'none'; return; }
  bar.style.display = 'flex';
  bar.innerHTML = '';

  let users = [];
  if(currentTab === 'global'){
    users = Object.keys(onlineNow).filter(uid => uid !== myUid);
    users.sort((a,b) => (lastSeenMap[b] || 0) - (lastSeenMap[a] || 0));
  } else if(currentTab === 'friends'){
    const online = myFriends.filter(uid => onlineNow[uid]);
    const offline = myFriends.filter(uid => !onlineNow[uid]);
    users = [...online, ...offline];
  }

  if(!users.length){
    bar.innerHTML = currentTab === 'global'
      ? '<div class="pill"><i class="off"></i>Only you online</div>'
      : '<div class="pill"><i class="off"></i>No friends yet — tap ＋</div>';
    return;
  }
  users.forEach(uid => {
    const p = profilesByUid[uid] || {};
    const isOnline = !!onlineNow[uid];
    const name = p.name || 'User';
    const st = p.about ? ` · ${escapeHtml(p.about.slice(0,16))}` : '';
    bar.innerHTML += `<div class="pill ${dmToUid === uid ? 'active' : ''}" onclick="startDM('${uid}','${escapeHtml(name)}')"><i class="${isOnline ? '' : 'off'}"></i>${escapeHtml(name)}${st}</div>`;
  });
}

/* ============================================================
   GROUPS
   ============================================================ */
window.openCreateGroup = function(){ document.getElementById('groupModal').style.display = 'flex'; };
window.createGroup = async function(){
  const name = document.getElementById('groupName').value.trim();
  if(!name){ toast('Type group name'); return; }
  const desc = document.getElementById('groupDesc').value.trim();
  const ref = await addDoc(collection(db,'groups'), {
    name, desc, createdBy: myName, createdByUid: myUid, createdAt: Date.now()
  });
  groupId = ref.id;
  closeModal('groupModal');
  document.getElementById('groupName').value = '';
  document.getElementById('groupDesc').value = '';
  toast('Group created 👥');
  switchTab('group');
};
function renderGroups(){
  const bar = document.getElementById('groupBar');
  bar.innerHTML = `<div class="gpill" onclick="openCreateGroup()">＋ New Group</div>`;
  groups.forEach(g => {
    bar.innerHTML += `<div class="gpill ${groupId === g.id ? 'active' : ''}" onclick="selectGroup('${g.id}')"># ${escapeHtml(g.data.name)}</div>`;
  });
}
window.selectGroup = function(id){
  groupId = id;
  document.getElementById('msgInput').placeholder = 'Message this group…';
  renderGroups(); renderMsgs(); updatePinBar();
};

/* ============================================================
   FRIENDS
   ============================================================ */
window.openAddFriend = function(){
  document.getElementById('addFriendModal').style.display = 'flex';
  document.getElementById('friendSearch').value = '';
  document.getElementById('friendSearchResults').innerHTML = '';
  document.getElementById('friendSearchErr').innerText = '';
  setTimeout(()=> document.getElementById('friendSearch').focus(), 50);
};

let friendSearchDebounce = null;
window.searchFriend = function(){
  clearTimeout(friendSearchDebounce);
  friendSearchDebounce = setTimeout(doFriendSearch, 350);
};
async function doFriendSearch(){
  const q = document.getElementById('friendSearch').value.trim().toLowerCase().replace(/^@/,'');
  const results = document.getElementById('friendSearchResults');
  const err = document.getElementById('friendSearchErr');
  err.innerText = ''; results.innerHTML = '';
  if(!q || q.length < 2) return;

  try{
    const snap = await getDoc(doc(db,'usernames',q));
    if(!snap.exists()){
      results.innerHTML = `<p class="hint" style="margin-top:12px">No user with username @${escapeHtml(q)}</p>`;
      return;
    }
    const foundUid = snap.data().uid;
    if(foundUid === myUid){
      results.innerHTML = `<p class="hint" style="margin-top:12px">That's you! 😄</p>`;
      return;
    }
    const p = profilesByUid[foundUid];
    if(!p){
      results.innerHTML = `<p class="hint" style="margin-top:12px">Loading profile…</p>`;
      setTimeout(doFriendSearch, 500);
      return;
    }
    const isFriend = myFriends.includes(foundUid);
    const outSnap = await getDoc(doc(db,'friendRequests', myUid + '_' + foundUid));
    const hasOutgoing = outSnap.exists() && outSnap.data().status === 'pending';
    const inSnap = await getDoc(doc(db,'friendRequests', foundUid + '_' + myUid));
    const hasIncoming = inSnap.exists() && inSnap.data().status === 'pending';

    let action = '';
    if(isFriend) action = '<button class="btn2" disabled>✓ Friend</button>';
    else if(hasOutgoing) action = '<button class="btn2" disabled>Sent</button>';
    else if(hasIncoming) action = `<button class="btn2" style="background:var(--primary);color:#fff" onclick="acceptFriendRequest('${foundUid}')">Accept</button>`;
    else action = `<button class="btn2" style="background:var(--primary);color:#fff" onclick="sendFriendRequest('${foundUid}')">Add</button>`;

    results.innerHTML = `
      <div class="friend-result">
        <div class="av" style="background:${p.photoURL ? 'transparent' : (p.color || colorFor(foundUid))}">
          ${p.photoURL ? `<img src="${p.photoURL}">` : initials(p.name)}
        </div>
        <div class="info">
          <b>${escapeHtml(p.name)}</b>
          <small>@${escapeHtml(p.username)}</small>
        </div>
        ${action}
      </div>`;
  }catch(e){ console.error(e); err.innerText = 'Search failed'; }
}

window.sendFriendRequest = async function(toUid){
  try{
    await setDoc(doc(db,'friendRequests', myUid + '_' + toUid), {
      from: myUid, to: toUid, status: 'pending', createdAt: Date.now()
    });
    toast('Friend request sent ✓');
    if(document.getElementById('addFriendModal').style.display === 'flex') doFriendSearch();
  }catch(e){ console.error(e); toast('Failed to send'); }
};
window.acceptFriendRequest = async function(fromUid){
  try{
    await updateDoc(doc(db,'friendRequests', fromUid + '_' + myUid), {
      status: 'accepted', acceptedAt: Date.now()
    });
    toast('Friend added ✓');
    if(document.getElementById('addFriendModal').style.display === 'flex') doFriendSearch();
  }catch(e){ toast('Failed'); }
};
window.declineFriendRequest = async function(fromUid){
  try{
    await deleteDoc(doc(db,'friendRequests', fromUid + '_' + myUid));
    toast('Request declined');
  }catch(e){ toast('Failed'); }
};

/* ============================================================
   MESSAGES RENDERING
   ============================================================ */
function ticksSvg(read){
  return `<svg class="msg-tick ${read ? 'read' : ''}" viewBox="0 0 16 11" fill="none"
    stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
    <path d="M1 6l3 3 6-7"/>
    ${read ? '<path d="M8 9l1 1 6-7"/>' : ''}
  </svg>`;
}
function formatDate(d){
  const t = new Date();
  const y = new Date(t); y.setDate(y.getDate() - 1);
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
  const avatar = mine ? '' : msgAvatarHtml(m.uid, m.name);
  const nameHtml = (!mine && !grouped)
    ? `<div class="msg-name" style="color:${col}" onclick="event.stopPropagation();openProfile('${m.uid}')">${escapeHtml(m.name || 'User')}</div>`
    : '';
  const reactions = renderReactions(coll, id, m.reactions);
  const actions = `<div class="msg-actions">
    <button title="Love" onclick="event.stopPropagation();reactTo('${coll}','${id}','❤️')">❤️</button>
    <button title="Fire" onclick="event.stopPropagation();reactTo('${coll}','${id}','🔥')">🔥</button>
    <button title="Laugh" onclick="event.stopPropagation();reactTo('${coll}','${id}','😂')">😂</button>
    <button title="Like" onclick="event.stopPropagation();reactTo('${coll}','${id}','👍')">👍</button>
    <button title="Reply" onclick="event.stopPropagation();setReply('${id}')">↩</button>
    <button title="Pin" onclick="event.stopPropagation();pinMsg('${id}')">📌</button>
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
  const box = document.getElementById('msgs');
  const search = document.getElementById('searchInput').value.trim().toLowerCase();
  box.innerHTML = '';

  if(currentTab === 'friends' && !dmToUid){
    if(!myFriends.length){
      box.innerHTML = `<div style="text-align:center;color:var(--text-2);padding:30px 20px">
        No friends yet 🤝<br>
        <button class="btn2" style="margin-top:12px" onclick="openAddFriend()">Add your first friend</button>
      </div>`;
      return;
    }
    let html = `<div style="padding:8px 4px;color:var(--text-2);font-size:12px">${myFriends.length} friend${myFriends.length === 1 ? '' : 's'}</div>`;
    myFriends.forEach(uid => {
      const p = profilesByUid[uid] || {};
      const isOnline = onlineNow[uid];
      const av = p.photoURL ? `<img src="${p.photoURL}">` : initials(p.name || '?');
      html += `
        <div class="friend-result" style="cursor:pointer" onclick="startDM('${uid}','${escapeHtml(p.name || 'Friend')}')">
          <div class="av" style="background:${p.photoURL ? 'transparent' : (p.color || colorFor(uid))}">${av}</div>
          <div class="info">
            <b>${escapeHtml(p.name || 'Friend')}</b>
            <small>@${escapeHtml(p.username || '')} · ${isOnline ? 'Online' : 'Offline'}</small>
          </div>
          ${isOnline ? '<i style="width:10px;height:10px;border-radius:50%;background:var(--read);display:block"></i>' : ''}
        </div>`;
    });
    box.innerHTML = html;
    return;
  }

  if(currentTab === 'group' && !groupId){
    box.innerHTML = `<div style="text-align:center;color:var(--text-2);padding:20px">Pick a group above or create one 👥<br><button class="btn2" style="margin-top:10px" onclick="openCreateGroup()">＋ Create Group</button></div>`;
    return;
  }

  let list = [], coll = 'messages';
  if(currentTab === 'global'){ list = messages; coll = 'messages'; }
  if(currentTab === 'friends'){ list = dms.filter(m => m.data.dmId === dmId(myUid, dmToUid)); coll = 'dms'; }
  if(currentTab === 'group'){ list = groupMsgs.filter(m => m.data.groupId === groupId); coll = 'groupMsgs'; }
  if(search) list = list.filter(x =>
    (x.data.text || '').toLowerCase().includes(search) ||
    (x.data.name || '').toLowerCase().includes(search));

  if(search && !list.length){
    box.innerHTML = `<div style="text-align:center;color:var(--text-2);padding:20px">No results for "${escapeHtml(search)}"</div>`;
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
  let list = currentTab === 'global' ? messages : currentTab === 'friends' ? dms : groupMsgs;
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
   SEND MESSAGE
   ============================================================ */
window.sendMsg = async function(){
  const t = document.getElementById('msgInput').value.trim();
  if(!t) return;
  const payload = {
    uid: myUid, name: myName, username: myUsername,
    text: t,
    time: serverTimestamp(),
    replyTo: replyTo || null,
    reactions: {},
    readBy: [myUid]
  };
  if(currentTab === 'friends'){
    if(!dmToUid){ toast('Pick a friend first'); return; }
    payload.dmId = dmId(myUid, dmToUid);
    payload.to = dmToUid;
    await addDoc(collection(db,'dms'), payload);
  } else if(currentTab === 'group'){
    if(!groupId){ toast('Pick or create a group first'); return; }
    payload.groupId = groupId;
    await addDoc(collection(db,'groupMsgs'), payload);
  } else {
    await addDoc(collection(db,'messages'), payload);
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
      time: serverTimestamp(),
      replyTo: replyTo || null,
      reactions: {},
      readBy: [myUid]
    };
    if(currentTab === 'friends' && dmToUid){ payload.dmId = dmId(myUid, dmToUid); payload.to = dmToUid; await addDoc(collection(db,'dms'), payload); }
    else if(currentTab === 'group' && groupId){ payload.groupId = groupId; await addDoc(collection(db,'groupMsgs'), payload); }
    else await addDoc(collection(db,'messages'), payload);
    toast('Photo sent 📷');
    cancelReply();
  };
  reader.readAsDataURL(file);
  input.value = '';
};

window.toggleVoice = async function(){
  const btn = document.getElementById('voiceBtn');
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
            time: serverTimestamp(),
            replyTo: replyTo || null,
            reactions: {},
            readBy: [myUid]
          };
          if(currentTab === 'friends' && dmToUid){ payload.dmId = dmId(myUid, dmToUid); payload.to = dmToUid; await addDoc(collection(db,'dms'), payload); }
          else if(currentTab === 'group' && groupId){ payload.groupId = groupId; await addDoc(collection(db,'groupMsgs'), payload); }
          else await addDoc(collection(db,'messages'), payload);
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
  const coll = currentTab === 'friends' ? 'dms' : currentTab === 'group' ? 'groupMsgs' : 'messages';
  let list = currentTab === 'global' ? messages : currentTab === 'friends' ? dms : groupMsgs;
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
  let list = currentTab === 'global' ? messages : currentTab === 'friends' ? dms : groupMsgs;
  const found = list.find(x => x.id === id);
  if(!found) return;
  pinnedMsg = {
    tab: currentTab, groupId,
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
    if(currentTab === 'global' && pinnedMsg.tab === 'global') show = true;
    if(currentTab === 'friends' && pinnedMsg.tab === 'friends' && pinnedMsg.dmId === dmId(myUid, dmToUid || '')) show = true;
    if(currentTab === 'group' && pinnedMsg.tab === 'group' && pinnedMsg.groupId === groupId) show = true;
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
  const payload = {
    uid: myUid, name: myName, username: myUsername,
    createdAt: Date.now(), viewers: []
  };
  if(statusComposerType === 'text'){
    const text = document.getElementById('statusText').value.trim();
    if(!text){ err.innerText = 'Write something first.'; return; }
    payload.type = 'text';
    payload.text = text;
    payload.bgColor = statusBgColor;
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
  others.forEach(s => {
    if(!byUser[s.data.uid]) byUser[s.data.uid] = [];
    byUser[s.data.uid].push(s);
  });

  const recentUsers = [], viewedUsers = [];
  Object.keys(byUser).forEach(uid => {
    const items = byUser[uid];
    const allViewed = items.every(s => (s.data.viewers || []).includes(myUid));
    if(allViewed) viewedUsers.push(uid);
    else recentUsers.push(uid);
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

/* Status viewer */
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

  document.getElementById('svName').innerText =
    (p.name || d.name || 'User') + ' · ' +
    new Date(d.createdAt).toLocaleTimeString([], {hour:'2-digit', minute:'2-digit'});

  document.getElementById('svProgress').innerHTML = s.items.map((_, i) => {
    const cls = i < s.index ? 'viewed' : i === s.index ? 'active' : '';
    return `<div class="${cls}"></div>`;
  }).join('');

  const content = document.getElementById('svContent');
  if(d.type === 'image' && d.image){
    content.innerHTML = `<img src="${d.image}">`;
  } else {
    content.innerHTML = `<div class="bg-text" style="background:${d.bgColor || '#0A84FF'}">${escapeHtml(d.text || '')}</div>`;
  }
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
let reelVideoData = null;
let reelObserver = null;

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
  if(file.size > 550000){ toast('Video too large (>550KB) — record shorter'); input.value = ''; return; }
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
      likes: [],
      createdAt: Date.now()
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
      if(entry.isIntersecting && entry.intersectionRatio > 0.6){
        v.muted = false;
        v.play().catch(() => {});
      } else {
        try { v.pause(); } catch(e){}
      }
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
    if(likes.includes(myUid)){
      await updateDoc(ref, { likes: arrayRemove(myUid) });
    } else {
      await updateDoc(ref, { likes: arrayUnion(myUid) });
    }
  }catch(e){}
};

/* ============================================================
   PROFILE
   ============================================================ */
function renderProfile(){
  if(!myProfile) return;
  const p = myProfile;
  const av = p.photoURL ? `<img src="${p.photoURL}">` : initials(p.name);
  const friendsCount = myFriends.length;
  const statusCount = statuses.filter(s => s.data.uid === myUid).length;
  const reelsCount = reels.filter(r => r.data.uid === myUid).length;
  document.getElementById('profileHero').innerHTML = `
    <div class="av" style="background:${p.photoURL ? 'transparent' : (p.color || colorFor(p.username || myUid))}">${av}</div>
    <h2>${escapeHtml(p.name)}</h2>
    <div class="username">@${escapeHtml(p.username)}</div>
    <div class="bio">${escapeHtml(p.bio || p.about || "Hey! I'm on Dabz")}</div>
    <div class="profile-stats">
      <div><div class="n">${friendsCount}</div><div class="l">Friends</div></div>
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
    setHeaderAvatars();
  }catch(e){ console.error(e); err.innerText = 'Save failed'; }
};

window.openProfile = async function(uid, isMe = false){
  try{
    const snap = await getDoc(doc(db,'profiles',uid));
    const p = snap.exists() ? snap.data() : { name:'User', username:'' };
    const isOnline = !!onlineNow[uid];
    const isFriend = myFriends.includes(uid);
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
          ${isFriend
            ? `<button class="btn" onclick="closeModal('profileModal');startDM('${uid}','${escapeHtml(p.name || 'Friend')}')">Message</button>`
            : `<button class="btn" onclick="sendFriendRequest('${uid}')">Add Friend</button>`}
        </div>
      `}`;
    document.getElementById('profileModal').style.display = 'flex';
  }catch(e){ console.error(e); }
};

/* ============================================================
   MODALS
   ============================================================ */
window.closeModal = function(id){ document.getElementById(id).style.display = 'none'; };

/* ============================================================
   FINAL INIT
   ============================================================ */
// Make sure default page is news on load
showPage('news');
