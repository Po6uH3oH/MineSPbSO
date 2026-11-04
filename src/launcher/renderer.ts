declare global{interface Window{smp:{call:(channel:string,value?:unknown)=>Promise<{ok:boolean,value:any,error?:string,status?:number,detail?:string}>,onProgress:(fn:(v:TransferInfo|null)=>void)=>void,onStatus:(fn:(s:string)=>void)=>void}}}
type TransferInfo={label:string,bytes:number,total?:number};
const $=(id:string)=>document.getElementById(id)!;
let state:any,mode='login',activeTab='home',wasAuthenticated=false;
let lastAuthAttempt:(()=>Promise<void>)|undefined;
const input=(id:string)=>$(id) as HTMLInputElement;
function notice(s:string){$('notice-text').textContent=s;$('notice').hidden=false;}
async function call(channel:string,value?:unknown){const r=await window.smp.call(channel,value);if(!r.ok)throw Object.assign(new Error(r.error),{status:r.status,detail:r.detail});return r.value;}
function tab(id:string){if(!state?.account)return;activeTab=id;for(const s of document.querySelectorAll<HTMLElement>('.tab'))s.hidden=s.id!==id;for(const b of document.querySelectorAll<HTMLElement>('[data-tab]')){if(b.dataset.tab===id)b.setAttribute('aria-current','page');else b.removeAttribute('aria-current');} $('page-caption').textContent=({home:'Главная',profile:'Аккаунт',settings:'Настройки',developers:'Разработчикам'} as Record<string,string>)[id]!;}
for(const b of document.querySelectorAll<HTMLButtonElement>('[data-tab]'))b.onclick=()=>tab(b.dataset.tab!);
async function action(fn:()=>Promise<unknown>){$('notice').hidden=true;try{await fn();await refresh();}catch(e:any){notice(e.message);}}
async function refresh(){state=await call('state');$('identity').textContent=state.account?.nickname??'Вы не вошли';$('stage').textContent=state.stage;$('pack-source').textContent=state.localPack||(state.remotePack?'Загрузка с сервера':'Сборка не выбрана');$('remote-pack').hidden=!state.remotePack;
 $('basic-edition').setAttribute('aria-pressed',String(!state.enhancedGraphics));$('enhanced-edition').setAttribute('aria-pressed',String(state.enhancedGraphics));
 $('edition-label').textContent=state.enhancedGraphics?'Улучшенная':'Обычная';$('edition-description').textContent=state.enhancedGraphics?'Больше деталей. Больше впечатлений.':'Всё для комфортной игры';
 $('memory-recommended').textContent='Рекомендуется: '+(state.enhancedGraphics?6:4)+' ГБ';$('memory-max').textContent=state.budget.max+' ГБ';
 $('memory-hint').textContent=state.enhancedGraphics&&state.budget.max<6?'Для 6 ГБ недостаточно общей памяти. Выделение ограничено, чтобы оставить запас для Windows.':'Оставьте запас памяти для Windows и других приложений.';
 input('auto-login').checked=state.preferences.autoLogin;input('auto-join').checked=state.preferences.autoJoin;
 if(!document.querySelector('#game-settings :focus')){input('game-width').value=state.preferences.width;input('game-height').value=state.preferences.height;input('fullscreen').checked=state.preferences.fullscreen;($('jvm-args') as HTMLTextAreaElement).value=state.preferences.jvmArgs;}
 $('map').hidden=!state.hasMap;
 ($('logging') as HTMLInputElement).checked=state.logging;
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
 const a=state.account;$('app-shell').hidden=!a;$('auth-screen').hidden=!!a;document.body.dataset.locked=String(!a);
 if(a){if(!wasAuthenticated){activeTab='home';$('connection-error').hidden=true;$('auth-content').hidden=false;$('auth-error').hidden=true;}tab(activeTab);}else if(wasAuthenticated){showStep('login');}
 wasAuthenticated=!!a;
 if(!a&&state.sessionError){showAuthError(state.sessionError);}
 const m=$('memory') as HTMLInputElement;m.max=state.budget.max;m.value=String(state.memory);paintMemory();$('memory-value').textContent=`${state.memory} ГБ`;if(a){$('profile-name').textContent=a.nickname;$('avatar-letter').textContent=a.nickname.slice(0,1).toUpperCase();$('account-status').textContent=a.verified?'Почта подтверждена':'Подтвердите почту';$('verify-box').hidden=a.verified;}}
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
 $('server-count').textContent=value?.players?String(value.players.online):'—';
 $('server-status-label').textContent=value?'В сети · '+value.version.name:'Сервер недоступен';
 $('server-dot').style.background=value?'#50c6b5':'#8997ac';
 const names=value?.players?.sample?.map((p:{name:string})=>p.name)??[];
 $('player-list').textContent=names.length?'Игроки на сервере'+(names.length<value.players.online?' (часть списка)':'')+'\n'+names.join('\n'):value?.players?.online===0?'Сейчас на сервере нет игроков':'Сервер не передал список игроков';
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
setInterval(()=>{if(!document.hidden&&state?.account)void updateServer();},30000);
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
 mode=next;lastAuthAttempt=undefined;$('auth-error').hidden=true;$('connection-error').hidden=true;$('auth-content').hidden=false;
 $('register-link').hidden=next!=='login';$('back-login').hidden=next==='login';
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
  if(field==='password')input.autocomplete=next==='login'?'current-password':'new-password';
 }
 const focus = next==='reset'||next==='verify' ? 'token' : 'email';
 $(focus+'-label').querySelector('input')!.focus();
}
for(const b of document.querySelectorAll<HTMLButtonElement>('[data-mode]'))b.onclick=()=>{ $('notice').hidden=true;showStep(b.dataset.mode!); };
showStep('login');
function form(id:string,fn:(v:Record<string,FormDataEntryValue>)=>Promise<unknown>){const f=$(id) as HTMLFormElement;f.onsubmit=e=>{e.preventDefault();const data=Object.fromEntries(new FormData(f));void action(async()=>{await fn(data);for(const x of f.querySelectorAll<HTMLInputElement>('input[type=password]'))x.value='';});};}
function showAuthError(error:{message:string,status?:number,detail?:string}){
 const connection=error.status===0||error.status===undefined||error.status>=500;
 if(connection){$('auth-content').hidden=true;$('connection-error').hidden=false;$('connection-detail').textContent=error.message+(error.detail?'\n'+error.detail:'');}
 else{$('auth-error-text').textContent=error.status===401?'Неверная почта или пароль. Проверьте данные аккаунта.':error.message;$('auth-error').hidden=false;}
}
async function submitAuth(data:Record<string,FormDataEntryValue>,step:string){
 const button=$('auth-submit') as HTMLButtonElement;if(button.disabled)return;
 button.disabled=true;$('auth-error').hidden=true;$('notice').hidden=true;
 try{
  await call('auth',{action:step,data:{...data,token:data.token?.toString().trim(),remember:data.remember==='on'}});
  lastAuthAttempt=undefined;($('auth-form') as HTMLFormElement).querySelector<HTMLInputElement>('[name=password]')!.value='';
  if(step==='register')showStep('verify');if(step==='forgot')showStep('reset');
  if(step==='verify'||step==='reset'){showStep('login');notice(step==='verify'?'Почта подтверждена. Теперь можно войти.':'Пароль изменён. Войди с новым паролем.');}
  await refresh();if(state.account)void updateServer();
 }catch(e:any){showAuthError(e);}finally{button.disabled=false;}
}
$('auth-form').onsubmit=e=>{e.preventDefault();const data=Object.fromEntries(new FormData($('auth-form') as HTMLFormElement));const step=mode;lastAuthAttempt=()=>submitAuth(data,step);void lastAuthAttempt();};
$('retry-auth').onclick=()=>{if(lastAuthAttempt){$('connection-error').hidden=true;$('auth-content').hidden=false;void lastAuthAttempt();}else showStep('login');};
$('back-auth').onclick=()=>{lastAuthAttempt=undefined;showStep('login');};
$('dismiss-auth-error').onclick=()=>{$('auth-error').hidden=true;};
$('dismiss-notice').onclick=()=>{$('notice').hidden=true;};
$('minimize').onclick=()=>void call('window','minimize');$('close').onclick=()=>void call('window','close');
$('auth-theme').onclick=()=>{themeSelect.value=document.documentElement.dataset.theme==='dark'?'light':'dark';localStorage.setItem('appearance',themeSelect.value);applyTheme();};
document.querySelector<HTMLAnchorElement>('.brand')!.onclick=e=>{e.preventDefault();tab('home');};
document.querySelector<HTMLButtonElement>('[data-open-settings]')!.onclick=()=>tab('settings');
form('verify-form',data=>call('auth',{action:'verify',data}));
for(const [id,channel,value] of [['select-pack','select-pack',undefined],['map','map',undefined],['folder','folder',undefined],['diagnostics','diagnostics',undefined],['release-page','update','releases'],['update-download','update','download'],['update-install','update','install']] as const)$(id).onclick=()=>void action(()=>call(channel,value));
for(const [id,kind] of [['resend','resend'],['logout','logout'],['revoke','revoke-all']])$(id!).onclick=()=>void action(()=>call('auth',{action:kind,data:{}}));
$('skin').onclick=()=>void action(async()=>{await call('skin',($('skin-model') as HTMLSelectElement).value);notice('Скин сохранён. Перезапусти игру, чтобы обновить его.');});
$('memory').onchange=()=>void action(()=>call('memory',Number(($('memory') as HTMLInputElement).value)));
$('play').onclick=()=>void action(async()=>{if(!state.account){tab('profile');throw new Error('Войдите или создайте аккаунт');}const b=$('play') as HTMLButtonElement;b.disabled=true;try{await call('play');}finally{b.disabled=false;}});
$('update-check').onclick=()=>void action(async()=>{const result=await call('update','check');notice(typeof result==='string'?result:'Проверка обновлений завершена.');});
$('offer-action').onclick=()=>void action(()=>call('update',state.downloaded?'install':'download'));
void refresh().then(async()=>{if(state.account)void updateServer();await call('update','check');await refresh();}).catch(()=>{});
export {};

$('logging').onchange=()=>void action(()=>call('logging',($('logging') as HTMLInputElement).checked));
$('open-logs').onclick=()=>void action(()=>call('open-logs'));
$('check-instance').onclick=()=>void action(async()=>notice(await call('maintenance','check')));
$('clear-cache').onclick=()=>void action(async()=>{if(confirm('Удалить кеш загрузок? При следующей установке файлы могут скачаться заново.'))notice(await call('maintenance','clear'));});

$('identity').onclick=()=>tab('profile');

for(const [id,enabled] of [['basic-edition',false],['enhanced-edition',true]] as const)$(id).onclick=()=>void action(async()=>{await call('graphics',enabled);});
function paintMemory(){const m=input('memory'),span=Number(m.max)-Number(m.min);m.style.setProperty('--memory-fill',((Number(m.value)-Number(m.min))/span*100)+'%');$('memory-marker').style.setProperty('--memory-recommendation',(Math.min(1,((state?.enhancedGraphics?6:4)-Number(m.min))/span)*100)+'%');}
$('memory').oninput=()=>{$('memory-value').textContent=input('memory').value+' ГБ';paintMemory();};
for(const [id,key] of [['auto-login','autoLogin'],['auto-join','autoJoin']] as const)$(id).onchange=()=>void action(async()=>{try{await call('preferences',{...state.preferences,[key]:input(id).checked});}finally{await refresh();}});
$('game-settings').onsubmit=e=>{e.preventDefault();void action(async()=>{await call('preferences',{...state.preferences,width:Number(input('game-width').value),height:Number(input('game-height').value),fullscreen:input('fullscreen').checked,jvmArgs:($('jvm-args') as HTMLTextAreaElement).value});notice('Параметры игры сохранены.');});};
