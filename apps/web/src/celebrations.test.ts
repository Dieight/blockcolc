import {describe,it,expect} from 'vitest';
import {celebrationEvents,pixelConfettiFrame,goalConfettiFrame,CELEBRATION_DURATION_MS} from './celebrations';
describe('pixel celebration overlay',()=>{
  it('responds to committed completion events only and coalesces birthday',()=>{
    expect(celebrationEvents([])).toBeNull();
    expect(celebrationEvents([{type:'ProjectCreated',projectId:'p'}])).toBeNull();
    expect(celebrationEvents([{type:'DailyGoalReached',date:'2026-10-18'}])).toBe('goal');
    expect(celebrationEvents([{type:'HabitBuildingCompleted',projectId:'p',buildingId:'b',cycleNumber:1}])).toBe('building');
    expect(celebrationEvents([{type:'ProjectSealedAsMonument',projectId:'p'},{type:'BirthdayRewardGranted',year:2026,date:'2026-10-18'}])).toBe('birthday');
  });
  it('uses a distinct bounded overhead shower for the daily goal',()=>{
    for(const time of [0,300,900,2000]){
      const frame=goalConfettiFrame(time,390,844);expect(frame).toEqual(goalConfettiFrame(time,390,844));expect(frame.length).toBeLessThanOrEqual(84);
      expect(frame).not.toEqual(pixelConfettiFrame(time,390,844));for(const particle of frame)expect(Object.values(particle).every(Number.isFinite)).toBe(true);
    }
    expect(goalConfettiFrame(CELEBRATION_DURATION_MS+1,390,844)).toEqual([]);
  });
  it('is deterministic, finite, pixel-aligned and bounded in duration',()=>{
    expect(pixelConfettiFrame(800,390,844)).toEqual(pixelConfettiFrame(800,390,844));
    for(const time of [0,200,800,1600,2600]){
      const frame=pixelConfettiFrame(time,390,844);expect(frame.length).toBeLessThanOrEqual(112);
      for(const part of frame)expect(Object.values(part).every(Number.isFinite)).toBe(true);
    }
    expect(pixelConfettiFrame(CELEBRATION_DURATION_MS+1,390,844)).toEqual([]);
    expect(pixelConfettiFrame(100,0,0)).toEqual([]);
  });
});
