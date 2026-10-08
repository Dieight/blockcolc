import {createRoot} from 'react-dom/client';
import {LoadingPage} from '../LoadingPage';
import '../styles/index.css';
const params=new URLSearchParams(location.search);
const theme=params.get('theme')==='dark'?'dark':'light';
document.documentElement.dataset.theme=theme;document.documentElement.style.colorScheme=theme;
createRoot(document.getElementById('root')!).render(<LoadingPage stage="scene" status="正在准备地形与建筑" scene={params.get('scene')==='house'?'house':'tomato'}/>);
