import { CollisionWorld, type Solid, type Point } from '../src/animal-navigation';

export const box = (id: string, minX: number, maxX: number, minY: number, maxY: number, minZ: number, maxZ: number, extra: Partial<Solid> = {}): Solid =>
  ({ id, owner: 'fixture', minX, maxX, minY, maxY, minZ, maxZ, ...extra });

export function course(origin: Point = { x: 0, y: 0, z: 0 }) {
  const raw = [
    box('platform', -8.5, 8.5, -1, 0, -5.5, 5.5),
    box('step-half', -4.5, -3.5, 0, .5, 1.5, 4.5),
    box('step-one', -3.5, -2.5, 0, 1.5, 1.5, 4.5),
    box('step-down-half', -2.5, -1.5, 0, .5, 1.5, 4.5),
    box('bridge-left-pier', .5, 1.5, 0, 2, -3.5, -2.5),
    box('bridge-right-pier', .5, 1.5, 0, 2, .5, 1.5),
    box('bridge-deck', .5, 1.5, 2, 2.5, -3.5, 1.5),
    box('fence', 4.5, 4.8, 0, 1.5, -2.5, 3.5, { walkable: false }),
  ];
  const solids = raw.map(s => ({ ...s, minX: s.minX + origin.x, maxX: s.maxX + origin.x,
    minY: s.minY + origin.y, maxY: s.maxY + origin.y, minZ: s.minZ + origin.z, maxZ: s.maxZ + origin.z }));
  const p = (x: number, y: number, z: number): Point => ({ x: x + origin.x, y: y + origin.y, z: z + origin.z });
  return { solids, bridge: [p(-2, 0, -1), p(3, 0, -1)], steps: [p(-6, 0, 3), p(0, 0, 3)],
    wall: [p(-6, 0, -4), p(6, 0, -4)], origin };
}

export function testWorld(solids: Solid[] = []) {
  return new CollisionWorld({ minX: -12, maxX: 12, minZ: -12, maxZ: 12 },
    [box('ground', -12, 12, -3, 0, -12, 12), ...solids]);
}
