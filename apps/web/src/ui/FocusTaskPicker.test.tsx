import {describe,it,expect} from 'vitest';
import {renderToStaticMarkup} from 'react-dom/server';
import type {DomainState} from '@blockcolc/domain';
import {FocusTaskPicker,orderedFocusProjects} from './FocusTaskPicker';

describe('focus task catalog',()=>{
  const projects=[
    {id:'a',title:'普通 A',kind:'finite',status:'paused',subtasks:[{id:'done',title:'已经完成',progressBasisPoints:10000},{id:'todo',title:'尚未完成',progressBasisPoints:0}]},
    {id:'b',title:'习惯 B',kind:'habit',status:'paused',subtasks:[],habit:{targetRounds:10}},
    {id:'c',title:'当前 C',kind:'finite',status:'active',subtasks:[]},
    {id:'d',title:'旧建筑',kind:'finite',status:'monument',subtasks:[]},
  ] as unknown as DomainState['projects'];
  it('puts the current project first, then habits and ordinary tasks without mutating state',()=>{
    expect(orderedFocusProjects(projects,'c').map(item=>item.id)).toEqual(['c','b','a']);expect(projects[0]!.id).toBe('a');
  });
  it('opens only the current project and excludes finished subtasks and monuments',()=>{
    const html=renderToStaticMarkup(<FocusTaskPicker projects={projects} currentId="c" projectId="a" subtaskId="todo" disabled={false} onSelect={()=>{}}/>);
    expect((html.match(/ open=""/g)??[]).length).toBe(1);expect(html).toContain('尚未完成');expect(html).not.toContain('已经完成');expect(html).not.toContain('旧建筑');
  });
  it('renders a habit as one selectable row without a disclosure, including the current habit',()=>{
    const html=renderToStaticMarkup(<FocusTaskPicker projects={[projects[1]!]} currentId="b" projectId="b" subtaskId={null} disabled={false} onSelect={()=>{}}/>);
    expect(html).toContain('focus-task-habit');expect(html).toContain('aria-pressed="true"');expect(html).not.toContain('<details');expect(html).not.toContain('chevron');
  });
  it('keeps an awaiting habit disabled instead of selecting an unavailable building',()=>{
    const habit={...projects[1]!,habit:{...projects[1]!.habit!,awaitingNextBuilding:true}};
    const html=renderToStaticMarkup(<FocusTaskPicker projects={[habit]} currentId="b" projectId="b" subtaskId={null} disabled={false} onSelect={()=>{}}/>);
    expect(html).toContain('disabled=""');expect(html).toContain('请先选择下一座建筑');
  });
});
