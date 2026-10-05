import {describe,it,expect} from 'vitest';
import {sliderFlight,sliderFlightPosition,sliderBounceOffset,sliderValueAt,sliderLandingValueAt,sliderFirstBounceDuration} from './physical-slider';
describe('ballistic slider',()=>{
 it('projects left pulls to right, right to left and preserves vertical launches',()=>{
  const left=sliderFlight(150,-30,35,300),right=sliderFlight(150,30,35,300),vertical=sliderFlight(150,0,-65,300);
  expect(left.landing).toBeGreaterThan(150);expect(right.landing).toBeLessThan(150);expect(vertical.landing).toBe(150);
  expect(vertical.vy).toBeGreaterThan(0);expect(left.vy).toBeLessThan(0);
  expect(sliderFlight(150,-30,-35,300).landing).toBeLessThan(150);
  expect(sliderFlight(150,-60,65,300).landing).toBeGreaterThan(left.landing);
 });
 it('lands at the preview regardless of frame rate, rebounds then settles',()=>{
  for(const pull of [-200,-20,0,20,200]){
   const flight=sliderFlight(130,pull,70,300);expect(flight.landing).toBeGreaterThanOrEqual(0);expect(flight.landing).toBeLessThanOrEqual(300);
   expect(sliderFlightPosition(flight,0)).toEqual({x:flight.origin,y:70});
   expect(sliderFlightPosition(flight,flight.duration+5).x).toBeCloseTo(flight.landing);
   expect(sliderFlightPosition(flight,flight.duration+5).y).toBeCloseTo(0);
  }
  expect(sliderBounceOffset(.025,600)).toBeLessThan(0);expect(sliderBounceOffset(2,600)).toBe(0);
 });
 it('quantizes and bounds tap/flight values',()=>{
  expect(sliderValueAt(300,300,50,150,5)).toBe(150);expect(sliderValueAt(-30,300,0,100,1)).toBe(0);
  expect(sliderValueAt(166,300,0,100,5)).toBe(55);
  expect(sliderLandingValueAt(166,300,0,100,5,-1)).toBe(55);
  expect(sliderLandingValueAt(166,300,0,100,5,1)).toBe(60);
  expect(sliderLandingValueAt(164,300,0,100,5,-1)).toBe(50);
  expect(sliderBounceOffset(sliderFirstBounceDuration(600)/2,600)).toBeLessThan(-20);
 });
});
