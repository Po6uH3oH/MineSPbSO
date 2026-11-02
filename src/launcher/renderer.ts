declare global{interface Window{smp:{call:(channel:string,value?:unknown)=>Promise<{ok:boolean,value:any,error?:string}>,onProgress:(fn:(v:TransferInfo|null)=>void)=>void,onStatus:(fn:(s:string)=>void)=>void}}}
type TransferInfo={label:string,bytes:number,total?:number};
const $=(id:string)=>document.getElementById(id)!;
let state:any,mode='login';
function notice(s:string){$('notice').textContent=s;$('notice').hidden=false;}
async function call(channel:string,value?:unknown){const r=await window.smp.call(channel,value);if(!r.ok)throw new Error(r.error);return r.value;}
function tab(id:string){for(const s of document.querySelectorAll<HTMLElement>('.tab'))s.hidden=s.id!==id;}
for(const b of document.querySelectorAll<HTMLButtonElement>('[data-tab]'))b.onclick=()=>tab(b.dataset.tab!);
async function action(fn:()=>Promise<unknown>){$('notice').hidden=true;try{await fn();await refresh();}catch(e:any){notice(e.message);}}
async function refresh(){state=await call('state');$('identity').textContent=state.account?.nickname??'Вы не вошли';$('stage').textContent=state.stage;$('pack-source').textContent=state.localPack||(state.remotePack?'Загрузка с сервера':'Сборка не выбрана');$('remote-pack').hidden=!state.remotePack;
 $('host-form').hidden=!state.tester;
 $('check-network').hidden=!state.tester;
 if(document.activeElement!==$('server-host'))($('server-host') as HTMLInputElement).value=state.host;
 $('host-info').textContent=state.tester?'Текущий адрес: '+state.host:'Адрес задаёт владелец серверного выпуска.';
 $('launcher-version').textContent='Версия лаунчера: '+state.version;
 $('update-offer').hidden=!state.availableVersion;
 $('update-title').textContent='Доступна версия '+(state.availableVersion??'');
 $('offer-action').textContent=state.downloaded?'Установить и перезапустить':'Скачать';
 $('update-download').hidden=!state.updates&&!state.availableVersion;
 $('update-install').hidden=!state.updates&&!state.downloaded;
 showProgress(state.progress);
 const a=state.account;$('signed-in').hidden=!a;$('signed-out').hidden=!!a;const m=$('memory') as HTMLInputElement;m.max=state.budget.max;m.value=String(state.memory);$('memory-value').textContent=`${state.memory} ГБ`;if(a){$('profile-name').textContent=a.nickname;$('verify-box').hidden=a.verified;}}
function showProgress(info:TransferInfo|null){
 $('transfer').hidden=!info;
 if(!info)return;
 const mb=(n:number)=>(n/1e6).toLocaleString('ru-RU',{maximumFractionDigits:1});
 $('transfer-label').textContent=info.label+' · '+mb(info.bytes)+(info.total===undefined?' МБ':' / '+mb(info.total)+' МБ');
 const bar=$('transfer-bar') as HTMLProgressElement;
 if(info.total){bar.max=info.total;bar.value=info.bytes;}else bar.removeAttribute('value');
}
let statusRequest=0;
async function updateServer(){
 const id=++statusRequest;
 const value=await call('server-status').catch(()=>null);
 if(id!==statusRequest)return;
 $('server-count').textContent=value?(value.players?'В игре '+value.players.online+' из '+value.players.max:'Сервер в сети')+' · '+value.version.name:'Сервер не ответил';
}
$('host-form').onsubmit=e=>{e.preventDefault();void action(async()=>{
 await call('host',($('server-host') as HTMLInputElement).value);
 await updateServer();notice('Адрес сохранён.');
});};
$('check-network').onclick=()=>void action(async()=>{
 const button=$('check-network') as HTMLButtonElement;
 button.disabled=true;$('network-results').textContent='Проверяем доступность…';
 try{
   const checks=await call('check-network');
   $('network-results').replaceChildren(...checks.map((r:{label:string,ok:boolean,detail:string})=>{
     const item=document.createElement('li');item.textContent=(r.ok?'✓ ':'× ')+r.label+' — '+r.detail;return item;
   }));
 }finally{button.disabled=false;}
});
$('remote-pack').onclick=()=>void action(()=>call('remote-pack'));
window.smp.onProgress(showProgress);
void updateServer();setInterval(()=>{if(!document.hidden)void updateServer();},30000);
window.smp.onStatus(s=>{$('stage').textContent=s;});
const themeSelect = $('theme') as HTMLSelectElement;
const systemTheme = matchMedia('(prefers-color-scheme: dark)');
themeSelect.value = localStorage.getItem('appearance') || 'system';
function applyTheme() {
 const dark = themeSelect.value === 'dark' || (themeSelect.value === 'system' && systemTheme.matches);
 document.documentElement.dataset.theme = dark ? 'dark' : 'light';
}
themeSelect.onchange = () => { localStorage.setItem('appearance',themeSelect.value); applyTheme(); };
systemTheme.addEventListener('change', applyTheme);
applyTheme();

const steps: Record<string,[string,string,string,string[]]> = {
 login:['Вход','Войти','',['email','password','remember']],
 register:['Регистрация','Получить код','Укажи почту, пароль и постоянный игровой ник.',['email','password','nick']],
 verify:['Регистрация · подтверждение почты','Подтвердить почту','Введи код из письма. Он действует 30 минут.',['token']],
 forgot:['Восстановление пароля','Получить код','Укажи почту своего аккаунта.',['email']],
 reset:['Восстановление пароля','Сохранить новый пароль','Введи код из письма и придумай новый пароль.',['token','password']],
};
function showStep(next:string) {
 mode=next;
 const [title,submit,hint,fields]=steps[next]!;
 $('step-title').textContent=title;
 $('step-info').textContent=hint;
 $('auth-submit').textContent=submit;
 for(const field of ['email','nick','password','token','remember']){
  const label=$(field+'-label'),input=label.querySelector('input')!;
  label.hidden=!fields.includes(field);
  input.disabled=label.hidden;
  input.required=!label.hidden && field!=='remember';
  if(field==='token'||field==='password')input.value='';
 }
 const focus = next==='reset'||next==='verify' ? 'token' : 'email';
 $(focus+'-label').querySelector('input')!.focus();
}
for(const b of document.querySelectorAll<HTMLButtonElement>('[data-mode]'))b.onclick=()=>{ $('notice').hidden=true;showStep(b.dataset.mode!); };
showStep('login');
function form(id:string,fn:(v:Record<string,FormDataEntryValue>)=>Promise<unknown>){const f=$(id) as HTMLFormElement;f.onsubmit=e=>{e.preventDefault();const data=Object.fromEntries(new FormData(f));void action(async()=>{await fn(data);for(const x of f.querySelectorAll<HTMLInputElement>('input[type=password]'))x.value='';});};}
form('auth-form',async data=>{
 const step=mode;
 const button=$('auth-submit') as HTMLButtonElement;
 if(button.disabled)return;
 button.disabled=true;
 try {
  await call('auth',{action:step,data:{...data,token:data.token?.toString().trim(),remember:data.remember==='on'}});
  if(step==='register')showStep('verify');
  if(step==='forgot')showStep('reset');
  if(step==='verify'||step==='reset'){
   showStep('login');
   notice(step==='verify'?'Почта подтверждена. Теперь можно войти.':'Пароль изменён. Войди с новым паролем.');
  }
 } finally {button.disabled=false;}
});
form('verify-form',data=>call('auth',{action:'verify',data}));
for(const [id,channel,value] of [['select-pack','select-pack',undefined],['map','map',undefined],['folder','folder',undefined],['diagnostics','diagnostics',undefined],['release-page','update','releases'],['update-download','update','download'],['update-install','update','install']] as const)$(id).onclick=()=>void action(()=>call(channel,value));
for(const [id,kind] of [['resend','resend'],['logout','logout'],['revoke','revoke-all']])$(id!).onclick=()=>void action(()=>call('auth',{action:kind,data:{}}));
$('skin').onclick=()=>void action(async()=>{await call('skin',($('skin-model') as HTMLSelectElement).value);notice('Скин сохранён. Перезапусти игру, чтобы обновить его.');});
$('memory').onchange=()=>void action(()=>call('memory',Number(($('memory') as HTMLInputElement).value)));
$('play').onclick=()=>void action(async()=>{if(!state.account){tab('profile');throw new Error('Войдите или создайте аккаунт');}const b=$('play') as HTMLButtonElement;b.disabled=true;try{await call('play');}finally{b.disabled=false;}});
$('update-check').onclick=()=>void action(async()=>{const result=await call('update','check');notice(typeof result==='string'?result:'Проверка обновлений завершена.');});
$('offer-action').onclick=()=>void action(()=>call('update',state.downloaded?'install':'download'));
void refresh().then(async()=>{await call('update','check');await refresh();}).catch(()=>{});
export {};
