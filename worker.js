const PROFILE = 'https://api.dexscreener.com/token-profiles/latest/v1';
const BOOST = 'https://api.dexscreener.com/token-boosts/latest/v1';
const TOKENS = (chain, addrs) => `https://api.dexscreener.com/tokens/v1/${encodeURIComponent(chain)}/${addrs.join(',')}`;
const DEFAULTS = { enabled:false, mode:'PAPER', size:50, maxOpen:3, minScore:74, dailyCap:30, cooldown:20, walletAddress:'', walletChainId:'', lastScan:0, lastTick:0 };
const now = () => Date.now();
const num = v => Number.isFinite(Number(v)) ? Number(v) : 0;
const clamp = (v,a,b) => Math.max(a,Math.min(b,v));
const json = (x, status=200) => new Response(JSON.stringify(x), {status, headers:{'content-type':'application/json; charset=utf-8','cache-control':'no-store','access-control-allow-origin':'*'}});
const ageHours = t => t ? Math.max(0,(now()-Number(t))/3600000) : 999;
const keyFor = p => `${p.chainId||''}|${p.baseToken?.address||''}`;
const money = v => '$'+num(v).toFixed(2);

function scorePair(p){
  const liq=num(p?.liquidity?.usd), vol=num(p?.volume?.h24), buys=num(p?.txns?.h24?.buys), sells=num(p?.txns?.h24?.sells), flow=(buys+sells)?buys/(buys+sells):0.5;
  const pc5=num(p?.priceChange?.m5), pc1=num(p?.priceChange?.h1), pc6=num(p?.priceChange?.h6), age=ageHours(p?.pairCreatedAt);
  const liqScore=clamp((Math.log10(Math.max(liq,1000))-3)/3*100,0,100), flowScore=clamp(flow*100,0,100);
  const fastScore=clamp(50+pc5*5+pc1*1.8,0,100), momentumScore=clamp(50+pc5*3.5+pc1*1.6+pc6*.35,0,100);
  const activity=clamp((vol/Math.max(liq,1))*60,0,100), ageScore=age<=72?clamp(100-Math.max(0,age-3)*1.7,25,100):20;
  const supportScore=clamp(liqScore*.60+flowScore*.25+activity*.15,0,100);
  const risk=clamp(100-(liqScore*.34+flowScore*.22+momentumScore*.18+activity*.16+ageScore*.10),0,100);
  const huntScore=Math.round(clamp(liqScore*.24+supportScore*.20+flowScore*.22+fastScore*.18+momentumScore*.11+activity*.05,0,100));
  const earlyBonus=age<=24?12:age<=72?7:0;
  const acceleration=clamp(50+pc5*6+pc1*2.2-pc6*.05,0,100);
  const x100Score=Math.round(clamp(liqScore*.18+flowScore*.23+acceleration*.19+momentumScore*.17+activity*.13+ageScore*.10-risk*.10+earlyBonus,0,100));
  let stage='WATCH'; if(risk>=72||liq<8000||sells>buys*1.45) stage='REJECT'; else if(x100Score>=82&&huntScore>=78&&flow>=.58&&liq>=15000&&acceleration>=68) stage='HUNT'; else if(huntScore>=74&&liq>=12000&&flow>=.54&&momentumScore>=60) stage='EARLY';
  return {score:huntScore,huntScore,x100Score,risk,flow,liq,vol,buys,sells,pc5,pc1,pc6,fastScore,momentumScore,acceleration,activity,supportScore,age,stage,pairAddress:p?.pairAddress||'',quoteSymbol:p?.quoteToken?.symbol||'',dataAt:now()};
}

function makePlan(p,m,size){
  const e=num(p.priceUsd); if(!e) return null;
  const pc5=Math.abs(num(p?.priceChange?.m5)), pc1=Math.abs(num(p?.priceChange?.h1));
  const slPct=clamp(.085 + pc5*.0025 + pc1*.0008, .085, .18);
  const risk=e*slPct;
  const maxLoss=Math.max(2,Math.min(7,size*.10));
  const notional=Math.min(size,maxLoss/slPct);
  return {entry:e,sl:e-risk,tp1:e+risk*1.5,tp2:e+risk*2.5,tp3:e+risk*4,runner2:e*2,runner5:e*5,runner10:e*10,runner25:e*25,runner50:e*50,runner100:e*100,runner250:e*250,runner500:e*500,runner1000:e*1000,slPct,x100Score:num(m.x100Score),notional};
}

async function getJSON(url){ const r=await fetch(url,{headers:{'accept':'application/json'},cf:{cacheTtl:0}}); if(!r.ok) throw new Error(`HTTP ${r.status}`); return r.json(); }

export class KamalEngine extends DurableObject {
  constructor(ctx, env){ super(ctx,env); this.ctx=ctx; this.env=env; }
  async getState(){
    const state=await this.ctx.storage.get('state'); return state || {cfg:{...DEFAULTS},trades:[],logs:[]};
  }
  async putState(state){ await this.ctx.storage.put('state',state); }
  async log(state,msg){ state.logs=[`${new Date().toISOString()} • ${msg}`,...(state.logs||[])].slice(0,40); }
  async schedule(ms=5000){ await this.ctx.storage.setAlarm(now()+ms); }
  async fetch(request){
    const u=new URL(request.url); let state=await this.getState();
    if(request.method==='GET' && u.pathname==='/state') return json(this.publicState(state));
    if(request.method==='POST' && u.pathname==='/control'){
      const b=await request.json().catch(()=>({}));
      state.cfg={...state.cfg,...this.sanitizeConfig(b)};
      await this.log(state,state.cfg.enabled?'ENGINE ENABLED':'ENGINE STOPPED');
      await this.putState(state); if(state.cfg.enabled) await this.schedule(100); return json(this.publicState(state));
    }
    if(request.method==='POST' && u.pathname==='/wallet'){
      const b=await request.json().catch(()=>({}));
      state.cfg.walletAddress=String(b.walletAddress||'').trim(); state.cfg.walletChainId=String(b.walletChainId||'').trim();
      await this.log(state,state.cfg.walletAddress?`WALLET REGISTERED ${state.cfg.walletAddress.slice(0,8)}…`:'WALLET CLEARED'); await this.putState(state); return json(this.publicState(state));
    }
    if(request.method==='POST' && u.pathname==='/kill'){
      state.cfg.enabled=false; await this.log(state,'KILL SWITCH • new orders disabled'); await this.putState(state); return json(this.publicState(state));
    }
    if(request.method==='POST' && u.pathname==='/tick'){ await this.tick(state,true); return json(this.publicState(await this.getState())); }
    return new Response('Not found',{status:404});
  }
  sanitizeConfig(b){
    return {enabled:Boolean(b.enabled),mode:b.mode==='LIVE'?'LIVE':'PAPER',size:clamp(num(b.size)||50,1,100000),maxOpen:clamp(Math.round(num(b.maxOpen)||3),1,10),minScore:clamp(Math.round(num(b.minScore)||74),60,95),dailyCap:Math.max(1,num(b.dailyCap)||30),cooldown:Math.max(1,num(b.cooldown)||20),walletAddress:String(b.walletAddress||''),walletChainId:String(b.walletChainId||'')};
  }
  publicState(s){
    const open=(s.trades||[]).filter(t=>t.status==='OPEN');
    return {ok:true,engine:s.cfg.enabled?'ON':'OFF',mode:s.cfg.mode,config:{...s.cfg},openTrades:open,tradesCount:s.trades.length,dayPnl:this.dayPnl(s),logs:s.logs||[],serverTime:now(),lastScan:s.cfg.lastScan||0,lastTick:s.cfg.lastTick||0};
  }
  dayPnl(s){ const d=new Date(); d.setUTCHours(0,0,0,0); return (s.trades||[]).filter(t=>t.status==='CLOSED'&&num(t.closedAt)>=d.getTime()).reduce((a,t)=>a+num(t.pnl),0); }
  openTrades(s){ return s.trades.filter(t=>t.status==='OPEN'); }
  eligible(x,cfg,s){
    const m=x.meta||{},p=x.p||{},price=num(p.priceUsd); if(!price||!['EARLY','HUNT'].includes(m.stage))return false;
    if(num(m.huntScore||m.score)<cfg.minScore)return false;
    if(num(m.risk)>=72||num(m.flow)<.54||num(m.liq)<12000)return false;
    if(this.dayPnl(s)<=-cfg.dailyCap)return false;
    if(num(m.pc5)>24 && (num(m.flow)<.64 || num(m.acceleration)<72))return false;
    if(num(m.pc5)<-12 && num(m.flow)<.60)return false;
    const k=keyFor(p);if(this.openTrades(s).some(t=>t.key===k))return false;
    const cool=cfg.cooldown*60000;return !s.trades.some(t=>t.key===k&&t.status==='CLOSED'&&now()-(t.closedAt||0)<cool);
  }
  async execute(action,t,qty,price,reason,state){
    if(state.cfg.mode!=='LIVE') return {ok:true,simulated:true};
    const url=this.env.EXECUTION_BRIDGE_URL; const token=this.env.EXECUTION_BRIDGE_TOKEN; if(!url||!token) {await this.log(state,'LIVE BLOCKED • execution bridge secrets not configured');return {ok:false};}
    if(!state.cfg.walletAddress){await this.log(state,'LIVE BLOCKED • wallet not registered');return {ok:false};}
    const payload={source:'KAMAL_AI_MEME_HUNTER_24_7',action,reason,tradeId:t.id,chain:t.chain,token:t.address,symbol:t.symbol,side:action==='BUY'?'BUY':'SELL',notional:qty,price,sl:t.sl,tp1:t.tp1,tp2:t.tp2,tp3:t.tp3,walletAddress:state.cfg.walletAddress,walletChainId:state.cfg.walletChainId,executionMode:'SECURE_BRIDGE',time:now()};
    try{const r=await fetch(url,{method:'POST',headers:{'content-type':'application/json','authorization':`Bearer ${token}`},body:JSON.stringify(payload)});if(!r.ok)throw new Error(`HTTP ${r.status}`);return {ok:true,simulated:false};}catch(e){await this.log(state,`LIVE ${action} BLOCKED • ${e.message}`);return {ok:false};}
  }
  async openTrade(x,state){
    const p=x.p,m=x.meta,cfg=state.cfg;if(!this.eligible(x,cfg,state)||this.openTrades(state).length>=cfg.maxOpen)return false;if(num(m.dataAt)&&now()-num(m.dataAt)>20000)return false;const pl=makePlan(p,m,cfg.size);if(!pl)return false;
    const t={id:'M'+now().toString(36)+Math.random().toString(36).slice(2,6),createdAt:now(),key:keyFor(p),pairAddress:m.pairAddress||p.pairAddress||'',quoteSymbol:m.quoteSymbol||p.quoteToken?.symbol||'',chain:p.chainId,address:p.baseToken.address,symbol:p.baseToken.symbol||'TOKEN',mode:cfg.mode,side:'BUY',entry:pl.entry,current:pl.entry,sl:pl.sl,tp1:pl.tp1,tp2:pl.tp2,tp3:pl.tp3,runner2:pl.runner2,runner5:pl.runner5,runner10:pl.runner10,runner25:pl.runner25,runner50:pl.runner50,runner100:pl.runner100,runner250:pl.runner250,runner500:pl.runner500,runner1000:pl.runner1000,initialSL:pl.sl,notional:pl.notional,remaining:1,realized:0,pnl:0,status:'OPEN',stage:m.stage,score:m.huntScore,x100Score:m.x100Score,hit:'',tp1Done:false,tp2Done:false,tp3Done:false,r2Done:false,r5Done:false,r10Done:false,r25Done:false,r50Done:false,r100Done:false,r250Done:false,r500Done:false,r1000Done:false,belowSLCount:0,lastObservedPrice:pl.entry};
    const ex=await this.execute('BUY',t,t.notional,t.entry,'ENTRY',state); if(!ex.ok)return false;state.trades.push(t);await this.log(state,`BUY ${t.symbol} @ ${t.entry} • ${m.stage} ${m.huntScore}`);return true;
  }
  async closePart(t,portion,price,reason,state){const qty=t.notional*portion;const pnl=(price-t.entry)/t.entry*qty;const ex=await this.execute('SELL',t,qty,price,reason,state);if(!ex.ok)return false;t.pnl+=pnl;t.realized+=portion;t.remaining=clamp(1-t.realized,0,1);await this.log(state,`SELL ${t.symbol} ${reason} ${Math.round(portion*100)}% @ ${price} • ${money(pnl)}`);return true;}
  async processTrade(t,p,state){
    const price=num(p?.priceUsd); if(!price||t.status!=='OPEN')return;
    t.current=price; t.lastObservedPrice=price;
    const hardSL=t.sl*0.985;
    if(price<=t.sl)t.belowSLCount=num(t.belowSLCount)+1;else t.belowSLCount=0;
    if(price<=hardSL || t.belowSLCount>=2){
      if(await this.closePart(t,t.remaining,price,'SL',state)){t.status='CLOSED';t.closedAt=now();t.result='LOSS';t.hit='SL';}
      return;
    }
    if(!t.tp1Done&&price>=t.tp1&&await this.closePart(t,.35,t.tp1,'TP1',state)){t.tp1Done=true;t.hit='TP1';t.sl=Math.max(t.sl,t.entry);t.belowSLCount=0;}
    if(!t.tp2Done&&price>=t.tp2&&await this.closePart(t,.35,t.tp2,'TP2',state)){t.tp2Done=true;t.hit='TP2';t.sl=Math.max(t.sl,t.tp1);t.belowSLCount=0;}
    if(!t.tp3Done&&price>=t.tp3&&await this.closePart(t,Math.min(t.remaining,.10),t.tp3,'TP3 • 10%',state)){t.tp3Done=true;t.hit='TP3';t.sl=Math.max(t.sl,t.tp2);t.belowSLCount=0;}
    const steps=[['r2Done','runner2','2X'],['r5Done','runner5','5X'],['r10Done','runner10','10X'],['r25Done','runner25','25X'],['r50Done','runner50','50X'],['r100Done','runner100','100X'],['r250Done','runner250','250X'],['r500Done','runner500','500X']];
    for(const [done,key,label] of steps){if(!t[done]&&price>=t[key]&&t.remaining>=.02&&await this.closePart(t,.02,t[key],label,state)){t[done]=true;t.hit=label;t.sl=Math.max(t.sl,t.entry);t.belowSLCount=0;}}
    if(!t.r1000Done&&price>=t.runner1000&&t.remaining>0&&await this.closePart(t,t.remaining,t.runner1000,'1000X RUNNER',state)){t.r1000Done=true;t.hit='1000X RUNNER';t.status='CLOSED';t.closedAt=now();t.result='1000X+ RUNNER';}
  }
  async refreshOpen(state){
    const opens=this.openTrades(state); await Promise.all(opens.map(async t=>{
      try{
        const a=await getJSON(`https://api.dexscreener.com/tokens/v1/${encodeURIComponent(t.chain)}/${encodeURIComponent(t.address)}`);
        const arr=Array.isArray(a)?a:[];
        const exact=t.pairAddress?arr.find(x=>x?.pairAddress===t.pairAddress):null;
        const p=exact || arr.find(x=>x?.baseToken?.address===t.address && (!t.quoteSymbol || x?.quoteToken?.symbol===t.quoteSymbol));
        if(!p){await this.log(state,`PRICE WATCH ${t.symbol} • exact pair unavailable; skip tick`);return;}
        await this.processTrade(t,p,state);
      }catch(e){await this.log(state,`PRICE WATCH ${t.symbol} • ${e.message}`)}
    }));
  }
  async tick(state,force=false){
    if(!state.cfg.enabled&&!force)return;
    state.cfg.lastTick=now();
    if(state.cfg.enabled){
      await this.refreshOpen(state);
      if(!state.cfg.lastScan || now()-state.cfg.lastScan>=15000){
        try{const rows=await this.discover();state.cfg.lastScan=now();for(const x of rows){if(this.openTrades(state).length>=state.cfg.maxOpen)break;await this.openTrade(x,state)}}catch(e){await this.log(state,`DISCOVERY ERROR • ${e.message}`)}
      }
    }
    await this.putState(state); if(state.cfg.enabled)await this.schedule(5000);
  }
  async alarm(){const s=await this.getState();await this.tick(s);}
}

export default {
  async fetch(request, env){
    const u=new URL(request.url);
    if(u.pathname.startsWith('/api/')){
      const id=env.ENGINE.idFromName('main'); const stub=env.ENGINE.get(id); const path=u.pathname.replace('/api','')||'/state'; return stub.fetch(new Request(new URL(path,u.origin),request));
    }
    return env.ASSETS.fetch(request);
  },
  async scheduled(controller, env, ctx){
    const id=env.ENGINE.idFromName('main'); const stub=env.ENGINE.get(id); ctx.waitUntil(stub.fetch(new Request('https://engine/tick',{method:'POST'})));
  }
};
