export const ONBOARDING_KEY='blockcolc-onboarding-v1';
export interface TutorialStorage { getItem(key:string):string|null;setItem(key:string,value:string):void }
/** Existing installations do not get a new first-run gate after upgrading. */
export function shouldOfferTutorial(storage:TutorialStorage,freshInstallation:boolean):boolean {
  try {
    if(storage.getItem(ONBOARDING_KEY)==='1')return false;
    if(!freshInstallation){storage.setItem(ONBOARDING_KEY,'1');return false;}
  } catch { /* The current session can still show/close the guide. */ }
  return freshInstallation;
}
export function completeTutorial(storage:TutorialStorage):void {
  try{storage.setItem(ONBOARDING_KEY,'1');}catch{/* A storage failure must not trap the user. */}
}
export const TUTORIAL_PAGES=[
  {icon:'hammer',title:'把事情建成建筑',lines:[['建立任务','首次选一个大任务或习惯任务，再挑建筑。大任务拆成小任务；习惯按轮次建造。'],['管理清单','在任务页切换、新增或暂停任务，改名和排序；有进度后不能增删小任务。'],['自己的蓝图','新建任务或设置里可导入 .litematic，先看预览再使用。']]},
  {icon:'clock',title:'开始、休息、汇报',lines:[['安排节奏','计时页「调整」选固定轮次或结束时间，确认后开始。多轮间可休息。'],['极简操作','设置开启极简；空闲时上下滑时间、双击开始，信息面板左右切换。'],['结束与提交','点计时面板显示结束按钮，可提前完成或中止；统一汇报时分配轮次并提交进度。']]},
  {icon:'map',title:'逛逛你的聚落',lines:[['转动与缩放','拖动世界旋转，双指缩放；点建筑查看记忆，以它为中心转动。'],['返回全景','点世界右上角显示控件；地图按钮回聚落，复位按钮恢复视角。'],['奖励建筑','每日目标达成后获得装饰；奖励也能点看，完成的大任务成为纪念建筑。']]},
  {icon:'flag',title:'让投入留下痕迹',lines:[['今日目标','任务页调整当天目标轮数，0 轮关闭。设置中选择计划专注日。'],['习惯与节日','习惯完成一座后可选下一座。节日挂件点按可读介绍，专注还可能留下节日建筑。'],['继续工作','建筑记忆可继续对应任务；未分配的轮次仍保留在统计中。']]},
  {icon:'chart',title:'回看时间花在哪里',lines:[['选择日期','点热力图看一天，按住拖动选多天；下方团簇显示各任务投入。'],['比较投入','点时长档位高亮对应日期，最高档还标记专注最长的一天。'],['纪念与成就','向下看完成建筑及小任务投入、已解锁与未解锁成就；新成就会弹出提示。']]},
  {icon:'gear',title:'按自己的习惯调整',lines:[['外观与世界','设置里切字体、主题、聚落和光影；玻璃与色彩滑杆可拖动，也能把小球拉开弹出。'],['天气与保护','可选同步现实天气、自动连续专注、离开保护和返回提醒；按实际需要开启。'],['材质与数据','导入材质包改世界外观；自动备份之外，也可导出、导入和恢复。关于页检查更新，本教程可在设置重看。']]},
] as const;
