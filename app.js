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
    /* re-route only on sign-out or the first sign-in; routine token
       refreshes must NOT re-enter the app (it would reset the current tab) */
    sb.auth.onAuthStateChange((ev,_s)=>{
      if(ev==='PASSWORD_RECOVERY')recoveryMode=true;   /* belt-and-braces: the hash sniff already caught it */
      if(ev==='SIGNED_OUT'||ev==='PASSWORD_RECOVERY'||!entered)route();
    });
  },
  async session(){ return (await sb.auth.getSession()).data.session; },
  async signUp(email,pass,name,birthday){
    const {data,error}=await sb.auth.signUp({email,password:pass});
    if(error)throw error;
    if(data.session){
      const {error:e2}=await sb.from('profiles').insert({auth_id:data.session.user.id,email,name,birthday:birthday||null});
      if(e2&&e2.code!=='23505')throw e2;
    } else {
      localStorage.setItem('pendingName',name);
      if(birthday)localStorage.setItem('pendingBday',birthday);
      throw {message:'Check your email to confirm the account, then sign in.'};
    }
  },
  async resetPassword(email){
    /* redirectTo must be listed under Auth -> URL Configuration in Supabase,
       otherwise the emailed link silently bounces to the Site URL instead */
    const {error}=await sb.auth.resetPasswordForEmail(email,{redirectTo:APP_URL});
    if(error)throw error;
  },
  async updatePassword(pass){
    const {error}=await sb.auth.updateUser({password:pass});
    if(error)throw error;
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
      const birthday=localStorage.getItem('pendingBday')||null;
      const {data:row,error:e2}=await sb.from('profiles').insert({auth_id:s.user.id,email:s.user.email,name,birthday}).select().single();
      if(e2)throw e2;
      localStorage.removeItem('pendingName'); localStorage.removeItem('pendingBday');
      return row;
    }
    return data;
  },
  async loadAll(){
    const q=async(t,optional)=>{ const {data,error}=await sb.from(t).select('*'); if(error){ if(optional)return []; throw error; } return data; };
    const [settingsRows,profiles,meetings,assignments,awards,goals,dcpRows,agendaRows,polls,votes,announcements,birthdayChanges,suggestions]=await Promise.all(
      [...['settings','profiles','meetings','assignments','awards','goals','dcp','agendas'].map(t=>q(t)),
       q('polls',true),q('votes',true),q('announcements',true),q('birthday_changes',true),q('suggestions',true)]);
    return {settingsRows,profiles,meetings,assignments,awards,goals,dcpRows,agendaRows,polls,votes,announcements,birthdayChanges,suggestions};
  },
  async addSuggestion(f){ const {data,error}=await sb.from('suggestions').insert(f).select().single(); if(error)throw error; return data; },
  async updSuggestion(id,f){ const {error}=await sb.from('suggestions').update(f).eq('id',id); if(error)throw error; },
  async delSuggestion(id){ const {error}=await sb.from('suggestions').delete().eq('id',id); if(error)throw error; },
  async markBcSeen(id){ const {error}=await sb.from('birthday_changes').update({seen:true}).eq('id',id); if(error)throw error; },
  async addAnnouncement(text){ const {data,error}=await sb.from('announcements').insert({text}).select().single(); if(error)throw error; return data; },
  async delAnnouncement(id){ const {error}=await sb.from('announcements').delete().eq('id',id); if(error)throw error; },
  async createPoll(f){ const {data,error}=await sb.from('polls').insert(f).select().single(); if(error)throw error; return data; },
  async updatePoll(id,f){ const {error}=await sb.from('polls').update(f).eq('id',id); if(error)throw error; },
  async deletePoll(id){ const {error}=await sb.from('polls').delete().eq('id',id); if(error)throw error; },
  async castVote(poll_id,voter,candidate_key){
    const {error}=await sb.from('votes').upsert({poll_id,voter,candidate_key},{onConflict:'poll_id,voter'});
    if(error)throw error;
  },
  async delVote(poll_id,voter){
    const {error}=await sb.from('votes').delete().eq('poll_id',poll_id).eq('voter',voter);
    if(error)throw error;
  },
  async saveSettings(data){ const {error}=await sb.from('settings').upsert({id:1,data}); if(error)throw error; },
  async insertMeeting(m){ const {data,error}=await sb.from('meetings').insert(m).select().single(); if(error)throw error; return data; },
  async updateMeeting(id,fields){ const {error}=await sb.from('meetings').update(fields).eq('id',id); if(error)throw error; },
  async book(meeting_id,slot_key,profile_id){
    const {error}=await sb.from('assignments').insert({meeting_id,slot_key,profile_id});
    if(error)throw error;
  },
  async adminAssign(meeting_id,slot_key,profile_id,booked_at){
    const row={meeting_id,slot_key,profile_id,status:'booked',actual_role:null};
    /* carried across when a booking is moved forward: a member who is bumped
       must keep their original place in the queue, not go to the back of it */
    if(booked_at)row.booked_at=booked_at;
    const {error}=await sb.from('assignments').upsert(row);
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
  async reassignData(fromId,intoId){
    for(const t of ['assignments','awards','goals']){
      const {error}=await sb.from(t).update({profile_id:intoId}).eq('profile_id',fromId);
      if(error)throw error;
    }
  },
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
      .on('postgres_changes',{event:'*',schema:'public',table:'polls'},p=>onChange('polls',p))
      .on('postgres_changes',{event:'*',schema:'public',table:'votes'},p=>onChange('votes',p))
      .on('postgres_changes',{event:'*',schema:'public',table:'announcements'},p=>onChange('announcements',p))
      .on('postgres_changes',{event:'*',schema:'public',table:'birthday_changes'},p=>onChange('birthday_changes',p))
      .subscribe();
  }
};

/* ---------- demo backend: in-memory sample data ---------- */
const DemoApi=(function(){
  let auth=null;
  const P=(n,extra)=>({id:uid(),auth_id:null,email:'',name:n,home_club:null,role:'member',approved:true,active:true,path:'',birthday:null,base_level:0,projects_done:0,...extra});
  const mdOf=n=>{const d=new Date();d.setDate(d.getDate()+n);return dstr(d).slice(5);};
  const profiles=[
    P('Demo Admin (you)',{auth_id:'demo-admin',role:'admin',email:'admin@demo',path:'Presentation Mastery',base_level:2,projects_done:1}),
    P('Demo Member (you)',{auth_id:'demo-member',email:'member@demo',path:'Dynamic Leadership',base_level:0,projects_done:3,birthday:mdOf(0)}),
    P('Ayesha',{paths:[{name:'Engaging Humor',baseLevel:1,projectsDone:2,done:false},
                       {name:'Presentation Mastery',baseLevel:5,projectsDone:0,done:true}]}),
    P('Bilal',{path:'Innovative Planning',base_level:1,birthday:mdOf(2)}),
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
  const polls=[{id:'pollPast',meeting_id:'mtPast',category:'Best Speaker',status:'closed',
    candidates:[{key:profiles[1].id,name:profiles[1].name,profileId:profiles[1].id},{key:profiles[2].id,name:'Ayesha',profileId:profiles[2].id}],
    adjust:{},winner_key:profiles[1].id}];
  const votes=[];
  const announcements=[{id:'annDemo',text:'Our own TM Danish has been appointed Area Director — congratulations! 🎊',created_at:new Date().toISOString()}];
  const birthdayChanges=[];
  const suggestions=[{id:'sug1',profile_id:profiles[2].id,text:'Can we start meetings 10 minutes earlier?',hide_name:false,status:'new',admin_note:null,created_at:new Date().toISOString()}];
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
    async resetPassword(email){ throw {message:'Demo: a reset link would be emailed to '+email+'.'}; },
    async updatePassword(){ /* demo: nothing to store */ },
    async signOut(){ auth=null; },
    async myProfile(){ return profiles.find(p=>p.auth_id===auth)||null; },
    /* return copies of rows AND of the arrays — the app mutates its own state
       locally, and sharing references would both double rows up and hide
       real changes from this fake backend (the server sees separate rows) */
    async loadAll(){
      const cp=a=>a.map(o=>({...o}));
      return {settingsRows:cp(settingsRows),profiles:cp(profiles),meetings:cp(meetings),assignments:cp(assignments),
        awards:cp(awards),goals:cp(goals),dcpRows:cp(dcpRows),agendaRows:cp(agendaRows),polls:cp(polls),
        votes:cp(votes),announcements:cp(announcements),birthdayChanges:cp(birthdayChanges),suggestions:cp(suggestions)};
    },
    async addSuggestion(f){ const row={id:uid(),status:'new',admin_note:null,created_at:new Date().toISOString(),...f}; suggestions.push(row); return row; },
    async updSuggestion(id,f){ Object.assign(suggestions.find(s=>s.id===id)||{},f); },
    async delSuggestion(id){ const i=suggestions.findIndex(s=>s.id===id); if(i>=0)suggestions.splice(i,1); },
    async markBcSeen(id){ const r=birthdayChanges.find(b=>b.id===id); if(r)r.seen=true; },
    async addAnnouncement(text){ const row={id:uid(),text,created_at:new Date().toISOString()}; announcements.push(row); return row; },
    async delAnnouncement(id){ const i=announcements.findIndex(a=>a.id===id); if(i>=0)announcements.splice(i,1); },
    async createPoll(f){ const row={id:uid(),status:'open',candidates:[],adjust:{},paper_voters:[],winner_key:null,...f}; polls.push(row); return row; },
    async updatePoll(id,f){ Object.assign(polls.find(p=>p.id===id)||{},f); },
    async deletePoll(id){ const i=polls.findIndex(p=>p.id===id); if(i>=0)polls.splice(i,1); },
    async castVote(poll_id,voter,candidate_key){
      const ex=votes.find(v=>v.poll_id===poll_id&&v.voter===voter);
      if(ex)ex.candidate_key=candidate_key; else votes.push({poll_id,voter,candidate_key});
    },
    async delVote(poll_id,voter){
      const i=votes.findIndex(v=>v.poll_id===poll_id&&v.voter===voter);
      if(i>=0)votes.splice(i,1);
    },
    async saveSettings(data){ settingsRows=[{id:1,data}]; },
    async insertMeeting(m){ const row={id:uid(),theme:'',cancelled:false,reviewed:false,...m}; meetings.push(row); return row; },
    async updateMeeting(id,f){ Object.assign(meetings.find(m=>m.id===id)||{},f); },
    async book(mid,key,pid){
      if(assignments.some(a=>a.meeting_id===mid&&a.slot_key===key))throw {message:'duplicate key value'};
      assignments.push({meeting_id:mid,slot_key:key,profile_id:pid,status:'booked',actual_role:null});
    },
    async adminAssign(mid,key,pid,booked_at){
      const at=booked_at||new Date().toISOString();
      const ex=assignments.find(a=>a.meeting_id===mid&&a.slot_key===key);
      if(ex){ex.profile_id=pid;ex.status='booked';ex.actual_role=null;ex.booked_at=at;}
      else assignments.push({meeting_id:mid,slot_key:key,profile_id:pid,status:'booked',actual_role:null,booked_at:at});
    },
    async unbook(mid,key){ const i=assignments.findIndex(a=>a.meeting_id===mid&&a.slot_key===key); if(i>=0)assignments.splice(i,1); },
    async setAsg(mid,key,f){ Object.assign(assignments.find(a=>a.meeting_id===mid&&a.slot_key===key)||{},f); },
    async insertProfile(f){ const row=P(f.name,f); profiles.push(row); return row; },
    async reassignData(fromId,intoId){
      for(const arr of [assignments,awards,goals])
        for(const r of arr)if(r.profile_id===fromId)r.profile_id=intoId;
    },
    async updateProfile(id,f){
      const p=profiles.find(p=>p.id===id);
      if(p&&f.birthday!==undefined&&f.birthday!==p.birthday)
        birthdayChanges.push({id:uid(),profile_id:id,old_value:p.birthday,new_value:f.birthday,
          by_admin:auth==='demo-admin'&&id!==(profiles.find(x=>x.auth_id===auth)||{}).id,
          changed_at:new Date().toISOString(),seen:false});
      Object.assign(p||{},f);
    },
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
let S={profiles:[],meetings:[],assignments:[],awards:[],goals:[],polls:[],votes:[],announcements:[],birthdayChanges:[],suggestions:[],settings:defaultSettings(),dcp:{},agendas:{}};
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
      /* multiple pathways; legacy single-path profiles are folded in on read */
      paths:(p.paths&&p.paths.length)?p.paths:(p.path?[{name:p.path,baseLevel:p.base_level||0,projectsDone:p.projects_done||0,done:false}]:[]),
      awards:(awardsBy[p.id]||[]).map(a=>({id:a.id,level:a.level,path:a.path||'',date:a.date})).sort((a,b)=>a.date<b.date?-1:1),
      goals:(goalsBy[p.id]||[]).map(g=>({id:g.id,text:g.text,done:g.done})),
      archived:!p.active,role:p.role,approved:p.approved,hasAccount:!!p.auth_id,email:p.email||'',birthday:p.birthday||''}))
      .sort((a,b)=>a.name.localeCompare(b.name,undefined,{sensitivity:'base'})),
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
/* format swap: prepared speeches run before Table Topics */
function speechFirstOn(m){ return !!(m&&m.config&&m.config.speechFirst); }
/* attendance is opt-out: everyone counts as present unless listed here */
function absentList(m){ return (m&&m.config&&m.config.absent)||[]; }
function isAbsent(m,pid){ return absentList(m).includes(pid); }
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
const UNTRACKED_ROLES=['saa','po'];   // standing roles — booked and on agendas, but not counted as history
function meetingOutcomes(m){
  const out=[];
  for(const [key,a] of Object.entries(m.assignments||{})){
    if(!a||!a.memberId||!memberById(a.memberId))continue;
    const rid=key.split('|')[0];
    const baseRole=roleNameById(rid);
    const st=a.status||'done';
    out.push({memberId:a.memberId,rid,roleName:(st==='other'&&a.actualRole)?a.actualRole:baseRole,status:st});
  }
  return out;
}
function pastMeetings(){ const t=todayStr(); return state.meetings.filter(m=>!m.cancelled&&m.date<t).sort((a,b)=>a.date<b.date?1:-1); }
/* Members only ever plan three meetings ahead — more is noise on a phone.
   Officers need a longer runway to shuffle speakers between meetings. */
const MEMBER_HORIZON=3, ADMIN_HORIZON=8;
function upcomingMeetings(n){
  const t=todayStr();
  return state.meetings.filter(m=>!m.cancelled&&m.date>=t)
    .sort((a,b)=>a.date<b.date?-1:1).slice(0,n||MEMBER_HORIZON);
}
function roleHistory(){
  const h={},abs={};
  for(const m of pastMeetings()){
    const counted=new Set();
    /* the attendance register is the wider record — someone can miss a meeting
       without ever having been booked for a role */
    for(const pid of absentList(m)){ abs[pid]=(abs[pid]||0)+1; counted.add(pid); }
    for(const o of meetingOutcomes(m)){
      if(UNTRACKED_ROLES.includes(o.rid))continue;
      if(o.status==='absent'){
        if(!counted.has(o.memberId)){ abs[o.memberId]=(abs[o.memberId]||0)+1; counted.add(o.memberId); }
        continue;
      }
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
/* A member may work several pathways at once (and finish some). Levels are
   tracked per path; awards carry the path they belong to. */
function memPaths(mem){ return mem.paths||[]; }
function pathLevel(mem,pe){
  const idx=memPaths(mem).indexOf(pe);
  let lv=pe.baseLevel||0;
  for(const a of (mem.awards||[])){
    /* awards recorded before multi-path support carry no path: count them on the first one */
    if(a.path?a.path!==pe.name:idx!==0)continue;
    const l=a.level==='DTM'?5:Number(a.level);
    if(l>lv)lv=l;
  }
  return lv;
}
function activePaths(mem){ return memPaths(mem).filter(p=>!p.done); }
/* "most junior speaks first": rank on the highest level they've reached on any
   active path, then on projects done within that path. No pathway at all = most
   junior of the lot, which is what a brand-new member is. */
function seniority(mem){
  if(!mem)return {level:99,projects:99};
  const ps=activePaths(mem);
  if(!ps.length)return {level:0,projects:0};
  let best=ps[0],lv=pathLevel(mem,ps[0]);
  for(const p of ps){ const l=pathLevel(mem,p); if(l>lv){lv=l;best=p;} }
  return {level:lv,projects:best.projectsDone||0};
}
function juniorFirst(a,b){
  const x=seniority(a),y=seniority(b);
  return x.level!==y.level?x.level-y.level:x.projects-y.projects;
}
function currentLevel(mem){   /* highest level reached across all paths */
  let lv=mem.baseLevel||0;
  for(const pe of memPaths(mem))lv=Math.max(lv,pathLevel(mem,pe));
  for(const a of (mem.awards||[])){ const l=a.level==='DTM'?5:Number(a.level); if(l>lv)lv=l; }
  return lv;
}
function dcpYear(yr){
  if(!state.dcp[yr])state.dcp[yr]={newMembers:0,officersR1:0,officersR2:0,dues:false,officerList:false,base:'',current:'',csp:false};
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
/* Each ACTIVE path is its own candidacy — someone on their second path can
   earn Level 1 again (which counts for the DCP) while finishing Level 4 on
   the first, so a member can legitimately appear under two goals. */
function candidatesByGoal(){
  const sp=speechesThisYear();
  const pool=state.members.filter(m=>!m.external&&!m.archived);
  const buckets={1:[],2:[],3:[],45:[]};
  for(const m of pool){
    for(const pe of activePaths(m)){
      const cl=pathLevel(m,pe);
      const info={m,pe,cl,score:(pe.projectsDone||0)*2+(sp[m.id]||0),speeches:sp[m.id]||0};
      if(cl===0)buckets[1].push(info);
      else if(cl===1)buckets[2].push(info);
      else if(cl===2)buckets[3].push(info);
      else if(cl>=3&&cl<5)buckets[45].push(info);
    }
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
  while(count<ADMIN_HORIZON&&guard++<30){
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
/* "am I acting as an admin right now?" — false while previewing as a member */
function actingAdmin(){ return isAdmin&&!viewAsMember; }
function tabsFor(){
  if(isAdmin&&!viewAsMember)
    return [['schedule','Roles & Meetings'],['agenda','Agenda'],['voting','Voting'],['members','Members'],['dcp','DCP Goals'],['me','My Profile'],['settings','Settings'],['practice','🧪 Practice']];
  const t=[['book','Book a Role'],['me','My Profile']];
  if(state&&vcMeetings().length){ t.push(['voting','Vote Counter']); t.push(['practice','🧪 Practice']); }
  return t;
}
/* A live update (someone votes, a candidate is added) rebuilds the whole tab,
   which throws away the sideways scroll on the vote table. Carry it over. */
function grabScroll(){
  const m={};
  document.querySelectorAll('#main .tblwrap[data-scroll]').forEach(el=>{
    if(el.scrollLeft)m[el.dataset.scroll]=el.scrollLeft;
  });
  return m;
}
function putScroll(m){
  document.querySelectorAll('#main .tblwrap[data-scroll]').forEach(el=>{
    const v=m[el.dataset.scroll]; if(v)el.scrollLeft=v;
  });
}
/* Rebuilding #main while a native <select> picker is open snaps it shut, so a
   vote landing mid-scroll would close the Vote Counter's candidate list under
   the officer's thumb. Hold the redraw until they're done with it. */
let liveTimer=null;
function pickerOpen(){
  const ae=document.activeElement;
  return !!(ae&&ae.tagName==='SELECT'&&ae.closest('#main'));
}
/* Polled rather than hung off blur/focusout: dismissing a native picker without
   choosing doesn't reliably fire either one, and a redraw that never arrives is
   worse than one that arrives a moment late. */
function renderLive(){
  if(!pickerOpen()){ render(); return; }
  clearInterval(liveTimer);
  liveTimer=setInterval(()=>{ if(!pickerOpen())render(); },300);
}
function render(){
  clearInterval(liveTimer);
  const keepScroll=grabScroll();
  document.getElementById('hClub').textContent=state.settings.clubName||'Toastmasters Club';
  document.getElementById('uName').textContent=(me?me.name:'')+(isAdmin?(viewAsMember?' (member view)':' (admin)'):'');
  const va=document.getElementById('viewAs');
  if(va){ va.style.display=isAdmin?'':'none'; va.textContent=viewAsMember?'← Back to admin':'👁 View as member'; }
  const TABS=tabsFor();
  if(!TABS.some(([id])=>id===tab))tab=TABS[0][0];
  document.getElementById('tabs').innerHTML=TABS.map(([id,label])=>
    (id==='practice'?'<span class="tabbreak"></span>':'')+
    `<button class="${tab===id?'on':''}${id==='practice'?' practice':''}" onclick="setTab('${id}')">${label}</button>`).join('');
  const main=document.getElementById('main');
  if(tab==='schedule')main.innerHTML=noticesHtml()+winnersBoardHtml()+annManagerHtml()+viewSchedule();
  else if(tab==='agenda'){ AgendaApp.mount(main); return; }
  else if(tab==='voting')main.innerHTML=viewVoting();
  else if(tab==='members')main.innerHTML=viewMembers();
  else if(tab==='dcp')main.innerHTML=viewDCP();
  else if(tab==='settings')main.innerHTML=viewSettings();
  else if(tab==='book')main.innerHTML=congratsHtml()+noticesHtml()+openVoteCardsHtml()+winnersBoardHtml()+viewBook();
  else if(tab==='me')main.innerHTML=congratsHtml()+noticesHtml()+viewMe();
  else if(tab==='practice')main.innerHTML=viewPractice();
  putScroll(keepScroll);
}
function setTab(t){ tab=t; try{localStorage.setItem('lastTab',t);}catch(e){} render(); window.scrollTo(0,0); }

/* ================= NOTICES: birthdays + announcements ================= */
function fmtMD(v){ return v?`${MD_MONTHS[Number(v.slice(0,2))-1]} ${Number(v.slice(3))}`:'not set'; }
function fmtWhen(ts){
  try{
    const d=new Date(ts),mins=Math.round((Date.now()-d)/60000);
    if(mins<60)return mins<=1?'just now':mins+' min ago';
    if(mins<1440)return Math.round(mins/60)+'h ago';
    return d.toLocaleDateString(undefined,{day:'numeric',month:'short'});
  }catch(e){ return ''; }
}
function bcSeen(id){
  const r=S.birthdayChanges.find(b=>b.id===id); if(r)r.seen=true;
  sync(api.markBcSeen(id));
  render();
}
function noticesHtml(){
  let html='';
  /* birthday edits by members — admins are told, so nobody can quietly
     move their date to line up with the next meeting's cake */
  if(isAdmin&&!viewAsMember){
    for(const c of S.birthdayChanges.filter(c=>!c.seen&&!c.by_admin).sort((a,b)=>a.changed_at<b.changed_at?1:-1)){
      const mem=memberById(c.profile_id);
      html+=`<div class="banner" style="border-color:var(--maroon)">
        <strong>🎂 Birthday changed:</strong> ${esc(mem?mem.name:'A member')} set their birthday
        from <b>${fmtMD(c.old_value)}</b> to <b>${fmtMD(c.new_value)}</b>
        <span class="muted small">· ${fmtWhen(c.changed_at)}</span>
        <button class="btn ghost small" style="float:right" onclick="bcSeen('${c.id}')">✓ noted</button>
      </div>`;
    }
  }
  /* announcements — admin-posted, shown to everyone until removed */
  for(const a of [...S.announcements].sort((x,y)=>x.created_at<y.created_at?1:-1))
    html+=`<div class="banner" style="background:var(--gold-soft);border-color:var(--gold)">
      <strong>📣</strong> ${esc(a.text)}
      ${isAdmin&&!viewAsMember?` <button class="btn ghost small" style="float:right" onclick="annDel('${a.id}')">✕ remove</button>`:''}
    </div>`;
  /* birthdays today */
  const todayMD=todayStr().slice(5);
  const bd=state.members.filter(x=>!x.archived&&x.birthday);
  for(const x of bd.filter(x=>x.birthday===todayMD)){
    if(x.id===me.profileId)
      html+=`<div class="banner" style="background:var(--gold-soft);border-color:var(--gold)"><strong>🎂 Happy Birthday, ${esc(x.name)}!</strong> The whole club wishes you a fantastic year ahead. 🥳</div>`;
    else
      html+=`<div class="banner"><strong>🎂 It's ${esc(x.name)}'s birthday today!</strong> Send them your wishes. 🥳</div>`;
  }
  /* admin cake reminder: birthdays falling since the last meeting up to the
     next one, shown from 4 days before that meeting through meeting day */
  if(isAdmin&&!viewAsMember){
    const t=todayStr();
    const nm=state.meetings.filter(m=>!m.cancelled&&m.date>=t).sort((a,b)=>a.date<b.date?-1:1)[0];
    if(nm){
      const prev=state.meetings.filter(m=>!m.cancelled&&m.date<nm.date).sort((a,b)=>a.date<b.date?1:-1)[0];
      const start=prev?parseD(prev.date):(()=>{const d=parseD(nm.date);d.setDate(d.getDate()-7);return d;})();
      const end=parseD(nm.date);
      const inWindow=md=>{
        for(const y of [start.getFullYear(),end.getFullYear()]){
          const d=parseD(y+'-'+md);
          if(d>start&&d<=end)return true;
        }
        return false;
      };
      const celebrate=bd.filter(x=>inWindow(x.birthday));
      const daysToMeeting=(end-parseD(t))/86400000;
      if(celebrate.length&&daysToMeeting<=4)
        html+=`<div class="banner" style="border-color:var(--maroon)"><strong>🍰 Cake alert for ${fmtDate(nm.date)}:</strong>
          ${celebrate.map(x=>`<b>${esc(x.name)}</b> (${MD_MONTHS[Number(x.birthday.slice(0,2))-1]} ${Number(x.birthday.slice(3))})`).join(', ')}
          — birthday${celebrate.length>1?'s':''} to celebrate at the meeting. Arrange the cake! 🎂</div>`;
    }
  }
  return html;
}
function annManagerHtml(){
  return `<div class="card sub no-print">
    <div class="row">
      <input type="text" id="annText" class="grow" placeholder="📣 Post an announcement to all members (e.g. TM Ali became Area Director! 🎊)" style="min-width:260px">
      <button class="btn small" onclick="annAdd()">Post</button>
    </div>
    <p class="small muted" style="margin:6px 0 0">Announcements banner at the top of every member's app until you remove them (✕ on the banner).</p>
  </div>`;
}
async function annAdd(){
  const inp=document.getElementById('annText'); const text=inp.value.trim();
  if(!text){toast('Write the announcement first');return;}
  try{ const row=await api.addAnnouncement(text); S.announcements.push(row); render(); toast('Posted 📣'); }
  catch(e){ toast('Could not post: '+(e.message||e)); }
}
function annDel(id){
  S.announcements=S.announcements.filter(a=>a.id!==id);
  sync(api.delAnnouncement(id));
  render();
}

/* ================= VOTING (Vote Counter tool + winners) ================= */
function isVCFor(m){ return ((m.assignments||{})['vc|0']||{}).memberId===me.profileId; }
function vcMeetings(){
  const lo=new Date(); lo.setDate(lo.getDate()-2);
  const hi=new Date(); hi.setDate(hi.getDate()+14);
  const loS=dstr(lo),hiS=dstr(hi);
  /* actingAdmin(), not isAdmin — while previewing as a member the tab must
     appear only if you actually hold the Vote Counter role */
  return state.meetings.filter(m=>!m.cancelled&&m.date>=loS&&m.date<=hiS&&(actingAdmin()||isVCFor(m)));
}
function pollsFor(mid){ return S.polls.filter(p=>p.meeting_id===mid); }
/* app votes exclude members currently marked as paper voters — their stored
   vote is set aside, and counts again if they're unmarked */
function appVotes(p){
  const t={}; for(const c of (p.candidates||[]))t[c.key]=0;
  const paper=new Set(p.paper_voters||[]);
  for(const v of S.votes)if(v.poll_id===p.id&&!paper.has(v.voter)&&t[v.candidate_key]!=null)t[v.candidate_key]++;
  return t;
}
function pollTally(p){
  const app=appVotes(p); const t={};
  for(const c of (p.candidates||[]))t[c.key]=Number((p.adjust||{})[c.key]||0)+app[c.key];
  return t;
}
function myVoteKey(p){ const v=S.votes.find(v=>v.poll_id===p.id&&v.voter===me.profileId); return v?v.candidate_key:null; }
function winnerName(p){ const c=(p.candidates||[]).find(c=>c.key===p.winner_key); return c?c.name:'—'; }
function latestWinners(){
  const byM={};
  for(const p of S.polls)if(p.status==='closed'&&p.winner_key)(byM[p.meeting_id]=byM[p.meeting_id]||[]).push(p);
  const withPolls=state.meetings.filter(m=>byM[m.id]&&!m.cancelled);
  /* most recent past/today meeting with winners; else (votes closed early /
     testing ahead of the date) the nearest upcoming one that has winners */
  const past=withPolls.filter(m=>m.date<=todayStr()).sort((a,b)=>a.date<b.date?1:-1);
  if(past.length)return {meeting:past[0],polls:byM[past[0].id]};
  const fut=withPolls.filter(m=>m.date>todayStr()).sort((a,b)=>a.date<b.date?-1:1);
  return fut.length?{meeting:fut[0],polls:byM[fut[0].id]}:null;
}
function winnersBoardHtml(){
  const lw=latestWinners(); if(!lw)return '';
  return `<div class="card" style="border-color:var(--gold)">
    <h3 style="margin:0 0 6px">🏆 Winners — ${fmtDate(lw.meeting.date)}</h3>
    ${lw.polls.map(p=>`<span class="chip gold">${esc(p.category)}: <b>${esc(winnerName(p))}</b></span>`).join(' ')}
  </div>`;
}
function congratsHtml(){
  const today=parseD(todayStr()); let html='';
  for(const p of S.polls){
    if(p.status!=='closed'||!p.winner_key)continue;
    const c=(p.candidates||[]).find(c=>c.key===p.winner_key);
    if(!c||c.profileId!==me.profileId)continue;
    const m=state.meetings.find(m=>m.id===p.meeting_id); if(!m)continue;
    const days=(today-parseD(m.date))/86400000;
    if(days>=-7&&days<=5)   /* also covers votes closed before the meeting date */
      html+=`<div class="banner" style="background:var(--gold-soft);border-color:var(--gold)">
        <strong>🎉 Congratulations!</strong> You were <b>${esc(p.category)}</b> at the ${fmtDate(m.date)} meeting. Keep it up! 👏
      </div>`;
  }
  return html;
}
const STANDARD_CATS=['Best Table Topics','Best Speaker','Best Evaluator','Best Facilitator','Best of Big 3'];
let vcSelMeeting=null, tieState={};
/* VC may open voting only on the meeting day, from 5:00 AM (admins any time) */
function canOpenVoting(m){
  if(actingAdmin())return true;
  return m.date===todayStr()&&new Date().getHours()>=5;
}
function prefillCandidates(m,cat){
  const list=[];
  const add=pid=>{ const mem=memberById(pid); if(mem&&!list.some(c=>c.key===pid))list.push({key:pid,name:mem.name,profileId:pid}); };
  const addSlots=re=>{ for(const [k,a] of Object.entries(m.assignments))if(re.test(k)&&a.memberId)add(a.memberId); };
  if(/big ?3/i.test(cat)) addSlots(/^(tmod|ttm|ge)\|/);
  else if(/facilitator/i.test(cat)) addSlots(/^(timer|vc|gram|al|ah|jm)\|/);
  else{
    if(/speaker/i.test(cat)&&!/table/i.test(cat)) addSlots(/^spk\|/);
    if(/evaluator/i.test(cat)) addSlots(/^(eval|tte)\|/);
  }
  return list;
}
function viewVoting(){
  const ms=vcMeetings();
  if(!ms.length)return `<h2>Voting</h2><div class="empty">No meeting in range where you're the Vote Counter.</div>`;
  if(!vcSelMeeting||!ms.some(m=>m.id===vcSelMeeting))vcSelMeeting=(ms.find(m=>m.date===todayStr())||ms[0]).id;
  const m=ms.find(x=>x.id===vcSelMeeting);
  const polls=pollsFor(m.id);
  let html=`<h2>🗳 Vote Counter</h2>
  <div class="row" style="margin-bottom:10px">
    <label class="small muted">Meeting</label>
    <select style="width:auto" onchange="vcPick(this.value)">
      ${ms.map(x=>`<option value="${x.id}" ${x.id===vcSelMeeting?'selected':''}>${fmtDate(x.date)}</option>`).join('')}
    </select>
  </div>
  <p class="small muted">Open a category, members vote from their phones, and the count is live. “Paper” adds the manual votes from the room — the app and paper ballots combine. Closing announces the winner (you break any tie).</p>`;
  /* officers only ever saw the tally, never a ballot — their own vote lives on
     the member Book tab, which admins do not have */
  html+=openVoteCardsHtml();
  for(const p of polls)html+=vcPollCard(p);
  const open=new Set(polls.map(p=>p.category));
  const starters=STANDARD_CATS.filter(c=>!open.has(c));
  if(canOpenVoting(m)){
    html+=`<div class="card sub"><div class="row">
      ${starters.map(c=>`<button class="btn small" onclick="startPoll('${m.id}','${esc(c)}')">＋ ${esc(c)} vote</button>`).join('')}
      <input type="text" id="customCat" placeholder="Custom category" style="max-width:180px">
      <button class="btn ghost small" onclick="startPoll('${m.id}',document.getElementById('customCat').value.trim())">＋ Start</button>
    </div>${isAdmin&&!viewAsMember&&m.date!==todayStr()?'<p class="small muted" style="margin:6px 0 0">Admins can open voting any time; the Vote Counter can only open it on the meeting day, from 5:00 am.</p>':''}</div>`;
  }else{
    html+=`<div class="card sub"><span class="muted">🕔 Voting can be opened on the meeting day (${fmtDate(m.date)}), starting 5:00 am. Come back then!</span></div>`;
  }
  return html;
}
/* Long roster names overflow the Vote Counter's table on a phone. This shortens
   them for DISPLAY ONLY — the stored candidate name, the winner record and the
   pick-a-candidate dropdowns all keep the full spelling, so nobody has to guess
   who "M. Ahsan W." is when they're looking for someone in the list.
   Muhammad Ahsan Waheed -> M. Ahsan Waheed -> M. Ahsan W. */
const VC_NAME_MAX=18;
function vcShortName(name){
  const full=String(name||'').trim();
  if(full.length<=VC_NAME_MAX)return full;
  const parts=full.split(/\s+/);
  if(parts.length<2)return full;
  const ini=w=>/^[A-Za-z]/.test(w)?w[0].toUpperCase()+'.':w;   /* leaves "$undas" alone */
  const out=[...parts], join=()=>out.join(' ');
  out[0]=ini(out[0]);
  if(join().length<=VC_NAME_MAX)return join();
  out[out.length-1]=ini(out[out.length-1]);
  if(join().length<=VC_NAME_MAX)return join();
  for(let i=1;i<out.length-1;i++){       /* four-part names: initial the middles too */
    out[i]=ini(out[i]);
    if(join().length<=VC_NAME_MAX)break;
  }
  return join();
}
function vcPollCard(p){
  const app=appVotes(p),total=pollTally(p);
  const tie=tieState[p.id];
  return `<div class="card" ${p.status==='closed'?'style="border-color:var(--good)"':''}>
    <div class="row"><h3 class="grow" style="margin:0">${esc(p.category)}
      ${p.status==='closed'?`<span class="pill done">closed</span> <span class="chip gold" title="${esc(winnerName(p))}">🏆 ${esc(vcShortName(winnerName(p)))}</span>`:'<span class="pill other">voting open</span>'}</h3>
      ${p.status==='open'?`<button class="btn small" onclick="closePoll('${p.id}')">Close voting</button>`
        :`<button class="btn ghost small" onclick="reopenPoll('${p.id}')">Reopen</button>`}
      <button class="btn danger small" onclick="deletePoll('${p.id}')">✕</button>
    </div>
    <div class="tblwrap" data-scroll="poll-${p.id}"><table><thead><tr><th>Candidate</th><th class="num">App votes</th><th class="num">Paper</th><th class="num">Total</th></tr></thead><tbody>
      ${(p.candidates||[]).map(c=>`<tr>
        <td title="${esc(c.name)}">${esc(vcShortName(c.name))} ${p.winner_key===c.key?'🏆':''}
          ${p.status==='open'?`<button class="del no-print" title="Remove this candidate" onclick="removeCandidate('${p.id}','${c.key}')">✕</button>`:''}</td>
        <td class="num">${app[c.key]}</td>
        <td class="num">
          <button class="btn ghost small" onclick="adjustPoll('${p.id}','${c.key}',-1)">−</button>
          ${Number((p.adjust||{})[c.key]||0)}
          <button class="btn ghost small" onclick="adjustPoll('${p.id}','${c.key}',1)">＋</button>
        </td>
        <td class="num"><b>${total[c.key]}</b></td>
      </tr>`).join('')}
    </tbody></table></div>
    ${tie?`<div class="warnline">⚖ It's a tie — pick the winner:
      ${tie.map(k=>{const c=p.candidates.find(c=>c.key===k);return `<button class="btn small" title="${esc(c?c.name:k)}" onclick="finalizePoll('${p.id}','${k}')">${esc(vcShortName(c?c.name:k))}</button>`;}).join(' ')}
    </div>`:''}
    ${p.status==='open'?`<div class="row small" style="margin-top:8px">
      <select style="width:auto" onchange="if(this.value){addCandidate('${p.id}',this.value);}">
        <option value="">＋ Add candidate…</option>
        ${state.members.filter(x=>!x.archived&&!(p.candidates||[]).some(c=>c.profileId===x.id)).map(x=>`<option value="${x.id}">${esc(x.name)}</option>`).join('')}
        <option value="__custom">Custom name…</option>
      </select>
      <span class="muted" style="margin-left:10px">🧾 Voted on paper:</span>
      ${(p.paper_voters||[]).map(pid=>{const mm=memberById(pid);return `<span class="chip bad" title="${esc(mm?mm.name:'?')}">${esc(vcShortName(mm?mm.name:'?'))} <a style="cursor:pointer" onclick="paperVoter('${p.id}','${pid}',false)">✕</a></span>`;}).join('')||'<span class="muted small">none</span>'}
      <select style="width:auto" onchange="if(this.value){paperVoter('${p.id}',this.value,true);}" title="Marked members can't vote in the app for this poll (their app vote, if any, is removed)">
        <option value="">＋ Mark member…</option>
        ${state.members.filter(x=>!x.archived&&x.hasAccount&&!(p.paper_voters||[]).includes(x.id)).map(x=>`<option value="${x.id}">${esc(x.name)}</option>`).join('')}
      </select></div>`:''}
  </div>`;
}
function vcPick(v){ vcSelMeeting=v; render(); }
async function startPoll(mid,cat){
  if(!cat){toast('Give the category a name');return;}
  const m=state.meetings.find(x=>x.id===mid); if(!m)return;
  if(!canOpenVoting(m)){toast('Voting opens on the meeting day at 5:00 am');return;}
  /* the starter buttons already hide a used category, but the custom box can
     still retype one — two polls for the same award would split the vote */
  if(pollsFor(mid).some(p=>p.category.trim().toLowerCase()===cat.trim().toLowerCase())){
    toast('There is already a “'+cat+'” vote for this meeting'); return;
  }
  try{
    const row=await api.createPoll({meeting_id:mid,category:cat,candidates:prefillCandidates(m,cat),adjust:{}});
    S.polls.push(row); render();
  }catch(e){ toast('Could not start: '+(e.message||e)); }
}
async function addCandidate(pollId,v){
  const p=S.polls.find(p=>p.id===pollId); if(!p)return;
  let cand;
  if(v==='__custom'){
    const name=prompt('Candidate name (e.g. a Table Topics guest):'); if(!name){render();return;}
    cand={key:'c'+uid(),name:name.trim(),profileId:null};
  }else{
    const mem=memberById(v); if(!mem)return;
    cand={key:v,name:mem.name,profileId:v};
  }
  p.candidates=[...(p.candidates||[]),cand];
  sync(api.updatePoll(pollId,{candidates:p.candidates}));
  render();
}
function adjustPoll(pollId,key,d){
  const p=S.polls.find(p=>p.id===pollId); if(!p)return;
  p.adjust={...(p.adjust||{}),[key]:Number((p.adjust||{})[key]||0)+d};
  sync(api.updatePoll(pollId,{adjust:p.adjust}));
  render();
}
function closePoll(pollId){
  const p=S.polls.find(p=>p.id===pollId); if(!p)return;
  const t=pollTally(p);
  const max=Math.max(...Object.values(t));
  const top=Object.keys(t).filter(k=>t[k]===max);
  if(top.length===1)finalizePoll(pollId,top[0]);
  else{ tieState[pollId]=top; render(); }
}
function finalizePoll(pollId,key){
  const p=S.polls.find(p=>p.id===pollId); if(!p)return;
  p.status='closed'; p.winner_key=key;
  delete tieState[pollId];
  sync(api.updatePoll(pollId,{status:'closed',winner_key:key}));
  render(); toast('🏆 '+winnerName(p)+' wins '+p.category);
}
function reopenPoll(pollId){
  const p=S.polls.find(p=>p.id===pollId); if(!p)return;
  p.status='open'; p.winner_key=null;
  sync(api.updatePoll(pollId,{status:'open',winner_key:null}));
  render();
}
function deletePoll(pollId){
  const p=S.polls.find(p=>p.id===pollId); if(!p)return;
  if(!confirm('Delete the '+p.category+' vote entirely?'))return;
  S.polls=S.polls.filter(x=>x.id!==pollId);
  S.votes=S.votes.filter(v=>v.poll_id!==pollId);
  sync(api.deletePoll(pollId));
  render();
}
function removeCandidate(pollId,key){
  const p=S.polls.find(p=>p.id===pollId); if(!p)return;
  const c=(p.candidates||[]).find(c=>c.key===key); if(!c)return;
  /* votes for a removed candidate are simply no longer counted — appVotes only
     tallies keys still on the list — so there is nothing to delete server-side */
  const cast=appVotes(p)[key]||0, paper=Number((p.adjust||{})[key]||0);
  const held=cast+paper;
  if(held&&!confirm(`${c.name} already has ${held} vote${held>1?'s':''}.\n\nRemove them anyway? Those votes are discarded.`))return;
  p.candidates=p.candidates.filter(x=>x.key!==key);
  if(p.adjust)delete p.adjust[key];
  sync(api.updatePoll(pollId,{candidates:p.candidates,adjust:p.adjust||{}}));
  render();
}
async function paperVoter(pollId,pid,add){
  const p=S.polls.find(p=>p.id===pollId); if(!p)return;
  const list=new Set(p.paper_voters||[]);
  const hadVote=S.votes.some(v=>v.poll_id===pollId&&v.voter===pid);
  if(add){
    list.add(pid);
    if(hadVote)toast('Their app vote is set aside — count their paper ballot. Unmarking brings the app vote back.');
  } else {
    list.delete(pid);
    if(hadVote)toast('Unmarked — their app vote counts again.');
  }
  p.paper_voters=[...list];
  sync(api.updatePoll(pollId,{paper_voters:p.paper_voters}));
  render();
}
async function castMyVote(pollId,key){
  const p=S.polls.find(p=>p.id===pollId); if(!p||p.status!=='open')return;
  if((p.paper_voters||[]).includes(me.profileId)){toast('You voted on paper for this one — thanks!');return;}
  try{
    await api.castVote(pollId,me.profileId,key);
    const ex=S.votes.find(v=>v.poll_id===pollId&&v.voter===me.profileId);
    if(ex)ex.candidate_key=key; else S.votes.push({poll_id:pollId,voter:me.profileId,candidate_key:key});
    render(); toast('Vote recorded ✓');
  }catch(e){ toast('Could not vote: '+(e.message||e)); }
}
/* Record a winner directly on a (past) meeting — stored as a closed poll so
   the winners board, congratulations and records all use one mechanism. */
async function setWinner(mid,cat,sel){
  const v=sel.value;
  const existing=pollsFor(mid).find(p=>p.category===cat);
  let key=v,name=null,profileId=null;
  if(v==='__custom'){
    const n=prompt('Winner name:'); if(!n){render();return;}
    key='c'+uid(); name=n.trim();
  }else if(v){
    const mem=memberById(v); if(!mem)return;
    name=mem.name; profileId=v;
  }
  try{
    if(!v){
      if(existing){ S.polls=S.polls.filter(p=>p!==existing); sync(api.deletePoll(existing.id)); }
    }else if(existing){
      const cands=[...(existing.candidates||[])];
      if(!cands.some(c=>c.key===key))cands.push({key,name,profileId});
      existing.candidates=cands; existing.status='closed'; existing.winner_key=key;
      sync(api.updatePoll(existing.id,{candidates:cands,status:'closed',winner_key:key}));
    }else{
      const row=await api.createPoll({meeting_id:mid,category:cat,status:'closed',candidates:[{key,name,profileId}],adjust:{},winner_key:key});
      S.polls.push(row);
    }
    render();
  }catch(e){ toast('Could not save winner: '+(e.message||e)); }
}
function openVoteCardsHtml(){
  let html='';
  for(const p of S.polls.filter(p=>p.status==='open')){
    const m=state.meetings.find(m=>m.id===p.meeting_id); if(!m||m.cancelled)continue;
    const mine=myVoteKey(p);
    const onPaper=(p.paper_voters||[]).includes(me.profileId);
    html+=`<div class="card" style="border-color:var(--accent)">
      <h3 style="margin:0 0 6px">🗳 Vote: ${esc(p.category)} <span class="muted small">· ${fmtDate(m.date)}</span></h3>
      <div class="row">
        ${(p.candidates||[]).map(c=>`<button class="btn ${mine===c.key?'good':'ghost'} small" ${onPaper?'disabled':''} onclick="castMyVote('${p.id}','${c.key}')">${mine===c.key?'✓ ':''}${esc(c.name)}</button>`).join('')}
      </div>
      <div class="small muted" style="margin-top:6px">${onPaper?'🧾 You voted on paper for this one — thanks!':(mine?'You can change your vote until voting closes.':'Tap to vote — secret ballot.')}</div>
    </div>`;
  }
  return html;
}

/* ================= PRACTICE: Vote Counter rehearsal =================
   A sandbox so the Vote Counter can rehearse a live count before standing up
   in front of the club. Deliberately a parallel implementation rather than a
   flag threaded through the real one: it holds its own polls, its own made-up
   roster and its own votes, and calls no api.* method at all, so there is no
   code path by which a rehearsal can touch club data. Nothing here is saved
   or shared — a refresh wipes it. */
const PRACTICE_NAMES=['John Carter','David Mills','Sarah Bennett','Emily Hayes','Michael Doyle',
  'Olivia Grant','James Whitfield','Sophia Reynolds','Daniel Foster','Grace Sullivan',
  'Christopher Anderson','Ruth Bell'];
let pMembers=null,pPolls=[],pVotes=[],pTie={},pTrickle=null;
function pRoster(){
  if(!pMembers)pMembers=PRACTICE_NAMES.map((n,i)=>({id:'pm'+i,name:n}));
  return pMembers;
}
function pMemberById(id){ return pRoster().find(m=>m.id===id)||null; }
function pAppVotes(p){
  const t={}; for(const c of p.candidates)t[c.key]=0;
  const paper=new Set(p.paper_voters||[]);
  for(const v of pVotes)if(v.poll_id===p.id&&!paper.has(v.voter)&&t[v.key]!=null)t[v.key]++;
  return t;
}
function pTally(p){
  const app=pAppVotes(p),t={};
  for(const c of p.candidates)t[c.key]=Number((p.adjust||{})[c.key]||0)+app[c.key];
  return t;
}
function pStart(cat){
  cat=(cat||'').trim(); if(!cat){toast('Give the category a name');return;}
  if(pPolls.some(p=>p.category.trim().toLowerCase()===cat.toLowerCase())){
    toast('There is already a “'+cat+'” vote in this practice run'); return;
  }
  /* three random practice members so there is something to count straight away */
  const pool=[...pRoster()].sort(()=>Math.random()-0.5).slice(0,3);
  pPolls.push({id:'pp'+uid(),category:cat,status:'open',winner_key:null,adjust:{},paper_voters:[],
    candidates:pool.map(m=>({key:m.id,name:m.name}))});
  render();
}
function pAdd(pollId,v){
  const p=pPolls.find(x=>x.id===pollId); if(!p)return;
  if(v==='__custom'){
    const name=prompt('Practice candidate name:'); if(!name){render();return;}
    p.candidates.push({key:'pc'+uid(),name:name.trim()});
  } else {
    const m=pMemberById(v); if(!m||p.candidates.some(c=>c.key===m.id)){render();return;}
    p.candidates.push({key:m.id,name:m.name});
  }
  render();
}
function pRemove(pollId,key){
  const p=pPolls.find(x=>x.id===pollId); if(!p)return;
  const c=p.candidates.find(x=>x.key===key); if(!c)return;
  const held=(pAppVotes(p)[key]||0)+Number((p.adjust||{})[key]||0);
  if(held&&!confirm(`${c.name} already has ${held} vote${held>1?'s':''}.\n\nRemove them anyway? Those votes are discarded.`))return;
  p.candidates=p.candidates.filter(x=>x.key!==key);
  if(p.adjust)delete p.adjust[key];
  render();
}
function pAdjust(pollId,key,d){
  const p=pPolls.find(x=>x.id===pollId); if(!p)return;
  p.adjust=p.adjust||{};
  p.adjust[key]=Math.max(0,Number(p.adjust[key]||0)+d);
  render();
}
function pPaper(pollId,pid,add){
  const p=pPolls.find(x=>x.id===pollId); if(!p)return;
  const list=new Set(p.paper_voters||[]);
  add?list.add(pid):list.delete(pid);
  p.paper_voters=[...list];
  render();
}
/* one made-up member votes for a random candidate; re-voting replaces their
   earlier choice, exactly like the real thing */
function pCastOne(pollId){
  const p=pPolls.find(x=>x.id===pollId);
  if(!p||p.status!=='open'||!p.candidates.length)return false;
  const voter=pRoster()[Math.floor(Math.random()*pRoster().length)];
  const cand=p.candidates[Math.floor(Math.random()*p.candidates.length)];
  const ex=pVotes.find(v=>v.poll_id===p.id&&v.voter===voter.id);
  if(ex)ex.key=cand.key; else pVotes.push({poll_id:p.id,voter:voter.id,key:cand.key});
  return true;
}
function pVote(pollId){ if(pCastOne(pollId))render(); }
function pTrickleToggle(pollId){
  if(pTrickle){ clearInterval(pTrickle); pTrickle=null; render(); return; }
  pTrickle=setInterval(()=>{
    const p=pPolls.find(x=>x.id===pollId);
    if(!p||p.status!=='open'){ clearInterval(pTrickle); pTrickle=null; render(); return; }
    pCastOne(pollId); renderLive();     /* same deferred-redraw path as a real vote */
  },1400);
  render();
}
function pClose(pollId){
  const p=pPolls.find(x=>x.id===pollId); if(!p)return;
  const t=pTally(p);
  const best=Math.max(0,...Object.values(t));
  const top=Object.keys(t).filter(k=>t[k]===best);
  if(!best){ toast('No votes yet — cast a few first'); return; }
  if(top.length>1){ pTie[p.id]=top; toast('Tie — pick the winner'); render(); return; }
  delete pTie[p.id]; p.status='closed'; p.winner_key=top[0]; render();
}
function pFinalize(pollId,key){
  const p=pPolls.find(x=>x.id===pollId); if(!p)return;
  delete pTie[p.id]; p.status='closed'; p.winner_key=key; render();
}
function pReopen(pollId){
  const p=pPolls.find(x=>x.id===pollId); if(!p)return;
  p.status='open'; p.winner_key=null; render();
}
function pDelete(pollId){
  pPolls=pPolls.filter(x=>x.id!==pollId);
  pVotes=pVotes.filter(v=>v.poll_id!==pollId);
  render();
}
function pReset(){
  if(pPolls.length&&!confirm('Clear the whole practice run and start fresh?'))return;
  if(pTrickle){ clearInterval(pTrickle); pTrickle=null; }
  pPolls=[]; pVotes=[]; pTie={}; render();
}
function pPollCard(p){
  const app=pAppVotes(p),total=pTally(p),tie=pTie[p.id];
  const wname=(p.candidates.find(c=>c.key===p.winner_key)||{}).name||'—';
  return `<div class="card" ${p.status==='closed'?'style="border-color:var(--good)"':''}>
    <div class="row"><h3 class="grow" style="margin:0">${esc(p.category)}
      ${p.status==='closed'?`<span class="pill done">closed</span> <span class="chip gold" title="${esc(wname)}">🏆 ${esc(vcShortName(wname))}</span>`:'<span class="pill other">voting open</span>'}</h3>
      ${p.status==='open'?`<button class="btn small" onclick="pClose('${p.id}')">Close voting</button>`
        :`<button class="btn ghost small" onclick="pReopen('${p.id}')">Reopen</button>`}
      <button class="btn danger small" onclick="pDelete('${p.id}')">✕</button>
    </div>
    <div class="tblwrap" data-scroll="prac-${p.id}"><table><thead><tr><th>Candidate</th><th class="num">App votes</th><th class="num">Paper</th><th class="num">Total</th></tr></thead><tbody>
      ${p.candidates.map(c=>`<tr>
        <td title="${esc(c.name)}">${esc(vcShortName(c.name))} ${p.winner_key===c.key?'🏆':''}
          ${p.status==='open'?`<button class="del no-print" title="Remove this candidate" onclick="pRemove('${p.id}','${c.key}')">✕</button>`:''}</td>
        <td class="num">${app[c.key]}</td>
        <td class="num">
          <button class="btn ghost small" onclick="pAdjust('${p.id}','${c.key}',-1)">−</button>
          ${Number((p.adjust||{})[c.key]||0)}
          <button class="btn ghost small" onclick="pAdjust('${p.id}','${c.key}',1)">＋</button>
        </td>
        <td class="num"><b>${total[c.key]}</b></td>
      </tr>`).join('')}
    </tbody></table></div>
    ${tie?`<div class="warnline">⚖ It's a tie — pick the winner:
      ${tie.map(k=>{const c=p.candidates.find(c=>c.key===k);return `<button class="btn small" title="${esc(c?c.name:k)}" onclick="pFinalize('${p.id}','${k}')">${esc(vcShortName(c?c.name:k))}</button>`;}).join(' ')}
    </div>`:''}
    ${p.status==='open'?`<div class="row small" style="margin-top:8px">
      <button class="btn ghost small" onclick="pVote('${p.id}')">🗳 Cast a vote</button>
      <button class="btn ${pTrickle?'good':'ghost'} small" onclick="pTrickleToggle('${p.id}')">${pTrickle?'⏸ Stop live votes':'▶ Votes rolling in'}</button>
      <select style="width:auto" onchange="if(this.value){pAdd('${p.id}',this.value);}">
        <option value="">＋ Add candidate…</option>
        ${pRoster().filter(m=>!p.candidates.some(c=>c.key===m.id)).map(m=>`<option value="${m.id}">${esc(m.name)}</option>`).join('')}
        <option value="__custom">Custom name…</option>
      </select>
      <span class="muted" style="margin-left:10px">🧾 Voted on paper:</span>
      ${(p.paper_voters||[]).map(pid=>{const mm=pMemberById(pid);return `<span class="chip bad" title="${esc(mm?mm.name:'?')}">${esc(vcShortName(mm?mm.name:'?'))} <a style="cursor:pointer" onclick="pPaper('${p.id}','${pid}',false)">✕</a></span>`;}).join('')||'<span class="muted small">none</span>'}
      <select style="width:auto" onchange="if(this.value){pPaper('${p.id}',this.value,true);}">
        <option value="">＋ Mark member…</option>
        ${pRoster().filter(m=>!(p.paper_voters||[]).includes(m.id)).map(m=>`<option value="${m.id}">${esc(m.name)}</option>`).join('')}
      </select></div>`:''}
  </div>`;
}
function viewPractice(){
  return `<h2>🧪 Practice — Vote Counter</h2>
  <div class="banner practice-banner">
    <strong>Practice mode.</strong> Made-up names, made-up votes. Nothing here is saved, nothing
    is shared with the club, and no real vote is affected. Rehearse as often as you like —
    a refresh clears it.
  </div>
  <div class="card sub">
    <p class="small muted" style="margin:0 0 8px">Open a category, then either tap <b>Cast a vote</b> yourself or
    let <b>Votes rolling in</b> trickle them in the way phones do on the night. Close the voting to see
    the winner — force a tie by keeping the totals level and you'll get the tie-break too.</p>
    <div class="row">
      ${STANDARD_CATS.filter(c=>!pPolls.some(p=>p.category===c))
        .map(c=>`<button class="btn small" onclick="pStart('${c}')">＋ ${c}</button>`).join('')
        ||'<span class="muted small">All five categories are running — close or clear one to start it again.</span>'}
    </div>
    <div class="row" style="margin-top:8px">
      <input type="text" id="pCat" class="grow" placeholder="Custom category" style="max-width:260px">
      <button class="btn small" onclick="pStart(document.getElementById('pCat').value)">＋ Start</button>
      <span class="grow"></span>
      <button class="btn ghost small" onclick="pReset()">↺ Clear practice run</button>
    </div>
  </div>
  ${pPolls.map(pPollCard).join('')||'<div class="empty">No practice votes yet — start a category above.</div>'}`;
}

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
        <input type="text" style="max-width:280px" class="grow" placeholder="meaning" value="${esc((m.wod||{}).def||'')}" onchange="setWod('${m.id}','def',this.value)">
        <input type="text" style="max-width:320px" class="grow" placeholder="example sentence" value="${esc((m.wod||{}).sent||'')}" onchange="setWod('${m.id}','sent',this.value)">
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
    /* stamped locally too, so give-way order is right straight away rather than
       only after the next full load (the DB default is authoritative) */
    S.assignments.push({meeting_id:mid,slot_key:key,profile_id:me.profileId,status:'booked',actual_role:null,booked_at:new Date().toISOString()});
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
function lvlChipsFor(cl){
  return `<span class="lvl">${[1,2,3,4,5].map(l=>`<span class="${l<=cl?'done':''}">${l}</span>`).join('')}</span>`;
}
function lvlChips(mem){ return lvlChipsFor(currentLevel(mem)); }
function pathSummary(mem){
  const ps=memPaths(mem);
  if(!ps.length)return '<span class="muted small">no path set</span>';
  return ps.map(pe=>`<span class="chip ${pe.done?'good':''}">${esc(pe.name)} ${pe.done?'🎓':'L'+pathLevel(mem,pe)}</span>`).join('');
}
/* Pathways editor — used on the admin member card and on My Profile */
function pathsBlock(mem){
  const ps=memPaths(mem);
  const rows=ps.map((pe,i)=>{
    const lv=pathLevel(mem,pe);
    return `<div class="row small" style="padding:5px 0;border-bottom:1px dashed var(--line)">
      <b class="grow" style="min-width:150px">${esc(pe.name)}</b>
      ${pe.done?'<span class="pill done">completed 🎓</span>':lvlChipsFor(lv)}
      ${pe.done?'':`
        <label class="muted">start level</label>
        <input type="number" min="0" max="5" value="${pe.baseLevel||0}" onchange="pathField('${mem.id}',${i},'baseLevel',Number(this.value))">
        <label class="muted">projects in L${Math.min(lv+1,5)}</label>
        <input type="number" min="0" max="9" value="${pe.projectsDone||0}" onchange="pathField('${mem.id}',${i},'projectsDone',Number(this.value))">`}
      <button class="btn ghost small" onclick="pathToggleDone('${mem.id}',${i})">${pe.done?'reopen':'mark completed 🎓'}</button>
      <button class="btn ghost small" onclick="pathDel('${mem.id}',${i})">✕</button>
    </div>`;
  }).join('')||'<div class="muted small">no pathway yet</div>';
  const avail=PATHS.filter(p=>!ps.some(x=>x.name===p));
  return `<div class="sect"><h3>Pathways <span class="muted small">(a member can work more than one)</span></h3>
    ${rows}
    ${avail.length?`<div class="row" style="margin-top:8px">
      <select id="np-${mem.id}" style="width:auto">${avail.map(p=>`<option>${p}</option>`).join('')}</select>
      <button class="btn small" onclick="pathAdd('${mem.id}')">＋ Add pathway</button>
    </div>`:''}
  </div>`;
}
function pathsUpdate(memId,fn){
  const mem=memberById(memId); if(!mem)return;
  const paths=JSON.parse(JSON.stringify(memPaths(mem)));
  fn(paths);
  const p=S.profiles.find(p=>p.id===memId); if(p)p.paths=paths;
  sync(api.updateProfile(memId,{paths}));
  rebuild(); render(); keepOpen(memId);
}
function pathAdd(memId){
  const sel=document.getElementById('np-'+memId); if(!sel||!sel.value)return;
  pathsUpdate(memId,ps=>ps.push({name:sel.value,baseLevel:0,projectsDone:0,done:false}));
  toast('Pathway added');
}
function pathDel(memId,i){
  const mem=memberById(memId); const pe=memPaths(mem)[i]; if(!pe)return;
  if(!confirm('Remove "'+pe.name+'" from '+mem.name+'? Recorded level completions stay in their history.'))return;
  pathsUpdate(memId,ps=>ps.splice(i,1));
}
function pathField(memId,i,k,v){ pathsUpdate(memId,ps=>{ if(ps[i])ps[i][k]=v; }); }
function pathToggleDone(memId,i){
  pathsUpdate(memId,ps=>{ if(ps[i])ps[i].done=!ps[i].done; });
  toast('Pathway status updated');
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
    <div class="row"><span class="mname">${esc(mem.name)}</span> ${pathSummary(mem)}</div>
    <div class="row" style="margin-top:10px">
      <div><label class="small muted">My name (as it appears on agendas)</label><br>
        <input type="text" value="${esc(mem.name)}" style="max-width:240px" onchange="meSet('name',this.value)"></div>
      <div><label class="small muted">🎂 Birthday (optional — the club will wish you)</label><br>
        ${bdaySelects(mem.id,mem.birthday)}</div>
    </div>
    ${pathsBlock(mem)}
    <div class="sect"><h3>Level completions</h3>
      ${(mem.awards||[]).map(a=>`<span class="chip gold">${a.path?esc(a.path)+' · ':''}Level ${esc(a.level)} · ${fmtDate(a.date)}</span>`).join('')||'<span class="muted small">none recorded yet — completions are recorded by the officers</span>'}
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
    <div class="sect"><h3>💡 Suggestions for the club</h3>
      <p class="small muted">Anything that would make club life better — an idea, a gripe, a request. Officers read every one and you'll see what happened to it here.</p>
      <textarea id="sugText" rows="2" placeholder="e.g. Could we start Table Topics a bit earlier?" style="width:100%;max-width:520px"></textarea>
      <div class="row" style="margin-top:6px">
        <label class="small"><input type="checkbox" id="sugAnon"> Hide my name in the officers' list</label>
        <button class="btn small" onclick="sugAdd()">Send to officers</button>
      </div>
      ${mySuggestionsHtml(mem.id)}
    </div>
    <div class="sect"><h3>🔑 Password</h3>
      <div class="row">
        <div class="pwwrap" style="max-width:240px;flex:1">
          <input type="password" id="meNewPw" autocomplete="new-password" minlength="6" placeholder="New password (min 6)">
          <button type="button" class="pweye" id="meNewPwEye" aria-label="Show password" aria-pressed="false" title="Show password">👁</button>
        </div>
        <button class="btn small" onclick="meChangePw()">Change password</button>
      </div>
    </div>
    <div class="sect"><h3>Roles I've completed</h3>${roleChips}
      ${abs[mem.id]?`<div class="small muted" style="margin-top:4px">absences: ${abs[mem.id]}</div>`:''}</div>
  </div>`;
}
async function meChangePw(){
  const inp=document.getElementById('meNewPw'); if(!inp)return;
  const pw=inp.value;
  if(pw.length<6){ toast('Please use at least 6 characters'); return; }
  try{ await api.updatePassword(pw); inp.value=''; toast('Password changed'); }
  catch(e){ toast('Could not change it: '+(e.message||e)); }
}
function meSet(k,v){
  const mem=memberById(me.profileId); if(!mem)return;
  if(k==='name'){ v=String(v).trim(); if(!v){toast('Name cannot be empty');render();return;} }
  mem[k]=v;
  const p=S.profiles.find(p=>p.id===me.profileId);
  const col={path:'path',projectsDone:'projects_done',birthday:'birthday',name:'name'}[k];
  if(p&&col)p[col]=v;
  sync(api.updateProfile(me.profileId,{[col]:v}));
  if(k==='name'){ me.name=v; toast('Name updated'); }
  render();
}
/* birthday month/day selects, shared by My Profile and admin member cards */
const MD_MONTHS=['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
function bdaySelects(pid,val){
  const [mm,dd]=(val||'').split('-');
  return `<select id="bm-${pid}" style="width:auto" onchange="bdaySet('${pid}')"><option value="">— month —</option>
      ${MD_MONTHS.map((n,i)=>{const v=String(i+1).padStart(2,'0');return `<option value="${v}" ${mm===v?'selected':''}>${n}</option>`;}).join('')}</select>
    <select id="bd-${pid}" style="width:auto" onchange="bdaySet('${pid}')"><option value="">— day —</option>
      ${Array.from({length:31},(_,i)=>{const v=String(i+1).padStart(2,'0');return `<option value="${v}" ${dd===v?'selected':''}>${i+1}</option>`;}).join('')}</select>`;
}
function bdaySet(pid){
  const m=document.getElementById('bm-'+pid).value,d=document.getElementById('bd-'+pid).value;
  if((m&&!d)||(!m&&d))return;   /* half-chosen: wait for the other select — saving now would re-render and wipe it */
  const v=(m&&d)?m+'-'+d:null;
  if(pid===me.profileId)meSet('birthday',v);
  else setMem(pid,'birthday',v);
  toast(v?'Birthday saved 🎂':'Birthday cleared');
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
  const up=upcomingMeetings(ADMIN_HORIZON);
  let html=`<h2>Next ${up.length} meeting${up.length===1?'':'s'} — book roles</h2>
  <p class="small muted" style="margin:-6px 0 10px">Members see the next ${MEMBER_HORIZON} of these; you see further ahead so bookings can be moved between meetings.</p>
  ${lastMove?`<div class="warnline">⏩ Moved <b>${esc(lastMove.label)}</b> forward.
    <button class="btn ghost small" onclick="undoMove()">↩ Undo</button></div>`:''}`;
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
  for(const [key,a] of Object.entries(m.assignments||{})){
    if(!a||!a.memberId)continue;
    if(UNTRACKED_ROLES.includes(key.split('|')[0]))continue;  /* SAA/PO alongside another role is normal */
    counts[a.memberId]=(counts[a.memberId]||0)+1;
  }
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
      <label style="display:flex;gap:6px;align-items:center;margin-left:14px"
             title="Run the Prepared Speech Session before Table Topics on the agenda">
        <input type="checkbox" ${speechFirstOn(m)?'checked':''} onchange="setMeetingOrder('${m.id}',this.checked)"> 🔁 Speeches first
      </label>
    </div>
    <div class="row small" style="margin-top:6px">
      <label class="muted">📖 Word of the Day</label>
      <input type="text" style="max-width:130px" placeholder="word" value="${esc((m.wod||{}).word||'')}" onchange="setWod('${m.id}','word',this.value)">
      <input type="text" style="max-width:280px" class="grow" placeholder="meaning" value="${esc((m.wod||{}).def||'')}" onchange="setWod('${m.id}','def',this.value)">
      <input type="text" style="max-width:320px" class="grow" placeholder="example sentence" value="${esc((m.wod||{}).sent||'')}" onchange="setWod('${m.id}','sent',this.value)">
      <span class="muted">(the meeting's Grammarian can also set this; TMOD can set the theme)</span>
    </div>
    <div class="grid-roles">
      ${slots.map(s=>{
        const a=(m.assignments||{})[s.key];
        const rid=ridOf(s.key);
        const canDefer=deferrable(rid)&&a&&a.memberId;
        /* surface the queue: whoever gives way first for this role, and when
           each booking was made (blank until booked_at exists in the table) */
        const group=canDefer?bookingsByGiveWay(m,rid):[];
        const isNext=group.length>1&&group[0].key===s.key;
        const at=canDefer?bookedAt(m.id,s.key):null;
        const when=at?`booked ${new Date(at).toLocaleString(undefined,{day:'numeric',month:'short',hour:'2-digit',minute:'2-digit'})}`
                     :'booking time not recorded yet';
        return `<div class="slot"><label>${esc(s.label)}${isNext?` <span class="pill other" title="Booked last of the ${esc(roleNameById(rid))}s — gives way first">gives way</span>`:''}${canDefer?`
            <button class="btn ghost small" style="float:right;padding:0 6px"
              title="Move to a later meeting — ${esc(when)}" onclick="deferBooking('${m.id}','${s.key}')">⏩</button>`:''}</label>
          <select ${canDefer?`title="${esc(when)}"`:''} onchange="assign('${m.id}','${s.key}',this)">${memberOptions(a&&a.memberId)}</select></div>`;
      }).join('')}
    </div>
    ${dupes.length?`<div class="warnline">⚠ Double-booked in this meeting: ${dupes.map(esc).join(', ')}</div>`:''}
  </div>`;
}
/* Attendance is opt-out: everyone is present until someone says otherwise, so
   an unreviewed meeting never quietly records the whole club as missing. */
function attendanceHtml(m){
  const roster=state.members.filter(x=>!x.archived&&!x.external)
    .sort((a,b)=>a.name.localeCompare(b.name));
  const away=absentList(m);
  return `<details class="card sub" style="margin-top:8px" ${away.length?'open':''}>
    <summary class="small" style="cursor:pointer"><b>🙋 Attendance</b>
      ${away.length?`<span class="pill absent">${away.length} absent</span>`
                   :'<span class="muted">everyone marked present</span>'}</summary>
    <p class="small muted" style="margin:6px 0">Untick anyone who wasn't there. Everybody counts as present unless you untick them.</p>
    <div class="grid-roles">
      ${roster.map(x=>`<label class="small" style="display:flex;gap:6px;align-items:center">
        <input type="checkbox" ${isAbsent(m,x.id)?'':'checked'} onchange="setPresent('${m.id}','${x.id}',this.checked)">
        <span style="${isAbsent(m,x.id)?'color:var(--muted);text-decoration:line-through':''}">${esc(x.name)}</span>
      </label>`).join('')}
    </div>
    ${away.length?`<div class="row" style="margin-top:6px"><button class="btn ghost small" onclick="markAllPresent('${m.id}')">Everyone was here</button></div>`:''}
  </details>`;
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
      /* a delivered speech is a Pathways project — but only the officer knows
         which pathway it belongs to when the member is working more than one */
      const isSpeech=/^spk\|/.test(key)&&st==='done';
      const credited=((m.config||{}).credited||{})[key]||'';
      const paths=activePaths(mem);
      return `<tr><td>${esc(role)}</td>
        <td>${esc(mem.name)} ${mem.external?`<span class="pill guest">guest</span>`:''}</td>
        <td><select onchange="setOutcome('${m.id}','${key}',this.value)" style="width:auto">
          <option value="done" ${st==='done'?'selected':''}>Completed ✓</option>
          <option value="absent" ${st==='absent'?'selected':''}>Absent</option>
          <option value="other" ${st==='other'?'selected':''}>Did another role…</option>
        </select>
        ${st==='other'?`<input type="text" style="width:150px" placeholder="actual role" value="${esc(a.actualRole||'')}" onchange="setActualRole('${m.id}','${key}',this.value)">`:''}
        ${isSpeech?(paths.length?`<select style="width:auto;margin-left:6px" title="Count this speech as a project on one of their pathways"
            onchange="creditSpeech('${m.id}','${key}',this.value)">
            <option value="">🎓 credit project…</option>
            ${paths.map(pe=>`<option value="${esc(pe.name)}" ${credited===pe.name?'selected':''}>${esc(pe.name)}</option>`).join('')}
          </select>${credited?'<span class="pill done">counted</span>':''}`
          :'<span class="muted small" style="margin-left:6px">no active pathway</span>'):''}
        </td></tr>`;
    }).join('')}
    </tbody></table></div>
    ${attendanceHtml(m)}
    <div class="row small" style="margin-top:8px;padding:6px 10px;background:var(--gold-soft);border-radius:8px">
      <span><b>🏆 Winners</b></span>
      ${STANDARD_CATS.map(cat=>{
        const p=pollsFor(m.id).find(p=>p.category===cat);
        const cur=p&&p.status==='closed'?p.winner_key:null;
        return `<label class="muted">${esc(cat.replace(/^Best (of )?/,''))}</label>
        <select style="width:auto" onchange="setWinner('${m.id}','${esc(cat)}',this)">
          <option value="">—</option>
          ${state.members.filter(x=>!x.archived).map(x=>`<option value="${x.id}" ${cur===x.id?'selected':''}>${esc(x.name)}</option>`).join('')}
          ${cur&&!memberById(cur)?`<option value="${cur}" selected>${esc(winnerName(p))}</option>`:''}
          <option value="__custom">Custom name…</option>
        </select>`;
      }).join('')}
    </div>
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
  /* offer to carry the speeches over before the meeting disappears from view —
     done first, while this meeting is still in the upcoming list */
  const bookings=allDeferrable(m);
  let carried=0;
  if(bookings.length&&confirm(`Move ${bookings.length} booked role${bookings.length>1?'s':''} forward to the next meetings?\n\nWhoever booked earliest keeps the earliest slot. SAA and Presiding Officer stay put.`))
    carried=deferAllBookings(id);
  const row=S.meetings.find(x=>x.id===id); if(row)row.cancelled=true;
  sync(api.updateMeeting(id,{cancelled:true}));
  await ensureMeetings(); autoFillStanding(); render();
  toast(carried?`Meeting cancelled — ${carried} speech${carried>1?'es':''} moved forward`
               :'Meeting cancelled — next date added');
}
/* ---------- moving speeches to a later meeting ----------
   A cancelled meeting or a dropped speech has to go somewhere, and the club's
   rule is first-come-first-served: whoever booked LAST gives way. assignments
   carries no timestamp yet, so booked_at is used when the column exists and
   slot order stands in for it otherwise (slots fill top-down, so the highest
   numbered speaker is the best available guess at "booked last"). Run
     alter table assignments add column booked_at timestamptz not null default now();
   to make it exact from that point on. */
function bookedAt(mid,key){
  const row=S.assignments.find(a=>a.meeting_id===mid&&a.slot_key===key);
  return row&&row.booked_at?row.booked_at:null;
}
/* SAA and the Presiding Officer are standing appointments, not slots members
   pick — everything else can be moved to a later meeting. */
const ridOf=key=>key.split('|')[0];
function deferrable(rid){ return !UNTRACKED_ROLES.includes(rid); }
/* bookings for one role on a meeting, the one who gives way first at the front */
function bookingsByGiveWay(m,rid){
  const out=[];
  for(const s of slotListFor(m)){
    if(ridOf(s.key)!==rid)continue;
    const a=(m.assignments||{})[s.key];
    if(a&&a.memberId)out.push({key:s.key,memberId:a.memberId,at:bookedAt(m.id,s.key),idx:Number(s.key.split('|')[1])});
  }
  return out.sort((x,y)=>{
    if(x.at&&y.at&&x.at!==y.at)return x.at<y.at?1:-1;   /* later booking gives way first */
    return y.idx-x.idx;                                  /* tie / no timestamps: highest slot first */
  });
}
function freeSlotFor(m,rid){
  for(const s of slotListFor(m)){
    if(ridOf(s.key)!==rid)continue;
    const a=(m.assignments||{})[s.key];
    if(!a||!a.memberId)return s.key;
  }
  return null;
}
/* every deferrable booking on a meeting, grouped give-way-first within its role */
function allDeferrable(m){
  const rids=[...new Set(slotListFor(m).map(s=>ridOf(s.key)))].filter(deferrable);
  return rids.flatMap(rid=>bookingsByGiveWay(m,rid).map(b=>({...b,rid})));
}
function laterMeetingIds(m){
  return state.meetings.filter(x=>!x.cancelled&&x.date>m.date)
    .sort((a,b)=>a.date<b.date?-1:1).map(x=>x.id);
}
/* Place one member into the next meeting that has room, pushing that meeting's
   own give-way speaker along if it is full. Returns the meeting landed on. */
function holdsRole(m,rid,memberId){
  return bookingsByGiveWay(m,rid).some(s=>s.memberId===memberId);
}
/* Works on meeting IDs and re-resolves after every write: bookLocal/unbookLocal
   mutate S, and the derived `state` only catches up on rebuild(). Holding object
   references across a placement meant the next speaker read a stale slot map and
   overwrote the one just placed. */
function pushInto(chainIds,rid,memberId,at,hops){
  if(!chainIds.length||hops>ADMIN_HORIZON)return null;
  const target=state.meetings.find(x=>x.id===chainIds[0]);
  if(!target)return pushInto(chainIds.slice(1),rid,memberId,at,hops+1);
  /* never stack someone twice on the same role — carry them to the next instead */
  if(holdsRole(target,rid,memberId))return pushInto(chainIds.slice(1),rid,memberId,at,hops+1);
  let slot=freeSlotFor(target,rid);
  if(!slot){
    const give=bookingsByGiveWay(target,rid)[0];
    if(!give)return null;
    if(!pushInto(chainIds.slice(1),rid,give.memberId,give.at,hops+1))return null;
    unbookLocal(target.id,give.key);
    slot=give.key;
  }
  bookLocal(target.id,slot,memberId,at);
  return state.meetings.find(x=>x.id===chainIds[0]);
}
function bookLocal(mid,key,memberId,at){
  const had=S.assignments.find(a=>a.meeting_id===mid&&a.slot_key===key);
  if(had){ had.profile_id=memberId; had.status='booked'; had.actual_role=null; if(at)had.booked_at=at; }
  else S.assignments.push({meeting_id:mid,slot_key:key,profile_id:memberId,status:'booked',actual_role:null,booked_at:at||undefined});
  sync(api.adminAssign(mid,key,memberId,at));
  rebuild();
}
function unbookLocal(mid,key){
  S.assignments=S.assignments.filter(a=>!(a.meeting_id===mid&&a.slot_key===key));
  sync(api.unbook(mid,key));
  rebuild();
}
/* A cascade can touch several meetings at once, so undo restores the whole
   booking table rather than trying to retrace the individual hops. */
let lastMove=null;
const asgKey=a=>a.meeting_id+'|'+a.slot_key;
function snapshotBookings(label){
  /* the cancelled flags come too: undoing a cancel-and-carry that only put the
     bookings back would restore them onto a meeting still marked cancelled,
     where nobody can see them */
  lastMove={label,rows:S.assignments.map(a=>({...a})),
            cancelled:S.meetings.map(m=>({id:m.id,cancelled:!!m.cancelled}))};
}
function undoMove(){
  if(!lastMove){ toast('Nothing to undo'); return; }
  for(const c of lastMove.cancelled||[]){
    const row=S.meetings.find(m=>m.id===c.id);
    if(row&&!!row.cancelled!==c.cancelled){
      row.cancelled=c.cancelled;
      sync(api.updateMeeting(c.id,{cancelled:c.cancelled}));
    }
  }
  rebuild();
  const want=new Map(lastMove.rows.map(a=>[asgKey(a),a]));
  const have=new Map(S.assignments.map(a=>[asgKey(a),a]));
  for(const [k,a] of have)if(!want.has(k))unbookLocal(a.meeting_id,a.slot_key);
  for(const [k,a] of want){
    const cur=have.get(k);
    if(!cur||cur.profile_id!==a.profile_id)bookLocal(a.meeting_id,a.slot_key,a.profile_id,a.booked_at);
  }
  const label=lastMove.label; lastMove=null;
  render(); toast(`Undone — ${label} put back`);
}
function deferBooking(mid,key){
  const m=state.meetings.find(x=>x.id===mid); if(!m)return;
  const a=(m.assignments||{})[key]; if(!a||!a.memberId)return;
  const rid=ridOf(key);
  if(!deferrable(rid)){ toast('Standing roles stay put'); return; }
  const who=memberById(a.memberId), at=bookedAt(mid,key);
  const chain=laterMeetingIds(m);
  if(!chain.length){ toast('No later meeting to move them to'); return; }
  snapshotBookings(`${who?who.name:'that booking'}`);
  /* free the source slot first, or a full-meeting cascade can bounce them
     straight back into the seat they are leaving */
  unbookLocal(mid,key);
  const landed=pushInto(chain,rid,a.memberId,at,0);
  if(!landed){ bookLocal(mid,key,a.memberId,at); render(); toast(`Every later meeting's ${roleNameById(rid)} is taken — free one first`); return; }
  render();
  toast(`${who?who.name:'Booking'} moved to ${fmtDate(landed.date)}`);
}
/* every member-picked booking on a meeting moves on, give-way order preserved */
function deferAllBookings(mid){
  const m=state.meetings.find(x=>x.id===mid); if(!m)return 0;
  snapshotBookings(`${fmtDate(m.date)}'s bookings`);
  const list=allDeferrable(m).reverse();   /* earliest booker placed first, keeps their priority */
  let moved=0;
  for(const s of list){
    const src=state.meetings.find(x=>x.id===mid);
    const chain=laterMeetingIds(src);
    unbookLocal(mid,s.key);
    if(pushInto(chain,s.rid,s.memberId,s.at,0))moved++;
    else bookLocal(mid,s.key,s.memberId,s.at);   /* nowhere to go — leave them put */
  }
  render();
  return moved;
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
    else S.assignments.push({meeting_id:mid,slot_key:key,profile_id:v,status:'booked',actual_role:null,booked_at:new Date().toISOString()});
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
    /* the speaker who gives way is the last to have booked, not whoever happens
       to sit in the slot being removed — so move them out of the way first */
    const give=bookingsByGiveWay(m,'spk')[0];
    const lastSpk=`spk|${cur-1}`;
    if(give&&give.key!==lastSpk&&m.assignments[lastSpk]&&m.assignments[lastSpk].memberId){
      const occupant=m.assignments[lastSpk].memberId;
      unbookLocal(mid,give.key);
      unbookLocal(mid,lastSpk);
      bookLocal(mid,give.key,occupant);
      rebuild();
    }
    const dropped=[`spk|${cur-1}`,`eval|${cur-1}`].filter(k=>m.assignments[k]&&m.assignments[k].memberId);
    if(dropped.length){
      const names=dropped.map(k=>memberById(m.assignments[k].memberId)?.name).filter(Boolean).join(', ');
      const move=confirm(`${names} gives way.\n\nOK = move them forward to the next meeting.\nCancel = leave the slot count alone.`);
      if(!move)return;
      for(const k of dropped){
        if(/^spk\|/.test(k))deferBooking(mid,k);
        else await unbookSlots(m,[k]);
      }
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
/* quiet: called from the agenda's own toolbar, where a full render() would
   remount the sheet from its last saved state and undo the tick that got us here */
function setMeetingOrder(mid,speechFirst,quiet){
  const m=state.meetings.find(x=>x.id===mid); if(!m)return;
  m.config={...(m.config||{}),speechFirst:!!speechFirst};
  if(!quiet){ saveMeetingConfig(m); return; }
  const row=S.meetings.find(x=>x.id===mid); if(row)row.config=m.config;
  sync(api.updateMeeting(mid,{config:m.config}));
}
/* What the meeting's own records say about whether someone was in the room. */
function attendanceEvidence(m,pid){
  const roles=[];
  for(const [key,a] of Object.entries(m.assignments||{})){
    if(!a||a.memberId!==pid||a.status==='absent')continue;
    roles.push(a.status==='other'&&a.actualRole?a.actualRole:roleNameById(ridOf(key)));
  }
  const polls=pollsFor(m.id);
  const nominated=polls.filter(p=>(p.candidates||[]).some(c=>c.profileId===pid||c.key===pid)).map(p=>p.category);
  const voted=polls.some(p=>S.votes.some(v=>v.poll_id===p.id&&v.voter===pid));
  return {roles,nominated,voted};
}
function setPresent(mid,pid,present){
  const m=state.meetings.find(x=>x.id===mid); if(!m)return;
  if(!present){
    const who=(memberById(pid)||{}).name||'They';
    const ev=attendanceEvidence(m,pid);
    /* a completed role is hard proof they were here — refuse outright, and point
       at the fix, because the role outcome is the record that should change */
    if(ev.roles.length){
      toast(`${who} did ${ev.roles.join(' and ')} at this meeting. Set that role to Absent above if they missed it.`);
      render(); return;
    }
    /* softer traces: nominated in a vote, or voted from their phone */
    const soft=[];
    if(ev.nominated.length)soft.push(`was nominated for ${ev.nominated.join(', ')}`);
    if(ev.voted)soft.push('voted from the app');
    if(soft.length&&!confirm(`${who} ${soft.join(' and ')} at this meeting — that usually means they were there.\n\nMark them absent anyway?`)){ render(); return; }
  }
  const list=new Set(absentList(m));
  present?list.delete(pid):list.add(pid);
  m.config={...(m.config||{}),absent:[...list]};
  saveMeetingConfig(m);
  rebuild(); render();
}
function markAllPresent(mid){
  const m=state.meetings.find(x=>x.id===mid); if(!m)return;
  m.config={...(m.config||{}),absent:[]};
  saveMeetingConfig(m);
  rebuild(); render();
}
/* Credit a delivered speech to one of the speaker's pathways. Stored per slot
   on the meeting so re-crediting can undo the previous one — a member working
   two pathways at once can't be guessed at, so the officer says which. */
function creditSpeech(mid,slotKey,pathName){
  const m=state.meetings.find(x=>x.id===mid); if(!m)return;
  const a=(m.assignments||{})[slotKey]; if(!a||!a.memberId)return;
  const credited={...((m.config||{}).credited||{})};
  const prev=credited[slotKey]||'';
  if(prev===pathName){ render(); return; }
  pathsUpdate(a.memberId,ps=>{
    const bump=(name,d)=>{
      const pe=ps.find(p=>p.name===name);
      if(pe)pe.projectsDone=Math.max(0,(pe.projectsDone||0)+d);
    };
    if(prev)bump(prev,-1);
    if(pathName)bump(pathName,1);
  });
  if(pathName)credited[slotKey]=pathName; else delete credited[slotKey];
  m.config={...(m.config||{}),credited};
  saveMeetingConfig(m);
  rebuild(); render();
}
function setReviewed(id,v){
  const row=S.meetings.find(x=>x.id===id); if(row)row.reviewed=v;
  sync(api.updateMeeting(id,{reviewed:v}));
  rebuild(); render();
}

/* ================= SUGGESTIONS ================= */
const SUG_PILL={new:'other',planned:'other',done:'done',declined:'absent'};
const SUG_LABEL={new:'new',planned:'planned 👍',done:'done ✓',declined:'not now'};
function mySuggestionsHtml(pid){
  const mine=S.suggestions.filter(s=>s.profile_id===pid).sort((a,b)=>a.created_at<b.created_at?1:-1);
  if(!mine.length)return '';
  return `<div style="margin-top:10px">${mine.map(s=>`<div class="small" style="padding:4px 0;border-bottom:1px dashed var(--line)">
    <span class="pill ${SUG_PILL[s.status]}">${SUG_LABEL[s.status]}</span>
    ${esc(s.text)}
    ${s.admin_note?`<div class="muted" style="margin-top:2px">↳ ${esc(s.admin_note)}</div>`:''}
  </div>`).join('')}</div>`;
}
async function sugAdd(){
  const t=document.getElementById('sugText'); const text=t.value.trim();
  if(!text){toast('Write your suggestion first');return;}
  try{
    const row=await api.addSuggestion({profile_id:me.profileId,text,hide_name:document.getElementById('sugAnon').checked});
    S.suggestions.push(row); render(); toast('Sent to the officers — thank you! 💡');
  }catch(e){ toast('Could not send: '+(e.message||e)); }
}
function sugAdminHtml(){
  const list=[...S.suggestions].sort((a,b)=>a.created_at<b.created_at?1:-1);
  const fresh=list.filter(s=>s.status==='new').length;
  if(!list.length)return `<div class="card"><h3>💡 Suggestions</h3><div class="empty">Nothing yet — ask for ideas at the next meeting; members send them from their profile.</div></div>`;
  return `<div class="card"><h3>💡 Suggestions <span class="muted small">(${list.length}${fresh?`, ${fresh} new`:''})</span></h3>
    ${list.map(s=>{
      const who=s.hide_name?'<i>name hidden</i>':esc((memberById(s.profile_id)||{}).name||'former member');
      return `<div style="padding:8px 0;border-bottom:1px dashed var(--line)">
        <div><b>${esc(s.text)}</b></div>
        <div class="small muted">${who} · ${fmtWhen(s.created_at)}</div>
        <div class="row small" style="margin-top:6px">
          <select style="width:auto" onchange="sugStatus('${s.id}',this.value)">
            ${Object.keys(SUG_LABEL).map(k=>`<option value="${k}" ${s.status===k?'selected':''}>${SUG_LABEL[k]}</option>`).join('')}
          </select>
          <input type="text" class="grow" style="max-width:320px" placeholder="reply to the member (optional)" value="${esc(s.admin_note||'')}" onchange="sugNote('${s.id}',this.value)">
          <button class="btn small" onclick="sugAnnounce('${s.id}')" title="Post this to everyone as a 'you said → we did' announcement">📣 You said → we did</button>
          <button class="btn danger small" onclick="sugDel('${s.id}')">✕</button>
        </div>
      </div>`;
    }).join('')}
    <p class="small muted" style="margin-top:8px">“Hide my name” hides it from this list; as an officer you can still identify a suggestion if you must — so don't promise members full anonymity.</p>
  </div>`;
}
function sugStatus(id,v){ const s=S.suggestions.find(s=>s.id===id); if(s)s.status=v; sync(api.updSuggestion(id,{status:v})); render(); }
function sugNote(id,v){ const s=S.suggestions.find(s=>s.id===id); if(s)s.admin_note=v.trim(); sync(api.updSuggestion(id,{admin_note:v.trim()})); }
async function sugAnnounce(id){
  const s=S.suggestions.find(s=>s.id===id); if(!s)return;
  const text=`💡 You said: “${s.text}” → ${s.admin_note||'Done!'}`;
  try{
    const row=await api.addAnnouncement(text); S.announcements.push(row);
    if(s.status!=='done'){ s.status='done'; sync(api.updSuggestion(id,{status:'done'})); }
    render(); toast('Posted to the whole club 📣');
  }catch(e){ toast('Could not post: '+(e.message||e)); }
}
function sugDel(id){
  if(!confirm('Delete this suggestion?'))return;
  S.suggestions=S.suggestions.filter(s=>s.id!==id);
  sync(api.delSuggestion(id)); render();
}

/* ================= SIGNUP DRIVE ================= */
function copyText(t,msg){
  const done=()=>toast(msg||'Copied ✓');
  if(navigator.clipboard&&navigator.clipboard.writeText)navigator.clipboard.writeText(t).then(done,()=>fallback());
  else fallback();
  function fallback(){
    const ta=document.createElement('textarea'); ta.value=t; ta.style.position='fixed'; ta.style.opacity='0';
    document.body.appendChild(ta); ta.select();
    try{ document.execCommand('copy'); done(); }catch(e){ prompt('Copy this message:',t); }
    ta.remove();
  }
}
const APP_URL='https://wajahat934.github.io/toastmasters-club-app/';
function signupDriveHtml(){
  const mems=state.members.filter(m=>!m.external&&!m.archived);
  const withLogin=mems.filter(m=>m.hasAccount);
  const without=mems.filter(m=>!m.hasAccount);
  const pct=mems.length?Math.round(withLogin.length/mems.length*100):0;
  const invite=`🎤 *Rawalpindi Toastmasters — club app*\n\nBook your roles, see the agenda, track your Pathways progress and DCP goals, all in one place.\n\n👉 ${APP_URL}\n\nTap the link, choose *Create an account*, and an officer will approve you. On your phone use *Add to Home Screen* so it opens like an app.\n\nStuck? Message me and I'll set it up for you in 30 seconds.`;
  return `<div class="card">
    <h3>Signup drive <span class="muted small">(${withLogin.length} of ${mems.length} members — ${pct}%)</span></h3>
    <div class="bar ${pct>=80?'met':''}"><div style="width:${pct}%"></div></div>
    <div class="row" style="margin-top:10px">
      <button class="btn small" onclick="copyInvite()">📋 Copy WhatsApp invite</button>
      <span class="small muted">Paste it in the group, or send it to one person at a time — personal messages convert far better.</span>
    </div>
    <textarea id="inviteText" rows="7" style="width:100%;margin-top:8px;font-size:.85rem">${esc(invite)}</textarea>
    <h3 style="margin-top:14px">Not signed up yet (${without.length})</h3>
    ${without.length?without.map(m=>`<div class="row small" style="padding:4px 0;border-bottom:1px dashed var(--line)">
        <span class="grow">${esc(m.name)}</span>
        <button class="btn ghost small" onclick="copyNudge('${esc(m.name).replace(/'/g,'')}')">📋 personal nudge</button>
      </div>`).join('')
      :'<div class="empty">Everyone on the roster has an account 🎉</div>'}
    <p class="small muted" style="margin-top:8px">Tip: split this list between 3–4 members who already signed up — peer-to-peer beats a group broadcast.</p>
  </div>`;
}
function copyInvite(){ copyText(document.getElementById('inviteText').value,'Invite copied — paste it in WhatsApp'); }
function copyNudge(name){
  const first=String(name).split(' ')[0];
  copyText(`Hi ${first}! 👋 We've moved role booking to the club app — your past roles and Pathways progress are already in there waiting for you.\n\n👉 ${APP_URL}\n\nTap *Create an account* (takes 30 seconds) and I'll approve you right away. Want me to do it with you before the next meeting?`,'Personal nudge copied');
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
        <select onchange="if(this.value){mergeProfiles('${m.id}',this.value);}" style="width:auto" title="Link this login to a roster entry even if the names differ">
          <option value="">Merge into roster entry…</option>
          ${state.members.filter(x=>!x.hasAccount&&!x.archived&&x.id!==m.id).map(x=>`<option value="${x.id}">${esc(x.name)}</option>`).join('')}
        </select>
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
    <button class="btn ${memView==='signup'?'':'ghost'} small" onclick="memView='signup';render()">Signup drive</button>
    <button class="btn ${memView==='sug'?'':'ghost'} small" onclick="memView='sug';render()">💡 Suggestions${S.suggestions.filter(s=>s.status==='new').length?' ('+S.suggestions.filter(s=>s.status==='new').length+')':''}</button>
  </div>`;
  if(memView==='matrix')return html+roleMatrix(h,abs);
  if(memView==='signup')return html+signupDriveHtml();
  if(memView==='sug')return html+sugAdminHtml();
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
      ${mem.external?`<span class="pill guest">guest · ${esc(mem.homeClub||'other club')}</span>`:pathSummary(mem)}
      ${absCount?`<span class="chip bad small">absent ×${absCount}</span>`:''}
    </summary>
    <div class="body">
      <div class="row" style="margin-bottom:${mem.external?'0':'10px'}">
        <div><label class="small muted">Name</label><br>
          <input type="text" value="${esc(mem.name)}" style="max-width:220px" onchange="setMem('${mem.id}','name',this.value)"></div>
        ${mem.external?`<div><label class="small muted">Home club</label><br>
          <input type="text" value="${esc(mem.homeClub)}" style="max-width:180px" onchange="setMem('${mem.id}','homeClub',this.value)"></div>`
        :`<div><label class="small muted">🎂 Birthday${(()=>{const n=S.birthdayChanges.filter(c=>c.profile_id===mem.id&&!c.by_admin).length;return n?` <span class="chip bad small">changed ${n}×</span>`:'';})()}</label><br>${bdaySelects(mem.id,mem.birthday)}</div>`}
      </div>
      ${mem.external?'':`
      ${pathsBlock(mem)}
      <div class="sect">
        <h3>Level completions <span class="muted small">(dated — these feed the DCP)</span></h3>
        ${(mem.awards||[]).map(a=>`<div class="row small" style="padding:2px 0">
          <span class="chip gold">Level ${esc(a.level)}${a.path?' · '+esc(a.path):''}</span><span class="muted">${fmtDate(a.date)}</span>
          <button class="btn ghost small" onclick="delAward('${mem.id}','${a.id}')">✕</button></div>`).join('')||'<div class="muted small">none recorded</div>'}
        <div class="row" style="margin-top:6px">
          <select id="aw-p-${mem.id}" style="width:auto">
            ${memPaths(mem).map(pe=>`<option ${pe.done?'':'selected'}>${esc(pe.name)}</option>`).join('')||'<option value="">(no pathway set)</option>'}
          </select>
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
        ${mem.external?'':`<select onchange="if(this.value){mergeProfiles('${mem.id}',this.value);}" style="width:auto" title="Combine this entry with another — bookings, history and awards merge">
          <option value="">Merge into…</option>
          ${state.members.filter(x=>x.id!==mem.id&&!x.external&&!x.archived&&!(x.hasAccount&&mem.hasAccount)).map(x=>`<option value="${x.id}">${esc(x.name)}</option>`).join('')}
        </select>`}
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
  const roles=state.settings.roles.filter(r=>!UNTRACKED_ROLES.includes(r.id)).map(r=>r.name);
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
  const col={path:'path',baseLevel:'base_level',projectsDone:'projects_done',name:'name',homeClub:'home_club',birthday:'birthday'}[k];
  if(p&&col)p[col]=v;
  sync(api.updateProfile(id,{[col]:v}));
  if(k!=='path'){render();keepOpen(id);}
}
async function addAward(id){
  const level=document.getElementById('aw-l-'+id).value;
  const date=document.getElementById('aw-d-'+id).value||todayStr();
  const pathName=(document.getElementById('aw-p-'+id)||{}).value||'';
  const mem=memberById(id);
  try{
    const row=await api.addAward({profile_id:id,level,path:pathName||mem.path||'',date});
    S.awards.push(row);
    /* a completed level resets the project counter on THAT pathway
       (falling back to the only pathway when none was picked) */
    const paths=JSON.parse(JSON.stringify(memPaths(mem)));
    const pe=paths.find(x=>x.name===pathName)||(paths.length===1?paths[0]:null);
    if(pe)pe.projectsDone=0;
    const p=S.profiles.find(p=>p.id===id); if(p)p.paths=paths;
    sync(api.updateProfile(id,{paths}));
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
/* Merge one profile into another: bookings, history, awards and goals move
   to the surviving entry; the login (if any) carries over; the duplicate goes. */
async function mergeProfiles(fromId,intoId){
  const from=S.profiles.find(p=>p.id===fromId), into=S.profiles.find(p=>p.id===intoId);
  if(!from||!into||fromId===intoId)return;
  if(from.auth_id&&into.auth_id){ toast('Both entries have logins — merge is for combining a login with a roster entry. Deactivate one instead.'); render(); return; }
  /* whoever brings the login brings their own name — that's the spelling the
     member chose for themselves, so it must survive the merge */
  const keepName=from.auth_id?from.name:into.name;
  if(!confirm(`Merge “${from.name}” into “${into.name}”?\n\nAll bookings, role history, awards and goals combine into one record, kept under the name “${keepName}”.`)){ render(); return; }
  try{
    await api.reassignData(fromId,intoId);
    await api.deleteProfile(fromId);
    const patch={approved:true,active:true,name:keepName};
    if(from.auth_id){ patch.auth_id=from.auth_id; patch.email=from.email; }
    await api.updateProfile(intoId,patch);
    for(const a of S.assignments)if(a.profile_id===fromId)a.profile_id=intoId;
    for(const a of S.awards)if(a.profile_id===fromId)a.profile_id=intoId;
    for(const g2 of S.goals)if(g2.profile_id===fromId)g2.profile_id=intoId;
    S.profiles=S.profiles.filter(p=>p.id!==fromId);
    Object.assign(into,patch);
    rebuild(); render(); toast('Merged ✓');
  }catch(e){ toast('Merge failed: '+(e.message||e)); }
}
async function approveMerge(pendId,rosterId){
  const pend=S.profiles.find(p=>p.id===pendId); if(!pend)return;
  try{
    /* the signed-up member's own spelling of their name wins */
    const patch={auth_id:pend.auth_id,email:pend.email,name:pend.name,approved:true,active:true};
    await api.deleteProfile(pendId);                      // free the unique auth_id first
    await api.updateProfile(rosterId,patch);
    S.profiles=S.profiles.filter(p=>p.id!==pendId);
    const r=S.profiles.find(p=>p.id===rosterId);
    if(r)Object.assign(r,patch);
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
  const cur=d.current===''?null:Number(d.current);
  const net=(d.base!==''&&d.current!=='')?Number(d.current)-Number(d.base):null;
  const stdMem=(cur!=null&&cur>=20)||(net!=null&&net>=3);
  const tiers=[
    {name:'Distinguished',need:5,memOk:stdMem,memLabel:'20 members or +3 net'},
    {name:'Select Distinguished',need:7,memOk:stdMem,memLabel:'20 members or +3 net'},
    {name:'President’s Distinguished',need:9,memOk:stdMem,memLabel:'20 members or +3 net'},
    {name:'Smedley Distinguished',need:10,memOk:cur!=null&&cur>=25,memLabel:'25 members'}
  ];
  let html=`<h2>Distinguished Club Program</h2>
  <div class="row" style="margin-bottom:10px">
    <label class="small muted">Club year</label>
    <select style="width:auto" onchange="dcpSelYear=Number(this.value);render()">
      ${years.map(y=>`<option value="${y}" ${y===yr?'selected':''}>${y}–${String(y+1).slice(2)}</option>`).join('')}
    </select>
  </div>
  <div class="banner">
    <div class="row">
      <strong>${met}/10 goals met</strong>
      <span class="small muted">base (Jul 1) <input type="number" value="${esc(d.base)}" onchange="setDcp(${yr},'base',this.value)">
        now <input type="number" value="${esc(d.current)}" onchange="setDcp(${yr},'current',this.value)">
        ${net!=null?`· net ${net>=0?'+':''}${net}`:''}</span>
      <label class="small" style="display:flex;gap:6px;align-items:center;margin-left:10px">
        <input type="checkbox" ${d.csp?'checked':''} onchange="setDcp(${yr},'csp',this.checked)"> Club Success Plan submitted
      </label>
    </div>
    <div class="tblwrap" style="margin-top:8px"><table>
      <thead><tr><th>Status</th><th>Goals</th><th>Membership</th><th>Standing</th></tr></thead><tbody>
      ${tiers.map(t=>{
        const goalsOk=met>=t.need;
        const achieved=goalsOk&&t.memOk&&d.csp;
        const needs=[];
        if(!goalsOk)needs.push(`${t.need-met} more goal${t.need-met>1?'s':''}`);
        if(!t.memOk)needs.push(t.name.startsWith('Smedley')&&cur!=null?`${25-cur} more members`:'membership');
        if(!d.csp)needs.push('Club Success Plan');
        return `<tr><td><b>${t.name}</b></td>
          <td class="num">${Math.min(met,t.need)}/${t.need}</td>
          <td>${t.memOk?'✓':'✗'} <span class="muted small">${t.memLabel}</span></td>
          <td>${achieved?'<span class="pill done">Achieved 🏆</span>':`<span class="muted small">needs ${needs.join(' + ')}</span>`}</td></tr>`;
      }).join('')}
      </tbody></table></div>
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
  <p class="small muted">One entry per active pathway — a member on a second path can earn Level 1 again while finishing Level 4 on the first, and both count. Ranked by momentum: projects finished in that path's current level (×2) plus speeches this club year.</p>`;
  let any=false;
  for(const s of sections){
    if(!s.list.length)continue; any=true;
    html+=`<div class="card"><h3>${s.title} <span class="muted small">(${s.list.length})</span> ${s.unmet?'':'<span class="pill done">goal met</span>'}</h3>
      <div class="cand" style="border-bottom:1px solid var(--line)"><span class="score muted small" style="font-family:var(--sans);font-weight:600">momentum</span><span class="grow muted small">member — pathway and progress</span></div>
      ${s.list.map(c=>`<div class="cand">
        <span class="score" title="Momentum ${c.score} = ${c.pe.projectsDone||0} project${(c.pe.projectsDone||0)===1?'':'s'} ×2 + ${c.speeches} speech${c.speeches===1?'':'es'} this club year">${c.score}</span>
        <span class="grow"><b>${esc(c.m.name)}</b> <span class="muted small">— ${esc(c.pe.name)}: Level ${c.cl} done, ${c.pe.projectsDone||0} project${(c.pe.projectsDone||0)===1?'':'s'} into Level ${Math.min(c.cl+1,5)}, ${c.speeches} speech${c.speeches===1?'':'es'} this year</span></span>
        <button class="btn ghost small" onclick="setTab('members');setTimeout(()=>{keepOpen('${c.m.id}');document.getElementById('mem-${c.m.id}')?.scrollIntoView()},50)">open</button>
      </div>`).join('')}</div>`;
  }
  if(!any)html+=`<div class="empty">Add members with paths and levels to see predictions.</div>`;
  /* nobody should be invisible here: members without a pathway can't be
     ranked, so list them so an officer can ask what path they're on */
  const noPath=state.members.filter(m=>!m.external&&!m.archived&&!activePaths(m).length);
  if(noPath.length)
    html+=`<div class="card" style="border-color:var(--maroon)">
      <h3>No active pathway set <span class="muted small">(${noPath.length})</span></h3>
      <p class="small muted">These members can't be counted towards any education goal until their pathway is recorded — ask them which path they're on, then set it on their card.</p>
      ${noPath.map(m=>`<div class="cand"><span class="grow"><b>${esc(m.name)}</b>${memPaths(m).length?' <span class="muted small">— all pathways marked completed</span>':''}</span>
        <button class="btn ghost small" onclick="setTab('members');setTimeout(()=>{keepOpen('${m.id}');document.getElementById('mem-${m.id}')?.scrollIntoView()},50)">open</button></div>`).join('')}
    </div>`;
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
  <h2>Getting members on board</h2>
  <div class="card">
    <div class="row">
      <a class="btn" href="guide.html" target="_blank" style="text-decoration:none">🖨 Member guide (printable, with QR)</a>
      <button class="btn ghost" onclick="setTab('members');memView='signup';render()">Signup drive tracker</button>
    </div>
    <p class="small muted" style="margin:8px 0 0">Print the guide for the table at your signup session — the QR code goes straight to this app.</p>
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
      {act:'Introduction &amp; Purpose',fill:'tmod',who:P,dur:1,introRow:true},
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
  let blocks=[],showTT=true,showSpeech=true,swapOrder=false,juniorFirstOn=true,mid=null,container=null,saveTimer=null;
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
  /* Speakers, optionally reordered most junior first. Only the filled slots are
     sorted — empty slots stay at the end so the blanks don't shuffle about. */
  function speakerNames(m){
    const booked=[];
    for(const s of slotListFor(m)){
      if(!/^speaker$/i.test(s.role.name.trim()))continue;
      const a=(m.assignments||{})[s.key];
      booked.push(a&&a.memberId?memberById(a.memberId):null);
    }
    const filled=booked.filter(Boolean),blanks=booked.length-filled.length;
    if(juniorFirstOn)filled.sort(juniorFirst);
    return [...filled.map(tmName),...Array(blanks).fill(null)];
  }
  function roleMap(m){
    return {
      saa:one(m,/sergeant|saa/i),po:one(m,/presiding|president/i),
      tmod:one(m,/toastmaster of the day|^tmod$/i),ttm:one(m,/table topics master/i),
      ge:one(m,/general evaluator/i),tte:one(m,/table topics evaluator/i),
      spk:speakerNames(m),eval:bookedNames(m,/^(speech )?evaluator$/i),
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
        <label title="Run the Prepared Speech Session before Table Topics">🔁 Speeches first <input type="checkbox" id="agSwap"></label>
        <label title="Order the speakers most junior first, by Pathways level then projects done">🎓 Junior first <input type="checkbox" id="agJr" checked></label>
        <label title="Transition minutes after each prepared speech">🚶 Speech buffer <input type="number" id="agBuf" value="1" min="0" step="0.5"></label>
        <label title="Transition minutes after each evaluation">🚶 Eval buffer <input type="number" id="agBufE" value="1" min="0" step="0.5"></label>
        <label title="Transition minutes after each item in the Opening Session">🚶 Opening buffer <input type="number" id="agBufO" value="0" min="0" step="0.5"></label>
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
          <div class="def" id="agWodDef" contenteditable="true"><b>Meaning:</b> ____ &nbsp;·&nbsp; <i>e.g. “____.”</i></div>
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
    let arr=blocks;
    if(!showTT&&showSpeech){          /* Speakathon: the break follows the speeches */
      arr=blocks.filter(b=>b.type!=='break');
      const brk=blocks.find(b=>b.type==='break');
      if(brk)arr.splice(arr.findIndex(b=>b.id==='speech')+1,0,brk);
      return arr;
    }
    if(swapOrder&&showTT&&showSpeech){
      /* swap the two session blocks in place, leaving the break where it sits */
      arr=[...blocks];
      const i=arr.findIndex(b=>b.id==='tt'),j=arr.findIndex(b=>b.id==='speech');
      if(i>=0&&j>=0){ const t=arr[i]; arr[i]=arr[j]; arr[j]=t; }
    }
    return arr;
  }
  /* The TMOD introduces the session they hand over to. Run speeches first and
     they are still on stage from the Opening, but they have to come back for
     Table Topics — so the introduction travels with the later session. Moved on
     the real blocks rather than a render-time copy, because agRender hangs
     _minsEl on the block objects and updateTimes looks them up again. */
  function isIntroRow(r){
    return r.introRow===true||(r.fill==='tmod'&&/introduction/i.test(String(r.act||'').replace(/<[^>]*>/g,'')));
  }
  function placeIntroRow(){
    const sp=blocks.find(b=>b.id==='speech'),tt=blocks.find(b=>b.id==='tt');
    if(!sp||!tt)return;
    const from=swapOrder?sp:tt,to=swapOrder?tt:sp;
    const i=from.rows.findIndex(isIntroRow);
    if(i<0)return;                       /* already sitting where it belongs */
    to.rows.unshift(from.rows.splice(i,1)[0]);
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
          const lbl=document.createElement('span');
          lbl.title='Click to rename (clear it to go back to "Prepared Speaker N")';
          lbl.innerHTML=row.label||`Prepared Speaker ${spkN}`;
          /* blank it out and the row falls back to the auto-numbered label */
          makeEditable(lbl,()=>{ row.label=lbl.innerText.trim()?lbl.innerHTML:undefined; });
          actTd.appendChild(lbl);
          const note=AG_PRESETS[row.preset].label;
          if(note){
            const n=document.createElement('span'); n.className='role-note';
            n.textContent=' '+note; actTd.appendChild(n);
          }
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
    const bufS=parseFloat(g('agBuf').value)||0,bufE=parseFloat(g('agBufE').value)||0,
          bufO=parseFloat(g('agBufO').value)||0;
    /* the block matters for the opening — its rows carry no kind of their own */
    const extra=(r,block)=>{
      if(r.kind==='speaker')return bufS;
      if(r.kind==='evaluator'||r.kind==='tteval')return bufE;
      return block&&block.id==='opening'?bufO:0;
    };
    orderedBlocks().forEach(block=>{
      if(block.type==='break'){
        if(block._fromEl)block._fromEl.innerText=fmtT(cur);
        cur+=block.dur;
        if(block._toEl)block._toEl.innerText=fmtT(cur);
        return;
      }
      if(blockHidden(block))return;
      const rows=visibleRows(block);
      const total=rows.reduce((s,r)=>s+(r.dur||0)+extra(r,block),0);
      if(block._minsEl)block._minsEl.innerText=`${total} min`;
      rows.forEach(row=>{
        if(row._fromEl)row._fromEl.innerText=fmtT(cur);
        cur+=(row.dur||0);
        if(row._toEl)row._toEl.innerText=fmtT(cur);
        cur+=extra(row,block);
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
    /* mirror the meeting's Table Topics and running-order settings onto the agenda */
    g('agTT').checked=ttOn(m); showTT=ttOn(m);
    g('agSwap').checked=speechFirstOn(m); swapOrder=speechFirstOn(m);
    juniorFirstOn=g('agJr').checked;
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
    if(m.wod&&(m.wod.def||m.wod.sent)){
      const parts=[];
      if(m.wod.def)parts.push('<b>Meaning:</b> '+esc(m.wod.def));
      if(m.wod.sent)parts.push('<i>e.g. “'+esc(m.wod.sent.replace(/^[\s"“”']+|[\s"“”'.]+$/g,''))+'.”</i>');
      g('agWodDef').innerHTML=parts.join(' &nbsp;·&nbsp; ');
    }
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
          rows:b.rows.map(r=>({kind:r.kind,fill:r.fill,act:r.act,label:r.label,introRow:r.introRow,who:r.who,dur:r.dur,preset:r.preset,autoMode:r.autoMode,lights:[...(r.lights||['','',''])]}))}),
      inputs:{date:g('agDate').value,start:g('agStart').value,no:g('agNo').value,
              buf:g('agBuf').value,bufE:g('agBufE').value,bufO:g('agBufO').value,
              tt:g('agTT').checked,sp:g('agSp').checked,
              swap:g('agSwap').checked,jr:g('agJr').checked},
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
      if(i.bufO!=null)g('agBufO').value=i.bufO;
      if(i.tt!=null)g('agTT').checked=i.tt;
      if(i.sp!=null)g('agSp').checked=i.sp;
      if(i.swap!=null)g('agSwap').checked=i.swap;
      if(i.jr!=null)g('agJr').checked=i.jr;
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
    swapOrder=g('agSwap').checked; juniorFirstOn=g('agJr').checked;
    placeIntroRow();
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
    g('agBufO').addEventListener('input',updateTimes);
    g('agNo').addEventListener('input',()=>{ g('agChipNo').innerText='No. '+g('agNo').value; });
    function updateToggles(){
      showTT=g('agTT').checked; showSpeech=g('agSp').checked;
      swapOrder=g('agSwap').checked; juniorFirstOn=g('agJr').checked;
      placeIntroRow();
      g('agChipSpk').style.display=(!showTT&&showSpeech)?'inline-block':'none';
      agRender();
    }
    g('agTT').addEventListener('change',updateToggles);
    g('agSp').addEventListener('change',updateToggles);
    g('agSwap').addEventListener('change',()=>{ updateToggles(); setMeetingOrder(mid,g('agSwap').checked,true); });
    /* re-order needs the names refetched from the bookings, not just a redraw */
    g('agJr').addEventListener('change',()=>{ juniorFirstOn=g('agJr').checked; applyBookings(); agRender(); });
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
  for(const x of ['authWrap','pendingWrap','appWrap','resetWrap'])
    document.getElementById(x).style.display=(x===id)?'':'none';
}
async function reload(){
  const raw=await api.loadAll();
  S.profiles=raw.profiles; S.meetings=raw.meetings; S.assignments=raw.assignments;
  S.awards=raw.awards; S.goals=raw.goals;
  S.polls=raw.polls||[]; S.votes=raw.votes||[]; S.announcements=raw.announcements||[];
  S.birthdayChanges=raw.birthdayChanges||[]; S.suggestions=raw.suggestions||[];
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
  if(!entered){
    /* restore the last-used tab (survives page reloads / phone tab eviction) */
    const saved=localStorage.getItem('lastTab');
    tab=tabsFor().some(([id])=>id===saved)?saved:(isAdmin?'schedule':'book');
  }
  show('appWrap'); render();
  if(!entered){
    entered=true;
    api.subscribe(async(table,p)=>{ await reload(); if(['book','schedule','voting'].includes(tab))renderLive(); });
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
    /* the emailed link signs them in for real, so this check must come before
       the session check — otherwise they land straight in the app and the
       wrong password is never replaced */
    if(recoveryMode&&session){ show('resetWrap'); document.getElementById('resetPass').focus(); return; }
    if(!session){ show('authWrap'); return; }
    const profile=await api.myProfile();
    if(!profile){ show('authWrap'); return; }
    if(!profile.approved||!profile.active){ show('pendingWrap'); return; }
    await enterApp(profile);
  }catch(e){ console.error(e); toast('Error: '+(e.message||e)); }
}

/* ---------- auth UI ---------- */
let authMode='signin';
/* supabase-js consumes and clears the URL hash while it builds the session, so
   the recovery marker has to be read before init() ever runs */
let recoveryMode=/[#&?]type=recovery/.test(location.hash)||/[?&]type=recovery/.test(location.search);
/* delegated so it also covers the field on the profile tab, which is re-rendered */
function bindPwEyes(){
  document.addEventListener('click',e=>{
    const eye=e.target.closest('.pweye'); if(!eye)return;
    const inp=eye.parentElement.querySelector('input'); if(!inp)return;
    const reveal=inp.type==='password';
    inp.type=reveal?'text':'password';
    eye.setAttribute('aria-pressed',String(reveal));
    eye.title=reveal?'Hide password':'Show password';
    eye.setAttribute('aria-label',eye.title);
    inp.focus();
  });
}
function bindAuth(){
  const form=document.getElementById('authForm');
  const errEl=document.getElementById('authErr');
  document.getElementById('authBm').innerHTML='<option value="">— month —</option>'+
    MD_MONTHS.map((n,i)=>`<option value="${String(i+1).padStart(2,'0')}">${n}</option>`).join('');
  document.getElementById('authBd').innerHTML='<option value="">— day —</option>'+
    Array.from({length:31},(_,i)=>`<option value="${String(i+1).padStart(2,'0')}">${i+1}</option>`).join('');
  document.getElementById('authToggle').addEventListener('click',()=>{
    authMode=authMode==='signin'?'signup':'signin';
    document.getElementById('nameRow').style.display=authMode==='signup'?'':'none';
    document.getElementById('authGo').textContent=authMode==='signup'?'Create account':'Sign in';
    document.getElementById('authSwitch').firstChild.textContent=authMode==='signup'?'Already a member? ':'New here? ';
    document.getElementById('authToggle').textContent=authMode==='signup'?'Sign in instead':'Create an account';
    document.getElementById('forgotRow').style.display=authMode==='signup'?'none':'';
    errEl.style.color=''; errEl.textContent='';
  });
  form.addEventListener('submit',async e=>{
    e.preventDefault(); errEl.style.color=''; errEl.textContent='';
    const email=document.getElementById('authEmail').value.trim();
    const pass=document.getElementById('authPass').value;
    try{
      if(authMode==='signup'){
        const name=document.getElementById('authName').value.trim();
        if(!name){errEl.textContent='Please enter your name.';return;}
        const bm=document.getElementById('authBm').value,bd=document.getElementById('authBd').value;
        await api.signUp(email,pass,name,(bm&&bd)?bm+'-'+bd:null);
      } else await api.signIn(email,pass);
      await route();
    }catch(err){ errEl.textContent=err.message||String(err); }
  });
  bindPwEyes();
  document.getElementById('authForgot').addEventListener('click',async()=>{
    const email=document.getElementById('authEmail').value.trim();
    if(!email){ errEl.textContent='Type your email address above first, then tap this again.'; return; }
    errEl.textContent='';
    try{
      await api.resetPassword(email);
      errEl.style.color='var(--accent)';
      errEl.textContent='Reset link sent to '+email+'. Check your inbox (and spam), then tap the link.';
    }catch(err){ errEl.style.color=''; errEl.textContent=err.message||String(err); }
  });
  const resetForm=document.getElementById('resetForm'),resetErr=document.getElementById('resetErr');
  resetForm.addEventListener('submit',async e=>{
    e.preventDefault(); resetErr.textContent='';
    const pw=document.getElementById('resetPass').value;
    if(pw.length<6){ resetErr.textContent='Please use at least 6 characters.'; return; }
    try{
      await api.updatePassword(pw);
      recoveryMode=false;
      toast('Password updated — you are signed in.');
      await route();
    }catch(err){ resetErr.textContent=err.message||String(err); }
  });
  document.getElementById('resetCancel').addEventListener('click',async()=>{
    recoveryMode=false; await api.signOut(); route();
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
  spkDelta,setMeetingTT,setMeetingOrder,setPresent,markAllPresent,creditSpeech,deferBooking,deferAllBookings,undoMove,setWod,addPastMeeting,pastEditToggle,mergeProfiles,
  vcPick,startPoll,addCandidate,removeCandidate,adjustPoll,closePoll,finalizePoll,reopenPoll,deletePoll,castMyVote,setWinner,
  pStart,pAdd,pRemove,pAdjust,pPaper,pVote,pTrickleToggle,pClose,pFinalize,pReopen,pDelete,pReset,
  bdaySet,annAdd,annDel,paperVoter,bcSeen,pathAdd,pathDel,pathField,pathToggleDone,
  sugAdd,sugStatus,sugNote,sugAnnounce,sugDel,copyInvite,copyNudge,
  toggleArchive,delMember,keepOpen,s_set,roleEdit,roleDel,roleAdd,exportData,setDcp,
  myBook,myUnbook,meSet,meChangePw,meGoalAdd,meGoalToggle,meGoalDel,route});
Object.defineProperty(window,'memView',{get:()=>memView,set:v=>{memView=v;}});
Object.defineProperty(window,'dcpSelYear',{get:()=>dcpSelYear,set:v=>{dcpSelYear=v;}});

(async function boot(){
  api=DEMO?DemoApi:SupabaseApi;
  bindAuth();
  await api.init();
  await route();
})();
