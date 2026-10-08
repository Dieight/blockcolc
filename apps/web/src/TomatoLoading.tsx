export const TOMATO_STAGES = ['萌芽', '完整茎', '青番茄', '成熟', '落果'] as const;

function Stem() {
  return <>
    <path className="tomato-stem" d="M24 13h2v22h-2zM17 24h9v2h-9zM24 15h9v2h-9zM31 15h2v6h-2z"/>
    <path className="tomato-leaf" d="M14 21h8v3h-8zM18 16h6v3h-6zM19 29h5v2h-5z"/>
    <path className="tomato-leaf-lit" d="M26 12h9v3h-9zM26 27h5v2h-5z"/>
  </>;
}
function Fruit({ green = false }: { green?: boolean }) {
  return <g className={green ? 'tomato-fruit-green' : 'tomato-fruit-red'}>
    <path d="M29 18h6v1h1v5h-1v1h-6v-1h-1v-5h1z"/>
    <rect className="tomato-fruit-shade" x="33" y="20" width="3" height="4"/>
    <rect className="tomato-fruit-glint" x="29" y="19" width="2" height="2"/>
    <rect className="tomato-leaf" x="30" y="17" width="4" height="2"/>
  </g>;
}

/** The plant grows once; each fruit lands, rebounds, then fades away. */
export function TomatoLoading() {
  return <div className="boot-page-model boot-tomato" data-boot-scene="tomato" aria-hidden="true">
    <svg className="tomato-art tomato-earth" viewBox="0 0 48 40" shapeRendering="crispEdges">
      <path className="tomato-soil-side" d="M9 34h30v4H9z"/>
      <path className="tomato-soil" d="M7 32h34v3H7z"/>
      <path className="tomato-grass" d="M7 32h8v2H7zm28 0h6v2h-6zM9 31h4v1H9zm26 0h4v1h-4z"/>
      <path className="tomato-earth-grain" d="M12 35h2v1h-2zm6 1h3v1h-3zm9-1h2v1h-2zm8 1h2v1h-2z"/>
    </svg>
    <div className="tomato-sprout" data-tomato-stage="萌芽">
      <svg className="tomato-art" viewBox="0 0 48 40" shapeRendering="crispEdges">
        <path className="tomato-stem" d="M24 30h2v5h-2zM22 28h2v2h-2zM26 28h2v2h-2z"/>
        <path className="tomato-leaf" d="M19 25h3v3h-3zM28 25h3v3h-3z"/>
      </svg>
    </div>
    <div className="tomato-canopy" data-tomato-stage="完整茎">
      <svg className="tomato-art" viewBox="0 0 48 40" shapeRendering="crispEdges"><Stem/></svg>
    </div>
    <div className="tomato-green-layer" data-tomato-stage="青番茄">
      <svg className="tomato-art" viewBox="0 0 48 40" shapeRendering="crispEdges"><Fruit green/></svg>
    </div>
    <div className="tomato-ripe-layer" data-tomato-stage="成熟">
      <svg className="tomato-art" viewBox="0 0 48 40" shapeRendering="crispEdges"><Fruit/></svg>
    </div>
    <div className="tomato-fall" data-tomato-stage="落果">
      <svg className="tomato-art" viewBox="0 0 48 40" shapeRendering="crispEdges"><Fruit/></svg>
    </div>
  </div>;
}
