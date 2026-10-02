export type LocalBuiltinCategory = "building" | "daily-reward";

export interface LocalBuiltinSource {
  readonly category: LocalBuiltinCategory;
  readonly id: string;
  readonly description: string;
}

/** Stable catalogue metadata shared by conversion and the packaged catalogue.
 * Raw Litematic inputs stay in the workspace; this module loads no voxel assets. */
export const LOCAL_BUILTIN_SOURCES: Readonly<Record<string, LocalBuiltinSource>> = Object.freeze({
  "Dieight的高级火柴盒.litematic": {
    category: "building", id: "builtin-local-advanced-matchbox",
    description: "Dieight的高级火柴盒：方正的火柴盒小屋，以简洁立面呈现紧凑轮廓。",
  },
  "Dieight的高级火柴盒plus.litematic": {
    category: "building", id: "builtin-local-advanced-matchbox-plus",
    description: "Dieight的高级火柴盒plus：在方盒外形上增加层次的进阶小屋。",
  },
  "Dieight的高级火柴盒pro.litematic": {
    category: "building", id: "builtin-local-advanced-matchbox-pro",
    description: "Dieight的高级火柴盒pro：轮廓更丰富、立面更完整的火柴盒住宅。",
  },
  "GYPpro的简易小仓库.litematic": {
    category: "building", id: "builtin-local-gyp-simple-warehouse",
    description: "GYPpro的简易小仓库：以方正体量和简洁屋顶构成的小型仓库。",
  },
  "Dieight的神秘附魔台.litematic": {
    category: "daily-reward", id: "builtin-local-mysterious-enchanting-table",
    description: "Dieight的神秘附魔台：以附魔台为中心的神秘魔法角落。",
  },
  "Dieight的小别墅.litematic": {
    category: "building", id: "builtin-local-small-villa",
    description: "Dieight的小别墅：有舒展屋顶与开阔立面的独栋小别墅。",
  },
  "Dieight的小水箱.litematic": {
    category: "daily-reward", id: "builtin-local-small-water-tank",
    description: "Dieight的小水箱：小巧的储水装饰，以方正箱体呈现水面。",
  },
  "karry_steven的豪宅.litematic": {
    category: "building", id: "builtin-local-gkr-mansion",
    description: "karry_steven的豪宅：体量宽阔、层次分明的宅邸。",
  },
  "GYPpro的豪宅（一层）.litematic": {
    category: "building", id: "builtin-local-gyp-mansion-first-floor",
    description: "GYPpro的豪宅（一层）：以宽大的首层平面展开的宅邸雏形。",
  },
  "m0m0kA_QWQ的小黄鸭.litematic": {
    category: "daily-reward", id: "builtin-local-wqh-yellow-duck",
    description: "m0m0kA_QWQ的小黄鸭：小黄鸭造型装饰，有圆润身体和醒目的喙。",
  },
  "Dieight的挂机池.litematic": {
    category: "daily-reward", id: "builtin-local-dieight-afk-pool",
    description: "Dieight的挂机池：围绕水面搭成的小型挂机池，池沿勾勒出紧凑轮廓。",
  },
  "Dieight的圣诞树.litematic": {
    category: "building", id: "builtin-local-dieight-christmas-tree",
    description: "Dieight的圣诞树：层层收拢的枝叶与节日装点组成一棵方块圣诞树。",
  },
  "Dieight的昔涟Q版手办_byMC烤河马.litematic": {
    category: "building", id: "builtin-local-dieight-xilian-figurine",
    description: "Dieight的昔涟Q版手办（MC烤河马制作）：以方块塑成的Q版人物手办，呈现鲜明的人物轮廓。",
  },
  "GYPpro的挂机点.litematic": {
    category: "daily-reward", id: "builtin-local-gyp-afk-spot",
    description: "GYPpro的挂机点：集中布置的紧凑挂机角落，以小巧方块构件组成。",
  },
  "GYPpro的昔涟-仪式剑.litematic": {
    category: "building", id: "builtin-local-gyp-ritual-sword",
    description: "GYPpro的昔涟-仪式剑：以细长剑身和醒目剑饰构成的仪式剑造型。",
  },
  "GYPpro的樱花仓库熔炉.litematic": {
    category: "building", id: "builtin-local-gyp-cherry-storage-furnace",
    description: "GYPpro的樱花仓库熔炉：以樱花木搭起的仓储与熔炉建筑，兼具温柔配色和实用布局。",
  },
  "GYPpro的樱花树.litematic": {
    category: "building", id: "builtin-local-gyp-cherry-tree",
    description: "GYPpro的樱花树：舒展的枝干托起层叠花冠，形成柔和的樱花树轮廓。",
  },
  "m0m0kA_QWQ的神秘小房子.litematic": {
    category: "building", id: "builtin-local-momo-mysterious-house",
    description: "m0m0kA_QWQ的神秘小房子：紧凑屋身与独特屋顶组成一间神秘小屋。",
  },
  "Togawa15akiko的豪宅.litematic": {
    category: "building", id: "builtin-local-togawa-mansion",
    description: "Togawa15akiko的豪宅：宽阔宅邸以丰富的体量和立面层次展开。",
  },
  "Togawa15akiko的刷铁机.litematic": {
    category: "building", id: "builtin-local-togawa-iron-farm",
    description: "Togawa15akiko的刷铁机：分层平台与收集结构组成的方块机械建筑。",
  },
  "zdrcgubjo4的铁傀儡.litematic": {
    category: "daily-reward", id: "builtin-local-zdrcgubjo4-iron-golem",
    description: "zdrcgubjo4的铁傀儡：宽肩长臂的铁傀儡造型，以方块呈现守卫姿态。",
  },
  "zdrcgubjo4的小喷泉.litematic": {
    category: "building", id: "builtin-local-zdrcgubjo4-small-fountain",
    description: "zdrcgubjo4的小喷泉：围绕中央水景展开的小型喷泉，池边构件形成整齐轮廓。",
  },
});
