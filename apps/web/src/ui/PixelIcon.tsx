import type { SVGProps } from 'react';

// Shared 12 px glyphs: one filled path, no canvas redraw or icon font.
const glyphs = {
  cube: ['000111100000','011000011000','100000000100','101000010100','100110100100','100001000100','100001000100','010001001000','001001010000','000111100000','000000000000','000000000000'],
  clock: ['000011110000','001100001100','010000000010','010001000010','100001000001','100001110001','100000000001','100000000001','010000000010','010000000010','001100001100','000011110000'],
  tasks: ['011101111100','010100000000','011100000000','000000000000','011101111100','010100000000','011100000000','000000000000','011101111100','010100000000','011100000000','000000000000'],
  chart: ['000000000000','000000011000','000000011000','011000011000','011000011000','011011011000','011011011000','011011011000','011011011000','000000000000','111111111110','000000000000'],
  gear: ['000011110000','000110011000','011100001110','010000000010','110001100011','100010010001','100010010001','110001100011','010000000010','011100001110','000110011000','000011110000'],
  play: ['000000000000','001100000000','001111000000','001111110000','001111111100','001111111100','001111110000','001111000000','001100000000','000000000000','000000000000','000000000000'],
  check: ['000000000000','000000000110','000000001100','000000011000','011000110000','001101100000','000111000000','000010000000','000000000000','000000000000','000000000000','000000000000'],
  plus: ['000000000000','000001100000','000001100000','000001100000','000011110000','011111111110','011111111110','000011110000','000001100000','000001100000','000001100000','000000000000'],
  minus: ['000000000000','000000000000','000000000000','000000000000','011111111110','011111111110','000000000000','000000000000','000000000000','000000000000','000000000000','000000000000'],
  edit: ['000000001100','000000010010','000000101100','000001011000','000010110000','000101100000','001011000000','010110000000','011100000000','111000000000','000000000000','000000000000'],
  trophy: ['000111111000','011100001110','010100001010','010100001010','001111111100','000011110000','000001100000','000001100000','000111111000','000111111000','000000000000','000000000000'],
  sprout: ['011100000000','011110001110','000110011110','000011111000','000001100000','000001100000','000001100000','000001100000','001111111100','000000000000','000000000000','000000000000'],
  chest: ['000000000000','001111111100','011000000110','010000000010','011111111110','010001100010','010001100010','010000000010','011111111110','000000000000','000000000000','000000000000'],
  close: ['000000000000','011000001100','011100011100','001110111000','000111110000','000011100000','000111110000','001110111000','011100011100','011000001100','000000000000','000000000000'],
  chevron: ['000000000000','000000000000','011000001100','001100011000','000110110000','000011100000','000001000000','000000000000','000000000000','000000000000','000000000000','000000000000'],
  map: ['000000000000','011110011110','010010110010','010010010010','010010010010','010010010010','010010010010','010010010010','011110011110','000000000000','000000000000','000000000000'],
  reset: ['000111110000','001111111000','011000001100','011000001100','111100000000','111110000000','000000011111','000000001111','001100000110','001100000110','000111111100','000011111000'],
  hammer: ['000000110000','000001111000','000011111100','000111111100','001111111000','000111110000','000011100000','000111000000','001110000000','011100000000','000000000000','000000000000'],
  flag: ['001111111000','001000001000','001000110000','001111000000','001000000000','001000000000','001000000000','001000000000','001000000000','011110000000','000000000000','000000000000'],
  stop: ['000000000000','011111111100','011111111100','011111111100','011111111100','011111111100','011111111100','011111111100','011111111100','011111111100','000000000000','000000000000'],
  repeat: ['000000010000','001111111000','010000011100','100000010000','100000000000','000000000100','000010000100','000111001000','000011110000','000010000000','000000000000','000000000000'],
  minimize: ['000000000000','010010010010','001010010100','000110011000','011110011110','000000000000','000000000000','011110011110','000110011000','001010010100','010010010010','000000000000'],
} as const;

/** The product mark keeps the red rind / inset clock identity at small sizes. */
export function PixelBrand({ size = 28, ...props }: SVGProps<SVGSVGElement> & { size?: number }) {
  return <svg width={size} height={size} viewBox="0 0 16 16" className="pixel-icon pixel-brand" data-pixel-icon="brand" aria-hidden="true" focusable="false" shapeRendering="crispEdges" {...props}>
    <path fill="#5b8358" d="M7 0h3v1h3v2h-3v1H7V3H4V1h3z"/>
    <path fill="#d4523f" d="M4 3h7v1h2v2h1v7h-2v2H4v-1H2v-2H1V7h1V5h2z"/>
    <path fill="#a63e34" d="M2 6h2v1h2v8H4v-1H2v-2H1V7h1z"/>
    <path fill="#ed7660" d="M4 3h7v1h2v2H6V5H4z"/>
    <path fill="#8d3c33" d="M7 6h5v1h1v6h-1v1H7v-1H6V7h1z"/>
    <path fill="#f1e8d5" d="M8 7h4v5h-1v1H7V8h1z"/>
    <path fill="#344d3d" d="M9 8h1v2h2v1H9z"/>
  </svg>;
}

export type PixelIconName = keyof typeof glyphs;
type IconProps = Omit<SVGProps<SVGSVGElement>, 'name' | 'children'> & { size?: number };
const paths = Object.fromEntries(Object.entries(glyphs).map(([name, rows]) => [name,
  rows.flatMap((row, y) => [...row.matchAll(/1+/g)].map(match => `M${match.index} ${y}h${match[0].length}v1h-${match[0].length}z`)).join(''),
])) as Record<PixelIconName, string>;
const navViewBoxes=Object.fromEntries(['clock','tasks','chart','gear'].map(name=>{
  const cells=glyphs[name as PixelIconName].flatMap((row,y)=>[...row].flatMap((value,x)=>value==='1'?[{x,y}]:[]));
  const minX=Math.min(...cells.map(p=>p.x)),minY=Math.min(...cells.map(p=>p.y));
  const width=Math.max(...cells.map(p=>p.x))+1-minX,height=Math.max(...cells.map(p=>p.y))+1-minY;
  const side=Math.max(width,height);return[name,`${minX-(side-width)/2} ${minY-(side-height)/2} ${side} ${side}`];
}));

export function PixelIcon({ name, size = 24, className, ...props }: IconProps & { name: PixelIconName }) {
  return <svg width={size} height={size} viewBox={navViewBoxes[name]??'0 0 12 12'} fill="currentColor" shapeRendering="crispEdges"
    className={`pixel-icon${className ? ` ${className}` : ''}`} data-pixel-icon={name} aria-hidden="true" focusable="false" {...props}>
    <path d={paths[name]}/>
  </svg>;
}

const glyph = (name: PixelIconName) => function Icon(props: IconProps) { return <PixelIcon name={name} {...props}/>; };
export const PixelCube = glyph('cube');
export const PixelClock = glyph('clock');
export const PixelTasks = glyph('tasks');
export const PixelChart = glyph('chart');
export const PixelSettings = glyph('gear');
export const PixelPlay = glyph('play');
export const PixelCheck = glyph('check');
export const PixelPlus = glyph('plus');
export const PixelMinus = glyph('minus');
export const PixelEdit = glyph('edit');
export const PixelTrophy = glyph('trophy');
export const PixelSprout = glyph('sprout');
export const PixelChest = glyph('chest');
export const PixelClose = glyph('close');
export const PixelChevron = glyph('chevron');
export const PixelMap = glyph('map');
export const PixelReset = glyph('reset');
export const PixelHammer = glyph('hammer');
export const PixelFlag = glyph('flag');
export const PixelStop = glyph('stop');
export const PixelRepeat = glyph('repeat');
export const PixelMinimize = glyph('minimize');
