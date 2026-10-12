let language:'zh-CN'|'en'='zh-CN';
try{if(JSON.parse(localStorage.getItem('blockcolc-focus-preferences-v1')??'{}').language==='en')language='en';}catch{}
export function setPresentationLanguage(next:'zh-CN'|'en'){language=next;}
export const notificationText=(zh:string,en:string)=>language==='en'?en:zh;
