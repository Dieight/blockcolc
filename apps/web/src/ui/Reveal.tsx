import type {ReactNode} from 'react';
export function Reveal({open,children}:{open:boolean;children:ReactNode}){
  return <div className={`content-reveal${open?' is-open':''}`} inert={!open} aria-hidden={!open}><div>{children}</div></div>;
}
