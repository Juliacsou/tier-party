(() => {
  const COLORS = ['#ff615f','#ff8b37','#ffc43b','#38d5ad','#54c2f0','#7d6cff','#ef68b8','#4b5568'];
  const THEMES = [
    'Cantor pop','Filme para assistir de novo','Comida de festa','Super-herói','Lugar para viajar','Desenho animado','Jogo de videogame','Série de TV','Sobremesa','Celebridade','Música para karaokê','Animal de estimação','Aplicativo de celular','Marca famosa','Comida de fast-food','Personagem de filme','Esporte','Profissão','Cidade para morar','Presente de aniversário'
  ];
  const cfg = window.TIER_CONFIG || {};
  const hasSupabase = !!(cfg.SUPABASE_URL && cfg.SUPABASE_ANON_KEY && window.supabase);
  const sb = hasSupabase ? window.supabase.createClient(cfg.SUPABASE_URL, cfg.SUPABASE_ANON_KEY) : null;
  const $app = document.getElementById('app');
  let channel = null;
  let timerHandle = null;
  let livePoll = null;
  const PLAYER_SESSION_KEY = 'tier_party_player_session_v1';

  const state = {
    view: 'home', role: null, game: null, players: [], me: null,
    answers: [], ranking: {}, revealIndex: -1, selectedColor: COLORS[0],
    hostSetup: { answerSeconds: 30, rounds: 5 },
    editingProfile: false,
    answerDraft: '', answerDraftRound: null,
    roundResultAnimatedKey: null,
    replayMode: false,
    couch: null
  };

  function esc(v=''){return String(v).replace(/[&<>'"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]));}
  function uid(){return crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).slice(2)+Date.now();}
  function code(){return Math.random().toString(36).slice(2,6).toUpperCase();}
  function nowIso(){return new Date().toISOString();}
  function secondsLeft(end){return Math.max(0,Math.ceil((new Date(end)-Date.now())/1000));}
  function infiniteTime(game=state.game){
    if(!game)return false;
    if(game.status==='answering' && !game.answer_deadline)return true;
    return state.role==='host' && sessionStorage.getItem(`tier_infinite_${game.id}`)==='1';
  }
  function timeLabel(seconds){return Number(seconds)===0?'∞':`${seconds}s`;}
  function fmtTime(s){const m=Math.floor(s/60),r=s%60;return `${String(m).padStart(2,'0')}:${String(r).padStart(2,'0')}`;}
  function toast(msg){const el=document.createElement('div');el.className='toast';el.textContent=msg;document.body.appendChild(el);setTimeout(()=>el.remove(),2600)}
  let appConfirmResolver=null;
  let appConfirmDismissible=true;
  function appConfirm(message,{title='Tem certeza?',confirmText='Confirmar',cancelText='Cancelar',danger=true,dismissible=true}={}){
    const overlay=document.getElementById('appConfirmOverlay');
    if(!overlay)return Promise.resolve(false);
    document.getElementById('appConfirmTitle').textContent=title;
    document.getElementById('appConfirmMessage').textContent=message;
    const ok=document.getElementById('appConfirmOk'), cancel=document.getElementById('appConfirmCancel');
    ok.textContent=confirmText; cancel.textContent=cancelText; ok.classList.toggle('danger',danger);
    appConfirmDismissible=dismissible; overlay.classList.remove('hidden');
    return new Promise(resolve=>{appConfirmResolver=resolve});
  }
  function closeAppConfirm(value){
    document.getElementById('appConfirmOverlay')?.classList.add('hidden');
    const resolve=appConfirmResolver; appConfirmResolver=null; appConfirmDismissible=true;
    if(resolve)resolve(Boolean(value));
  }
  function clearTimers(){if(timerHandle)clearInterval(timerHandle);if(livePoll)clearInterval(livePoll);timerHandle=livePoll=null;}
  function teardownChannel(){if(channel&&sb){sb.removeChannel(channel);channel=null}}
  function resetRealtime(){clearTimers();teardownChannel();}
  function page(inner){return `<div class="bg"><div class="shell">${inner}</div></div>`}
  function topbar(extra=''){return `<div class="topbar"><div class="brand"><img src="assets/tier-party-logo.png" alt="Tier Party"></div>${extra}</div>`}
  function backBtn(){return `<button class="btn ghost small" data-action="home">← Voltar</button>`}
  function playerColor(p){return p?.color || '#8b93a5'}
  function loadingDots(label='Aguardando'){const dots=`<span class="loading-dots" aria-label="Carregando"><i></i><i></i><i></i></span>`;return label?`<div class="waiting-inline"><span>${esc(label)}</span>${dots}</div>`:dots}
  function playerSession(){try{return JSON.parse(localStorage.getItem(PLAYER_SESSION_KEY)||'null')}catch(_){return null}}
  function savePlayerSession(){if(!state.game?.id||!state.me?.id)return;try{localStorage.setItem(PLAYER_SESSION_KEY,JSON.stringify({gameId:state.game.id,playerId:state.me.id,joinCode:state.game.join_code}))}catch(_){}}
  function clearPlayerSession(){try{localStorage.removeItem(PLAYER_SESSION_KEY)}catch(_){}}
  async function shareGame(){
    if(!state.game?.join_code)return;
    const url=`${location.origin}${location.pathname}?join=${encodeURIComponent(state.game.join_code)}`;
    const touch=window.matchMedia?.('(pointer: coarse)').matches || /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);
    if(touch&&typeof navigator.share==='function'){
      try{await navigator.share({title:'Tier Party',text:'Entre na minha partida do Tier Party!',url});return}catch(e){if(e?.name==='AbortError')return}
    }
    try{await navigator.clipboard.writeText(url);toast('Link da partida copiado!')}catch(_){
      const ta=document.createElement('textarea');ta.value=url;ta.setAttribute('readonly','');ta.style.position='fixed';ta.style.opacity='0';document.body.appendChild(ta);ta.select();document.execCommand('copy');ta.remove();toast('Link da partida copiado!')
    }
  }

  async function dbInsert(table,row){const {data,error}=await sb.from(table).insert(row).select().single();if(error)throw error;return data}
  async function dbUpdate(table,id,patch){const {data,error}=await sb.from(table).update(patch).eq('id',id).select().single();if(error)throw error;return data}
  async function loadGame(gameId){
    const [{data:g,error:ge},{data:p,error:pe},{data:a,error:ae}] = await Promise.all([
      sb.from('tier_games').select('*').eq('id',gameId).single(),
      sb.from('tier_players').select('*').eq('game_id',gameId).eq('is_active',true).order('created_at'),
      sb.from('tier_answers').select('*').eq('game_id',gameId).order('created_at')
    ]);
    if(ge)throw ge;if(pe)throw pe;if(ae)throw ae;
    state.game=g;state.players=p||[];state.answers=a||[];
    const myId=state.me?.id || playerSession()?.playerId || sessionStorage.getItem('tier_player_id');
    if(myId)state.me=state.players.find(x=>x.id===myId)||state.me;
  }
  async function loadByCode(joinCode){
    const {data,error}=await sb.from('tier_games').select('*').eq('join_code',joinCode.toUpperCase()).in('status',['lobby','theme','answering','ranking','reveal','round_result']).maybeSingle();
    if(error)throw error;return data;
  }
  function subscribe(gameId){
    teardownChannel();
    channel=sb.channel(`tier-${gameId}`)
      .on('postgres_changes',{event:'*',schema:'public',table:'tier_games',filter:`id=eq.${gameId}`},async()=>{await refreshAndRender()})
      .on('postgres_changes',{event:'*',schema:'public',table:'tier_players',filter:`game_id=eq.${gameId}`},async()=>{await refreshAndRender()})
      .on('postgres_changes',{event:'*',schema:'public',table:'tier_answers',filter:`game_id=eq.${gameId}`},async()=>{await refreshAndRender()})
      .subscribe();
    livePoll=setInterval(()=>refreshAndRender(true),3000);
  }
  async function refreshAndRender(silent=false){
    if(!state.game||!sb)return;
    const active=document.activeElement;
    const typingAnswer=state.role==='player' && state.view==='playerAnswer' && active?.id==='answerText';
    const typingProfile=state.role==='player' && state.editingProfile && (active?.id==='editPlayerName');
    const answerValue=typingAnswer ? active.value : null;
    const answerStart=typingAnswer ? active.selectionStart : null;
    const answerEnd=typingAnswer ? active.selectionEnd : null;
    const profileValue=typingProfile ? active.value : null;
    const profileStart=typingProfile ? active.selectionStart : null;
    const profileEnd=typingProfile ? active.selectionEnd : null;
    const previousStatus=state.game.status;
    try{
      await loadGame(state.game.id);
      if(state.role==='player' && !state.players.some(p=>p.id===state.me?.id)){
        clearPlayerSession(); resetRealtime(); state.role=null; state.game=null; state.me=null; state.view='home'; render(); if(!silent)toast('Você não está mais conectado a esta partida.'); return;
      }

      // Enquanto o jogador está digitando, atualizações de polling/realtime não devem
      // reconstruir a tela e roubar o foco. Se a etapa mudou, renderizamos normalmente.
      if(typingAnswer && previousStatus==='answering' && state.game.status==='answering' && !myRoundAnswer()){
        state.answerDraft=answerValue||'';state.answerDraftRound=state.game.round_no;
        return;
      }
      if(typingProfile && previousStatus==='lobby' && state.game.status==='lobby' && state.editingProfile){
        // O nome digitado fica no DOM; não redesenhamos a tela enquanto o campo está ativo.
        return;
      }

      routeFromGame();render();if(state.role==='host')hostAutoProgress();

      // Fallback: caso uma atualização indispensável tenha exigido redraw na mesma etapa,
      // restauramos foco/cursor imediatamente.
      if(typingAnswer && state.game?.status==='answering') requestAnimationFrame(()=>{const el=document.getElementById('answerText');if(el){el.value=answerValue||'';state.answerDraft=el.value;el.focus();try{el.setSelectionRange(answerStart,answerEnd)}catch(_){}}});
      if(typingProfile && state.game?.status==='lobby' && state.editingProfile) requestAnimationFrame(()=>{const el=document.getElementById('editPlayerName');if(el){el.value=profileValue||'';el.focus();try{el.setSelectionRange(profileStart,profileEnd)}catch(_){}}});
    }
    catch(e){if(!silent)toast(e.message)}
  }
  function routeFromGame(){
    if(!state.game)return;
    // Ao escolher "Jogar novamente", o host permanece na configuracao mesmo que
    // polling/realtime ainda recebam o estado final da partida anterior.
    // A navegacao volta a seguir o status do banco somente depois de criar/reiniciar a partida.
    if(state.role==='host' && state.replayMode && state.view==='hostConfig') return;
    if(state.role==='player' && state.editingProfile && state.game.status==='lobby') return;
    if(state.role==='player' && state.editingProfile && state.game.status!=='lobby') state.editingProfile=false;
    const s=state.game.status;
    if(state.role==='host'){
      state.view={lobby:'hostLobby',theme:'hostTheme',answering:'hostWaiting',ranking:'hostRanking',reveal:'hostRanking',round_result:'hostRoundResult',finished:'final'}[s]||state.view;
    }else if(state.role==='player'){
      state.view={lobby:'playerWaiting',theme:'playerWaiting',answering:'playerAnswer',ranking:'playerRankWait',reveal:'playerRankWait',round_result:'playerRoundResult',finished:'final'}[s]||state.view;
    }
  }
  function render(){
    clearInterval(timerHandle);timerHandle=null;
    const fn=views[state.view]||views.home;$app.innerHTML=fn();bind();postRender();
  }
  function bind(){
    const joinInput=document.getElementById('joinCode');if(joinInput)joinInput.addEventListener('keydown',e=>{if(e.key==='Enter')actions.findGame();});
    const answerInput=document.getElementById('answerText');if(answerInput)answerInput.addEventListener('input',e=>{state.answerDraft=e.target.value;state.answerDraftRound=state.game?.round_no??null;});
  }
  function postRender(){
    if(state.view==='hostLobby'&&state.game){
      const q=document.getElementById('qrcode');if(q&&window.QRCode){q.innerHTML='';new QRCode(q,{text:`${location.origin}${location.pathname}?join=${state.game.join_code}`,width:180,height:180});}
    }
    if(['hostWaiting','playerAnswer'].includes(state.view)&&state.game?.answer_deadline){startCountdown();}
    if(state.view==='couchAnswer'&&state.couch?.answerSeconds>0&&state.couch?.turnDeadline){startCouchCountdown();}
    if(state.view==='hostRanking')setupDragDrop();
    if(state.view==='couchRanking')setupDragDrop(true);
    if(state.view==='hostRoundResult'){
      const key=`${state.game?.id||''}:${state.game?.round_no||0}`;
      if(state.roundResultAnimatedKey===key) applyRoundResultFinal();
      else { state.roundResultAnimatedKey=key; animateRoundResult(); }
    }
  }
  function applyRoundResultFinal(){
    const list=document.getElementById('roundResultList');
    if(!list)return;
    const cards=[...list.querySelectorAll('.round-score-card')];
    const ordered=[...cards].sort((a,b)=>Number(a.dataset.finalOrder)-Number(b.dataset.finalOrder));
    ordered.forEach(card=>{
      card.style.opacity='1';
      card.style.transform='none';
      card.style.animation='none';
      const earned=card.querySelector('.round-score-earned');
      if(earned){earned.classList.add('show');earned.style.opacity='1';earned.style.transform='none';earned.style.animation='none';}
      const totalEl=card.querySelector('.round-score-total');
      if(totalEl)totalEl.textContent=String(Number(totalEl.dataset.scoreTotal||0));
      list.appendChild(card);
    });
  }

  function animateRoundResult(){
    const list=document.getElementById('roundResultList');
    if(!list)return;
    const cards=[...list.querySelectorAll('.round-score-card')];

    // 1) Os cards entram primeiro e permanecem um instante na ordem anterior.
    cards.forEach((card,i)=>{
      card.style.setProperty('--enter-delay',`${i*110}ms`);
    });

    // 2) Revela com calma quanto cada jogador ganhou nesta rodada.
    setTimeout(()=>{
      cards.forEach((card,i)=>{
        const earned=card.querySelector('.round-score-earned');
        setTimeout(()=>earned?.classList.add('show'),i*180);
      });
    },1500);

    // 3) Depois de deixar o ganho visível, anima a soma até o novo total.
    setTimeout(()=>{
      cards.forEach((card,i)=>{
        const totalEl=card.querySelector('.round-score-total');
        if(!totalEl)return;
        const from=Number(totalEl.dataset.scorePrevious||0), to=Number(totalEl.dataset.scoreTotal||0);
        const duration=1500;
        setTimeout(()=>{
          const start=performance.now();
          const tick=now=>{
            const t=Math.min(1,(now-start)/duration);
            const eased=1-Math.pow(1-t,3);
            totalEl.textContent=String(Math.round(from+(to-from)*eased));
            if(t<1)requestAnimationFrame(tick);
          };
          requestAnimationFrame(tick);
        },i*100);
      });
    },3900);

    // 4) Só depois do novo total ficar legível os cards mudam de posição.
    setTimeout(()=>{
      const first=new Map(cards.map(c=>[c,c.getBoundingClientRect()]));
      const ordered=[...cards].sort((a,b)=>Number(a.dataset.finalOrder)-Number(b.dataset.finalOrder));
      ordered.forEach(c=>list.appendChild(c));
      ordered.forEach(c=>{
        const a=first.get(c), b=c.getBoundingClientRect();
        const dx=a.left-b.left, dy=a.top-b.top;
        if(dx||dy){
          c.animate(
            [{transform:`translate(${dx}px,${dy}px)`},{transform:'translate(0,0)'}],
            {duration:1400,easing:'cubic-bezier(.2,.8,.2,1)',fill:'both'}
          );
        }
      });
    },6800);
  }

  function startCountdown(){
    const tick=()=>{const s=secondsLeft(state.game.answer_deadline);document.querySelectorAll('[data-timer]').forEach(x=>{x.textContent=x.closest('.waiting-timer-ring')?String(s):fmtTime(s);x.classList.toggle('danger',s<=5)});document.querySelectorAll('[data-timer-ring]').forEach(x=>{const total=Math.max(1,Number(state.game.answer_seconds)||1);const pct=Math.max(0,Math.min(100,(s/total)*100));x.style.setProperty('--timer-pct',pct+'%');x.classList.toggle('danger',s<=5)});if(s<=0){clearInterval(timerHandle);if(state.role==='host')hostAutoProgress(true);else if(state.role==='player'&&!myRoundAnswer())render();}};tick();timerHandle=setInterval(tick,500);
  }
  function myRoundAnswer(){return state.answers.find(a=>a.round_no===state.game.round_no&&a.player_id===state.me?.id)}
  function roundAnswers(){return state.answers.filter(a=>a.round_no===state.game.round_no)}
  function currentPlayers(){return state.players.filter(p=>p.is_active)}
  function answeredCount(){return roundAnswers().length}
  function rankMapFromAnswers(){const m={};roundAnswers().forEach(a=>{if(Number.isInteger(a.ranked_value))m[a.id]=a.ranked_value});return m}

  const views={
    home:()=>page(`<div class="hero home-hero"><section class="home-controls"><img class="home-main-logo" src="assets/tier-party-logo.png" alt="Tier Party"><div class="quick-join home-join-card"><label for="joinCode">Código da partida</label><div class="quick-join-row"><input id="joinCode" class="input" maxlength="4" placeholder="CÓDIGO" autocomplete="off" inputmode="text"><button class="btn primary" data-action="findGame">Entrar →</button></div></div><div class="home-or" aria-hidden="true"><span>OU</span></div><div class="home-actions home-secondary-actions"><button class="btn orange home-mode-button" data-action="hostConfig"><svg class="home-action-svg" viewBox="0 0 24 24" aria-hidden="true"><path d="M4 8.5 7.4 11 12 5l4.6 6L20 8.5 18.3 17H5.7L4 8.5Z"/><path d="M7 19h10"/></svg><span>CRIAR PARTIDA COMO HOST</span></button><button class="btn mint home-mode-button" data-action="couchSetup"><svg class="home-action-svg" viewBox="0 0 24 24" aria-hidden="true"><rect x="4" y="5" width="16" height="11" rx="2"/><path d="M9 20h6M12 16v4"/><circle cx="9" cy="10.5" r="1.3"/><circle cx="15" cy="10.5" r="1.3"/></svg><span>JOGAR NO MESMO DISPOSITIVO</span></button></div></section><aside class="panel demo-board home-demo-board">${[1,2,3,4,5,6,7].map((n,i)=>`<div class="mini-tier"><div class="n t${n}">${n}</div><div class="slots">${i<5?`<span class="mini-chip">${['Taylor Swift','Pizza','Japão','Mario Kart','Friends'][i]}</span>`:''}</div></div>`).join('')}</aside></div>`),

    join:()=>page(`${topbar(backBtn())}<section class="panel center-card"><div class="eyebrow">Entrar na partida</div><h2>Qual é o código?</h2><p>Digite o código exibido na tela do host.</p><div class="form-grid" style="grid-template-columns:1fr"><div class="field"><label>Código da partida</label><input id="joinCode" class="input" maxlength="4" placeholder="ABCD" style="text-transform:uppercase;font-size:30px;font-weight:1000;letter-spacing:8px;text-align:center"></div></div><div class="actions end"><button class="btn primary" data-action="findGame">Continuar →</button></div></section>`),

    playerProfile:()=>page(`${topbar(backBtn())}<section class="player-profile-screen"><img class="player-profile-logo" src="assets/tier-party-logo.png" alt="Tier Party"><div class="player-profile-code">${esc(state.game?.join_code||'')}</div><h1>Seu jogador</h1><div class="player-profile-form"><div class="field player-field"><input id="playerName" class="input" maxlength="22" placeholder="Seu nome"></div><div class="player-color-picker"><div class="player-picker-title">Escolha sua cor</div><div class="color-grid">${COLORS.map(c=>`<button class="color-choice ${state.selectedColor===c?'selected':''}" style="background:${c}" data-color="${c}" aria-label="cor"></button>`).join('')}</div></div><button class="btn primary player-wide-btn" data-action="joinGame">Entrar na partida →</button></div></section>`),

    hostConfig:()=>page(`<section class="setup-screen"><button class="btn setup-back-btn" data-action="home">← Voltar</button><div class="setup-content"><img class="setup-logo" src="assets/tier-party-logo.png" alt="Tier Party"><h1 class="setup-title">Configurar partida</h1><div class="stepper-grid setup-stepper-grid"><div class="stepper-box setup-option"><div class="setup-option-icon" aria-hidden="true"><svg viewBox="0 0 24 24"><circle cx="12" cy="13" r="8"></circle><path d="M12 9v4l2.5 1.5M9 2h6M12 2v3"></path></svg></div><div class="stepper"><button class="stepper-btn" aria-label="Diminuir tempo" data-action="timeMinus">−</button><strong>${timeLabel(state.hostSetup.answerSeconds)}</strong><button class="stepper-btn" aria-label="Aumentar tempo" data-action="timePlus">+</button></div></div><div class="stepper-box setup-option"><div class="setup-option-icon" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="M19.5 8A8 8 0 1 0 20 14"></path><path d="M19.5 3v5h-5"></path></svg></div><div class="stepper"><button class="stepper-btn" aria-label="Diminuir rodadas" data-action="roundMinus" ${state.hostSetup.rounds<=1?'disabled':''}>−</button><strong>${state.hostSetup.rounds}</strong><button class="stepper-btn" aria-label="Aumentar rodadas" data-action="roundPlus">+</button></div></div></div>${!hasSupabase?`<div class="card setup-warning"><strong>Supabase ainda não configurado.</strong><div class="subtle">Preencha o arquivo <code>config.js</code> para criar partidas multiplayer.</div></div>`:''}<div class="setup-create-wrap"><button class="btn orange setup-create-btn" data-action="createGame" ${!hasSupabase?'disabled':''}>${state.replayMode?'Jogar novamente →':'Criar partida →'}</button></div></div></section>`),

    hostLobby:()=>page(`${topbar(`<div class="pill">Lobby • ${esc(state.game.join_code)}</div>`)}<div class="lobby-grid lobby-grid-v17"><section class="join-card lobby-host-tools"><div class="lobby-qr-box"><div id="qrcode" class="qr"></div></div><button class="lobby-share-btn" data-action="shareGame" aria-label="Compartilhar partida" title="Compartilhar partida"><svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="18" cy="5" r="2.5"></circle><circle cx="6" cy="12" r="2.5"></circle><circle cx="18" cy="19" r="2.5"></circle><path d="M8.2 10.8 15.7 6.3M8.2 13.2l7.5 4.5"></path></svg></button><div class="lobby-code-box"><div class="code">${esc(state.game.join_code)}</div></div><div class="lobby-settings-box"><div class="lobby-setting"><svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="13" r="8"></circle><path d="M12 9v4l2.5 1.5M9 2h6M12 2v3"></path></svg><strong>${infiniteTime()?'∞':timeLabel(state.game.answer_seconds)}</strong></div><div class="lobby-setting"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M19.5 8A8 8 0 1 0 20 14"></path><path d="M19.5 3v5h-5"></path></svg><strong>${state.game.rounds_total}</strong></div></div><button class="btn primary lobby-start-btn" data-action="startGame" ${currentPlayers().length<2?'disabled':''}>Começar partida →</button></section><section class="panel players-panel lobby-players-panel"><div class="section-title lobby-section-title"><div class="lobby-player-count"><svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="8" r="4"></circle><path d="M4.5 20c.8-4.1 3.3-6.2 7.5-6.2s6.7 2.1 7.5 6.2"></path></svg><strong>${currentPlayers().length}</strong></div><button class="btn coral small lobby-end-btn" data-action="endGame">Encerrar</button></div><div class="player-list lobby-player-list">${currentPlayers().length?currentPlayers().map(p=>playerCard(p,true)).join(''):`<div class="lobby-waiting"><strong>Aguardando jogadores</strong><span class="loading-dots" aria-label="Carregando"><i></i><i></i><i></i></span></div>`}</div></section></div>`),

    playerWaiting:()=>playerPage(state.game?.status==='theme'?`<div class="player-state-stage"><div class="player-state-kicker">Próxima rodada</div><h1>Escolhendo o tema</h1><div class="player-topic-card"><span>Sugestão de tema</span><strong>${esc(state.game.theme_candidate||'')}</strong></div><div class="player-loading-line"><strong>Aguardando o host</strong>${loadingDots('')}</div></div>`:`<div class="player-state-stage"><div class="player-state-kicker">Você entrou!</div><h1>Aguardando a partida</h1><div class="player-loading-orb"><span class="loading-dots"><i></i><i></i><i></i></span></div><div class="player-loading-line"><strong>O host vai começar em breve</strong></div></div>`),

    hostTheme:()=>page(`${topbar(`<button class="btn coral theme-end-btn" data-action="endGame">Encerrar jogo</button>`)}<div class="theme-layout theme-layout-v112"><section class="theme-choice-column"><div class="theme-suggestion-label">Sugestão de tema</div><div class="theme-choice-card"><div class="theme-choice-name">${esc(state.game.theme_candidate||'')}</div></div><div class="theme-choice-actions"><button class="btn theme-skip-btn" data-action="skipTheme"><span>Pular tema</span><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M19.5 8A8 8 0 1 0 20 14"></path><path d="M19.5 3v5h-5"></path></svg></button><button class="btn primary theme-choose-btn" data-action="chooseTheme">Escolher este tema →</button></div></section><aside class="theme-info-column"><div class="theme-info-card"><div class="theme-round-indicator"><strong>${state.game.round_no}<small>/${state.game.rounds_total}</small></strong></div><div class="theme-scoreboard">${currentPlayers().map(p=>`<div class="theme-score-row"><span class="theme-score-color" style="background:${playerColor(p)}"></span><span class="theme-score-name">${esc(p.name)}</span><strong class="theme-score-points">${p.score||0}</strong></div>`).join('')}</div></div></aside></div>`),

    hostWaiting:()=>page(`${topbar(`<div class="theme-banner waiting-theme-card"><div class="tiny">Tema da rodada</div><strong>${esc(state.game.current_theme)}</strong></div><div class="waiting-timer-ring ${infiniteTime()?'infinite':''}" ${infiniteTime()?'':'data-timer-ring'} style="--timer-pct:${infiniteTime()?100:Math.max(0,Math.min(100,(secondsLeft(state.game.answer_deadline)/(Number(state.game.answer_seconds)||1))*100))}%"><div class="waiting-timer-inner timer" ${infiniteTime()?'':'data-timer'}>${infiniteTime()?'∞':secondsLeft(state.game.answer_deadline)}</div></div>`)}<section class="host-waiting-stage"><div class="waiting-status-row"><strong class="waiting-count">${answeredCount()}/${currentPlayers().length}</strong><span class="loading-dots waiting-loading" aria-label="Aguardando respostas"><i></i><i></i><i></i></span></div><div class="progress waiting-progress"><span style="width:${currentPlayers().length?answeredCount()/currentPlayers().length*100:0}%"></span></div><div class="waiting-player-grid">${currentPlayers().map(p=>{const answered=!!roundAnswers().find(a=>a.player_id===p.id);const color=playerColor(p);return `<div class="waiting-player-card ${answered?'answered':''}" style="--player-color:${color}"><div class="waiting-player-color" style="background:${color}"></div><div class="waiting-player-name">${esc(p.name)}</div>${answered?'<div class="waiting-player-check" aria-label="Resposta enviada">✓</div>':''}</div>`}).join('')}</div><div class="waiting-footer"><button class="btn dark" data-action="forceRanking">Ir para o ranking agora →</button></div></section>`),

    playerAnswer:()=>{
      const a=myRoundAnswer(); if(a)return playerPage(`<div class="player-state-stage"><div class="player-success-icon">✓</div><div class="player-state-kicker">Resposta enviada</div><div class="player-own-answer">${esc(a.answer_text)}</div><div class="player-loading-line"><strong>Aguardando jogadores</strong>${loadingDots('')}</div></div>`);
      const assignment=(state.game.assignments||{})[state.me?.id];
      if(!infiniteTime()&&secondsLeft(state.game.answer_deadline)<=0)return playerPage(`<div class="player-state-stage"><div class="player-timeout-icon">!</div><div class="player-state-kicker">Tempo encerrado</div><h1>Rodada encerrada</h1><div class="player-loading-line"><strong>Aguardando o host</strong>${loadingDots('')}</div></div>`);
      return playerPage(`<div class="player-answer-head"><div class="player-round-number">${state.game.round_no}/${state.game.rounds_total}</div><div class="waiting-timer-ring player-waiting-timer ${infiniteTime()?'infinite':''}" ${infiniteTime()?'':'data-timer-ring'} style="--timer-pct:${infiniteTime()?100:Math.max(0,Math.min(100,(secondsLeft(state.game.answer_deadline)/(Number(state.game.answer_seconds)||1))*100))}%"><div class="waiting-timer-inner timer" ${infiniteTime()?'':'data-timer'}>${infiniteTime()?'∞':secondsLeft(state.game.answer_deadline)}</div></div></div><div class="player-secret-wrap"><div class="secret-score">${assignment ?? '?'}</div></div><div class="player-topic-plain">${esc(state.game.current_theme)}</div><div class="player-answer-form"><input id="answerText" class="input player-answer-input" maxlength="48" placeholder="Digite sua resposta…" value="${esc(state.answerDraftRound===state.game.round_no?state.answerDraft:'')}"><button class="btn primary player-wide-btn" data-action="submitAnswer">Enviar resposta →</button></div>`)
    },

    hostRanking:()=>page(`${topbar(`<div class="theme-banner ranking-theme-card"><div class="tiny">Tema da rodada</div><strong>${esc(state.game.current_theme)}</strong></div><div class="ranking-round-count">${state.game.round_no}/${state.game.rounds_total}</div>`)}<div class="ranking-layout ranking-layout-v119"><aside class="ranking-sidebar"><div class="panel answers-bank ranking-bank-v119"><div id="bank" class="answer-cards dropzone">${rankingCards(null)}</div>${state.game.status==='reveal'?`<div class="ranking-reveal-wait">${loadingDots('Revelando respostas')}</div>`:''}</div><div class="ranking-sidebar-action">${state.game.status==='ranking'?`<button class="btn primary ranking-finish-btn" data-action="finishRanking">Finalizar ranking →</button>`:`<button class="btn primary ranking-finish-btn" data-action="continueAfterReveal" ${!allRevealed()?'disabled':''}>Ver pontos →</button>`}</div></aside><main><div class="tier-board">${[1,2,3,4,5,6,7].map(n=>tierRow(n)).join('')}</div></main></div>`),

    playerRankWait:()=>playerPage(`<div class="player-state-stage"><div class="player-state-kicker">Hora de rankear</div><h1>Olhe para a tela do host</h1><div class="player-own-answer"><span>Sua resposta</span><strong>${esc(myRoundAnswer()?.answer_text||'—')}</strong></div><div class="player-loading-line"><strong>Aguardando o ranking</strong>${loadingDots('')}</div></div>`),

    hostRoundResult:()=>page(`${topbar(`<div class="result-round-count">${state.game.round_no}/${state.game.rounds_total}</div>`)}<section class="round-result-screen"><h1 class="round-result-title">Resultado da rodada</h1><div class="round-result-board"><div id="roundResultList" class="round-result-list">${roundPlayerScoreCards()}</div></div><div class="round-result-actions"><button class="btn primary round-result-next" data-action="nextRound">${state.game.round_no>=state.game.rounds_total?'Encerrar o jogo':'Próxima rodada →'}</button></div></section>`),

    playerRoundResult:()=>{
      const mine=myRoundAnswer();
      const correct=roundAnswers().filter(a=>a.ranked_value===a.secret_value).length;
      const participated=!!mine;
      const participantCount=roundAnswers().length;
      const ownCorrect=mine?.ranked_value===mine?.secret_value;
      const othersCorrect=Math.max(0,correct-(ownCorrect?1:0));
      const ownBonus=ownCorrect?50*participantCount:0;
      const rankingBonus=participated?othersCorrect*50:0;
      const earned=ownBonus+rankingBonus;
      return playerPage(`<div class="player-result-stage"><div class="player-state-kicker">Fim da rodada</div><h1>${participated?(ownCorrect?'Acertou!':'Rodada concluída'):'Rodada concluída'}</h1><div class="player-round-earned ${earned>0?'positive':''}">+${earned}</div><div class="player-total-card"><span>Total</span><strong>${state.me?.score||0}</strong></div><div class="player-loading-line"><strong>Aguardando o host</strong>${loadingDots('')}</div></div>`)
    },

    playerEdit:()=>playerPage(`<div class="player-edit-stage"><div class="player-state-kicker">Seu perfil</div><h1>Editar jogador</h1><input id="editPlayerName" class="input player-answer-input" maxlength="22" value="${esc(state.me?.name||'')}"><div class="player-color-picker"><div class="player-picker-title">Escolha sua cor</div><div class="color-grid">${COLORS.map(c=>`<button class="color-choice ${state.selectedColor===c?'selected':''}" style="background:${c}" data-color="${c}" aria-label="cor"></button>`).join('')}</div></div><div class="player-edit-actions"><button class="btn ghost" data-action="cancelEditPlayer">Cancelar</button><button class="btn primary" data-action="savePlayerProfile">Salvar</button></div></div>`),

    final:()=>{
      if(state.role==='player'){
        const ranked=[...currentPlayers()].sort((a,b)=>(b.score||0)-(a.score||0));
        const place=Math.max(1,ranked.findIndex(p=>p.id===state.me?.id)+1);
        const content=`<section class="player-final-placement"><div class="player-final-overline">Você ficou em</div><div class="player-final-place ${place<=3?'podium':''}">${place}</div><div class="player-final-label">lugar</div><button class="btn primary player-final-home" data-action="home">Voltar para a home</button></section>`;
        return playerPage(content);
      }
      const hostActions=`<div class="final-actions"><button class="btn ghost final-home-btn" data-action="home">Voltar para a home</button><button class="btn primary final-replay-btn" data-action="replayConfig">Jogar novamente →</button></div>`;
      const content=`<section class="final-screen"><h1 class="final-title">Placar final</h1>${finalBoard()}${hostActions}</section>`;
      return page(`${topbar()}${content}`);
    },

    couchSetup:()=>page(`<section class="setup-screen couch-setup-screen"><button class="btn setup-back-btn" data-action="home">← Voltar</button><div class="setup-content couch-setup-content"><img class="setup-logo couch-setup-logo" src="assets/tier-party-logo.png" alt="Tier Party"><h1 class="setup-title">Configurar partida</h1><div class="stepper-grid setup-stepper-grid couch-stepper-grid"><div class="stepper-box setup-option"><div class="setup-option-icon" aria-hidden="true"><svg viewBox="0 0 24 24"><circle cx="12" cy="13" r="8"></circle><path d="M12 9v4l2.5 1.5M9 2h6M12 2v3"></path></svg></div><div class="stepper"><button class="stepper-btn" aria-label="Diminuir tempo" data-action="couchTimeMinus">−</button><strong>${timeLabel(state.couch.answerSeconds)}</strong><button class="stepper-btn" aria-label="Aumentar tempo" data-action="couchTimePlus">+</button></div></div><div class="stepper-box setup-option"><div class="setup-option-icon mint-icon" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="M19.5 8A8 8 0 1 0 20 14"></path><path d="M19.5 3v5h-5"></path></svg></div><div class="stepper"><button class="stepper-btn" aria-label="Diminuir rodadas" data-action="couchRoundMinus" ${state.couch.rounds<=1?'disabled':''}>−</button><strong>${state.couch.rounds}</strong><button class="stepper-btn" aria-label="Aumentar rodadas" data-action="couchRoundPlus">+</button></div></div></div><div class="couch-players-section"><div class="couch-players-title">Jogadores</div><div id="couchPlayers" class="couch-players-list">${couchPlayersRows()}</div><button class="btn couch-add-player" data-action="addCouchPlayer">+ Adicionar jogador</button></div><div class="setup-create-wrap"><button class="btn orange setup-create-btn" data-action="startCouch">Começar partida →</button></div></div></section>`),

    couchTheme:()=>page(`${topbar(`<div class="ranking-round-count">${state.couch.roundNo}/${state.couch.rounds}</div>`)}<div class="theme-layout theme-layout-v112 couch-theme-layout"><section class="theme-choice-column"><div class="theme-suggestion-label">Sugestão de tema</div><div class="theme-choice-card"><div class="theme-choice-name">${esc(state.couch.candidate)}</div></div><div class="theme-choice-actions"><button class="btn theme-skip-btn" data-action="couchSkipTheme"><span>Pular tema</span><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M19.5 8A8 8 0 1 0 20 14"></path><path d="M19.5 3v5h-5"></path></svg></button><button class="btn primary theme-choose-btn" data-action="couchChooseTheme">Escolher este tema →</button></div></section><aside class="theme-info-column"><div class="theme-info-card couch-score-card"><div class="theme-scoreboard">${[...state.couch.players].sort((a,b)=>(b.score||0)-(a.score||0)).map(p=>`<div class="theme-score-row"><span class="theme-score-color" style="background:${p.color}"></span><span class="theme-score-name">${esc(p.name)}</span><strong class="theme-score-points">${p.score||0}</strong></div>`).join('')}</div></div></aside></div>`),

    couchPass:()=>page(`${topbar(`<div class="ranking-round-count">${state.couch.roundNo}/${state.couch.rounds}</div>`)}<section class="couch-pass-stage"><div class="couch-pass-icon" aria-hidden="true"><svg viewBox="0 0 24 24"><rect x="6" y="2" width="12" height="20" rx="3"></rect><path d="M10 18h4"></path></svg></div><div class="player-state-kicker">Passe o aparelho</div><h1>${esc(state.couch.players[state.couch.turn].name)}</h1><p>Somente este jogador deve olhar a próxima tela.</p><button class="btn primary couch-primary-action" data-action="couchRevealTurn">Estou com o aparelho →</button></section>`),

    couchAnswer:()=>{const p=state.couch.players[state.couch.turn];const inf=state.couch.answerSeconds===0;const left=inf?'∞':secondsLeft(state.couch.turnDeadline);return page(`${topbar(`<div class="ranking-round-count">${state.couch.roundNo}/${state.couch.rounds}</div>`)}<section class="couch-answer-stage"><div class="player-answer-head couch-answer-head"><div class="couch-answer-player"><span class="theme-score-color" style="background:${p.color}"></span><strong>${esc(p.name)}</strong></div><div class="waiting-timer-ring couch-answer-timer ${inf?'infinite':''}" ${inf?'':'data-couch-timer-ring'} style="--timer-pct:${inf?100:Math.max(0,Math.min(100,(secondsLeft(state.couch.turnDeadline)/(Number(state.couch.answerSeconds)||1))*100))}%"><div class="waiting-timer-inner timer" ${inf?'':'data-couch-timer'}>${left}</div></div></div><div class="player-secret-wrap"><div class="secret-score">${p.assignment}</div></div><div class="player-topic-plain">${esc(state.couch.theme)}</div><div class="player-answer-form"><input id="couchAnswerText" class="input player-answer-input" maxlength="48" placeholder="Digite sua resposta…"><button class="btn primary player-wide-btn" data-action="couchSubmitAnswer">Enviar resposta →</button></div></section>`)} ,

    couchRanking:()=>page(`${topbar(`<div class="theme-banner ranking-theme-card"><div class="tiny">Tema da rodada</div><strong>${esc(state.couch.theme)}</strong></div><div class="ranking-round-count">${state.couch.roundNo}/${state.couch.rounds}</div>`)}<div class="ranking-layout ranking-layout-v119"><aside class="ranking-sidebar"><div class="panel answers-bank ranking-bank-v119"><div id="bank" class="answer-cards dropzone">${couchRankingCards(null)}</div>${state.couch.revealing?`<div class="ranking-reveal-wait">${loadingDots('Revelando respostas')}</div>`:''}</div><div class="ranking-sidebar-action">${state.couch.revealing?`<button class="btn primary ranking-finish-btn" data-action="couchResult" ${!state.couch.answers.every(a=>a.revealed)?'disabled':''}>Ver pontos →</button>`:`<button class="btn primary ranking-finish-btn" data-action="couchFinishRanking">Finalizar ranking →</button>`}</div></aside><main><div class="tier-board">${[1,2,3,4,5,6,7].map(n=>couchTierRow(n)).join('')}</div></main></div>`),

    couchResult:()=>page(`${topbar(`<div class="result-round-count">${state.couch.roundNo}/${state.couch.rounds}</div>`)}<section class="round-result-screen couch-result-screen"><h1 class="round-result-title">Resultado da rodada</h1><div class="round-result-board"><div class="round-result-list couch-result-list">${[...state.couch.players].sort((a,b)=>(b.score||0)-(a.score||0)).map(p=>`<div class="round-score-card" style="--player-color:${p.color}"><div class="round-score-main"><span class="round-score-color" style="background:${p.color}"></span><strong class="round-score-name">${esc(p.name)}</strong><strong class="round-score-total">${p.score||0}</strong></div><div class="round-score-earned">+${p.roundPoints||0}</div></div>`).join('')}</div></div><div class="round-result-actions"><button class="btn primary round-result-next" data-action="couchNextRound">${state.couch.roundNo>=state.couch.rounds?'Ver placar final':'Próxima rodada →'}</button></div></section>`),

    couchFinal:()=>page(`${topbar()}<section class="final-screen couch-final-screen"><h1 class="final-title">Placar final</h1>${couchFinalBoard()}<div class="final-actions"><button class="btn primary final-home-btn" data-action="home">Voltar para a home</button></div></section>`)
  };

  function playerPage(content){const canEdit=state.game?.status==='lobby';return `<div class="bg player-screen player-screen-v132"><section class="player-shell"><header class="player-hud"><div class="player-identity"><div class="player-color-chip" style="background:${playerColor(state.me)}"></div><div class="player-hud-copy"><strong>${esc(state.me?.name||'Jogador')}</strong>${state.game?.status!=='lobby'?`<span>${state.me?.score||0}</span>`:''}</div></div><div class="player-global-actions">${canEdit?`<button class="icon-btn" data-action="editPlayer" title="Editar nome e cor">✎</button>`:''}<button class="icon-btn disconnect" data-action="disconnectPlayer" title="Desconectar" aria-label="Sair da partida">×</button></div></header><main class="player-main">${content}</main></section></div>`}
  function playerCard(p,kick=false,ready=false){const color=playerColor(p);return `<div class="card player-card lobby-player-card" style="--player-color:${color};border-color:${color}"><div class="lobby-player-color" style="background:${color}" aria-label="Cor do jogador"></div><div class="player-name">${esc(p.name)}</div>${kick?`<button class="lobby-kick-btn" data-kick="${p.id}" aria-label="Expulsar ${esc(p.name)}" title="Expulsar jogador">×</button>`:''}</div>`}
  function rankingCards(tier){
    const placed=rankMapFromAnswers(); return roundAnswers().filter(a=>tier===null?placed[a.id]==null:placed[a.id]===tier).map(a=>answerCard(a)).join('');
  }
  function answerCard(a){const p=state.players.find(x=>x.id===a.player_id);const revealed=state.game.status==='reveal'&&a.revealed_at;const good=a.ranked_value===a.secret_value;return `<div class="answer-card ranking-answer-card ${revealed?(good?'reveal-good':'reveal-bad'):''}" draggable="${state.game.status==='ranking'}" data-answer-id="${a.id}" style="--player-color:${playerColor(p)}"><div class="grow"><div class="owner">${esc(p?.name||'Jogador')}</div><div class="answer">${esc(a.answer_text)}</div></div>${revealed?`<span class="true-badge">${a.secret_value}</span>`:''}</div>`}
  function tierRow(n){return `<div class="tier-row"><div class="tier-label t${n}">${n}</div><div class="tier-drop dropzone" data-tier="${n}">${rankingCards(n)}</div></div>`}
  function allRevealed(){const rs=roundAnswers();return rs.length>0&&rs.every(a=>a.revealed_at)}
  function resultCards(){return roundAnswers().map(a=>{const p=state.players.find(x=>x.id===a.player_id);const good=a.ranked_value===a.secret_value;return `<div class="card player-card" style="border-color:${good?'#38d57f':'#ff6464'}"><div class="avatar" style="background:${playerColor(p)}">${esc(p?.name?.[0]||'?')}</div><div class="grow"><div class="player-name">${esc(p?.name)}</div><div class="subtle">${esc(a.answer_text)} • colocado em ${a.ranked_value ?? '—'} / era ${a.secret_value}</div></div><strong class="${good?'correct-text':'wrong-text'}">${good?'✓':'×'}</strong></div>`}).join('')}
  function roundPlayerScoreCards(){
    const rs=roundAnswers();
    const correct=rs.filter(a=>a.ranked_value===a.secret_value).length;
    const participants=new Set(rs.map(a=>a.player_id));
    const data=currentPlayers().map(p=>{
      const mine=rs.find(a=>a.player_id===p.id);
      const participated=participants.has(p.id);
      const ownCorrect=!!(mine&&mine.ranked_value===mine.secret_value);
      const participantCount=rs.length;
      const othersCorrect=Math.max(0,correct-(ownCorrect?1:0));
      const ownBonus=ownCorrect?50*participantCount:0;
      const rankingBonus=participated?othersCorrect*50:0;
      const earned=ownBonus+rankingBonus;
      const total=Number(p.score||0);
      return {p,earned,total,previous:total-earned};
    });
    const previousOrder=[...data].sort((a,b)=>b.previous-a.previous||String(a.p.name).localeCompare(String(b.p.name),'pt-BR'));
    const finalOrder=[...data].sort((a,b)=>b.total-a.total||String(a.p.name).localeCompare(String(b.p.name),'pt-BR'));
    const finalPos=new Map(finalOrder.map((x,i)=>[x.p.id,i]));
    return previousOrder.map(({p,earned,total,previous})=>`<div class="round-score-card" data-player-id="${p.id}" data-final-order="${finalPos.get(p.id)}" style="--player-color:${playerColor(p)};border-color:${playerColor(p)}"><div class="round-score-main"><div class="round-score-name">${esc(p.name)}</div><div class="round-score-total" data-score-total="${total}" data-score-previous="${previous}">${previous}</div></div><div class="round-score-earned ${earned>0?'has-points':''}">+${earned}</div></div>`).join('');
  }

  function finalBoard(){
    const ps=[...state.players].filter(p=>p.is_active!==false).sort((a,b)=>(b.score||0)-(a.score||0)||String(a.name).localeCompare(String(b.name),'pt-BR'));
    const top=ps.slice(0,3);
    const podiumOrder=[top[1],top[0],top[2]].filter(Boolean);
    const medal=(place)=>`<div class="final-medal medal-${place}" aria-label="${place}º lugar"><span class="medal-ribbon medal-ribbon-left"></span><span class="medal-ribbon medal-ribbon-right"></span><span class="medal-disc">${place}</span></div>`;
    const podium=podiumOrder.map(p=>{
      const place=top.indexOf(p)+1;
      return `<div class="final-player-card place-${place}" style="--player-color:${playerColor(p)}">${medal(place)}<div class="final-player-name">${esc(p.name)}</div><div class="final-player-score">${p.score||0}</div></div>`;
    }).join('');
    const rest=ps.slice(3).map((p,i)=>`<div class="final-rest-row" style="--player-color:${playerColor(p)}"><strong>${i+4}º</strong><span class="final-rest-color"></span><span>${esc(p.name)}</span><strong>${p.score||0}</strong></div>`).join('');
    return `<div class="final-board"><div class="final-podium">${podium}</div>${rest?`<div class="final-rest-list">${rest}</div>`:''}</div>`
  }
  function setupDragDrop(couch=false){
    const canDrag=couch?!state.couch.revealing:state.game.status==='ranking'; if(!canDrag)return;
    const moveAnswer=async(id,tier)=>{if(couch){const a=state.couch.answers.find(x=>x.id===id);if(a)a.ranked=tier;render()}else{try{await sb.from('tier_answers').update({ranked_value:tier}).eq('id',id);await refreshAndRender()}catch(err){toast(err.message)}}};
    document.querySelectorAll('.answer-card[draggable="true"]').forEach(card=>card.addEventListener('dragstart',e=>e.dataTransfer.setData('text/plain',card.dataset.answerId)));
    document.querySelectorAll('.dropzone').forEach(zone=>{
      zone.addEventListener('dragover',e=>{e.preventDefault();zone.classList.add('dragover')});
      zone.addEventListener('dragleave',()=>zone.classList.remove('dragover'));
      zone.addEventListener('drop',async e=>{e.preventDefault();e.stopPropagation();zone.classList.remove('dragover');const id=e.dataTransfer.getData('text/plain');const tier=zone.id==='bank'?null:Number(zone.dataset.tier);await moveAnswer(id,tier)});
    });
    // The whole left answers panel is also a return target. This keeps the bank usable
    // even when every answer has already been placed in a tier and #bank is visually empty.
    document.querySelectorAll('.ranking-bank-v119').forEach(bank=>{
      bank.addEventListener('dragover',e=>{e.preventDefault();bank.classList.add('dragover')});
      bank.addEventListener('dragleave',e=>{if(!bank.contains(e.relatedTarget))bank.classList.remove('dragover')});
      bank.addEventListener('drop',async e=>{if(e.target.closest('.tier-drop'))return;e.preventDefault();bank.classList.remove('dragover');const id=e.dataTransfer.getData('text/plain');if(id)await moveAnswer(id,null)});
    });
  }

  async function hostAutoProgress(force=false){
    if(!state.game||state.role!=='host'||state.game.status!=='answering')return;
    const done=answeredCount()>=currentPlayers().length;const expired=!infiniteTime()&&secondsLeft(state.game.answer_deadline)<=0;
    if(force||done||expired){await setRanking();}
  }
  async function setRanking(){
    if(state.game.status!=='answering')return;
    const count=answeredCount();
    if(count<2){await handleIncompleteRound(count);return;}
    const g=await dbUpdate('tier_games',state.game.id,{status:'ranking',updated_at:nowIso()});state.game=g;routeFromGame();render();
  }
  async function retryIncompleteRound(){
    if(!state.game?.id)return;
    try{
      await sb.from('tier_answers').delete().eq('game_id',state.game.id).eq('round_no',state.game.round_no);
      state.answers=state.answers.filter(a=>a.round_no!==state.game.round_no);
      state.answerDraft='';state.answerDraftRound=state.game.round_no;
      const deadline=infiniteTime()?null:new Date(Date.now()+state.game.answer_seconds*1000).toISOString();
      const assignments=shuffledAssignments(currentPlayers());
      state.game=await dbUpdate('tier_games',state.game.id,{status:'answering',assignments,answer_deadline:deadline,updated_at:nowIso()});
      routeFromGame();render();
    }catch(e){toast(e.message)}
  }
  async function nextThemeAfterIncomplete(){
    if(!state.game?.id)return;
    try{
      await sb.from('tier_answers').delete().eq('game_id',state.game.id).eq('round_no',state.game.round_no);
      state.answers=state.answers.filter(a=>a.round_no!==state.game.round_no);
      state.answerDraft='';state.answerDraftRound=null;
      state.game=await dbUpdate('tier_games',state.game.id,{status:'theme',current_theme:null,theme_candidate:randomTheme(state.game.current_theme||state.game.theme_candidate),assignments:{},answer_deadline:null,updated_at:nowIso()});
      routeFromGame();render();
    }catch(e){toast(e.message)}
  }
  async function handleIncompleteRound(count){
    const retry=await appConfirm(count===0?'Ninguém respondeu esta rodada. São necessárias pelo menos 2 respostas para continuar.':'Apenas 1 jogador respondeu esta rodada. São necessárias pelo menos 2 respostas para continuar.',{title:'Rodada incompleta',confirmText:'Tentar novamente',cancelText:'Próximo tema',danger:false,dismissible:false});
    if(retry)await retryIncompleteRound();else await nextThemeAfterIncomplete();
  }
  function randomTheme(exclude){const list=THEMES.filter(x=>x!==exclude);return list[Math.floor(Math.random()*list.length)]}
  function shuffledAssignments(players){const out={};players.forEach(p=>out[p.id]=1+Math.floor(Math.random()*7));return out}

  const actions={
    home(){resetRealtime();state.view='home';state.role=null;state.game=null;state.players=[];state.me=null;state.answers=[];state.editingProfile=false;state.replayMode=false;state.couch=null;history.replaceState({},'',location.pathname);render()},
    openJoin(){state.view='join';render()},hostConfig(){state.hostSetup=state.hostSetup||{answerSeconds:30,rounds:5};state.view='hostConfig';render()},timeMinus(){state.hostSetup.answerSeconds=state.hostSetup.answerSeconds===30?0:Math.max(0,state.hostSetup.answerSeconds-30);render()},timePlus(){state.hostSetup.answerSeconds=state.hostSetup.answerSeconds===0?30:state.hostSetup.answerSeconds+30;render()},roundMinus(){state.hostSetup.rounds=Math.max(1,state.hostSetup.rounds-1);render()},roundPlus(){state.hostSetup.rounds+=1;render()},shareGame(){shareGame()},couchSetup(){state.couch={answerSeconds:30,rounds:5,players:[{id:uid(),name:'Jogador 1',color:COLORS[0],score:0},{id:uid(),name:'Jogador 2',color:COLORS[3],score:0},{id:uid(),name:'Jogador 3',color:COLORS[4],score:0}]};state.view='couchSetup';render()},
    replayConfig(){if(!state.game||state.role!=='host')return;state.hostSetup={answerSeconds:infiniteTime()?0:Number(state.game.answer_seconds)||30,rounds:Number(state.game.rounds_total)||5};state.replayMode=true;state.view='hostConfig';render()},
    async createGame(){try{const rounds=state.hostSetup.rounds,isInfinite=state.hostSetup.answerSeconds===0,answer_seconds=isInfinite?30:state.hostSetup.answerSeconds;if(state.replayMode&&state.game?.id){await sb.from('tier_answers').delete().eq('game_id',state.game.id);await sb.from('tier_players').update({score:0,updated_at:nowIso()}).eq('game_id',state.game.id).eq('is_active',true);state.game=await dbUpdate('tier_games',state.game.id,{rounds_total:rounds,answer_seconds,status:'lobby',round_no:0,current_theme:null,theme_candidate:randomTheme(),assignments:{},answer_deadline:null,finished_at:null,updated_at:nowIso()});if(isInfinite)sessionStorage.setItem(`tier_infinite_${state.game.id}`,'1');else sessionStorage.removeItem(`tier_infinite_${state.game.id}`);state.replayMode=false;state.answers=[];state.roundResultAnimatedKey=null;await refreshAndRender();return;}let join_code=code(),g=null;for(let i=0;i<5&&!g;i++){const {data,error}=await sb.from('tier_games').insert({join_code,rounds_total:rounds,answer_seconds,status:'lobby',round_no:0,theme_candidate:randomTheme()}).select().single();if(!error)g=data;else if(error.code==='23505')join_code=code();else throw error}if(!g)throw new Error('Não foi possível gerar um código de sala.');state.role='host';state.game=g;sessionStorage.setItem('tier_host_game',g.id);if(isInfinite)sessionStorage.setItem(`tier_infinite_${g.id}`,'1');else sessionStorage.removeItem(`tier_infinite_${g.id}`);subscribe(g.id);await refreshAndRender()}catch(e){toast(e.message)}},
    async findGame(){if(!hasSupabase)return toast('Configure o Supabase primeiro.');const c=document.getElementById('joinCode').value.trim().toUpperCase();if(c.length!==4)return toast('Digite o código de 4 caracteres.');try{const g=await loadByCode(c);if(!g)return toast('Partida não encontrada.');state.game=g;state.view='playerProfile';render()}catch(e){toast(e.message)}},
    async joinGame(){const name=document.getElementById('playerName').value.trim();if(name.length<2)return toast('Digite um nome.');try{const p=await dbInsert('tier_players',{game_id:state.game.id,name,color:state.selectedColor,score:0,is_active:true});state.role='player';state.me=p;sessionStorage.setItem('tier_player_id',p.id);savePlayerSession();subscribe(state.game.id);await refreshAndRender()}catch(e){toast(e.message)}},
    editPlayer(){if(!state.me||!state.game)return;if(state.game.status!=='lobby')return toast('O perfil só pode ser editado no lobby.');state.selectedColor=state.me.color||COLORS[0];state.editingProfile=true;state.view='playerEdit';render();},
    cancelEditPlayer(){state.editingProfile=false;routeFromGame();render()},
    async savePlayerProfile(){const name=document.getElementById('editPlayerName')?.value.trim();if(!name)return toast('Digite seu nome.');try{state.me=await dbUpdate('tier_players',state.me.id,{name,color:state.selectedColor,updated_at:nowIso()});state.editingProfile=false;savePlayerSession();routeFromGame();render()}catch(e){toast(e.message)}},
    async disconnectPlayer(){if(!state.me||!state.game)return;if(appConfirmResolver)return;if(!(await appConfirm('Você pode entrar novamente com o código da sala depois, se ela ainda estiver aberta.',{title:'Sair da partida?',confirmText:'Sair',cancelText:'Ficar',danger:true})))return;try{await sb.from('tier_players').update({is_active:false,updated_at:nowIso()}).eq('id',state.me.id).eq('game_id',state.game.id)}catch(e){console.warn(e)}clearPlayerSession();sessionStorage.removeItem('tier_player_id');resetRealtime();state.role=null;state.game=null;state.me=null;state.players=[];state.answers=[];state.editingProfile=false;state.view='home';history.replaceState({},'',location.pathname);render();toast('Você saiu da partida.')},
    async kick(id){const p=state.players.find(x=>x.id===id);if(!(await appConfirm(`Expulsar ${p?.name||'este jogador'} da partida?`,{title:'Remover jogador?',confirmText:'Remover',cancelText:'Cancelar',danger:true})))return;try{await sb.from('tier_players').update({is_active:false}).eq('id',id);await refreshAndRender()}catch(e){toast(e.message)}},
    async startGame(){if(currentPlayers().length<2)return;try{const g=await dbUpdate('tier_games',state.game.id,{status:'theme',round_no:1,theme_candidate:randomTheme(),updated_at:nowIso()});state.game=g;routeFromGame();render()}catch(e){toast(e.message)}},
    async skipTheme(){try{state.game=await dbUpdate('tier_games',state.game.id,{theme_candidate:randomTheme(state.game.theme_candidate),updated_at:nowIso()});render()}catch(e){toast(e.message)}},
    async chooseTheme(){try{const deadline=infiniteTime()?null:new Date(Date.now()+state.game.answer_seconds*1000).toISOString();const assignments=shuffledAssignments(currentPlayers());state.answerDraft='';state.answerDraftRound=state.game.round_no;state.game=await dbUpdate('tier_games',state.game.id,{status:'answering',current_theme:state.game.theme_candidate,assignments,answer_deadline:deadline,updated_at:nowIso()});routeFromGame();render()}catch(e){toast(e.message)}},
    async submitAnswer(){const t=document.getElementById('answerText').value.trim();if(!t)return toast('Digite uma resposta.');if(!infiniteTime()&&secondsLeft(state.game.answer_deadline)<=0)return toast('O tempo acabou.');try{const secret=(state.game.assignments||{})[state.me.id];await dbInsert('tier_answers',{game_id:state.game.id,round_no:state.game.round_no,player_id:state.me.id,answer_text:t,secret_value:secret});state.answerDraft='';state.answerDraftRound=null;await refreshAndRender()}catch(e){toast(e.message)}},
    async forceRanking(){await setRanking()},
    async finishRanking(){const rs=roundAnswers();const placed=rs.filter(a=>Number.isInteger(a.ranked_value));if(placed.length!==rs.length)return toast('Posicione todas as respostas antes de finalizar.');try{state.game=await dbUpdate('tier_games',state.game.id,{status:'reveal',updated_at:nowIso()});state.view='hostRanking';render();await revealSequentially()}catch(e){toast(e.message)}},
    async continueAfterReveal(){try{state.game=await dbUpdate('tier_games',state.game.id,{status:'round_result',updated_at:nowIso()});routeFromGame();render()}catch(e){toast(e.message)}},
    async nextRound(){try{if(state.game.round_no>=state.game.rounds_total){state.game=await dbUpdate('tier_games',state.game.id,{status:'finished',finished_at:nowIso(),updated_at:nowIso()});routeFromGame();render();return;}state.answerDraft='';state.answerDraftRound=null;state.game=await dbUpdate('tier_games',state.game.id,{status:'theme',round_no:state.game.round_no+1,current_theme:null,theme_candidate:randomTheme(state.game.current_theme),assignments:{},answer_deadline:null,updated_at:nowIso()});routeFromGame();render()}catch(e){toast(e.message)}},
    async endGame(){if(!(await appConfirm('A partida será encerrada para todos os jogadores.',{title:'Encerrar partida?',confirmText:'Encerrar',cancelText:'Cancelar',danger:true})))return;try{state.game=await dbUpdate('tier_games',state.game.id,{status:'finished',finished_at:nowIso(),updated_at:nowIso()});routeFromGame();render()}catch(e){toast(e.message)}},

    couchTimeMinus(){readCouchSetup();state.couch.answerSeconds=state.couch.answerSeconds===30?0:Math.max(0,state.couch.answerSeconds-30);render()},
    couchTimePlus(){readCouchSetup();state.couch.answerSeconds=state.couch.answerSeconds===0?30:state.couch.answerSeconds+30;render()},
    couchRoundMinus(){readCouchSetup();state.couch.rounds=Math.max(1,state.couch.rounds-1);render()},
    couchRoundPlus(){readCouchSetup();state.couch.rounds+=1;render()},
    addCouchPlayer(){readCouchSetup();state.couch.players.push({id:uid(),name:`Jogador ${state.couch.players.length+1}`,color:COLORS[state.couch.players.length%COLORS.length],score:0});render()},
    startCouch(){readCouchSetup();if(state.couch.players.length<2)return toast('Adicione pelo menos 2 jogadores.');if(state.couch.players.some(p=>!p.name.trim()))return toast('Todos precisam de um nome.');state.couch.roundNo=1;state.couch.candidate=randomTheme();state.view='couchTheme';render()},
    couchSkipTheme(){state.couch.candidate=randomTheme(state.couch.candidate);render()},
    couchChooseTheme(){state.couch.theme=state.couch.candidate;state.couch.players.forEach(p=>{p.assignment=1+Math.floor(Math.random()*7);p.roundPoints=0});state.couch.answers=[];state.couch.turn=0;state.couch.turnDeadline=null;state.view='couchPass';render()},
    couchRevealTurn(){state.couch.turnDeadline=state.couch.answerSeconds===0?null:new Date(Date.now()+state.couch.answerSeconds*1000).toISOString();state.view='couchAnswer';render()},
    couchSubmitAnswer(){const t=document.getElementById('couchAnswerText').value.trim();if(!t)return toast('Digite uma resposta.');submitCouchAnswerValue(t)},
    couchFinishRanking(){if(state.couch.answers.some(a=>a.ranked==null))return toast('Posicione todas as respostas.');state.couch.revealing=true;render();couchRevealSequentially()},
    couchResult(){state.view='couchResult';render()},
    couchNextRound(){if(state.couch.roundNo>=state.couch.rounds){state.view='couchFinal';render();return;}state.couch.roundNo++;state.couch.candidate=randomTheme(state.couch.theme);state.view='couchTheme';render()}
  };

  async function revealSequentially(){
    const rs=roundAnswers();
    const participantIds=[...new Set(rs.map(a=>a.player_id))];
    const items=[...rs].sort((a,b)=>(b.ranked_value??-1)-(a.ranked_value??-1));
    for(const a of items){
      const good=a.ranked_value===a.secret_value;
      const ownerAward=good?50*participantIds.length:0;
      await sb.from('tier_answers').update({points_awarded:ownerAward,revealed_at:nowIso()}).eq('id',a.id);
      if(good){
        for(const id of participantIds){
          if(id===a.player_id)continue;
          const p=state.players.find(x=>x.id===id);
          if(!p)continue;
          p.score=(p.score||0)+50;
          await sb.from('tier_players').update({score:p.score}).eq('id',id);
        }
        const owner=state.players.find(x=>x.id===a.player_id);
        if(owner){
          owner.score=(owner.score||0)+ownerAward;
          await sb.from('tier_players').update({score:owner.score}).eq('id',owner.id);
        }
      }
      await loadGame(state.game.id);render();await new Promise(r=>setTimeout(r,1100));
    }
  }

  function readCouchSetup(){
    if(!state.couch)state.couch={players:[],answerSeconds:30,rounds:5};
    const rows=[...document.querySelectorAll('.couch-player-row')];
    if(rows.length){state.couch.players=rows.map((r,i)=>({id:state.couch.players[i]?.id||uid(),name:r.querySelector('input').value.trim(),color:r.dataset.color||state.couch.players[i]?.color||COLORS[i%COLORS.length],score:state.couch.players[i]?.score||0}));}
  }
  function couchPlayersRows(){return state.couch.players.map((p,i)=>`<div class="couch-player-row" data-color="${p.color}"><button class="couch-color-swatch" data-couch-color="${i}" style="background:${p.color}" aria-label="Trocar cor de ${esc(p.name)}" title="Trocar cor"></button><input class="input couch-player-name" value="${esc(p.name)}" maxlength="22"><button class="couch-remove-player" data-remove-couch="${i}" ${state.couch.players.length<=2?'disabled':''} aria-label="Remover jogador">×</button></div>`).join('')}

  function submitCouchAnswerValue(text){
    const p=state.couch.players[state.couch.turn];
    if(!p)return;
    state.couch.answers.push({id:uid(),playerId:p.id,text,secret:p.assignment,ranked:null,revealed:false});
    state.couch.turn++;state.couch.turnDeadline=null;
    if(state.couch.turn>=state.couch.players.length){state.couch.revealing=false;state.view='couchRanking'}else state.view='couchPass';
    render();
  }
  function startCouchCountdown(){
    const tick=()=>{
      const s=secondsLeft(state.couch.turnDeadline);
      document.querySelectorAll('[data-couch-timer]').forEach(x=>{x.textContent=String(s);x.classList.toggle('danger',s<=5)});
      document.querySelectorAll('[data-couch-timer-ring]').forEach(x=>{const total=Math.max(1,Number(state.couch.answerSeconds)||1);const pct=Math.max(0,Math.min(100,(s/total)*100));x.style.setProperty('--timer-pct',pct+'%');x.classList.toggle('danger',s<=5)});
      if(s<=0){clearInterval(timerHandle);timerHandle=null;submitCouchAnswerValue('Sem resposta');}
    };
    tick(); if(state.view==='couchAnswer')timerHandle=setInterval(tick,500);
  }
  function couchRankingCards(tier){return state.couch.answers.filter(a=>tier===null?a.ranked==null:a.ranked===tier).map(couchAnswerCard).join('')}
  function couchAnswerCard(a){const p=state.couch.players.find(x=>x.id===a.playerId);const good=a.ranked===a.secret;return `<div class="answer-card ranking-answer-card ${a.revealed?(good?'reveal-good':'reveal-bad'):''}" draggable="${!state.couch.revealing}" data-answer-id="${a.id}" style="--player-color:${p.color}"><div class="grow"><div class="owner">${esc(p.name)}</div><div class="answer">${esc(a.text)}</div></div>${a.revealed?`<span class="true-badge">${a.secret}</span>`:''}</div>`}
  function couchTierRow(n){return `<div class="tier-row"><div class="tier-label t${n}">${n}</div><div class="tier-drop dropzone" data-tier="${n}">${couchRankingCards(n)}</div></div>`}
  function couchRevealSequentially(){const items=[...state.couch.answers].sort((a,b)=>b.ranked-a.ranked);const participantCount=state.couch.answers.length;let i=0;const next=()=>{if(i>=items.length)return;const a=items[i++];a.revealed=true;const good=a.ranked===a.secret;if(good){state.couch.players.forEach(p=>{if(p.id===a.playerId)return;p.score+=50;p.roundPoints=(p.roundPoints||0)+50});const owner=state.couch.players.find(x=>x.id===a.playerId);if(owner){const ownerAward=50*participantCount;owner.score+=ownerAward;owner.roundPoints=(owner.roundPoints||0)+ownerAward}}render();setTimeout(next,950)};next()}
  function couchFinalBoard(){const oldPlayers=state.players;state.players=state.couch.players;const html=finalBoard();state.players=oldPlayers;return html}

  // Resume/join by URL
  async function restorePlayerSession(){
    if(!hasSupabase)return false;
    const sess=playerSession();if(!sess?.gameId||!sess?.playerId)return false;
    try{
      const [{data:g},{data:p}]=await Promise.all([sb.from('tier_games').select('*').eq('id',sess.gameId).maybeSingle(),sb.from('tier_players').select('*').eq('id',sess.playerId).eq('game_id',sess.gameId).eq('is_active',true).maybeSingle()]);
      if(!g||!p||g.status==='finished'){clearPlayerSession();return false}
      state.role='player';state.game=g;state.me=p;sessionStorage.setItem('tier_player_id',p.id);subscribe(g.id);await loadGame(g.id);routeFromGame();return true;
    }catch(_){return false}
  }
  async function boot(){
    if(await restorePlayerSession()){render();return}
    const params=new URLSearchParams(location.search);const join=params.get('join');
    if(join&&hasSupabase){try{const g=await loadByCode(join);if(g){state.game=g;state.view='playerProfile'}}catch(_){}
    }
    render();
  }
  // Delegação única de cliques: permanece válida mesmo quando o app é redesenhado
  // por atualizações em tempo real. Isso deixa editar/desconectar confiável no desktop e mobile.
  $app.addEventListener('click',e=>{
    const actionEl=e.target.closest('[data-action]');
    if(actionEl && $app.contains(actionEl)){
      e.preventDefault();
      const fn=actions[actionEl.dataset.action];
      if(fn) fn(actionEl);
      return;
    }
    const colorEl=e.target.closest('[data-color]');
    if(colorEl && $app.contains(colorEl)){
      e.preventDefault();
      state.selectedColor=colorEl.dataset.color;
      // Ao editar perfil, preserve o nome que ainda não foi salvo ao trocar a cor.
      const pendingName=document.getElementById('editPlayerName')?.value;
      render();
      if(pendingName!=null){const el=document.getElementById('editPlayerName');if(el)el.value=pendingName;}
      return;
    }
    const kickEl=e.target.closest('[data-kick]');
    if(kickEl && $app.contains(kickEl)){e.preventDefault();actions.kick(kickEl.dataset.kick);return;}
    const couchColorEl=e.target.closest('[data-couch-color]');
    if(couchColorEl && $app.contains(couchColorEl)){
      e.preventDefault();readCouchSetup();const i=+couchColorEl.dataset.couchColor;const current=state.couch.players[i]?.color;const next=COLORS[(Math.max(0,COLORS.indexOf(current))+1)%COLORS.length];if(state.couch.players[i])state.couch.players[i].color=next;render();return;
    }
    const removeEl=e.target.closest('[data-remove-couch]');
    if(removeEl && $app.contains(removeEl)){e.preventDefault();readCouchSetup();state.couch.players.splice(+removeEl.dataset.removeCouch,1);render();}
  });

  document.getElementById('appConfirmCancel')?.addEventListener('click',()=>closeAppConfirm(false));
  document.getElementById('appConfirmOk')?.addEventListener('click',()=>closeAppConfirm(true));
  document.getElementById('appConfirmOverlay')?.addEventListener('click',e=>{if(e.target===document.getElementById('appConfirmOverlay')&&appConfirmDismissible)closeAppConfirm(false)});
  boot();

  function closeHostGameOnPageExit(event){
    if(event?.persisted)return;
    if(state.role!=='host'||!state.game?.id||state.game.status==='finished'||!hasSupabase)return;
    try{
      const url=`${cfg.SUPABASE_URL}/rest/v1/tier_games?id=eq.${encodeURIComponent(state.game.id)}`;
      fetch(url,{method:'PATCH',headers:{apikey:cfg.SUPABASE_ANON_KEY,Authorization:`Bearer ${cfg.SUPABASE_ANON_KEY}`,'Content-Type':'application/json',Prefer:'return=minimal'},body:JSON.stringify({status:'finished',finished_at:nowIso(),updated_at:nowIso()}),keepalive:true}).catch(()=>{});
    }catch(_){}
  }
  window.addEventListener('pagehide',closeHostGameOnPageExit);
})();
