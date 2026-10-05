import { describe, expect, it } from 'vitest';
import { processExitLabel } from './BackgroundHealthSetting';
describe('background exit labels', () => {
  it('keeps memory reclamation separate from app crashes and user stops', () => {
    expect(processExitLabel(3)).toBe('系统内存回收');
    expect(processExitLabel(4)).toBe('应用崩溃');
    expect(processExitLabel(6)).toBe('应用无响应');
    expect(processExitLabel(10)).toBe('用户或系统停止');
    expect(processExitLabel(400)).toBe('其他系统原因');
  });
});
