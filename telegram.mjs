// Se usa secuencialmente desde el scanner. No repetir automáticamente timeouts:
// Telegram podría haber aceptado el mensaje aunque se haya perdido la respuesta.
export function createTelegramSender({fetchImpl=(...args)=>fetch(...args),clock=Date.now,
  sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms))}={}) {
  const lastAttempt=new Map();
  return async function send(token,chatId,text) {
    const key=`${token}:${chatId}`;
    const spacing=/^\d+$/.test(String(chatId))?1100:3100;
    for (let attempt=0;attempt<2;attempt++) {
      const last=lastAttempt.get(key);
      const wait=last===undefined?0:Math.max(0,spacing-(clock()-last));
      if (wait) await sleep(wait);
      lastAttempt.set(key,clock());
      const res=await fetchImpl(`https://api.telegram.org/bot${token}/sendMessage`,{
        method:'POST',signal:AbortSignal.timeout(20000),headers:{'Content-Type':'application/json'},
        body:JSON.stringify({chat_id:chatId,text,parse_mode:'HTML',link_preview_options:{is_disabled:true}}),
      });
      const body=await res.json();
      if (res.ok && body.ok===true) return body.result;
      const retryAfter=body.parameters?.retry_after;
      if (body.ok===false && body.error_code===429 && attempt===0
        && Number.isFinite(retryAfter) && retryAfter>=0 && retryAfter<=30) {
        await sleep((retryAfter+0.1)*1000); continue;
      }
      throw new Error(`Telegram error: HTTP ${res.status}, code=${body.error_code ?? 'unknown'}`);
    }
  };
}
export const sendTelegram=createTelegramSender();
