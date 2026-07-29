'use strict';
/* ============================================================
   Toastmasters Club App — multi-user version
   Admins: full dashboard (schedule, agenda, members, DCP, settings)
   Members: book open slots for themselves + own profile/goals
   Backend: Supabase (config.js). With placeholder config -> DEMO MODE.
   ============================================================ */

const DEMO = !window.CLUB_CONFIG || window.CLUB_CONFIG.SUPABASE_URL.includes('YOUR-');

/* ---------- small helpers ---------- */
const PATHS=['Presentation Mastery','Dynamic Leadership','Leadership Development','Effective Coaching','Engaging Humor','Innovative Planning','Motivational Strategies','Persuasive Influence','Strategic Relationships','Team Collaboration','Visionary Communication'];
const WEEKDAYS=['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];
function uid(){ return Date.now().toString(36)+Math.random().toString(36).slice(2,7); }
function esc(s){ return String(s==null?'':s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }
function dstr(d){ return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0'); }
function todayStr(){ return dstr(new Date()); }
function parseD(s){ const p=s.split('-').map(Number); return new Date(p[0],p[1]-1,p[2]); }
function fmtDate(s){ try{ return parseD(s).toLocaleDateString(undefined,{weekday:'short',day:'numeric',month:'short',year:'numeric'});}catch(e){return s;} }
function clubYearOf(s){ const p=s.split('-').map(Number); return p[1]>=7?p[0]:p[0]-1; }
function currentClubYear(){ return clubYearOf(todayStr()); }
function inClubYear(dateS,yr){ return clubYearOf(dateS)===yr; }
function toast(msg){ const t=document.getElementById('toast'); t.textContent=msg; t.classList.add('show'); clearTimeout(t._h); t._h=setTimeout(()=>t.classList.remove('show'),2500); }
function rtcRoleSet(){
  return [
    {id:'saa',name:'Sergeant at Arms (SAA)',count:1},
    {id:'po',name:'Presiding Officer',count:1},
    {id:'tmod',name:'Toastmaster of the Day',count:1},
    {id:'ttm',name:'Table Topics Master',count:1},
    {id:'spk',name:'Speaker',count:3},
    {id:'ge',name:'General Evaluator',count:1},
    {id:'tte',name:'Table Topics Evaluator',count:1},
    {id:'eval',name:'Evaluator',count:3},
    {id:'timer',name:'Timer',count:1},
    {id:'vc',name:'Vote Counter',count:1},
    {id:'gram',name:'Grammarian',count:1},
    {id:'al',name:'Active Listener',count:1},
    {id:'ah',name:'Ah-Counter',count:1},
    {id:'jm',name:'Joke Master',count:1}
  ];
}
function defaultSettings(){ return {clubName:'Rawalpindi Toastmasters Club',meetingDay:6,cadence:'weekly',roles:rtcRoleSet(),agendaAssets:{}}; }

/* ============================================================
   DATA LAYER — two implementations of the same api surface
   ============================================================ */
let api=null, sb=null;

const SupabaseApi={
  async init(){
    const {createClient}=await import('https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm');
    sb=createClient(window.CLUB_CONFIG.SUPABASE_URL,window.CLUB_CONFIG.SUPABASE_ANON_KEY);
    sb.auth.onAuthStateChange((_e,_s)=>{ route(); });
  },
  async session(){ return (await sb.auth.getSession()).data.session; },
  async signUp(email,pass,name){
    const {data,error}=await sb.auth.signUp({email,password:pass});
    if(error)throw error;
    if(data.session){
      const {error:e2}=await sb.from('profiles').insert({auth_id:data.session.user.id,email,name});
      if(e2&&e2.code!=='23505')throw e2;
    } else {
      localStorage.setItem('pendingName',name);
      throw {message:'Check your email to confirm the account, then sign in.'};
    }
  },
  async signIn(email,pass){
    const {error}=await sb.auth.signInWithPassword({email,password:pass});
    if(error)throw error;
  },
  async signOut(){ await sb.auth.signOut(); },
  async myProfile(){
    const s=await this.session(); if(!s)return null;
    const {data,error}=await sb.from('profiles').select('*').eq('auth_id',s.user.id).maybeSingle();
    if(error)throw error;
    if(!data){
      const name=localStorage.getItem('pendingName')||prompt('Your full name (for agendas):')||s.user.email;
      const {data:row,error:e2}=await sb.from('profiles').insert({auth_id:s.user.id,email:s.user.email,name}).select().single();
      if(e2)throw e2;
      localStorage.removeItem('pendingName');
      return row;
    }
    return data;
  },
  async loadAll(){
    const q=async(t)=>{ const {data,error}=await sb.from(t).select('*'); if(error)throw error; return data; };
    const [settingsRows,profiles,meetings,assignments,awards,goals,dcpRows,agendaRows]=await Promise.all(
      ['settings','profiles','meetings','assignments','awards','goals','dcp','agendas'].map(q));
    return {settingsRows,profiles,meetings,assignments,awards,goals,dcpRows,agendaRows};
  },
  async saveSettings(data){ const {error}=await sb.from('settings').upsert({id:1,data}); if(error)throw error; },
  async insertMeeting(m){ const {data,error}=await sb.from('meetings').insert(m).select().single(); if(error)throw error; return data; },
  async updateMeeting(id,fields){ const {error}=await sb.from('meetings').update(fields).eq('id',id); if(error)throw error; },
  async book(meeting_id,slot_key,profile_id){
    const {error}=await sb.from('assignments').insert({meeting_id,slot_key,profile_id});
    if(error)throw error;
  },
  async adminAssign(meeting_id,slot_key,profile_id){
    const {error}=await sb.from('assignments').upsert({meeting_id,slot_key,profile_id,status:'booked',actual_role:null});
    if(error)throw error;
  },
  async unbook(meeting_id,slot_key){
    const {error}=await sb.from('assignments').delete().eq('meeting_id',meeting_id).eq('slot_key',slot_key);
    if(error)throw error;
  },
  async setAsg(meeting_id,slot_key,fields){
    const {error}=await sb.from('assignments').update(fields).eq('meeting_id',meeting_id).eq('slot_key',slot_key);
    if(error)throw error;
  },
  async insertProfile(fields){ const {data,error}=await sb.from('profiles').insert(fields).select().single(); if(error)throw error; return data; },
  async updateProfile(id,fields){ const {error}=await sb.from('profiles').update(fields).eq('id',id); if(error)throw error; },
  async deleteProfile(id){ const {error}=await sb.from('profiles').delete().eq('id',id); if(error)throw error; },
  async addAward(fields){ const {data,error}=await sb.from('awards').insert(fields).select().single(); if(error)throw error; return data; },
  async delAward(id){ const {error}=await sb.from('awards').delete().eq('id',id); if(error)throw error; },
  async addGoal(fields){ const {data,error}=await sb.from('goals').insert(fields).select().single(); if(error)throw error; return data; },
  async updGoal(id,fields){ const {error}=await sb.from('goals').update(fields).eq('id',id); if(error)throw error; },
  async delGoal(id){ const {error}=await sb.from('goals').delete().eq('id',id); if(error)throw error; },
  async saveDcp(year,data){ const {error}=await sb.from('dcp').upsert({year,data}); if(error)throw error; },
  async saveAgenda(meeting_id,data){ const {error}=await sb.from('agendas').upsert({meeting_id,data}); if(error)throw error; },
  subscribe(onChange){
    sb.channel('live')
      .on('postgres_changes',{event:'*',schema:'public',table:'assignments'},p=>onChange('assignments',p))
      .on('postgres_changes',{event:'*',schema:'public',table:'meetings'},p=>onChange('meetings',p))
      .subscribe();
  }
};

/* ---------- demo backend: in-memory sample data ---------- */
const DemoApi=(function(){
  let auth=null;
  const P=(n,extra)=>({id:uid(),auth_id:null,email:'',name:n,home_club:null,role:'member',approved:true,active:true,path:'',base_level:0,projects_done:0,...extra});
  const profiles=[
    P('Demo Admin (you)',{auth_id:'demo-admin',role:'admin',email:'admin@demo',path:'Presentation Mastery',base_level:2,projects_done:1}),
    P('Demo Member (you)',{auth_id:'demo-member',email:'member@demo',path:'Dynamic Leadership',base_level:0,projects_done:3}),
    P('Ayesha',{path:'Engaging Humor',base_level:1,projects_done:2}),
    P('Bilal',{path:'Innovative Planning',base_level:1}),
    P('Danish',{path:'Presentation Mastery',base_level:3,projects_done:1}),
    P('Fatima',{path:'Team Collaboration'}),
    P('Hassan',{path:'Motivational Strategies',base_level:2}),
    P('Guest from City Club',{home_club:'City Speakers'}),
    P('Pending Signup',{auth_id:'demo-x',email:'new@demo',approved:false})
  ];
  const day=n=>{const d=new Date();d.setDate(d.getDate()+n);return dstr(d);};
  const meetings=[
    {id:'mtPast',date:day(-4),theme:'Practice makes progress',cancelled:false,reviewed:false},
    {id:'mt1',date:day(3),theme:'Turning Fear into Fuel',cancelled:false,reviewed:false},
    {id:'mt2',date:day(10),theme:'',cancelled:false,reviewed:false},
    {id:'mt3',date:day(17),theme:'',cancelled:false,reviewed:false}
  ];
  const assignments=[
    {meeting_id:'mtPast',slot_key:'tmod|0',profile_id:profiles[0].id,status:'booked',actual_role:null},
    {meeting_id:'mtPast',slot_key:'spk|0',profile_id:profiles[2].id,status:'booked',actual_role:null},
    {meeting_id:'mtPast',slot_key:'timer|0',profile_id:profiles[3].id,status:'absent',actual_role:null},
    {meeting_id:'mt1',slot_key:'tmod|0',profile_id:profiles[4].id,status:'booked',actual_role:null},
    {meeting_id:'mt1',slot_key:'spk|0',profile_id:profiles[2].id,status:'booked',actual_role:null},
    {meeting_id:'mt1',slot_key:'ge|0',profile_id:profiles[6].id,status:'booked',actual_role:null}
  ];
  const awards=[{id:uid(),profile_id:profiles[2].id,level:'1',path:'Engaging Humor',date:day(-20)}];
  const goals=[{id:uid(),profile_id:profiles[1].id,text:'Give my Ice Breaker before September',done:false}];
  const dcpRows=[],agendaRows=[];
  let settingsRows=[{id:1,data:defaultSettings()}];
  const T={profiles,meetings,assignments,awards,goals};
  return {
    demo:true,
    async init(){},
    async session(){ return auth?{user:{id:auth}}:null; },
    demoEnter(kind){ auth=kind==='admin'?'demo-admin':'demo-member'; route(); },
    async signUp(email,pass,name){ profiles.push(P(name,{auth_id:'demo-'+uid(),email,approved:false})); throw {message:'Demo: account created as pending — sign in as admin to see the approval flow.'}; },
    async signIn(email){ if(email==='admin@demo')auth='demo-admin'; else if(email==='member@demo')auth='demo-member'; else throw {message:'Demo mode: use the buttons above, or admin@demo / member@demo.'}; },
    async signOut(){ auth=null; },
    async myProfile(){ return profiles.find(p=>p.auth_id===auth)||null; },
    async loadAll(){ return {settingsRows,profiles,meetings,assignments,awards,goals,dcpRows,agendaRows}; },
    async saveSettings(data){ settingsRows=[{id:1,data}]; },
    async insertMeeting(m){ const row={id:uid(),theme:'',cancelled:false,reviewed:false,...m}; meetings.push(row); return row; },
    async updateMeeting(id,f){ Object.assign(meetings.find(m=>m.id===id)||{},f); },
    async book(mid,key,pid){
      if(assignments.some(a=>a.meeting_id===mid&&a.slot_key===key))throw {message:'duplicate key value'};
      assignments.push({meeting_id:mid,slot_key:key,profile_id:pid,status:'booked',actual_role:null});
    },
    async adminAssign(mid,key,pid){
      const ex=assignments.find(a=>a.meeting_id===mid&&a.slot_key===key);
      if(ex){ex.profile_id=pid;ex.status='booked';ex.actual_role=null;}
      else assignments.push({meeting_id:mid,slot_key:key,profile_id:pid,status:'booked',actual_role:null});
    },
    async unbook(mid,key){ const i=assignments.findIndex(a=>a.meeting_id===mid&&a.slot_key===key); if(i>=0)assignments.splice(i,1); },
    async setAsg(mid,key,f){ Object.assign(assignments.find(a=>a.meeting_id===mid&&a.slot_key===key)||{},f); },
    async insertProfile(f){ const row=P(f.name,f); profiles.push(row); return row; },
    async updateProfile(id,f){ Object.assign(profiles.find(p=>p.id===id)||{},f); },
    async deleteProfile(id){ const i=profiles.findIndex(p=>p.id===id); if(i>=0)profiles.splice(i,1); },
    async addAward(f){ const row={id:uid(),...f}; awards.push(row); return row; },
    async delAward(id){ const i=awards.findIndex(a=>a.id===id); if(i>=0)awards.splice(i,1); },
    async addGoal(f){ const row={id:uid(),done:false,...f}; goals.push(row); return row; },
    async updGoal(id,f){ Object.assign(goals.find(g=>g.id===id)||{},f); },
    async delGoal(id){ const i=goals.findIndex(g=>g.id===id); if(i>=0)goals.splice(i,1); },
    async saveDcp(year,data){ const ex=dcpRows.find(r=>r.year===year); if(ex)ex.data=data; else dcpRows.push({year,data}); },
    async saveAgenda(mid,data){ const ex=agendaRows.find(r=>r.meeting_id===mid); if(ex)ex.data=data; else agendaRows.push({meeting_id:mid,data}); },
    subscribe(){},
    _tables:T
  };
})();

/* ============================================================
   COMPAT STATE — same shape the single-user tracker used, so all
   read/render logic carries over. Mutations patch it AND call api.
   ============================================================ */
let S={profiles:[],meetings:[],assignments:[],awards:[],goals:[],settings:defaultSettings(),dcp:{},agendas:{}};
let state=null, me=null, isAdmin=false;

function rebuild(){
  const awardsBy={},goalsBy={};
  for(const a of S.awards)(awardsBy[a.profile_id]=awardsBy[a.profile_id]||[]).push(a);
  for(const g of S.goals)(goalsBy[g.profile_id]=goalsBy[g.profile_id]||[]).push(g);
  const asgBy={};
  for(const a of S.assignments)
    (asgBy[a.meeting_id]=asgBy[a.meeting_id]||{})[a.slot_key]={memberId:a.profile_id,status:a.status==='booked'?undefined:a.status,actualRole:a.actual_role||undefined};
  state={
    settings:S.settings,
    members:S.profiles.map(p=>({id:p.id,name:p.name,external:!!p.home_club,homeClub:p.home_club||'',path:p.path||'',baseLevel:p.base_level||0,projectsDone:p.projects_done||0,
      awards:(awardsBy[p.id]||[]).map(a=>({id:a.id,level:a.level,path:a.path||'',date:a.date})).sort((a,b)=>a.date<b.date?-1:1),
      goals:(goalsBy[p.id]||[]).map(g=>({id:g.id,text:g.text,done:g.done})),
      archived:!p.active,role:p.role,approved:p.approved,hasAccount:!!p.auth_id,email:p.email||''})),
    meetings:S.meetings.map(m=>({id:m.id,date:m.date,theme:m.theme||'',cancelled:m.cancelled,reviewed:m.reviewed,config:m.config||{},wod:m.wod||{},assignments:asgBy[m.id]||{}}))
      .sort((a,b)=>a.date<b.date?-1:1),
    dcp:S.dcp, agendas:S.agendas
  };
}
function sync(p){ Promise.resolve(p).catch(e=>{ console.error(e); toast('Sync failed: '+(e.message||e)); }); }

/* ---------- shared read logic (ported unchanged) ---------- */
function slotList(){
  const out=[];
  for(const r of state.settings.roles)
    for(let i=0;i<(r.count||1);i++)
      out.push({key:r.id+'|'+i,role:r,label:(r.count>1?r.name+' '+(i+1):r.name)});
  return out;
}
/* per-meeting overrides (admin-set): {speakers: N, tt: false} */
function speakersFor(m){
  const def=(state.settings.roles.find(r=>r.id==='spk')||{count:3}).count||3;
  return (m&&m.config&&m.config.speakers!=null)?m.config.speakers:def;
}
function ttOn(m){ return !(m&&m.config&&m.config.tt===false); }
function slotListFor(m){
  const out=[];
  for(const r of state.settings.roles){
    if(m&&!ttOn(m)&&(r.id==='ttm'||r.id==='tte'))continue;
    let count=r.count||1;
    if(m&&(r.id==='spk'||r.id==='eval'))count=speakersFor(m);
    for(let i=0;i<count;i++)out.push({key:r.id+'|'+i,role:r,label:(count>1?r.name+' '+(i+1):r.name)});
  }
  return out;
}
function roleNameById(id){ const r=state.settings.roles.find(r=>r.id===id); return r?r.name:'(removed role)'; }
function memberById(id){ return state.members.find(m=>m.id===id); }
function meetingOutcomes(m){
  const out=[];
  for(const [key,a] of Object.entries(m.assignments||{})){
    if(!a||!a.memberId||!memberById(a.memberId))continue;
    const baseRole=roleNameById(key.split('|')[0]);
    const st=a.status||'done';
    out.push({memberId:a.memberId,roleName:(st==='other'&&a.actualRole)?a.actualRole:baseRole,status:st});
  }
  return out;
}
function pastMeetings(){ const t=todayStr(); return state.meetings.filter(m=>!m.cancelled&&m.date<t).sort((a,b)=>a.date<b.date?1:-1); }
function upcomingMeetings(){ const t=todayStr(); return state.meetings.filter(m=>!m.cancelled&&m.date>=t).sort((a,b)=>a.date<b.date?-1:1).slice(0,3); }
function roleHistory(){
  const h={},abs={};
  for(const m of pastMeetings()){
    for(const o of meetingOutcomes(m)){
      if(o.status==='absent'){ abs[o.memberId]=(abs[o.memberId]||0)+1; continue; }
      (h[o.memberId]=h[o.memberId]||{})[o.roleName]=(h[o.memberId][o.roleName]||0)+1;
    }
  }
  return {h,abs};
}
function speechesThisYear(){
  const yr=currentClubYear(),out={};
  for(const m of pastMeetings()){
    if(!inClubYear(m.date,yr))continue;
    for(const o of meetingOutcomes(m))
      if(o.status!=='absent'&&/^speaker/i.test(o.roleName))out[o.memberId]=(out[o.memberId]||0)+1;
  }
  return out;
}
function currentLevel(mem){
  let lv=mem.baseLevel||0;
  for(const a of (mem.awards||[])){ const l=a.level==='DTM'?5:Number(a.level); if(l>lv)lv=l; }
  return lv;
}
function dcpYear(yr){
  if(!state.dcp[yr])state.dcp[yr]={newMembers:0,officersR1:0,officersR2:0,dues:false,officerList:false,base:'',current:'',target:5};
  return state.dcp[yr];
}
function eduCounts(yr){
  const c={1:0,2:0,3:0,45:0};
  for(const mem of state.members){
    if(mem.external)continue;
    for(const a of (mem.awards||[])){
      if(!a.date||!inClubYear(a.date,yr))continue;
      const l=a.level==='DTM'?5:Number(a.level);
      if(l===1)c[1]++;else if(l===2)c[2]++;else if(l===3)c[3]++;else if(l>=4)c[45]++;
    }
  }
  return c;
}
function dcpGoals(yr){
  const e=eduCounts(yr),d=dcpYear(yr);
  return [
    {n:1,t:'Four members complete Level 1',cur:e[1],tgt:4},
    {n:2,t:'Two members complete Level 2',cur:Math.min(e[2],2),tgt:2},
    {n:3,t:'Two more members complete Level 2',cur:Math.max(0,e[2]-2),tgt:2},
    {n:4,t:'Two members complete Level 3',cur:e[3],tgt:2},
    {n:5,t:'One member completes Level 4, 5 or DTM',cur:Math.min(e[45],1),tgt:1},
    {n:6,t:'One more member completes Level 4, 5 or DTM',cur:Math.max(0,e[45]-1),tgt:1},
    {n:7,t:'Four new members',cur:Math.min(d.newMembers,4),tgt:4},
    {n:8,t:'Four more new members',cur:Math.max(0,d.newMembers-4),tgt:4},
    {n:9,t:'Four officers trained in both rounds',cur:Math.min(d.officersR1,d.officersR2),tgt:4},
    {n:10,t:'Dues on time + officer list submitted',cur:(d.dues?1:0)+(d.officerList?1:0),tgt:2}
  ].map(g=>({...g,met:g.cur>=g.tgt}));
}
function candidatesByGoal(){
  const sp=speechesThisYear();
  const pool=state.members.filter(m=>!m.external&&!m.archived);
  const buckets={1:[],2:[],3:[],45:[]};
  for(const m of pool){
    const cl=currentLevel(m);
    const info={m,cl,score:(m.projectsDone||0)*2+(sp[m.id]||0),speeches:sp[m.id]||0};
    if(cl===0)buckets[1].push(info);
    else if(cl===1)buckets[2].push(info);
    else if(cl===2)buckets[3].push(info);
    else if(cl>=3&&cl<5)buckets[45].push(info);
  }
  for(const k in buckets)buckets[k].sort((a,b)=>b.score-a.score);
  return buckets;
}

/* ---------- meetings auto-generation (admin writes; all read) ---------- */
async function ensureMeetings(){
  if(!isAdmin)return;
  const t=todayStr();
  const step=state.settings.cadence==='biweekly'?14:7;
  let count=S.meetings.filter(m=>!m.cancelled&&m.date>=t).length;
  const futureDates=S.meetings.map(m=>m.date).filter(d=>d>=t).sort();
  let d;
  if(futureDates.length){ d=parseD(futureDates[futureDates.length-1]); }
  else{
    d=parseD(t);
    const off=(state.settings.meetingDay-d.getDay()+7)%7;
    d.setDate(d.getDate()+off-step);
  }
  let guard=0;
  while(count<3&&guard++<30){
    d.setDate(d.getDate()+step);
    const ds=dstr(d);
    if(!S.meetings.some(m=>m.date===ds)){
      try{ const row=await api.insertMeeting({date:ds}); S.meetings.push(row); count++; }
      catch(e){ console.error(e); break; }
    }
  }
  rebuild();
}

/* ============================================================
   RENDERING
   ============================================================ */
let tab='schedule';
let viewAsMember=false;
function tabsFor(){
  return (isAdmin&&!viewAsMember)
    ? [['schedule','Roles & Meetings'],['agenda','Agenda'],['members','Members'],['dcp','DCP Goals'],['settings','Settings']]
    : [['book','Book a Role'],['me','My Profile']];
}
function render(){
  document.getElementById('hClub').textContent=state.settings.clubName||'Toastmasters Club';
  document.getElementById('uName').textContent=(me?me.name:'')+(isAdmin?(viewAsMember?' (member view)':' (admin)'):'');
  const va=document.getElementById('viewAs');
  if(va){ va.style.display=isAdmin?'':'none'; va.textContent=viewAsMember?'← Back to admin':'👁 View as member'; }
  const TABS=tabsFor();
  if(!TABS.some(([id])=>id===tab))tab=TABS[0][0];
  document.getElementById('tabs').innerHTML=TABS.map(([id,label])=>
    `<button class="${tab===id?'on':''}" onclick="setTab('${id}')">${label}</button>`).join('');
  const main=document.getElementById('main');
  if(tab==='schedule')main.innerHTML=viewSchedule();
  else if(tab==='agenda'){ AgendaApp.mount(main); return; }
  else if(tab==='members')main.innerHTML=viewMembers();
  else if(tab==='dcp')main.innerHTML=viewDCP();
  else if(tab==='settings')main.innerHTML=viewSettings();
  else if(tab==='book')main.innerHTML=viewBook();
  else if(tab==='me')main.innerHTML=viewMe();
}
function setTab(t){ tab=t; render(); window.scrollTo(0,0); }

/* ================= MEMBER: booking ================= */
function viewBook(){
  const up=upcomingMeetings();
  let html=`<h2>Book a role — next ${up.length} meeting${up.length===1?'':'s'}</h2>
  <p class="small muted">Tap an open slot to take it. You can release your own bookings any time before the meeting. Slots update live as others book.</p>`;
  if(!up.length)html+=`<div class="empty">No upcoming meetings scheduled yet — check back soon.</div>`;
  for(const m of up){
    const slots=slotListFor(m);
    const mineCount=Object.values(m.assignments||{}).filter(a=>a&&a.memberId===me.profileId).length;
    const isTmod=((m.assignments||{})['tmod|0']||{}).memberId===me.profileId;
    const isGram=((m.assignments||{})['gram|0']||{}).memberId===me.profileId;
    html+=`<div class="card">
      <div class="row"><h3 style="margin:0" class="grow">${fmtDate(m.date)} ${m.theme?`<span class="muted small">· ${esc(m.theme)}</span>`:''}
        ${ttOn(m)?'':' <span class="chip gold">Speakathon</span>'}
        ${(m.wod||{}).word?` <span class="chip">📖 WOD: ${esc(m.wod.word)}</span>`:''}</h3>
      ${mineCount?`<span class="chip good">you have ${mineCount} role${mineCount>1?'s':''}</span>`:''}</div>
      ${isTmod?`<div class="row small" style="margin-top:6px;padding:6px 10px;background:var(--gold-soft);border-radius:8px">
        <label><b>🎨 You're the TMOD</b> — set the theme:</label>
        <input type="text" style="max-width:260px" class="grow" placeholder="Meeting theme" value="${esc(m.theme)}" onchange="setTheme('${m.id}',this.value)">
      </div>`:''}
      ${isGram?`<div class="row small" style="margin-top:6px;padding:6px 10px;background:var(--gold-soft);border-radius:8px">
        <label><b>📖 You're the Grammarian</b> — Word of the Day:</label>
        <input type="text" style="max-width:130px" placeholder="word" value="${esc((m.wod||{}).word||'')}" onchange="setWod('${m.id}','word',this.value)">
        <input type="text" style="max-width:340px" class="grow" placeholder="meaning — example sentence" value="${esc((m.wod||{}).def||'')}" onchange="setWod('${m.id}','def',this.value)">
      </div>`:''}
      <div class="bookgrid">
      ${slots.map(s=>{
        const a=(m.assignments||{})[s.key];
        if(a&&a.memberId===me.profileId)
          return `<div class="bookslot mine"><div><div class="rname">${esc(s.label)}</div><div class="holder">You</div></div>
            <button class="btn ghost small" onclick="myUnbook('${m.id}','${s.key}')">Release</button></div>`;
        if(a&&a.memberId){
          const holder=memberById(a.memberId);
          return `<div class="bookslot"><div><div class="rname">${esc(s.label)}</div><div class="holder">${esc(holder?holder.name:'…')}</div></div></div>`;
        }
        return `<div class="bookslot open"><div><div class="rname">${esc(s.label)}</div><div class="holder muted">open</div></div>
          <button class="btn small" onclick="myBook('${m.id}','${s.key}')">Book</button></div>`;
      }).join('')}
      </div></div>`;
  }
  return html;
}
async function myBook(mid,key){
  try{
    await api.book(mid,key,me.profileId);
    S.assignments.push({meeting_id:mid,slot_key:key,profile_id:me.profileId,status:'booked',actual_role:null});
    rebuild();render();toast('Booked ✓');
  }catch(e){
    if(String(e.message||'').includes('duplicate')){ toast('Someone just took that slot'); await reload(); }
    else toast('Could not book: '+(e.message||e));
  }
}
async function myUnbook(mid,key){
  try{
    await api.unbook(mid,key);
    S.assignments=S.assignments.filter(a=>!(a.meeting_id===mid&&a.slot_key===key));
    rebuild();render();toast('Released');
  }catch(e){ toast('Could not release: '+(e.message||e)); }
}

/* ================= MEMBER: own profile ================= */
function lvlChips(mem){
  const cl=currentLevel(mem);
  return `<span class="lvl">${[1,2,3,4,5].map(l=>`<span class="${l<=cl?'done':''}">${l}</span>`).join('')}</span>`;
}
function viewMe(){
  const mem=memberById(me.profileId);
  if(!mem)return `<div class="empty">Profile not found.</div>`;
  const {h,abs}=roleHistory();
  const hist=h[mem.id]||{};
  const roleChips=Object.entries(hist).sort((a,b)=>b[1]-a[1]).map(([r,c])=>`<span class="chip">${esc(r)} ×${c}</span>`).join('')||`<span class="muted small">no roles completed yet</span>`;
  const myBookings=[];
  for(const m of upcomingMeetings())
    for(const [key,a] of Object.entries(m.assignments||{}))
      if(a&&a.memberId===mem.id)myBookings.push(`${fmtDate(m.date)} — ${roleNameById(key.split('|')[0])}`);
  return `<h2>My profile</h2>
  <div class="card">
    <div class="row"><span class="mname">${esc(mem.name)}</span> ${lvlChips(mem)}</div>
    <div class="row" style="margin-top:10px">
      <div><label class="small muted">My path</label><br>
        <select style="width:auto" onchange="meSet('path',this.value)">
          <option value="">— choose path —</option>
          ${PATHS.map(p=>`<option ${mem.path===p?'selected':''}>${p}</option>`).join('')}
        </select></div>
      <div><label class="small muted">Projects done in Level ${Math.min(currentLevel(mem)+1,5)}</label><br>
        <input type="number" min="0" max="9" value="${mem.projectsDone||0}" onchange="meSet('projectsDone',Number(this.value))"></div>
    </div>
    <div class="sect"><h3>Level completions</h3>
      ${(mem.awards||[]).map(a=>`<span class="chip gold">Level ${esc(a.level)} · ${fmtDate(a.date)}</span>`).join('')||'<span class="muted small">none recorded yet — completions are recorded by the officers</span>'}
    </div>
    <div class="sect"><h3>My goals</h3>
      ${(mem.goals||[]).map(g=>`<div class="row small" style="padding:2px 0">
        <label style="display:flex;gap:6px;align-items:center"><input type="checkbox" ${g.done?'checked':''} onchange="meGoalToggle('${g.id}',this.checked)">
        <span style="${g.done?'text-decoration:line-through;color:var(--muted)':''}">${esc(g.text)}</span></label>
        <button class="btn ghost small" onclick="meGoalDel('${g.id}')">✕</button></div>`).join('')||'<div class="muted small">no goals yet</div>'}
      <div class="row" style="margin-top:6px">
        <input type="text" id="meGoal" placeholder="e.g. Finish Level 1 by December" class="grow" style="max-width:340px">
        <button class="btn small" onclick="meGoalAdd()">Add goal</button>
      </div>
    </div>
    <div class="sect"><h3>My upcoming bookings</h3>
      ${myBookings.map(b=>`<div class="small">${b}</div>`).join('')||'<div class="muted small">nothing booked — grab a slot on the Book a Role tab!</div>'}
    </div>
    <div class="sect"><h3>Roles I've completed</h3>${roleChips}
      ${abs[mem.id]?`<div class="small muted" style="margin-top:4px">absences: ${abs[mem.id]}</div>`:''}</div>
  </div>`;
}
function meSet(k,v){
  const mem=memberById(me.profileId); mem[k]=v;
  const p=S.profiles.find(p=>p.id===me.profileId);
  if(k==='path')p.path=v; if(k==='projectsDone')p.projects_done=v;
  sync(api.updateProfile(me.profileId,k==='path'?{path:v}:{projects_done:v}));
  render();
}
async function meGoalAdd(){
  const inp=document.getElementById('meGoal'); const text=inp.value.trim(); if(!text)return;
  try{ const row=await api.addGoal({profile_id:me.profileId,text}); S.goals.push(row); rebuild();render(); }
  catch(e){ toast('Could not save goal'); }
}
function meGoalToggle(id,done){ const g=S.goals.find(g=>g.id===id); if(g)g.done=done; sync(api.updGoal(id,{done})); rebuild();render(); }
function meGoalDel(id){ S.goals=S.goals.filter(g=>g.id!==id); sync(api.delGoal(id)); rebuild();render(); }

/* Standing roles: SAA and Presiding Officer stay the same unless changed.
   The latest booked value propagates into EMPTY slots of upcoming meetings. */
function autoFillStanding(){
  if(!isAdmin)return;
  const t=todayStr();
  const ms=state.meetings.filter(m=>!m.cancelled).sort((a,b)=>a.date<b.date?-1:1);
  let changed=false;
  for(const rid of ['saa','po']){
    if(!state.settings.roles.some(r=>r.id===rid))continue;
    const key=rid+'|0';
    let src=null;
    for(const m of ms)if(m.assignments[key]&&m.assignments[key].memberId)src=m;
    if(!src)continue;
    const pid=src.assignments[key].memberId;
    if(!memberById(pid)||memberById(pid).archived)continue;
    for(const m of ms){
      if(m.date<t)continue;
      if(m.assignments[key]&&m.assignments[key].memberId)continue;
      S.assignments.push({meeting_id:m.id,slot_key:key,profile_id:pid,status:'booked',actual_role:null});
      sync(api.adminAssign(m.id,key,pid));
      changed=true;
    }
  }
  if(changed)rebuild();
}
/* ================= ADMIN: schedule ================= */
function memberOptions(sel){
  const mem=state.members.filter(m=>!m.archived&&!m.external);
  const ext=state.members.filter(m=>!m.archived&&m.external);
  let o=`<option value="">— open —</option>`;
  o+=mem.map(m=>`<option value="${m.id}" ${m.id===sel?'selected':''}>${esc(m.name)}</option>`).join('');
  if(ext.length)o+=`<optgroup label="External guests">`+ext.map(m=>`<option value="${m.id}" ${m.id===sel?'selected':''}>${esc(m.name)} (${esc(m.homeClub||'guest')})</option>`).join('')+`</optgroup>`;
  o+=`<option value="__addguest">＋ Add external guest…</option>`;
  return o;
}
function viewSchedule(){
  const up=upcomingMeetings();
  let html=`<h2>Next ${up.length} meeting${up.length===1?'':'s'} — book roles</h2>`;
  for(const m of up)html+=meetingBookingCard(m);
  const needReview=pastMeetings().filter(m=>!m.reviewed);
  html+=`<h2>Past meetings — confirm what happened</h2>
  <div class="row small" style="margin-bottom:8px">
    <span class="muted">Backfill history:</span>
    <input type="date" id="pastDate" style="width:auto" max="${todayStr()}">
    <button class="btn ghost small" onclick="addPastMeeting()">＋ Add past meeting</button>
  </div>
  <p class="small muted">Booked roles count as <b>completed automatically</b> once the meeting date passes. Use “Edit / add role players” to fill or correct any past meeting, mark absences, then mark it reviewed.</p>`;
  if(!needReview.length)html+=`<div class="empty">Nothing waiting for review.</div>`;
  for(const m of needReview.slice(0,12))html+=meetingReviewCard(m);
  const reviewed=pastMeetings().filter(m=>m.reviewed);
  if(reviewed.length){
    html+=`<details class="card sub"><summary class="small" style="cursor:pointer">Reviewed meetings (${reviewed.length})</summary>`;
    for(const m of reviewed.slice(0,10))html+=meetingReviewCard(m,true);
    html+=`</details>`;
  }
  return html;
}
function meetingBookingCard(m){
  const slots=slotListFor(m);
  const counts={};
  for(const a of Object.values(m.assignments||{}))if(a&&a.memberId)counts[a.memberId]=(counts[a.memberId]||0)+1;
  const dupes=Object.entries(counts).filter(([,c])=>c>1).map(([id])=>memberById(id)?.name).filter(Boolean);
  const filled=Object.values(m.assignments||{}).filter(a=>a&&a.memberId).length;
  const nSpk=speakersFor(m);
  return `<div class="card">
    <div class="row">
      <div class="grow"><h3 style="margin:0">${fmtDate(m.date)}</h3>
        <span class="small muted">${filled}/${slots.length} roles filled${ttOn(m)?'':' · <b>Speakathon (no Table Topics)</b>'}</span></div>
      <input type="text" style="max-width:220px" placeholder="Meeting theme (optional)" value="${esc(m.theme)}" onchange="setTheme('${m.id}',this.value)">
      <button class="btn ghost small" onclick="cancelMeeting('${m.id}')">Cancel meeting</button>
    </div>
    <div class="row small" style="margin-top:8px;padding:6px 10px;background:var(--surface2);border:1px solid var(--line);border-radius:8px">
      <span class="muted">This meeting:</span>
      <span>🎤 Speakers <button class="btn ghost small" onclick="spkDelta('${m.id}',-1)" ${nSpk<=1?'disabled':''}>−</button>
        <b>&nbsp;${nSpk}&nbsp;</b><button class="btn ghost small" onclick="spkDelta('${m.id}',1)" ${nSpk>=8?'disabled':''}>＋</button>
        <span class="muted">(evaluator slots follow)</span></span>
      <label style="display:flex;gap:6px;align-items:center;margin-left:14px">
        <input type="checkbox" ${ttOn(m)?'checked':''} onchange="setMeetingTT('${m.id}',this.checked)"> 🗣 Table Topics
      </label>
    </div>
    <div class="row small" style="margin-top:6px">
      <label class="muted">📖 Word of the Day</label>
      <input type="text" style="max-width:140px" placeholder="word" value="${esc((m.wod||{}).word||'')}" onchange="setWod('${m.id}','word',this.value)">
      <input type="text" style="max-width:360px" class="grow" placeholder="meaning — example sentence" value="${esc((m.wod||{}).def||'')}" onchange="setWod('${m.id}','def',this.value)">
      <span class="muted">(the meeting's Grammarian can also set this; TMOD can set the theme)</span>
    </div>
    <div class="grid-roles">
      ${slots.map(s=>{
        const a=(m.assignments||{})[s.key];
        return `<div class="slot"><label>${esc(s.label)}</label>
          <select onchange="assign('${m.id}','${s.key}',this)">${memberOptions(a&&a.memberId)}</select></div>`;
      }).join('')}
    </div>
    ${dupes.length?`<div class="warnline">⚠ Double-booked in this meeting: ${dupes.map(esc).join(', ')}</div>`:''}
  </div>`;
}
function meetingReviewCard(m,compact){
  const rows=Object.entries(m.assignments||{}).filter(([,a])=>a&&a.memberId&&memberById(a.memberId));
  return `<div class="card ${compact?'sub':''}">
    <div class="row"><div class="grow"><h3 style="margin:0">${fmtDate(m.date)} ${m.theme?`<span class="muted small">· ${esc(m.theme)}</span>`:''}</h3></div>
      ${m.reviewed?`<span class="pill done">Reviewed</span><button class="btn ghost small" onclick="setReviewed('${m.id}',false)">Reopen</button>`
                  :`<button class="btn small" onclick="setReviewed('${m.id}',true)">Mark reviewed ✓</button>`}
    </div>
    <div class="tblwrap"><table><thead><tr><th>Role</th><th>Member</th><th>Outcome</th></tr></thead><tbody>
    ${rows.map(([key,a])=>{
      const mem=memberById(a.memberId);
      const role=roleNameById(key.split('|')[0]);
      const st=a.status||'done';
      return `<tr><td>${esc(role)}</td>
        <td>${esc(mem.name)} ${mem.external?`<span class="pill guest">guest</span>`:''}</td>
        <td><select onchange="setOutcome('${m.id}','${key}',this.value)" style="width:auto">
          <option value="done" ${st==='done'?'selected':''}>Completed ✓</option>
          <option value="absent" ${st==='absent'?'selected':''}>Absent</option>
          <option value="other" ${st==='other'?'selected':''}>Did another role…</option>
        </select>
        ${st==='other'?`<input type="text" style="width:150px" placeholder="actual role" value="${esc(a.actualRole||'')}" onchange="setActualRole('${m.id}','${key}',this.value)">`:''}
        </td></tr>`;
    }).join('')}
    </tbody></table></div>
    <details ${pastEditOpen.has(m.id)?'open':''} ontoggle="pastEditToggle('${m.id}',this.open)" style="margin-top:8px">
      <summary class="small" style="cursor:pointer;color:var(--accent)">✎ Edit / add role players</summary>
      <div class="row small" style="margin-top:8px">
        <input type="text" style="max-width:220px" placeholder="Meeting theme" value="${esc(m.theme)}" onchange="setTheme('${m.id}',this.value)">
        <span>🎤 Speakers <button class="btn ghost small" onclick="spkDelta('${m.id}',-1)" ${speakersFor(m)<=1?'disabled':''}>−</button>
          <b>&nbsp;${speakersFor(m)}&nbsp;</b><button class="btn ghost small" onclick="spkDelta('${m.id}',1)" ${speakersFor(m)>=8?'disabled':''}>＋</button></span>
        <label style="display:flex;gap:6px;align-items:center">
          <input type="checkbox" ${ttOn(m)?'checked':''} onchange="setMeetingTT('${m.id}',this.checked)"> 🗣 Table Topics
        </label>
      </div>
      <div class="grid-roles">
        ${slotListFor(m).map(s=>{
          const a=(m.assignments||{})[s.key];
          return `<div class="slot"><label>${esc(s.label)}</label>
            <select onchange="assign('${m.id}','${s.key}',this)">${memberOptions(a&&a.memberId)}</select></div>`;
        }).join('')}
      </div>
    </details>
  </div>`;
}
function setTheme(id,v){
  const m=state.meetings.find(x=>x.id===id); if(!m)return;
  m.theme=v.trim();
  const row=S.meetings.find(x=>x.id===id); if(row)row.theme=m.theme;
  sync(api.updateMeeting(id,{theme:m.theme}));
}
function setWod(id,k,v){
  const m=state.meetings.find(x=>x.id===id); if(!m)return;
  m.wod={...(m.wod||{}),[k]:v.trim()};
  const row=S.meetings.find(x=>x.id===id); if(row)row.wod=m.wod;
  sync(api.updateMeeting(id,{wod:m.wod}));
}
async function addPastMeeting(){
  const inp=document.getElementById('pastDate');
  const d=inp&&inp.value;
  if(!d){toast('Pick a date first');return;}
  if(d>=todayStr()){toast('Future dates appear automatically in the booking list');return;}
  if(state.meetings.some(m=>m.date===d)){toast('A meeting on that date already exists');return;}
  try{
    const row=await api.insertMeeting({date:d});
    S.meetings.push(row); rebuild(); render();
    toast('Past meeting added — open “Edit / add role players” below to fill it');
  }catch(e){ toast('Could not add: '+(e.message||e)); }
}
const pastEditOpen=new Set();
function pastEditToggle(id,open){ if(open)pastEditOpen.add(id); else pastEditOpen.delete(id); }
async function cancelMeeting(id){
  const m=state.meetings.find(x=>x.id===id); if(!m)return;
  if(Object.values(m.assignments||{}).some(a=>a&&a.memberId)&&!confirm('This meeting has bookings. Cancel it anyway?'))return;
  const row=S.meetings.find(x=>x.id===id); if(row)row.cancelled=true;
  sync(api.updateMeeting(id,{cancelled:true}));
  await ensureMeetings(); autoFillStanding(); render(); toast('Meeting cancelled — next date added');
}
async function assign(mid,key,sel){
  let v=sel.value;
  if(v==='__addguest'){
    const name=prompt('Guest name:'); if(!name){render();return;}
    const club=prompt('Their home club (optional):')||'';
    try{
      const row=await api.insertProfile({name:name.trim(),home_club:club.trim()||'other club',approved:true,active:true,role:'member'});
      S.profiles.push(row); v=row.id;
    }catch(e){ toast('Could not add guest'); render(); return; }
  }
  const had=S.assignments.find(a=>a.meeting_id===mid&&a.slot_key===key);
  if(!v){
    if(had){ S.assignments=S.assignments.filter(a=>a!==had); sync(api.unbook(mid,key)); }
  }else{
    if(had){ had.profile_id=v; had.status='booked'; had.actual_role=null; }
    else S.assignments.push({meeting_id:mid,slot_key:key,profile_id:v,status:'booked',actual_role:null});
    sync(api.adminAssign(mid,key,v));
  }
  rebuild();
  if(v&&(key==='saa|0'||key==='po|0'))autoFillStanding();
  render();
}
function setOutcome(mid,key,st){
  const a=S.assignments.find(a=>a.meeting_id===mid&&a.slot_key===key); if(!a)return;
  a.status=st; if(st!=='other')a.actual_role=null;
  sync(api.setAsg(mid,key,{status:st,actual_role:st==='other'?a.actual_role:null}));
  rebuild(); render();
}
function setActualRole(mid,key,v){
  const a=S.assignments.find(a=>a.meeting_id===mid&&a.slot_key===key); if(!a)return;
  a.actual_role=v.trim();
  sync(api.setAsg(mid,key,{actual_role:a.actual_role}));
  rebuild();
}
async function saveMeetingConfig(m){
  const row=S.meetings.find(x=>x.id===m.id); if(row)row.config=m.config;
  sync(api.updateMeeting(m.id,{config:m.config}));
  rebuild(); render();
}
async function unbookSlots(m,keys){
  for(const key of keys){
    S.assignments=S.assignments.filter(a=>!(a.meeting_id===m.id&&a.slot_key===key));
    sync(api.unbook(m.id,key));
  }
}
async function spkDelta(mid,d){
  const m=state.meetings.find(x=>x.id===mid); if(!m)return;
  const cur=speakersFor(m), next=Math.min(8,Math.max(1,cur+d));
  if(next===cur)return;
  if(d<0){
    const dropped=[`spk|${cur-1}`,`eval|${cur-1}`].filter(k=>m.assignments[k]&&m.assignments[k].memberId);
    if(dropped.length){
      const names=dropped.map(k=>memberById(m.assignments[k].memberId)?.name).filter(Boolean).join(', ');
      if(!confirm(`Removing this slot also removes the booking${dropped.length>1?'s':''} of: ${names}. Continue?`))return;
      await unbookSlots(m,dropped);
    }
  }
  m.config={...(m.config||{}),speakers:next};
  saveMeetingConfig(m);
}
async function setMeetingTT(mid,on){
  const m=state.meetings.find(x=>x.id===mid); if(!m)return;
  if(!on){
    const booked=Object.keys(m.assignments).filter(k=>/^(ttm|tte)\|/.test(k)&&m.assignments[k].memberId);
    if(booked.length){
      const names=booked.map(k=>memberById(m.assignments[k].memberId)?.name).filter(Boolean).join(', ');
      if(!confirm(`Turning Table Topics off removes the booking${booked.length>1?'s':''} of: ${names}. Continue?`)){ render(); return; }
      await unbookSlots(m,booked);
    }
  }
  m.config={...(m.config||{}),tt:on};
  saveMeetingConfig(m);
}
function setReviewed(id,v){
  const row=S.meetings.find(x=>x.id===id); if(row)row.reviewed=v;
  sync(api.updateMeeting(id,{reviewed:v}));
  rebuild(); render();
}

/* ================= ADMIN: members & accounts ================= */
let memView='roster';
function viewMembers(){
  const {h,abs}=roleHistory();
  const pending=state.members.filter(m=>m.hasAccount&&!m.approved&&!m.archived);
  let html=`<h2>Members</h2>`;
  if(pending.length){
    html+=`<div class="card" style="border-color:var(--gold)"><h3>Waiting for approval</h3>
      ${pending.map(m=>{
        const match=state.members.find(x=>!x.hasAccount&&!x.external&&!x.archived&&x.id!==m.id&&x.name.trim().toLowerCase()===m.name.trim().toLowerCase());
        return `<div class="row" style="padding:4px 0">
        <span class="grow"><b>${esc(m.name)}</b> <span class="muted small">${esc(m.email)}</span></span>
        ${match?`<button class="btn good small" onclick="approveMerge('${m.id}','${match.id}')" title="Link this login to the existing roster entry so their booking history carries over">Approve &amp; merge with roster</button>`:''}
        <button class="btn ${match?'ghost':'good'} small" onclick="approveMember('${m.id}',true)">Approve as new</button>
        <button class="btn danger small" onclick="delMember('${m.id}')">Reject</button>
      </div>`;}).join('')}</div>`;
  }
  html+=`<div class="card sub"><div class="row">
    <input type="text" id="nmName" class="grow" placeholder="Full name" style="min-width:180px">
    <label class="small"><input type="checkbox" id="nmExt" onchange="document.getElementById('nmClub').style.display=this.checked?'':'none'"> External guest</label>
    <input type="text" id="nmClub" placeholder="Home club" style="display:none;max-width:160px">
    <button class="btn" onclick="addMember()">Add (no account)</button>
  </div>
  <p class="small muted" style="margin:6px 0 0">Members with accounts sign themselves up on the login page; you approve them above. Add people here only for roster-without-login (or guests).</p></div>
  <div class="row" style="margin-bottom:12px">
    <button class="btn ${memView==='roster'?'':'ghost'} small" onclick="memView='roster';render()">Roster</button>
    <button class="btn ${memView==='matrix'?'':'ghost'} small" onclick="memView='matrix';render()">Role history matrix</button>
  </div>`;
  if(memView==='matrix')return html+roleMatrix(h,abs);
  const active=state.members.filter(m=>!m.archived&&(m.approved||!m.hasAccount));
  if(!active.length)html+=`<div class="empty">No members yet.</div>`;
  for(const mem of active)html+=memberCard(mem,h[mem.id]||{},abs[mem.id]||0);
  const archived=state.members.filter(m=>m.archived);
  if(archived.length){
    html+=`<details class="card sub"><summary class="small" style="cursor:pointer">Deactivated (${archived.length})</summary>`+
      archived.map(m=>`<div class="row" style="padding:6px 0"><span class="grow">${esc(m.name)}</span><button class="btn ghost small" onclick="toggleArchive('${m.id}')">Reactivate</button></div>`).join('')+`</details>`;
  }
  return html;
}
function memberCard(mem,hist,absCount){
  const roleChips=Object.entries(hist).sort((a,b)=>b[1]-a[1]).map(([r,c])=>`<span class="chip">${esc(r)} ×${c}</span>`).join('')||`<span class="muted small">no roles yet</span>`;
  const cl=currentLevel(mem);
  return `<details class="mem" id="mem-${mem.id}">
    <summary>
      <span class="mname">${esc(mem.name)}</span>
      ${mem.role==='admin'?'<span class="pill admin">admin</span>':''}
      ${mem.hasAccount?'':'<span class="pill guest">no login</span>'}
      ${mem.external?`<span class="pill guest">guest · ${esc(mem.homeClub||'other club')}</span>`:lvlChips(mem)}
      ${mem.path&&!mem.external?`<span class="muted small">${esc(mem.path)}</span>`:''}
      ${absCount?`<span class="chip bad small">absent ×${absCount}</span>`:''}
    </summary>
    <div class="body">
      <div class="row" style="margin-bottom:${mem.external?'0':'10px'}">
        <div><label class="small muted">Name</label><br>
          <input type="text" value="${esc(mem.name)}" style="max-width:220px" onchange="setMem('${mem.id}','name',this.value)"></div>
        ${mem.external?`<div><label class="small muted">Home club</label><br>
          <input type="text" value="${esc(mem.homeClub)}" style="max-width:180px" onchange="setMem('${mem.id}','homeClub',this.value)"></div>`:''}
      </div>
      ${mem.external?'':`
      <div class="row">
        <div><label class="small muted">Path</label><br>
          <select onchange="setMem('${mem.id}','path',this.value)" style="width:auto">
            <option value="">— choose path —</option>
            ${PATHS.map(p=>`<option ${mem.path===p?'selected':''}>${p}</option>`).join('')}
          </select></div>
        <div><label class="small muted">Starting level (pre-tracker)</label><br>
          <input type="number" min="0" max="5" value="${mem.baseLevel||0}" onchange="setMem('${mem.id}','baseLevel',Number(this.value))"></div>
        <div><label class="small muted">Projects done in Level ${Math.min(cl+1,5)}</label><br>
          <input type="number" min="0" max="9" value="${mem.projectsDone||0}" onchange="setMem('${mem.id}','projectsDone',Number(this.value))"></div>
      </div>
      <div class="sect">
        <h3>Level completions <span class="muted small">(dated — these feed the DCP)</span></h3>
        ${(mem.awards||[]).map(a=>`<div class="row small" style="padding:2px 0">
          <span class="chip gold">Level ${esc(a.level)}${a.path?' · '+esc(a.path):''}</span><span class="muted">${fmtDate(a.date)}</span>
          <button class="btn ghost small" onclick="delAward('${mem.id}','${a.id}')">✕</button></div>`).join('')||'<div class="muted small">none recorded</div>'}
        <div class="row" style="margin-top:6px">
          <select id="aw-l-${mem.id}" style="width:auto">${['1','2','3','4','5','DTM'].map(l=>`<option ${String(cl+1)===l?'selected':''}>${l}</option>`).join('')}</select>
          <input type="date" id="aw-d-${mem.id}" value="${todayStr()}" style="width:auto">
          <button class="btn small" onclick="addAward('${mem.id}')">Record completion</button>
        </div>
      </div>
      <div class="sect">
        <h3>Personal goals</h3>
        ${(mem.goals||[]).map(g=>`<div class="row small" style="padding:2px 0">
          <label style="display:flex;gap:6px;align-items:center"><input type="checkbox" ${g.done?'checked':''} onchange="admGoalToggle('${g.id}',this.checked,'${mem.id}')">
          <span style="${g.done?'text-decoration:line-through;color:var(--muted)':''}">${esc(g.text)}</span></label>
          <button class="btn ghost small" onclick="admGoalDel('${g.id}','${mem.id}')">✕</button></div>`).join('')||'<div class="muted small">no goals set</div>'}
        <div class="row" style="margin-top:6px">
          <input type="text" id="goal-${mem.id}" placeholder="e.g. Finish Level 2 by December" class="grow" style="max-width:340px">
          <button class="btn small" onclick="admGoalAdd('${mem.id}')">Add goal</button>
        </div>
      </div>`}
      <div class="sect"><h3>Roles completed</h3>${roleChips}</div>
      <div class="sect row">
        ${mem.hasAccount?(mem.role==='admin'
          ?`<button class="btn ghost small" onclick="setRole('${mem.id}','member')">Remove admin</button>`
          :`<button class="btn ghost small" onclick="setRole('${mem.id}','admin')">Make admin</button>`):''}
        <button class="btn ghost small" onclick="toggleArchive('${mem.id}')">${mem.archived?'Reactivate':'Deactivate'}</button>
        <button class="btn danger small" onclick="delMember('${mem.id}')">Delete permanently</button>
      </div>
    </div>
  </details>`;
}
function roleMatrix(h,abs){
  const roles=state.settings.roles.map(r=>r.name);
  const extras=new Set();
  for(const per of Object.values(h))for(const r of Object.keys(per))if(!roles.includes(r))extras.add(r);
  const cols=[...roles,...extras];
  const mems=state.members.filter(m=>!m.archived);
  return `<div class="card"><div class="tblwrap"><table>
    <thead><tr><th>Member</th>${cols.map(c=>`<th class="num">${esc(c)}</th>`).join('')}<th class="num">Absences</th></tr></thead>
    <tbody>${mems.map(m=>{
      const per=h[m.id]||{};
      return `<tr><td>${esc(m.name)}${m.external?' <span class="pill guest">guest</span>':''}</td>
        ${cols.map(c=>`<td class="num">${per[c]||'·'}</td>`).join('')}
        <td class="num">${abs[m.id]||'·'}</td></tr>`;
    }).join('')}</tbody></table></div>
    <p class="small muted">Counts come from past meetings (auto-completed unless marked absent / another role).</p></div>`;
}
async function addMember(){
  const name=document.getElementById('nmName').value.trim(); if(!name){toast('Enter a name first');return;}
  const ext=document.getElementById('nmExt').checked;
  try{
    const row=await api.insertProfile({name,home_club:ext?(document.getElementById('nmClub').value.trim()||'other club'):null,approved:true,active:true,role:'member'});
    S.profiles.push(row); rebuild(); render(); toast(name+' added');
  }catch(e){ toast('Could not add: '+(e.message||e)); }
}
function setMem(id,k,v){
  const mem=memberById(id); if(!mem)return;
  if(k==='name'){ v=String(v).trim(); if(!v){toast('Name cannot be empty');render();return;} }
  mem[k]=v;
  const p=S.profiles.find(p=>p.id===id);
  const col={path:'path',baseLevel:'base_level',projectsDone:'projects_done',name:'name',homeClub:'home_club'}[k];
  if(p&&col)p[col]=v;
  sync(api.updateProfile(id,{[col]:v}));
  if(k!=='path'){render();keepOpen(id);}
}
async function addAward(id){
  const level=document.getElementById('aw-l-'+id).value;
  const date=document.getElementById('aw-d-'+id).value||todayStr();
  const mem=memberById(id);
  try{
    const row=await api.addAward({profile_id:id,level,path:mem.path||'',date});
    S.awards.push(row);
    const p=S.profiles.find(p=>p.id===id); if(p)p.projects_done=0;
    sync(api.updateProfile(id,{projects_done:0}));
    rebuild();render();keepOpen(id);toast('Level '+level+' recorded 🎉');
  }catch(e){ toast('Could not record: '+(e.message||e)); }
}
function delAward(memId,awardId){
  S.awards=S.awards.filter(a=>a.id!==awardId);
  sync(api.delAward(awardId));
  rebuild();render();keepOpen(memId);
}
async function admGoalAdd(memId){
  const inp=document.getElementById('goal-'+memId); const text=inp.value.trim(); if(!text)return;
  try{ const row=await api.addGoal({profile_id:memId,text}); S.goals.push(row); rebuild();render();keepOpen(memId); }
  catch(e){ toast('Could not save goal'); }
}
function admGoalToggle(id,done,memId){ const g=S.goals.find(g=>g.id===id); if(g)g.done=done; sync(api.updGoal(id,{done})); rebuild();render();keepOpen(memId); }
function admGoalDel(id,memId){ S.goals=S.goals.filter(g=>g.id!==id); sync(api.delGoal(id)); rebuild();render();keepOpen(memId); }
async function approveMerge(pendId,rosterId){
  const pend=S.profiles.find(p=>p.id===pendId); if(!pend)return;
  try{
    await api.deleteProfile(pendId);                      // free the unique auth_id first
    await api.updateProfile(rosterId,{auth_id:pend.auth_id,email:pend.email,approved:true,active:true});
    S.profiles=S.profiles.filter(p=>p.id!==pendId);
    const r=S.profiles.find(p=>p.id===rosterId);
    if(r){ r.auth_id=pend.auth_id; r.email=pend.email; r.approved=true; r.active=true; }
    rebuild();render();toast('Merged & approved ✓');
  }catch(e){ toast('Merge failed: '+(e.message||e)); }
}
function approveMember(id,ok){
  const p=S.profiles.find(p=>p.id===id); if(p)p.approved=ok;
  sync(api.updateProfile(id,{approved:ok}));
  rebuild();render();toast(ok?'Approved ✓':'Updated');
}
function setRole(id,role){
  if(id===me.profileId&&role==='member'&&!confirm('Remove YOUR OWN admin rights?'))return;
  const p=S.profiles.find(p=>p.id===id); if(p)p.role=role;
  sync(api.updateProfile(id,{role}));
  rebuild();render();toast(role==='admin'?'Promoted to admin':'Admin rights removed');
}
function toggleArchive(id){
  const p=S.profiles.find(p=>p.id===id); if(!p)return;
  p.active=!p.active;
  sync(api.updateProfile(id,{active:p.active}));
  rebuild();render();
}
function delMember(id){
  const m=memberById(id); if(!m)return;
  if(!confirm('Delete '+m.name+' permanently? Their role history and bookings disappear too. Deactivating is usually better.'))return;
  S.profiles=S.profiles.filter(p=>p.id!==id);
  S.assignments=S.assignments.filter(a=>a.profile_id!==id);
  S.awards=S.awards.filter(a=>a.profile_id!==id);
  S.goals=S.goals.filter(g=>g.profile_id!==id);
  sync(api.deleteProfile(id));
  rebuild();render();
}
function keepOpen(id){ const el=document.getElementById('mem-'+id); if(el)el.open=true; }

/* ================= ADMIN: DCP ================= */
let dcpSelYear=null;
function viewDCP(){
  const yrs=new Set([currentClubYear()]);
  for(const m of state.members)for(const a of (m.awards||[]))if(a.date)yrs.add(clubYearOf(a.date));
  for(const y of Object.keys(state.dcp))yrs.add(Number(y));
  const years=[...yrs].sort((a,b)=>b-a);
  const yr=dcpSelYear??currentClubYear();
  const d=dcpYear(yr);
  const goals=dcpGoals(yr);
  const met=goals.filter(g=>g.met).length;
  const memReq=(Number(d.current)>=20)||(d.base!==''&&d.current!==''&&(Number(d.current)-Number(d.base))>=3);
  const tier=met>=9?'President’s Distinguished':met>=7?'Select Distinguished':met>=5?'Distinguished':null;
  const targetNames={5:'Distinguished (5 goals)',7:'Select Distinguished (7 goals)',9:'President’s Distinguished (9 goals)'};
  let html=`<h2>Distinguished Club Program</h2>
  <div class="row" style="margin-bottom:10px">
    <label class="small muted">Club year</label>
    <select style="width:auto" onchange="dcpSelYear=Number(this.value);render()">
      ${years.map(y=>`<option value="${y}" ${y===yr?'selected':''}>${y}–${String(y+1).slice(2)}</option>`).join('')}
    </select>
    <label class="small muted" style="margin-left:12px">Club target</label>
    <select style="width:auto" onchange="setDcp(${yr},'target',Number(this.value))">
      ${[5,7,9].map(t=>`<option value="${t}" ${d.target===t?'selected':''}>${targetNames[t]}</option>`).join('')}
    </select>
  </div>
  <div class="banner">
    <strong>${met}/10 goals met</strong> — target: ${targetNames[d.target]||targetNames[5]}
    ${met>=d.target?` · <span style="color:var(--good);font-weight:700">target reached${tier?': '+tier:''}</span>`:` · ${d.target-met} to go`}
    <div class="small muted" style="margin-top:4px">Membership requirement (20 members, or +3 net growth):
      ${memReq?'<b style="color:var(--good)">met</b>':'<b style="color:var(--maroon)">not yet met</b>'}
      &nbsp; base (Jul 1) <input type="number" value="${esc(d.base)}" onchange="setDcp(${yr},'base',this.value)">
      &nbsp; now <input type="number" value="${esc(d.current)}" onchange="setDcp(${yr},'current',this.value)">
    </div>
  </div>
  <div class="goalgrid">
    ${goals.map(g=>`<div class="goal ${g.met?'met':''}">
      <div class="gnum">Goal ${g.n} ${g.met?'· <b style="color:var(--good)">met ✓</b>':''}</div>
      <div class="gtitle">${g.t}</div>
      <div class="small muted">${g.cur} / ${g.tgt}</div>
      <div class="bar ${g.met?'met':''}"><div style="width:${Math.min(100,g.cur/g.tgt*100)}%"></div></div>
      ${goalControls(g.n,yr,d)}
    </div>`).join('')}
  </div>`;
  const b=candidatesByGoal();
  const sections=[
    {title:'Goal 1 — Level 1 completions',list:b[1],unmet:!goals[0].met},
    {title:'Goals 2 & 3 — Level 2 completions',list:b[2],unmet:!goals[1].met||!goals[2].met},
    {title:'Goal 4 — Level 3 completions',list:b[3],unmet:!goals[3].met},
    {title:'Goals 5 & 6 — Level 4 / 5 / DTM',list:b[45],unmet:!goals[4].met||!goals[5].met}
  ];
  html+=`<h2>Who is most likely to get us there</h2>
  <p class="small muted">Ranked by momentum: projects finished in their current level (×2) plus speeches given this club year. Members update their own “projects done” — nudge them to keep it fresh.</p>`;
  let any=false;
  for(const s of sections){
    if(!s.list.length)continue; any=true;
    html+=`<div class="card"><h3>${s.title} ${s.unmet?'':'<span class="pill done">goal met</span>'}</h3>
      ${s.list.slice(0,5).map(c=>`<div class="cand">
        <span class="score">${c.score}</span>
        <span class="grow"><b>${esc(c.m.name)}</b> <span class="muted small">— Level ${c.cl} done, ${c.m.projectsDone||0} project${(c.m.projectsDone||0)===1?'':'s'} into Level ${Math.min(c.cl+1,5)}, ${c.speeches} speech${c.speeches===1?'':'es'} this year</span></span>
        <button class="btn ghost small" onclick="setTab('members');setTimeout(()=>{keepOpen('${c.m.id}');document.getElementById('mem-${c.m.id}')?.scrollIntoView()},50)">open</button>
      </div>`).join('')}</div>`;
  }
  if(!any)html+=`<div class="empty">Add members with paths and levels to see predictions.</div>`;
  return html;
}
function goalControls(n,yr,d){
  if(n===7||n===8)return `<div class="row small" style="margin-top:6px"><label class="muted">New members this year</label><input type="number" min="0" value="${d.newMembers}" onchange="setDcp(${yr},'newMembers',Number(this.value))"></div>`;
  if(n===9)return `<div class="row small" style="margin-top:6px"><label class="muted">Round 1</label><input type="number" min="0" value="${d.officersR1}" onchange="setDcp(${yr},'officersR1',Number(this.value))">
    <label class="muted">Round 2</label><input type="number" min="0" value="${d.officersR2}" onchange="setDcp(${yr},'officersR2',Number(this.value))"></div>`;
  if(n===10)return `<div class="row small" style="margin-top:6px">
    <label><input type="checkbox" ${d.dues?'checked':''} onchange="setDcp(${yr},'dues',this.checked)"> dues on time</label>
    <label><input type="checkbox" ${d.officerList?'checked':''} onchange="setDcp(${yr},'officerList',this.checked)"> officer list</label></div>`;
  return `<div class="small muted" style="margin-top:6px">auto-counted from dated level completions</div>`;
}
function setDcp(yr,k,v){
  dcpYear(yr)[k]=v;
  S.dcp=state.dcp;
  sync(api.saveDcp(yr,state.dcp[yr]));
  render();
}

/* ================= ADMIN: settings ================= */
function viewSettings(){
  const s=state.settings;
  return `<h2>Club settings</h2>
  <div class="card">
    <div class="row">
      <div class="grow"><label class="small muted">Club name</label><br>
        <input type="text" value="${esc(s.clubName)}" onchange="s_set('clubName',this.value)"></div>
      <div><label class="small muted">Meeting day</label><br>
        <select style="width:auto" onchange="s_set('meetingDay',Number(this.value))">
          ${WEEKDAYS.map((w,i)=>`<option value="${i}" ${s.meetingDay===i?'selected':''}>${w}</option>`).join('')}
        </select></div>
      <div><label class="small muted">Cadence</label><br>
        <select style="width:auto" onchange="s_set('cadence',this.value)">
          <option value="weekly" ${s.cadence==='weekly'?'selected':''}>Weekly</option>
          <option value="biweekly" ${s.cadence==='biweekly'?'selected':''}>Every 2 weeks</option>
        </select></div>
    </div>
  </div>
  <h2>Meeting roles</h2>
  <div class="card">
    ${s.roles.map((r,i)=>`<div class="row" style="padding:3px 0">
      <input type="text" value="${esc(r.name)}" style="max-width:260px" onchange="roleEdit(${i},'name',this.value)">
      <label class="small muted">slots</label>
      <input type="number" min="1" max="6" value="${r.count||1}" onchange="roleEdit(${i},'count',Math.max(1,Number(this.value)))">
      <button class="btn ghost small" onclick="roleDel(${i})">✕</button>
    </div>`).join('')}
    <div class="row" style="margin-top:8px">
      <input type="text" id="newRole" placeholder="New role name" style="max-width:260px">
      <button class="btn small" onclick="roleAdd()">Add role</button>
    </div>
    <p class="small muted">Changing roles applies to all meetings and to what members can book.</p>
  </div>
  <h2>Backup</h2>
  <div class="card">
    <button class="btn" onclick="exportData()">Download data snapshot (JSON)</button>
    <p class="small muted">The database is the source of truth (Supabase also keeps daily backups on paid tiers); this snapshot is an extra safety copy.</p>
  </div>`;
}
function saveSettingsRemote(){ sync(api.saveSettings(state.settings)); }
function s_set(k,v){ state.settings[k]=typeof v==='string'?v.trim():v; S.settings=state.settings; saveSettingsRemote(); render(); }
function roleEdit(i,k,v){ state.settings.roles[i][k]=typeof v==='string'?v.trim():v; saveSettingsRemote(); render(); }
function roleDel(i){
  const r=state.settings.roles[i];
  if(!confirm('Remove the role "'+r.name+'" from all meetings?'))return;
  state.settings.roles.splice(i,1); saveSettingsRemote(); render();
}
function roleAdd(){
  const v=document.getElementById('newRole').value.trim(); if(!v)return;
  state.settings.roles.push({id:uid(),name:v,count:1}); saveSettingsRemote(); render();
}
function exportData(){
  const data=JSON.stringify(S,null,2);
  const url=URL.createObjectURL(new Blob([data],{type:'application/json'}));
  const a=document.createElement('a'); a.href=url;
  a.download=(state.settings.clubName||'club').toLowerCase().replace(/[^a-z0-9]+/g,'-')+'-snapshot-'+todayStr()+'.json';
  a.click(); setTimeout(()=>URL.revokeObjectURL(url),4000);
}

/* ============================================================
   AGENDA BUILDER (admin) — ported from the artifact version;
   per-meeting agendas persist in the `agendas` table.
   ============================================================ */
const AG_PRESETS={
  std:{label:'',dur:7,lights:['5','6','7'],name:'Standard 5–7'},
  ice:{label:'(Ice Breaker)',dur:6,lights:['4','5','6'],name:'Ice Breaker 4–6'},
  custom:{label:'',dur:null,lights:null,name:'Custom…'}
};
function agDefaultBlocks(){
  const P='TM ____________';
  return [
    {type:'session',id:'opening',title:'Opening Session',rows:[
      {act:'Call to Order by SAA',fill:'saa',who:P,dur:2},
      {act:'Welcome Note by Presiding Officer',fill:'po',who:P,dur:5},
      {act:'Toastmaster of the Day (TMOD)',fill:'tmod',who:P,dur:3}
    ]},
    {type:'session',id:'tt',title:'Table Topics Session',rows:[
      {act:'Table Topics Master',fill:'ttm',who:P,dur:2},
      {act:'Table Topics <span class="role-note">(speakers: 1 – 2 min each)</span>',who:'Non-Role Players &amp; Guests',dur:25,autoMode:'manual',lights:['1','1.5','2']},
      {act:'Timer’s Report &amp; Voting',who:'Timer &amp; Vote Counter',dur:2}
    ]},
    {type:'break',dur:15},
    {type:'session',id:'speech',title:'Prepared Speech Session',rows:[
      {act:'Introduction &amp; Purpose',fill:'tmod',who:P,dur:1},
      {kind:'speaker',fill:'spk',who:P,preset:'std',dur:7},
      {kind:'speaker',fill:'spk',who:P,preset:'std',dur:7},
      {kind:'speaker',fill:'spk',who:P,preset:'std',dur:7},
      {act:'Timer’s Report &amp; Voting',fill:'tmod',who:P,dur:2}
    ]},
    {type:'session',id:'eval',title:'Evaluation Session',rows:[
      {act:'Team Introduction by GE',fill:'ge',who:P,dur:1},
      {kind:'tteval',fill:'tte',act:'Table Topics Evaluator',who:P,dur:5},
      {kind:'evaluator',fill:'eval',who:P,dur:3},
      {kind:'evaluator',fill:'eval',who:P,dur:3},
      {kind:'evaluator',fill:'eval',who:P,dur:3},
      {act:'Timer’s Report &amp; Voting',who:'Timer &amp; Vote Counter',dur:2},
      {act:'Call for Reports',who:'Role Players',dur:5},
      {act:'General Evaluator',fill:'ge',who:P,dur:5}
    ]},
    {type:'session',id:'awards',title:'Awards &amp; Closing',rows:[
      {act:'Feedback from Guests &amp; Awards',fill:'po',who:P,dur:5},
      {act:'Group Picture 📸',who:'Everyone',dur:1,autoMode:'manual',lights:['','','']}
    ]}
  ];
}
const AgendaApp=(function(){
  let blocks=[],showTT=true,showSpeech=true,mid=null,container=null,saveTimer=null;
  const g=id=>document.getElementById(id);
  const MONTHS=['January','February','March','April','May','June','July','August','September','October','November','December'];
  function tmName(mem){ const n=mem.name.trim(); return /^(TM|DTM)\b/i.test(n)?n:'TM '+n; }
  function bookedNames(meeting,re){
    const out=[];
    for(const s of slotListFor(meeting)){
      if(!re.test(s.role.name.trim()))continue;
      const a=(meeting.assignments||{})[s.key];
      out.push(a&&a.memberId&&memberById(a.memberId)?tmName(memberById(a.memberId)):null);
    }
    return out;
  }
  const one=(m,re)=>bookedNames(m,re).find(Boolean)||null;
  function roleMap(m){
    return {
      saa:one(m,/sergeant|saa/i),po:one(m,/presiding|president/i),
      tmod:one(m,/toastmaster of the day|^tmod$/i),ttm:one(m,/table topics master/i),
      ge:one(m,/general evaluator/i),tte:one(m,/table topics evaluator/i),
      spk:bookedNames(m,/^speaker$/i),eval:bookedNames(m,/^(speech )?evaluator$/i),
      timer:one(m,/^timer$/i),vc:one(m,/vote counter/i),gram:one(m,/grammarian/i),
      al:one(m,/active listener/i),ah:one(m,/ah[- ]?counter/i),jm:one(m,/joke/i)
    };
  }
  function nextMeetingAfter(dateS){
    return state.meetings.filter(x=>!x.cancelled&&x.date>dateS).sort((a,b)=>a.date<b.date?-1:1)[0]||null;
  }
  function nextNo(){
    let mx=350;
    for(const k in (state.agendas||{})){ const n=Number(((state.agendas[k]||{}).inputs||{}).no); if(n>mx)mx=n; }
    return mx+1;
  }
  function meetingOptions(){
    const t=todayStr();
    const up=state.meetings.filter(m=>!m.cancelled&&m.date>=t).sort((a,b)=>a.date<b.date?-1:1);
    const past=state.meetings.filter(m=>!m.cancelled&&m.date<t).sort((a,b)=>a.date<b.date?1:-1).slice(0,8);
    return [...up,...past].map(m=>{
      const booked=Object.values(m.assignments||{}).filter(a=>a&&a.memberId).length;
      return `<option value="${m.id}" ${m.id===mid?'selected':''}>${fmtDate(m.date)} — ${booked} booked${m.date<t?' (past)':''}${state.agendas&&state.agendas[m.id]?' ●':''}</option>`;
    }).join('');
  }
  function shell(){
    return `<div id="agWrap">
    <h2>Meeting agenda</h2>
    <div class="card agctrl no-print">
      <div class="row">
        <label>Meeting <select id="agMeeting" style="width:auto">${meetingOptions()}</select></label>
        <button class="btn small" id="agFill" title="Overwrite all role players from this meeting's bookings">↺ Fill from bookings</button>
        <span class="grow"></span>
        <button class="btn" id="agPrint">⬇ Download PDF</button>
      </div>
      <div class="row" style="margin-top:8px">
        <label>📅 Date <input type="date" id="agDate"></label>
        <label>⏰ Start <input type="time" id="agStart" value="16:30"></label>
        <label>No. <input type="number" id="agNo" value="351"></label>
        <label title="Untick for a Speakathon">🗣 Table Topics <input type="checkbox" id="agTT" checked></label>
        <label title="Untick to drop the Prepared Speech Session">🎤 Speeches <input type="checkbox" id="agSp" checked></label>
        <label title="Transition minutes after each prepared speech">🚶 Speech buffer <input type="number" id="agBuf" value="1" min="0" step="0.5"></label>
        <label title="Transition minutes after each evaluation">🚶 Eval buffer <input type="number" id="agBufE" value="1" min="0" step="0.5"></label>
        <button class="btn ghost small" id="agAdd">＋ Speaker</button>
        <button class="btn ghost small" id="agEdu">🎓 Educational session</button>
      </div>
      <p class="small muted" style="margin:8px 0 0">Role players fill automatically from the meeting's bookings. Click any text on the sheet to edit — changes save per meeting for all admins. The PDF auto-scales to one A4 page.</p>
    </div>
    <div id="agSheet">
      <div class="masthead">
        <div class="badge"><img class="agswap" data-asset="badge" src="${window.AG_BADGE}" alt="Toastmasters International"></div>
        <div>
          <h1 contenteditable="true">Rawalpindi Toastmasters Club</h1>
          <div class="sub" contenteditable="true">Club No. 07247940 &nbsp;•&nbsp; District 122 &nbsp;•&nbsp; Area A9 &nbsp;•&nbsp; Division B</div>
        </div>
        <div class="meet-chips">
          <span class="mchip spk" id="agChipSpk">🎤 SPEAKATHON</span>
          <span class="mchip">Meeting <b id="agChipNo">No. 351</b></span>
          <span class="mchip" id="agChipDate"></span><br>
          <span class="mchip" id="agChipTime"></span>
          <span class="mchip" contenteditable="true">In-Person</span>
        </div>
      </div>
      <div class="themebar">
        <div class="theme">
          <div class="kicker">Theme of the Meeting</div>
          <div class="big" id="agTheme" contenteditable="true">—</div>
        </div>
        <div class="wod">
          <div class="kicker">Word of the Day</div>
          <div class="big" id="agWodWord" contenteditable="true">“____”</div>
          <div class="def" id="agWodDef" contenteditable="true">Definition — “example sentence.”</div>
        </div>
      </div>
      <table>
        <thead><tr>
          <th style="width:34%">Activity</th><th style="width:28%">Role Player</th>
          <th class="c" style="width:8%">From</th><th class="c" style="width:8%">To</th>
          <th class="c" style="width:6%">Min</th><th class="c" style="width:16%">Timer &nbsp;<span style="font-weight:400">G · Y · R</span></th>
        </tr></thead>
        <tbody id="agBody"></tbody>
      </table>
      <div class="bottom">
        <div class="panel bluehead" style="flex:1.15">
          <h3>Supporting Roles</h3>
          <div class="pbody roles2">
            <div><b>Timer</b><br><span contenteditable="true" data-sup="timer">TM ____________</span></div>
            <div><b>Vote Counter</b><br><span contenteditable="true" data-sup="vc">TM ____________</span></div>
            <div><b>Grammarian</b><br><span contenteditable="true" data-sup="gram">TM ____________</span></div>
            <div><b>Active Listener</b><br><span contenteditable="true" data-sup="al">TM ____________</span></div>
            <div><b>Ah Counter</b><br><span contenteditable="true" data-sup="ah">TM ____________</span></div>
            <div><b>Joke Master</b><br><span contenteditable="true" data-sup="jm">TM ____________</span></div>
          </div>
        </div>
        <div class="panel">
          <h3>Forward Planner — <span id="agFpDate"></span></h3>
          <div class="pbody fp"><ul style="list-style:none;margin:0;padding:0">
            <li><b>TMOD:</b> <span contenteditable="true" data-fp="tmod">—</span></li>
            <li><b>TT Master:</b> <span contenteditable="true" data-fp="ttm">—</span></li>
            <li><b>Speakers:</b> <span contenteditable="true" data-fp="spk">—</span></li>
            <li><b>General Evaluator:</b> <span contenteditable="true" data-fp="ge">—</span></li>
          </ul></div>
        </div>
        <div class="panel bluehead">
          <h3>Club Mission</h3>
          <div class="pbody mission" contenteditable="true">
            We provide a supportive and positive learning experience in which members are
            empowered to develop communication and leadership skills, resulting in greater
            self-confidence and personal growth.
          </div>
        </div>
      </div>
      <div class="excom" id="agExcomSec">
        <h3><span contenteditable="true">Rawalpindi Toastmasters Club — ExCom 2026-27</span><button
          class="del no-print" id="agHideBar" title="Hide this bar (keeps the photo)">✕ bar</button><button
          class="del no-print" id="agHideSec" title="Hide the whole ExCom banner">✕ banner</button></h3>
        <div class="restore no-print" id="agExcomRestore">ExCom bar/banner hidden (won’t print) — click to restore</div>
        <img class="agswap" data-asset="excom" src="${window.AG_EXCOM}" alt="ExCom officers">
      </div>
      <div class="foot"><span class="motto" contenteditable="true">“For better listening, for better thinking, for better speaking — we learn by doing.”</span></div>
    </div></div>`;
  }
  function fmtT(mins){ const h24=Math.floor(mins/60),mm=String(Math.round(mins%60)).padStart(2,'0'); return `${((h24+11)%12)+1}:${mm}`; }
  function ampm(mins){ return Math.floor(mins/60)%24>=12?'PM':'AM'; }
  function startMins(){ const [h,m]=(g('agStart').value||'16:30').split(':').map(Number); return h*60+m; }
  function halfRound(v){ return Math.round(v*2)/2; }
  function autoStep(t){ return t<=2?0.5:Math.max(1,Math.round(t/4)); }
  function autoLights(t){ if(!t)return['','','']; const s=autoStep(t),gr=halfRound(t-2*s),y=halfRound(t-s); return [gr>0?String(gr):'',y>0?String(y):'',String(halfRound(t))]; }
  function speechLights(t){ if(!t)return['','','']; if(t<=2)return autoLights(t); return [String(halfRound(t-2)),String(halfRound(t-1)),String(halfRound(t))]; }
  function lightsFor(row){
    if(row.autoMode==='manual')return row.lights||['','',''];
    if(row.kind==='speaker')return row.preset==='custom'?autoLights(row.dur):speechLights(row.dur);
    return autoLights(row.dur);
  }
  function applyLights(row){
    if(!row._ltEls)return;
    row.lights=lightsFor(row);
    row.lights.forEach((v,i)=>{ const s=row._ltEls[i]; s.className=v===''?'lt empty':`lt ${['g','y','r'][i]}`; s.innerText=v===''?'–':v; });
  }
  function visibleRows(b){ return b.rows.filter(r=>{ if(r.kind==='tteval'&&!showTT)return false; if(r.kind==='evaluator'&&!showSpeech)return false; return true; }); }
  function blockHidden(b){ return (b.id==='tt'&&!showTT)||(b.id==='speech'&&!showSpeech); }
  function orderedBlocks(){
    if(showTT||!showSpeech)return blocks;
    const arr=blocks.filter(b=>b.type!=='break'); const brk=blocks.find(b=>b.type==='break');
    if(brk)arr.splice(arr.findIndex(b=>b.id==='speech')+1,0,brk);
    return arr;
  }
  function speechBlock(){ return blocks.find(b=>b.id==='speech'); }
  function evalBlock(){ return blocks.find(b=>b.id==='eval'); }
  function speakerCount(){ return speechBlock().rows.filter(r=>r.kind==='speaker').length; }
  function syncEvaluators(){
    const rows=evalBlock().rows;
    let diff=speakerCount()-rows.filter(r=>r.kind==='evaluator').length;
    while(diff>0){
      const lastIdx=rows.map(r=>r.kind).lastIndexOf('evaluator');
      const insertAt=lastIdx>=0?lastIdx+1:rows.findIndex(r=>r.kind==='tteval')+1;
      rows.splice(insertAt,0,{kind:'evaluator',fill:'eval',who:'TM ____________',dur:3});
      diff--;
    }
    while(diff<0){ rows.splice(rows.map(r=>r.kind).lastIndexOf('evaluator'),1); diff++; }
  }
  function makeEditable(el,fn){ el.contentEditable='true'; el.addEventListener('input',fn); }
  function agRender(){
    const body=g('agBody'); if(!body)return;
    body.innerHTML='';
    orderedBlocks().forEach(block=>{
      if(block.type==='break'){
        const tr=document.createElement('tr'); tr.className='break';
        tr.innerHTML=`<td colspan="6">☕ Networking Break — <span class="bdur">${block.dur}</span> min (<span class="bfrom"></span> – <span class="bto"></span>)</td>`;
        block._fromEl=tr.querySelector('.bfrom'); block._toEl=tr.querySelector('.bto');
        const durEl=tr.querySelector('.bdur');
        makeEditable(durEl,()=>{ block.dur=parseFloat(durEl.innerText)||0; updateTimes(); });
        body.appendChild(tr); return;
      }
      if(blockHidden(block))return;
      const head=document.createElement('tr'); head.className='session';
      const headTd=document.createElement('td'); headTd.colSpan=6;
      const titleSpan=document.createElement('span'); titleSpan.innerHTML=block.title;
      if(block.removable){
        makeEditable(titleSpan,()=>{ block.title=titleSpan.innerHTML; });
        const del=document.createElement('button');
        del.className='del no-print'; del.textContent='✕'; del.title='Remove this session';
        del.addEventListener('click',()=>{ blocks.splice(blocks.indexOf(block),1); agRender(); });
        headTd.appendChild(titleSpan); headTd.appendChild(del);
      } else headTd.appendChild(titleSpan);
      block._minsEl=document.createElement('span'); block._minsEl.className='mins';
      headTd.appendChild(block._minsEl); head.appendChild(headTd); body.appendChild(head);
      let spkN=0,evalN=0;
      visibleRows(block).forEach(row=>{
        const tr=document.createElement('tr');
        const actTd=document.createElement('td');
        if(row.kind==='speaker'){
          spkN++;
          const note=AG_PRESETS[row.preset].label;
          actTd.innerHTML=`Prepared Speaker ${spkN}`+(note?` <span class="role-note">${note}</span>`:'');
          const sel=document.createElement('select'); sel.className='preset no-print';
          for(const k in AG_PRESETS){
            const o=document.createElement('option'); o.value=k; o.textContent=AG_PRESETS[k].name;
            if(k===row.preset)o.selected=true; sel.appendChild(o);
          }
          sel.addEventListener('change',()=>{
            row.preset=sel.value;
            const p=AG_PRESETS[sel.value];
            if(p.dur!=null)row.dur=p.dur;
            row.autoMode=undefined; agRender();
          });
          actTd.appendChild(sel); row._sel=sel;
          const del=document.createElement('button');
          del.className='del no-print'; del.textContent='✕'; del.title='Remove this speaker';
          del.addEventListener('click',()=>{
            const rows=speechBlock().rows; rows.splice(rows.indexOf(row),1);
            syncEvaluators(); agRender();
          });
          actTd.appendChild(del);
        } else if(row.kind==='evaluator'){
          evalN++; actTd.innerHTML=`Speech Evaluator ${evalN}`;
        } else {
          actTd.innerHTML=row.act;
          makeEditable(actTd,()=>{ row.act=actTd.innerHTML; });
        }
        tr.appendChild(actTd);
        const whoTd=document.createElement('td');
        whoTd.innerHTML=`<span class="who">${row.who}</span>`;
        const whoSpan=whoTd.querySelector('.who');
        makeEditable(whoSpan,()=>{ row.who=whoSpan.innerHTML; });
        tr.appendChild(whoTd);
        const fromTd=document.createElement('td'); fromTd.className='c time';
        const toTd=document.createElement('td'); toTd.className='c time';
        row._fromEl=fromTd; row._toEl=toTd;
        tr.appendChild(fromTd); tr.appendChild(toTd);
        const durTd=document.createElement('td'); durTd.className='c dur';
        durTd.innerText=row.dur;
        makeEditable(durTd,()=>{
          row.dur=parseFloat(durTd.innerText)||0;
          if(row.kind==='speaker'&&AG_PRESETS[row.preset].dur!=null&&row.dur!==AG_PRESETS[row.preset].dur){
            row.preset='custom'; if(row._sel)row._sel.value='custom';
          }
          applyLights(row); updateTimes();
        });
        tr.appendChild(durTd);
        const ltTd=document.createElement('td');
        const box=document.createElement('div'); box.className='lights';
        row._ltEls=[];
        ['g','y','r'].forEach((cls,i)=>{
          const s=document.createElement('span');
          makeEditable(s,()=>{
            const t=s.innerText.trim();
            row.autoMode='manual';
            row.lights=row.lights||['','',''];
            row.lights[i]=(t==='–'||t==='-')?'':t;
          });
          row._ltEls.push(s); box.appendChild(s);
        });
        ltTd.appendChild(box); tr.appendChild(ltTd);
        applyLights(row); body.appendChild(tr);
      });
    });
    updateTimes(); queueAgSave();
  }
  function updateTimes(){
    if(!g('agBody'))return;
    let cur=startMins(); const start=cur;
    const bufS=parseFloat(g('agBuf').value)||0,bufE=parseFloat(g('agBufE').value)||0;
    const extra=r=>r.kind==='speaker'?bufS:(r.kind==='evaluator'||r.kind==='tteval')?bufE:0;
    orderedBlocks().forEach(block=>{
      if(block.type==='break'){
        if(block._fromEl)block._fromEl.innerText=fmtT(cur);
        cur+=block.dur;
        if(block._toEl)block._toEl.innerText=fmtT(cur);
        return;
      }
      if(blockHidden(block))return;
      const rows=visibleRows(block);
      const total=rows.reduce((s,r)=>s+(r.dur||0)+extra(r),0);
      if(block._minsEl)block._minsEl.innerText=`${total} min`;
      rows.forEach(row=>{
        if(row._fromEl)row._fromEl.innerText=fmtT(cur);
        cur+=(row.dur||0);
        if(row._toEl)row._toEl.innerText=fmtT(cur);
        cur+=extra(row);
      });
    });
    g('agChipTime').innerText=`${fmtT(start)} – ${fmtT(cur)} ${ampm(cur)}`;
  }
  function agFmtDate(d){ return `${String(d.getDate()).padStart(2,'0')} ${MONTHS[d.getMonth()]} ${d.getFullYear()}`; }
  function updateDates(){
    const v=g('agDate').value; if(!v)return;
    const [y,m,d]=v.split('-').map(Number);
    g('agChipDate').innerText=agFmtDate(new Date(y,m-1,d));
    g('agFpDate').innerText=agFmtDate(new Date(y,m-1,d+7));
  }
  function applyBookings(){
    const m=state.meetings.find(x=>x.id===mid); if(!m)return;
    /* mirror the meeting's Table Topics setting onto the agenda */
    g('agTT').checked=ttOn(m); showTT=ttOn(m);
    g('agChipSpk').style.display=(!showTT&&g('agSp').checked)?'inline-block':'none';
    const map=roleMap(m);
    const spkSlots=Math.max(1,map.spk.length||speakerCount());
    const rows=speechBlock().rows;
    let cur=rows.filter(r=>r.kind==='speaker').length;
    while(cur<spkSlots){ rows.splice(rows.length-1,0,{kind:'speaker',fill:'spk',who:'TM ____________',preset:'std',dur:7}); cur++; }
    while(cur>spkSlots){ rows.splice(rows.map(r=>r.kind).lastIndexOf('speaker'),1); cur--; }
    syncEvaluators();
    let si=0,ei=0;
    for(const b of blocks){ if(b.type==='break')continue;
      for(const r of b.rows){
        if(r.fill==='spk'){ if(map.spk[si])r.who=map.spk[si]; si++; }
        else if(r.fill==='eval'){ if(map.eval[ei])r.who=map.eval[ei]; ei++; }
        else if(r.fill&&map[r.fill])r.who=map[r.fill];
      }
    }
    document.querySelectorAll('#agSheet [data-sup]').forEach(el=>{ const v=map[el.dataset.sup]; if(v)el.innerText=v; });
    if(m.theme)g('agTheme').innerText=m.theme;
    if(m.wod&&m.wod.word)g('agWodWord').innerText='“'+m.wod.word.replace(/^[\s"“”']+|[\s"“”']+$/g,'')+'”';
    if(m.wod&&m.wod.def)g('agWodDef').innerText=m.wod.def;
    const nm=nextMeetingAfter(m.date);
    if(nm){
      const fmap=roleMap(nm);
      const fp={tmod:fmap.tmod||'—',ttm:fmap.ttm||'—',ge:fmap.ge||'—',
        spk:fmap.spk.filter(Boolean).map((n,i)=>`${i+1}) ${n}`).join(' &nbsp; ')||'—'};
      document.querySelectorAll('#agSheet [data-fp]').forEach(el=>{ el.innerHTML=fp[el.dataset.fp]; });
    }
  }
  function staticEditables(){
    return [...document.querySelectorAll('#agSheet [contenteditable]')].filter(el=>!el.closest('#agBody'));
  }
  function collectAgState(){
    return {
      blocks:blocks.map(b=>b.type==='break'?{type:'break',dur:b.dur}
        :{type:b.type,id:b.id,title:b.title,removable:b.removable,
          rows:b.rows.map(r=>({kind:r.kind,fill:r.fill,act:r.act,who:r.who,dur:r.dur,preset:r.preset,autoMode:r.autoMode,lights:[...(r.lights||['','',''])]}))}),
      inputs:{date:g('agDate').value,start:g('agStart').value,no:g('agNo').value,
              buf:g('agBuf').value,bufE:g('agBufE').value,tt:g('agTT').checked,sp:g('agSp').checked},
      texts:staticEditables().map(el=>el.innerHTML),
      excom:[g('agExcomSec').classList.contains('nobar'),g('agExcomSec').classList.contains('nosec')]
    };
  }
  function applyAgState(st){
    if(!st)return;
    try{
      if(st.blocks&&st.blocks.length)blocks=st.blocks;
      const i=st.inputs||{};
      if(i.date)g('agDate').value=i.date;
      if(i.start)g('agStart').value=i.start;
      if(i.no!=null){ g('agNo').value=i.no; g('agChipNo').innerText='No. '+i.no; }
      if(i.buf!=null)g('agBuf').value=i.buf;
      if(i.bufE!=null)g('agBufE').value=i.bufE;
      if(i.tt!=null)g('agTT').checked=i.tt;
      if(i.sp!=null)g('agSp').checked=i.sp;
      const els=staticEditables();
      (st.texts||[]).forEach((h,idx)=>{ if(els[idx]!=null&&h!=null)els[idx].innerHTML=h; });
      if(st.excom){
        g('agExcomSec').classList.toggle('nobar',!!st.excom[0]);
        g('agExcomSec').classList.toggle('nosec',!!st.excom[1]);
      }
    }catch(e){ console.warn('Could not restore agenda state:',e); }
  }
  function queueAgSave(){
    clearTimeout(saveTimer);
    saveTimer=setTimeout(()=>{
      if(!mid||!g('agBody'))return;
      const data=collectAgState();
      state.agendas[mid]=data; S.agendas=state.agendas;
      sync(api.saveAgenda(mid,data));
    },500);
  }
  /* Target a few mm short of true A4 (297mm): printer rendering differs
     slightly from screen, and a sub-mm overflow spills a near-empty page 2. */
  const PAGE_W=210,PAGE_H=291;
  let pxPerMm=null,savedTitle=null;
  function measurePxPerMm(){
    const probe=document.createElement('div');
    probe.style.cssText='width:100mm;position:absolute;visibility:hidden;';
    document.body.appendChild(probe); pxPerMm=probe.offsetWidth/100; document.body.removeChild(probe);
  }
  function fitToPage(){
    const sheet=g('agSheet'); if(!sheet)return;
    savedTitle=document.title;
    const v=g('agDate').value; let datePart='';
    if(v){ const [y,m,d]=v.split('-').map(Number); datePart=`${String(d).padStart(2,'0')}${MONTHS[m-1]}${y}`; }
    document.title=`RTC_Agenda_meeting no. ${g('agNo').value}_${datePart}`;
    if(!pxPerMm)measurePxPerMm();
    sheet.style.transform='';
    let z=1;
    for(let i=0;i<8;i++){
      sheet.style.width=(PAGE_W/z)+'mm';
      const hMm=sheet.offsetHeight/pxPerMm;   /* offsetHeight ignores transform — true layout height */
      const rendered=z*hMm;
      if(rendered<=PAGE_H)break;
      z=z*PAGE_H/rendered*0.99;
    }
    /* transform:scale prints deterministically (CSS zoom fragments unreliably
       when the sheet is nested); the .agprint clamp caps output at one page */
    sheet.style.transformOrigin='top left';
    sheet.style.transform=`scale(${z})`;
    document.documentElement.classList.add('agprint');
  }
  function unfit(){
    const sheet=g('agSheet'); if(!sheet)return;
    sheet.style.transform=''; sheet.style.transformOrigin=''; sheet.style.width='';
    document.documentElement.classList.remove('agprint');
    if(savedTitle)document.title=savedTitle;
  }
  window.addEventListener('beforeprint',fitToPage);
  window.addEventListener('afterprint',unfit);
  function loadMeeting(){
    const m=state.meetings.find(x=>x.id===mid);
    const saved=state.agendas&&state.agendas[mid];
    blocks=agDefaultBlocks();
    if(saved){ applyAgState(saved); }
    else{
      if(m)g('agDate').value=m.date;
      const no=nextNo(); g('agNo').value=no; g('agChipNo').innerText='No. '+no;
      applyBookings();
    }
    const assets=(state.settings.agendaAssets)||{};
    document.querySelectorAll('#agWrap img.agswap').forEach(img=>{
      if(assets[img.dataset.asset])img.src=assets[img.dataset.asset];
    });
    showTT=g('agTT').checked; showSpeech=g('agSp').checked;
    g('agChipSpk').style.display=(!showTT&&showSpeech)?'inline-block':'none';
    agRender(); updateDates();
  }
  function mount(main){
    container=main;
    if(!mid||!state.meetings.some(m=>m.id===mid&&!m.cancelled)){
      const up=upcomingMeetings(); mid=up.length?up[0].id:(state.meetings[0]&&state.meetings[0].id);
    }
    main.innerHTML=shell();
    if(!mid){ g('agBody').innerHTML='<tr><td colspan="6">No meetings yet.</td></tr>'; return; }
    g('agMeeting').addEventListener('change',e=>{
      clearTimeout(saveTimer);
      if(g('agBody')){ const data=collectAgState(); state.agendas[mid]=data; sync(api.saveAgenda(mid,data)); }
      mid=e.target.value; mount(container);
    });
    g('agFill').addEventListener('click',()=>{ applyBookings(); agRender(); toast('Role players refreshed from bookings'); });
    g('agPrint').addEventListener('click',()=>window.print());
    g('agDate').addEventListener('input',updateDates);
    g('agStart').addEventListener('input',updateTimes);
    g('agBuf').addEventListener('input',updateTimes);
    g('agBufE').addEventListener('input',updateTimes);
    g('agNo').addEventListener('input',()=>{ g('agChipNo').innerText='No. '+g('agNo').value; });
    function updateToggles(){
      showTT=g('agTT').checked; showSpeech=g('agSp').checked;
      g('agChipSpk').style.display=(!showTT&&showSpeech)?'inline-block':'none';
      agRender();
    }
    g('agTT').addEventListener('change',updateToggles);
    g('agSp').addEventListener('change',updateToggles);
    g('agAdd').addEventListener('click',()=>{
      const rows=speechBlock().rows;
      rows.splice(rows.length-1,0,{kind:'speaker',fill:'spk',who:'TM ____________',preset:'std',dur:7});
      syncEvaluators(); agRender();
    });
    g('agEdu').addEventListener('click',()=>{
      const idx=blocks.findIndex(b=>b.type==='break');
      blocks.splice(idx+1,0,{type:'session',title:'Educational Session',removable:true,rows:[
        {act:'Introduction of Guest Speaker',who:'TMOD',dur:2},
        {act:'Educational Session <span class="role-note">(topic)</span>',who:'Guest Speaker — ____________',dur:20},
        {act:'Q&amp;A &amp; Vote of Thanks',who:'Guest Speaker &amp; TMOD',dur:5}
      ]});
      agRender();
    });
    g('agHideBar').addEventListener('click',()=>{ g('agExcomSec').classList.add('nobar'); queueAgSave(); });
    g('agHideSec').addEventListener('click',()=>{ g('agExcomSec').classList.add('nosec'); queueAgSave(); });
    g('agExcomRestore').addEventListener('click',()=>{ g('agExcomSec').classList.remove('nobar','nosec'); queueAgSave(); });
    document.querySelectorAll('#agWrap img.agswap').forEach(img=>{
      img.title='Click to replace this image'; img.style.cursor='pointer';
      img.addEventListener('click',()=>{
        const inp=document.createElement('input'); inp.type='file'; inp.accept='image/*';
        inp.onchange=e=>{
          const f=e.target.files[0]; if(!f)return;
          const r=new FileReader();
          r.onload=()=>{
            img.src=r.result;
            state.settings.agendaAssets=state.settings.agendaAssets||{};
            state.settings.agendaAssets[img.dataset.asset]=r.result;
            saveSettingsRemote();
          };
          r.readAsDataURL(f);
        };
        inp.click();
      });
    });
    const wrap=document.getElementById('agWrap');
    wrap.addEventListener('input',queueAgSave);
    wrap.addEventListener('change',queueAgSave);
    loadMeeting();
  }
  return {mount};
})();

/* ============================================================
   SESSION FLOW
   ============================================================ */
function show(id){
  for(const x of ['authWrap','pendingWrap','appWrap'])
    document.getElementById(x).style.display=(x===id)?'':'none';
}
async function reload(){
  const raw=await api.loadAll();
  S.profiles=raw.profiles; S.meetings=raw.meetings; S.assignments=raw.assignments;
  S.awards=raw.awards; S.goals=raw.goals;
  S._hadSettings=!!(raw.settingsRows[0]&&raw.settingsRows[0].data&&raw.settingsRows[0].data.roles);
  S.settings=S._hadSettings?raw.settingsRows[0].data:defaultSettings();
  S.dcp={}; for(const r of raw.dcpRows)S.dcp[r.year]=r.data;
  S.agendas={}; for(const r of raw.agendaRows)S.agendas[r.meeting_id]=r.data;
  rebuild();
}
let entered=false;
async function enterApp(profile){
  me={profileId:profile.id,name:profile.name};
  isAdmin=profile.role==='admin';
  await reload();
  if(isAdmin){
    if(!S._hadSettings)sync(api.saveSettings(S.settings));
    await ensureMeetings();
    autoFillStanding();
  }
  tab=isAdmin?'schedule':'book';
  show('appWrap'); render();
  if(!entered){
    entered=true;
    api.subscribe(async(table,p)=>{ await reload(); if(['book','schedule'].includes(tab))render(); });
    setInterval(dateRollCheck,60000);
    document.addEventListener('visibilitychange',()=>{ if(!document.hidden)dateRollCheck(); });
  }
}
let _renderedDate=todayStr();
async function dateRollCheck(){
  const t=todayStr();
  if(t===_renderedDate)return;
  _renderedDate=t;
  await ensureMeetings(); autoFillStanding(); render();
}
async function route(){
  try{
    const session=await api.session();
    if(!session){ show('authWrap'); return; }
    const profile=await api.myProfile();
    if(!profile){ show('authWrap'); return; }
    if(!profile.approved||!profile.active){ show('pendingWrap'); return; }
    await enterApp(profile);
  }catch(e){ console.error(e); toast('Error: '+(e.message||e)); }
}

/* ---------- auth UI ---------- */
let authMode='signin';
function bindAuth(){
  const form=document.getElementById('authForm');
  const errEl=document.getElementById('authErr');
  document.getElementById('authToggle').addEventListener('click',()=>{
    authMode=authMode==='signin'?'signup':'signin';
    document.getElementById('nameRow').style.display=authMode==='signup'?'':'none';
    document.getElementById('authGo').textContent=authMode==='signup'?'Create account':'Sign in';
    document.getElementById('authSwitch').firstChild.textContent=authMode==='signup'?'Already a member? ':'New here? ';
    document.getElementById('authToggle').textContent=authMode==='signup'?'Sign in instead':'Create an account';
    errEl.textContent='';
  });
  form.addEventListener('submit',async e=>{
    e.preventDefault(); errEl.textContent='';
    const email=document.getElementById('authEmail').value.trim();
    const pass=document.getElementById('authPass').value;
    try{
      if(authMode==='signup'){
        const name=document.getElementById('authName').value.trim();
        if(!name){errEl.textContent='Please enter your name.';return;}
        await api.signUp(email,pass,name);
      } else await api.signIn(email,pass);
      await route();
    }catch(err){ errEl.textContent=err.message||String(err); }
  });
  document.getElementById('pendingRefresh').addEventListener('click',route);
  document.getElementById('pendingOut').addEventListener('click',async()=>{ await api.signOut(); route(); });
  document.getElementById('signOut').addEventListener('click',async()=>{ await api.signOut(); entered=false; route(); });
  document.getElementById('viewAs').addEventListener('click',()=>{
    viewAsMember=!viewAsMember;
    tab=viewAsMember?'book':'schedule';
    render();
  });
  if(DEMO){
    document.getElementById('demoBanner').style.display='';
    document.getElementById('demoAdmin').addEventListener('click',()=>DemoApi.demoEnter('admin'));
    document.getElementById('demoMember').addEventListener('click',()=>DemoApi.demoEnter('member'));
  }
}

/* ---------- boot ---------- */
Object.assign(window,{setTab,render,assign,setTheme,cancelMeeting,setOutcome,setActualRole,setReviewed,
  addMember,setMem,addAward,delAward,admGoalAdd,admGoalToggle,admGoalDel,approveMember,approveMerge,setRole,
  spkDelta,setMeetingTT,setWod,addPastMeeting,pastEditToggle,
  toggleArchive,delMember,keepOpen,s_set,roleEdit,roleDel,roleAdd,exportData,setDcp,
  myBook,myUnbook,meSet,meGoalAdd,meGoalToggle,meGoalDel,route});
Object.defineProperty(window,'memView',{get:()=>memView,set:v=>{memView=v;}});
Object.defineProperty(window,'dcpSelYear',{get:()=>dcpSelYear,set:v=>{dcpSelYear=v;}});

(async function boot(){
  api=DEMO?DemoApi:SupabaseApi;
  bindAuth();
  await api.init();
  await route();
})();
