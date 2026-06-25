const SERVER_URL = "";

let currentUser = null;
let voiceLang = "es-MX";
let chatHistory = [];
let chats = {};
let activeChatId = null;
let attachedImage = null;
let isDark = true;

const save = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch(e) {} };
const load = (k, d = null) => { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch(e) { return d; } };

/* ── SPHERE ── */
const canvas = document.getElementById("sphereCanvas");
const ctx2 = canvas.getContext("2d");
let sphereSize = 200;
function setSphereSize() {
  sphereSize = window.innerWidth <= 400 ? 160 : window.innerWidth <= 640 ? 190 : 220;
  canvas.width = sphereSize * 2; canvas.height = sphereSize * 2;
  canvas.style.width = sphereSize + "px"; canvas.style.height = sphereSize + "px";
  ctx2.scale(2, 2);
}
setSphereSize();
const CX = () => sphereSize/2, CY = () => sphereSize/2, R = () => sphereSize*0.9;
let t=0, volumeLevel=0, targetVolume=0, sphereRunning=false;
const PARTS=1400, parts=[];
for(let i=0;i<PARTS;i++){
  const phi=Math.acos(2*Math.random()-1),theta=Math.random()*Math.PI*2;
  parts.push({basePhi:phi,baseTheta:theta,phi,theta,r:0,size:0.6+Math.random()*1.4,speed:0.0008+Math.random()*0.002,phase:Math.random()*Math.PI*2,brightness:0.5+Math.random()*0.5,drift:(Math.random()-0.5)*0.003});
}
function updatePartsR(){parts.forEach(p=>{p.r=R()*(0.96+Math.random()*0.04)});}
updatePartsR();
function proj(phi,theta,rr){
  const cx=CX(),cy=CY(),r=R();
  const x=rr*Math.sin(phi)*Math.cos(theta),z=rr*Math.cos(phi);
  const sc=1+z/(r*6);
  return{sx:cx+x*sc,sy:cy-z*sc,z};
}
function drawSph(vol){
  const cx=CX(),cy=CY(),r=R(),w=sphereSize,h=sphereSize;
  ctx2.clearRect(0,0,w,h);
  const g=ctx2.createRadialGradient(cx-r*.3,cy-r*.35,r*.05,cx,cy,r);
  g.addColorStop(0,`rgba(240,220,200,${0.18+vol*.12})`);g.addColorStop(0.35,`rgba(160,120,200,${0.13+vol*.10})`);
  g.addColorStop(0.7,`rgba(80,50,140,${0.20+vol*.08})`);g.addColorStop(1,"rgba(20,10,40,0.88)");
  ctx2.save();ctx2.beginPath();ctx2.arc(cx,cy,r,0,Math.PI*2);ctx2.fillStyle=g;ctx2.fill();ctx2.restore();
  const sorted=parts.slice().sort((a,b)=>proj(a.phi,a.theta,a.r).z-proj(b.phi,b.theta,b.r).z);
  for(const p of sorted){
    const{sx,sy,z}=proj(p.phi,p.theta,p.r+vol*10*Math.sin(p.phase+t*4));
    const depth=(z+r)/(2*r);if(depth<0.02)continue;
    const warm=0.4+0.6*depth;
    const rr=Math.round(180+60*warm+vol*30),gg=Math.round(140+60*warm+vol*10),bb=Math.round(200+40*warm+vol*50);
    const a=(0.15+0.55*depth)*p.brightness;
    ctx2.beginPath();ctx2.arc(sx,sy,p.size*(0.7+0.3*depth),0,Math.PI*2);
    ctx2.fillStyle=`rgba(${rr},${gg},${bb},${a})`;ctx2.fill();
  }
  const rim=ctx2.createRadialGradient(cx,cy,r*.78,cx,cy,r);
  rim.addColorStop(0,"rgba(0,0,0,0)");rim.addColorStop(1,`rgba(60,30,120,${0.55+vol*.2})`);
  ctx2.save();ctx2.beginPath();ctx2.arc(cx,cy,r,0,Math.PI*2);ctx2.fillStyle=rim;ctx2.fill();ctx2.restore();
}
function animParts(vol){
  t+=0.007+vol*.03;
  for(const p of parts){
    p.phi=p.basePhi+Math.sin(t*p.speed*120+p.phase)*(0.05+vol*.25);
    p.theta=p.baseTheta+t*p.drift+Math.cos(t*p.speed*80+p.phase)*(0.03+vol*.15);
  }
}
function startSphereIdle(){
  if(sphereRunning)return;sphereRunning=true;
  const loop=()=>{volumeLevel+=(targetVolume-volumeLevel)*.12;animParts(volumeLevel);drawSph(volumeLevel);requestAnimationFrame(loop);};
  loop();
}
drawSph(0);
window.addEventListener("resize",()=>{
  if(document.getElementById("voice-panel").classList.contains("active")){setSphereSize();updatePartsR();drawSph(volumeLevel);}
});

/* ── DB API ── */
async function dbGetChats(user) {
  try {
    const r = await fetch(`${SERVER_URL}/history/${user}`);
    return await r.json();
  } catch { return []; }
}
async function dbGetMessages(user, chatId) {
  try {
    const r = await fetch(`${SERVER_URL}/history/${user}/${chatId}`);
    return await r.json();
  } catch { return []; }
}
async function dbNewChat(user, id, title) {
  try {
    await fetch(`${SERVER_URL}/history/${user}/new`, {
      method: "POST", headers: {"Content-Type":"application/json"},
      body: JSON.stringify({ id, title })
    });
  } catch {}
}
async function dbSaveMessage(user, chatId, role, content, img_url = null) {
  try {
    await fetch(`${SERVER_URL}/history/${user}/${chatId}/message`, {
      method: "POST", headers: {"Content-Type":"application/json"},
      body: JSON.stringify({ role, content, img_url })
    });
  } catch {}
}
async function dbDeleteChat(user, chatId) {
  try {
    await fetch(`${SERVER_URL}/history/${user}/${chatId}`, { method: "DELETE" });
  } catch {}
}

/* ── AUTH ── */
const authOverlay = document.getElementById("auth-overlay");
let isRegister = false;
function openAuth(register=false){ isRegister=register; updateAuthUI(); authOverlay.classList.add("visible"); setTimeout(()=>document.getElementById("auth-user").focus(),100); }
function closeAuth(){ authOverlay.classList.remove("visible"); document.getElementById("auth-error").textContent=""; }
function updateAuthUI(){
  document.getElementById("tab-login").classList.toggle("active",!isRegister);
  document.getElementById("tab-register").classList.toggle("active",isRegister);
  document.getElementById("auth-submit-btn").textContent=isRegister?"Crear cuenta":"Iniciar sesión";
  document.getElementById("auth-email-wrap").style.display=isRegister?"flex":"none";
  document.getElementById("auth-error").textContent="";
}
document.getElementById("toggle-pass-btn").addEventListener("click",()=>{
  const input=document.getElementById("auth-pass");
  const btn=document.getElementById("toggle-pass-btn");
  if(input.type==="password"){input.type="text";btn.textContent="🙈";}
  else{input.type="password";btn.textContent="👁";}
});
document.getElementById("tab-login").addEventListener("click",()=>{isRegister=false;updateAuthUI();});
document.getElementById("tab-register").addEventListener("click",()=>{isRegister=true;updateAuthUI();});
document.getElementById("auth-close-btn").addEventListener("click",closeAuth);
authOverlay.addEventListener("click",e=>{if(e.target===authOverlay)closeAuth();});
document.getElementById("auth-google-btn").addEventListener("click",()=>{
  const fakeUser={username:"usuario_google",email:"usuario@gmail.com",avatar:"G"};
  loginUser(fakeUser);
  const errEl=document.getElementById("auth-error");
  errEl.textContent="✓ Sesión iniciada con Google"; errEl.style.color="#5dcaa5";
  setTimeout(()=>{closeAuth();errEl.style.color="";},800);
});
document.getElementById("auth-submit-btn").addEventListener("click",()=>{
  const username=document.getElementById("auth-user").value.trim();
  const pass=document.getElementById("auth-pass").value;
  const errEl=document.getElementById("auth-error"); errEl.textContent="";
  if(!username||!pass){errEl.textContent="Completa todos los campos.";return;}
  if(pass.length<4){errEl.textContent="La contraseña debe tener al menos 4 caracteres.";return;}
  const users=load("nm_users",{});
  if(isRegister){
    if(users[username]){errEl.textContent="Ese usuario ya existe.";return;}
    const email=document.getElementById("auth-email").value.trim();
    users[username]={pass,email}; save("nm_users",users);
    loginUser({username,email,avatar:username.slice(0,2).toUpperCase()}); closeAuth();
  } else {
    if(!users[username]||users[username].pass!==pass){errEl.textContent="Usuario o contraseña incorrectos.";return;}
    loginUser({username,email:users[username].email||"",avatar:username.slice(0,2).toUpperCase()}); closeAuth();
  }
});
["auth-user","auth-pass","auth-email"].forEach(id=>{
  document.getElementById(id)?.addEventListener("keydown",e=>{if(e.key==="Enter")document.getElementById("auth-submit-btn").click();});
});
function loginUser(user){
  currentUser=user; save("nm_session",{user:currentUser,voiceLang,isDark});
  loadUserData(); updateSidebarUI();
}
function updateSidebarUI(){
  const logged=!!currentUser;
  document.getElementById("guest-banner").style.display=logged?"none":"block";
  document.getElementById("logout-btn").style.display=logged?"flex":"none";
  document.getElementById("login-btn-sidebar").style.display=logged?"none":"flex";
  if(logged){
    document.getElementById("user-av").textContent=currentUser.avatar||currentUser.username.slice(0,2).toUpperCase();
    document.getElementById("user-name-label").textContent=currentUser.username;
    document.getElementById("user-email-label").textContent=currentUser.email||"Sin correo";
  } else {
    document.getElementById("user-av").textContent="?";
    document.getElementById("user-name-label").textContent="Invitado";
    document.getElementById("user-email-label").textContent="Sin sesión";
  }
}
function tryAutoLogin(){
  const saved=load("nm_session");
  if(saved&&saved.user){currentUser=saved.user;voiceLang=saved.voiceLang||"es-MX";isDark=saved.isDark!==false;}
  else{isDark=true;}
  applyTheme(); updateSidebarUI(); loadUserData();
}

/* ── THEME ── */
function applyTheme(){
  document.documentElement.setAttribute("data-theme",isDark?"dark":"light");
  const dt=document.getElementById("dark-toggle");
  if(isDark)dt.classList.add("on");else dt.classList.remove("on");
}
document.getElementById("theme-btn").addEventListener("click",toggleTheme);
document.getElementById("dark-toggle").addEventListener("click",toggleTheme);
function toggleTheme(){isDark=!isDark;applyTheme();if(currentUser){const s=load("nm_session",{});s.isDark=isDark;save("nm_session",s);}}

/* ── SIDEBAR ── */
const sidebar=document.getElementById("sidebar");
const sidebarOverlay=document.getElementById("sidebar-overlay");
function openSidebar(){
  if(window.innerWidth<=640){sidebar.classList.add("open");sidebarOverlay.classList.add("visible");}
  else{sidebar.classList.remove("collapsed");}
}
function closeSidebar(){
  if(window.innerWidth<=640){sidebar.classList.remove("open");sidebarOverlay.classList.remove("visible");}
  else{sidebar.classList.add("collapsed");}
}
document.getElementById("sidebar-toggle-btn").addEventListener("click",()=>{
  const isDesktop=window.innerWidth>640;
  if(isDesktop){
    if(sidebar.classList.contains("collapsed"))openSidebar();else closeSidebar();
  } else {
    if(sidebar.classList.contains("open"))closeSidebar();else openSidebar();
  }
});
document.getElementById("sidebar-close-btn").addEventListener("click",closeSidebar);
sidebarOverlay.addEventListener("click",closeSidebar);

/* ── CHAT MANAGEMENT CON BD ── */
function genId(){return Date.now().toString(36)+Math.random().toString(36).slice(2);}

async function loadUserData(){
  if(!currentUser){chats={};renderChatList();newChat();return;}
  const rows=await dbGetChats(currentUser.username);
  chats={};
  rows.forEach(r=>{chats[r.id]={title:r.title,ts:r.ts,messages:[]};});
  renderChatList();
  if(rows.length>0){await loadChat(rows[0].id);}
  else{await newChat();}
}

async function newChat(){
  const id=genId();
  chats[id]={title:"Nueva conversación",messages:[],ts:Date.now()};
  activeChatId=id; chatHistory=[];
  if(currentUser) await dbNewChat(currentUser.username,id,"Nueva conversación");
  renderChatList(); clearMessages();
  document.getElementById("header-title").textContent="Nueva conversación";
}

async function loadChat(id){
  activeChatId=id;
  const chat=chats[id];
  clearMessages();
  document.getElementById("header-title").textContent=chat.title;
  chatHistory=[];
  if(currentUser){
    const msgs=await dbGetMessages(currentUser.username,id);
    chat.messages=msgs;
    msgs.forEach(m=>{
      appendMsg(m.content, m.role==="assistant"?"ai":"user", m.img_url||null, false);
      chatHistory.push({role:m.role,content:m.content});
    });
  }
  renderChatList();
}

function renderChatList(){
  const list=document.getElementById("chat-list");
  list.innerHTML="";
  if(!currentUser){
    list.innerHTML='<div style="padding:8px 12px;font-size:12px;color:var(--text3)">Inicia sesión para ver historial</div>';
    return;
  }
  Object.keys(chats)
    .sort((a,b)=>(chats[b].ts||0)-(chats[a].ts||0))
    .forEach(id=>{
      const item=document.createElement("div");
      item.className="chat-item"+(id===activeChatId?" active":"");
      item.innerHTML=`<span>${chats[id].title}</span><button class="chat-del" data-id="${id}">✕</button>`;
      item.addEventListener("click",async e=>{
        if(e.target.classList.contains("chat-del")){
          e.stopPropagation();
          const delId=e.target.dataset.id;
          if(currentUser) await dbDeleteChat(currentUser.username,delId);
          delete chats[delId];
          if(activeChatId===delId){
            const rem=Object.keys(chats);
            if(rem.length>0)await loadChat(rem[0]);else await newChat();
          } else renderChatList();
          return;
        }
        await loadChat(id);
        if(window.innerWidth<=640)closeSidebar();
      });
      list.appendChild(item);
    });
}

function clearMessages(){
  const msgs=document.getElementById("messages");
  msgs.innerHTML="";
  const welcome=document.createElement("div");
  welcome.className="welcome";welcome.id="welcome-screen";
  welcome.innerHTML=`
    <div class="welcome-icon">✦</div>
    <h2>¿En qué te ayudo hoy?</h2>
    <p>Chatea, envía imágenes o activa el modo voz para una experiencia manos libres.</p>
    <div class="quick-prompts">
      <div class="quick-prompt" data-prompt="Explícame cómo funciona la inteligencia artificial">¿Qué es la IA?</div>
      <div class="quick-prompt" data-prompt="Escríbeme un poema creativo corto">Escribe un poema</div>
      <div class="quick-prompt" data-prompt="Dame 5 ideas de negocios innovadores">Ideas de negocio</div>
      <div class="quick-prompt" data-prompt="Ayúdame a aprender inglés con frases básicas">Aprender inglés</div>
    </div>`;
  msgs.appendChild(welcome);
  bindQuickPrompts();
}
function bindQuickPrompts(){
  document.querySelectorAll(".quick-prompt").forEach(el=>{
    el.addEventListener("click",()=>{document.getElementById("msg-input").value=el.dataset.prompt;sendMessage();});
  });
}
document.getElementById("new-chat-btn").addEventListener("click",async()=>{await newChat();if(window.innerWidth<=640)closeSidebar();});

/* ── LOGOUT/LOGIN ── */
document.getElementById("logout-btn").addEventListener("click",async()=>{
  if(!confirm("¿Cerrar sesión?"))return;
  currentUser=null; save("nm_session",null); chats={}; chatHistory=[];
  updateSidebarUI(); renderChatList(); await newChat();
});
document.getElementById("guest-login-btn").addEventListener("click",()=>openAuth(false));
document.getElementById("login-btn-sidebar").addEventListener("click",()=>openAuth(false));

/* ── MODE TABS ── */
const chatPanel=document.getElementById("chat-panel");
const voicePanelEl=document.getElementById("voice-panel");
document.querySelectorAll(".mode-tab").forEach(tab=>{
  tab.addEventListener("click",()=>{
    document.querySelectorAll(".mode-tab").forEach(t=>t.classList.remove("active"));
    tab.classList.add("active");
    if(tab.dataset.mode==="chat"){chatPanel.classList.remove("hidden");voicePanelEl.classList.remove("active");stopListening();}
    else{chatPanel.classList.add("hidden");voicePanelEl.classList.add("active");setSphereSize();updatePartsR();startSphereIdle();}
  });
});

/* ── IMAGE ATTACH ── */
document.getElementById("attach-btn").addEventListener("click",()=>document.getElementById("file-input").click());
document.getElementById("file-input").addEventListener("change",e=>{
  const file=e.target.files[0];if(!file)return;
  const reader=new FileReader();
  reader.onload=ev=>{
    const dataURL=ev.target.result;
    attachedImage={base64:dataURL.split(",")[1],mimeType:file.type,dataURL};
    document.getElementById("img-preview-thumb").src=dataURL;
    document.getElementById("img-preview-wrap").style.display="block";
  };
  reader.readAsDataURL(file); e.target.value="";
});
document.getElementById("img-rm-btn").addEventListener("click",()=>{attachedImage=null;document.getElementById("img-preview-wrap").style.display="none";});

/* ── MESSAGES ── */
function removeWelcome(){const w=document.getElementById("welcome-screen");if(w)w.remove();}
function appendMsg(text,role,imgURL=null,animate=true){
  removeWelcome();
  const msgs=document.getElementById("messages");
  const row=document.createElement("div");
  row.className=`msg-row ${role}`;
  if(!animate)row.style.animation="none";
  const av=document.createElement("div");
  av.className=role==="user"?"msg-avatar":"msg-avatar ai-av";
  av.textContent=role==="user"?(currentUser?.avatar||currentUser?.username?.slice(0,2).toUpperCase()||"TÚ"):"✦";
  const bub=document.createElement("div");
  bub.className="bubble";
  let html=text.replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;")
    .replace(/\n/g,"<br>")
    .replace(/\*\*(.*?)\*\*/g,"<strong>$1</strong>")
    .replace(/`(.*?)`/g,'<code style="background:var(--bg3);padding:1px 5px;border-radius:4px;font-size:12px">$1</code>');
  if(imgURL)html=`<img src="${imgURL}" class="img-preview" alt="imagen adjunta"><br>`+html;
  bub.innerHTML=html;
  row.appendChild(av);row.appendChild(bub);
  msgs.appendChild(row);msgs.scrollTop=msgs.scrollHeight;
  return row;
}
function addTyping(){
  removeWelcome();
  const msgs=document.getElementById("messages");
  const row=document.createElement("div");
  row.className="msg-row ai";row.id="typing-row";
  row.innerHTML='<div class="msg-avatar ai-av">✦</div><div class="bubble"><div class="typing-dots"><span></span><span></span><span></span></div></div>';
  msgs.appendChild(row);msgs.scrollTop=msgs.scrollHeight;
}
function removeTyping(){const r=document.getElementById("typing-row");if(r)r.remove();}

/* ── CALL AI ── */
async function callAI(messages){
  const response=await fetch(`${SERVER_URL}/chat`,{
    method:"POST",headers:{"Content-Type":"application/json"},
    body:JSON.stringify({messages, user: currentUser?.username || null})
  });
  let data;
  try { data=await response.json(); }
  catch { throw new Error("El servidor no está listo, intenta de nuevo."); }
  if(!response.ok)throw new Error(data.error||"Error del servidor");
  return data.text||"Sin respuesta";
}

/* ── SEND MESSAGE ── */
async function sendMessage(){
  const input=document.getElementById("msg-input");
  const text=input.value.trim();
  if(!text&&!attachedImage)return;
  const imgURL=attachedImage?.dataURL||null;
  const imgB64=attachedImage?.base64||null;
  const imgMime=attachedImage?.mimeType||null;
  attachedImage=null;
  document.getElementById("img-preview-wrap").style.display="none";
  input.value="";input.style.height="24px";
  appendMsg(text||"📎 Imagen adjunta","user",imgURL);
  let userContent;
  if(imgB64){userContent=[{type:"image",source:{type:"base64",media_type:imgMime,data:imgB64}},{type:"text",text:text||"Describe esta imagen detalladamente."}];}
  else{userContent=text;}
  chatHistory.push({role:"user",content:userContent});

  // Guardar en BD
  if(currentUser&&activeChatId){
    await dbSaveMessage(currentUser.username,activeChatId,"user",text||"[Imagen]",imgURL);
    // Actualizar título en memoria
    const userMsgs=chatHistory.filter(m=>m.role==="user");
    if(userMsgs.length===1&&text){
      const title=text.length>36?text.slice(0,36)+"…":text;
      chats[activeChatId].title=title;
      document.getElementById("header-title").textContent=title;
      renderChatList();
    }
  }

  addTyping();
  document.getElementById("send-btn").disabled=true;
  try{
    const reply=await callAI(chatHistory);
    removeTyping();
    appendMsg(reply,"ai");
    chatHistory.push({role:"assistant",content:reply});
    if(currentUser&&activeChatId) await dbSaveMessage(currentUser.username,activeChatId,"assistant",reply);
  }catch(e){
    removeTyping();
    appendMsg(`⚠️ ${e.message||"Error al conectar con la IA."}`, "ai");
    chatHistory.pop();
  }finally{
    document.getElementById("send-btn").disabled=false;
  }
}
document.getElementById("send-btn").addEventListener("click",sendMessage);
document.getElementById("msg-input").addEventListener("keydown",e=>{if(e.key==="Enter"&&!e.shiftKey){e.preventDefault();sendMessage();}});
document.getElementById("msg-input").addEventListener("input",function(){this.style.height="24px";this.style.height=Math.min(this.scrollHeight,130)+"px";});
bindQuickPrompts();

/* ── SETTINGS ── */
const settingsModal=document.getElementById("settings-modal");
document.getElementById("settings-btn").addEventListener("click",()=>{document.getElementById("voice-lang").value=voiceLang;settingsModal.classList.add("open");});
document.getElementById("close-settings-btn").addEventListener("click",()=>settingsModal.classList.remove("open"));
settingsModal.addEventListener("click",e=>{if(e.target===settingsModal)settingsModal.classList.remove("open");});
document.getElementById("save-settings-btn").addEventListener("click",()=>{
  voiceLang=document.getElementById("voice-lang").value.trim()||"es-MX";
  const s=load("nm_session",{});s.voiceLang=voiceLang;s.isDark=isDark;save("nm_session",s);
  settingsModal.classList.remove("open");
});

/* ── VOICE ── */
let isListening=false,audioCtx=null,analyser=null,micStream=null,recog=null,voiceProcessing=false;
const sphereWrap=document.getElementById("sphere-wrap");
const voiceStatus=document.getElementById("voice-status");
const voiceBubble=document.getElementById("voice-bubble");
const micBtn=document.getElementById("mic-btn");

// Seleccionar la voz más robótica/IA disponible
function getBestVoice() {
  const voices = speechSynthesis.getVoices();
  // Buscar voces en español con preferencia a voces sintéticas
  const preferred = [
    "Microsoft Sabina", "Microsoft Helena", "Google español",
    "Microsoft Pablo", "Microsoft Jorge"
  ];
  for (const name of preferred) {
    const v = voices.find(v => v.name.includes(name));
    if (v) return v;
  }
  // Fallback: cualquier voz en español
  return voices.find(v => v.lang.startsWith("es")) || voices[0];
}

async function startListening(){
  if(isListening){stopListening();return;}
  try{
    micStream=await navigator.mediaDevices.getUserMedia({audio:true});
    audioCtx=new(window.AudioContext||window.webkitAudioContext)();
    const src=audioCtx.createMediaStreamSource(micStream);
    analyser=audioCtx.createAnalyser();analyser.fftSize=256;src.connect(analyser);
    isListening=true;
    micBtn.classList.add("active");
    sphereWrap.classList.add("pulsing");
    voiceStatus.textContent="Escuchando...";
    voiceStatus.className="voice-status listening";
    voiceBubble.textContent="🎙 Habla ahora...";
    pollVol();startSR();
  }catch(e){
    voiceStatus.textContent="No se pudo acceder al micrófono.";
  }
}

function pollVol(){
  if(!isListening||!analyser)return;
  const buf=new Uint8Array(analyser.frequencyBinCount);
  analyser.getByteFrequencyData(buf);
  let s=0;for(const v of buf)s+=v;
  targetVolume=Math.min(s/buf.length/60,1);
  requestAnimationFrame(pollVol);
}

function stopListening(){
  isListening=false;
  micBtn.classList.remove("active");
  sphereWrap.classList.remove("pulsing");
  targetVolume=0;
  voiceStatus.textContent="Presiona el micrófono para hablar";
  voiceStatus.className="voice-status";
  micStream?.getTracks().forEach(t=>t.stop());micStream=null;
  audioCtx?.close();audioCtx=null;analyser=null;
  try{recog?.abort();}catch(e){}recog=null;
  window.speechSynthesis.cancel();
}

function startSR(){
  const SR=window.SpeechRecognition||window.webkitSpeechRecognition;
  if(!SR){voiceBubble.textContent="Usa Chrome para el modo voz.";return;}
  recog=new SR();
  recog.lang=voiceLang;
  recog.interimResults=true;
  recog.continuous=false;
  recog.maxAlternatives=1;

  recog.onresult=e=>{
    let interim="",final="";
    for(let i=e.resultIndex;i<e.results.length;i++){
      if(e.results[i].isFinal)final+=e.results[i][0].transcript;
      else interim+=e.results[i][0].transcript;
    }
    if(interim) voiceBubble.textContent="🎙 "+interim;
    if(final){ voiceBubble.textContent="🎙 "+final; sendVoiceMsg(final.trim()); }
  };

  recog.onerror=e=>{
    if(e.error==="no-speech"||e.error==="aborted")return;
    voiceBubble.textContent="Error: "+e.error;
  };

  recog.onend=()=>{
    if(isListening&&!voiceProcessing){
      try{recog=new(window.SpeechRecognition||window.webkitSpeechRecognition)();startSR();}catch(e){}
    }
  };

  try{recog.start();}catch(e){}
}

async function sendVoiceMsg(text){
  if(!text||voiceProcessing)return;
  voiceProcessing=true;
  try{recog?.stop();}catch(e){}

  voiceStatus.textContent="⚡ Procesando...";
  voiceStatus.className="voice-status thinking";
  targetVolume=0.2;

  chatHistory.push({role:"user",content:text});

  try{
    const reply=await callAI(chatHistory);
    chatHistory.push({role:"assistant",content:reply});

    if(currentUser&&activeChatId){
      await dbSaveMessage(currentUser.username,activeChatId,"user",text);
      await dbSaveMessage(currentUser.username,activeChatId,"assistant",reply);
    }

    // Mostrar solo las primeras palabras para no saturar la pantalla
    const preview = reply.length > 80 ? reply.slice(0,80)+"…" : reply;
    voiceBubble.textContent = preview;
    voiceStatus.textContent="🔊 Hablando...";
    voiceStatus.className="voice-status speaking";
    speakText(reply);

  }catch(e){
    chatHistory.pop();
    voiceBubble.textContent="Error: "+e.message;
    voiceStatus.textContent="Presiona el micrófono para hablar";
    voiceStatus.className="voice-status";
    sphereWrap.classList.remove("pulsing");
    targetVolume=0;
    voiceProcessing=false;
    if(isListening){setTimeout(()=>startSR(),500);}
  }
}

function speakText(text){
  if(!window.speechSynthesis){finishSpeaking();return;}
  window.speechSynthesis.cancel();

  // Limpiar markdown para que suene mejor
  const clean = text
    .replace(/\*\*(.*?)\*\*/g,"$1")
    .replace(/\*(.*?)\*/g,"$1")
    .replace(/`(.*?)`/g,"$1")
    .replace(/#{1,6}\s/g,"")
    .replace(/\n+/g," ");

  const utt=new SpeechSynthesisUtterance(clean);
  utt.lang=voiceLang;
  utt.rate=1.1;   // un poco más rápido = más IA
  utt.pitch=0.85; // tono más bajo = más robótico
  utt.volume=1;

  const doSpeak=()=>{
    const voice=getBestVoice();
    if(voice)utt.voice=voice;

    let animTimer;
    const animVol=()=>{
      targetVolume=0.35+Math.random()*0.55;
      animTimer=setTimeout(animVol,60+Math.random()*100);
    };
    animVol();

    utt.onend=()=>{clearTimeout(animTimer);finishSpeaking();};
    utt.onerror=()=>{clearTimeout(animTimer);finishSpeaking();};
    speechSynthesis.speak(utt);
  };

  if(speechSynthesis.getVoices().length===0){
    speechSynthesis.onvoiceschanged=doSpeak;
    setTimeout(()=>{if(!speechSynthesis.speaking)doSpeak();},300);
  } else {
    doSpeak();
  }
}

function finishSpeaking(){
  targetVolume=0;
  sphereWrap.classList.remove("pulsing");
  voiceStatus.textContent="Escuchando...";
  voiceStatus.className="voice-status listening";
  voiceBubble.textContent="🎙 Habla ahora...";
  voiceProcessing=false;
  // Reanudar escucha automáticamente
  if(isListening){
    setTimeout(()=>{
      try{
        recog=new(window.SpeechRecognition||window.webkitSpeechRecognition)();
        startSR();
      }catch(e){}
    },2000);
  }
}

micBtn.addEventListener("click",startListening);


/* ── INIT ── */
applyTheme();
tryAutoLogin();
