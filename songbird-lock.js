const SONG_BIRD_PATH=/^\/Songbird@50\/?$/;
if(SONG_BIRD_PATH.test(location.pathname)){
  const SALT='0598aa230cae22581cb3942a01bb265b';
  const EXPECTED='f37f4320b5cd880566c515ab2c871adaf7212c573d37cc7c0f265d667d797b79';
  const key='masinloc_songbird_pin_lock';

  const style=document.createElement('style');
  style.textContent=`
    #songbirdGate{position:fixed;inset:0;z-index:2147483647;background:#061A46;display:grid;place-items:center;padding:24px;font-family:Inter,system-ui,-apple-system,sans-serif}
    #songbirdGate .card{width:min(420px,100%);background:#fff;border-radius:24px;padding:30px;box-shadow:0 24px 80px rgba(0,0,0,.3)}
    #songbirdGate img{display:block;max-width:230px;height:auto;margin:0 auto 24px}
    #songbirdGate .kicker{margin:0 0 8px;font-size:12px;letter-spacing:.16em;font-weight:800;color:#526079;text-align:center}
    #songbirdGate h1{margin:0 0 8px;font-size:26px;line-height:1.1;text-align:center;color:#071a3e}
    #songbirdGate p{margin:0 0 22px;text-align:center;color:#657086;line-height:1.5}
    #songbirdGate input{box-sizing:border-box;width:100%;font-size:28px;letter-spacing:.35em;text-align:center;border:1px solid #cfd6e4;border-radius:14px;padding:15px 12px;margin-bottom:12px;font-variant-numeric:tabular-nums}
    #songbirdGate button{width:100%;border:0;border-radius:14px;padding:14px 16px;background:#0b3c91;color:#fff;font-weight:800;font-size:16px;cursor:pointer}
    #songbirdGate .msg{min-height:22px;margin:12px 0 0;color:#a32727;font-size:14px}
  `;
  document.head.appendChild(style);

  const gate=document.createElement('div');
  gate.id='songbirdGate';
  gate.innerHTML=`<section class="card" role="dialog" aria-modal="true" aria-labelledby="songbirdTitle">
    <img src="assets/masinloc-logo.webp" width="320" height="78" alt="Masinloc Zambales">
    <div class="kicker">PRIVATE ACCESS</div>
    <h1 id="songbirdTitle">Masinloc Connect Admin</h1>
    <p>Enter your 6-digit PIN.</p>
    <form id="songbirdForm">
      <input id="songbirdPin" type="password" inputmode="numeric" autocomplete="off" maxlength="6" pattern="[0-9]{6}" aria-label="6-digit PIN" required>
      <button type="submit">Continue</button>
      <p class="msg" id="songbirdMessage" aria-live="polite"></p>
    </form>
  </section>`;
  document.body.appendChild(gate);

  const form=gate.querySelector('#songbirdForm');
  const pin=gate.querySelector('#songbirdPin');
  const msg=gate.querySelector('#songbirdMessage');
  setTimeout(()=>pin.focus(),50);

  async function hash(value){
    const data=new TextEncoder().encode(value);
    const digest=await crypto.subtle.digest('SHA-256',data);
    return [...new Uint8Array(digest)].map(b=>b.toString(16).padStart(2,'0')).join('');
  }
  function state(){try{return JSON.parse(localStorage.getItem(key)||'{}')}catch{return {}}}
  function save(v){localStorage.setItem(key,JSON.stringify(v))}

  form.addEventListener('submit',async e=>{
    e.preventDefault();
    const now=Date.now();
    const s=state();
    if(s.until&&now<s.until){
      const mins=Math.max(1,Math.ceil((s.until-now)/60000));
      msg.textContent=`Too many attempts. Try again in ${mins} minute${mins===1?'':'s'}.`;
      return;
    }
    const value=String(pin.value||'').replace(/\D/g,'').slice(0,6);
    if(value.length!==6){msg.textContent='Enter all 6 digits.';return}
    const ok=await hash(SALT+value)===EXPECTED;
    if(!ok){
      const attempts=(s.attempts||0)+1;
      if(attempts>=5){save({attempts:0,until:now+15*60*1000});msg.textContent='Too many attempts. Try again in 15 minutes.'}
      else{save({attempts,until:0});msg.textContent=`Invalid PIN. ${5-attempts} attempt${5-attempts===1?'':'s'} remaining.`}
      pin.value='';pin.focus();return;
    }
    localStorage.removeItem(key);
    gate.remove();
    style.remove();
  });
}
