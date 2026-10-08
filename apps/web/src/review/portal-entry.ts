// Run before importing App. No real storage or permission path is available here.
class ReviewStorage implements Storage{
  private values=new Map<string,string>();
  get length(){return this.values.size;}clear(){this.values.clear();}
  getItem(key:string){return this.values.get(String(key))??null;}
  setItem(key:string,value:string){this.values.set(String(key),String(value));}
  removeItem(key:string){this.values.delete(String(key));}
  key(index:number){return [...this.values.keys()][index]??null;}
}
Object.defineProperty(window,'localStorage',{value:new ReviewStorage()});
Object.defineProperty(window,'sessionStorage',{value:new ReviewStorage()});
Object.defineProperty(window,'indexedDB',{value:{open(){throw new Error('Review does not access IndexedDB');}}});
document.documentElement.dataset.inputMode='pointer';
document.documentElement.dataset.coldStartup='false';
void import('./portal-app').then(module=>module.startPortalApp()).catch(error=>{
  document.body.dataset.reviewError='initialization';
  const message=document.createElement('p');message.setAttribute('role','alert');message.textContent='审看页面暂未准备好';
  document.getElementById('root')?.replaceChildren(message);
  console.error(error);
});
