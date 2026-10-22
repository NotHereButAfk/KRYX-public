import assert from 'node:assert/strict';
import {scheduleModal,detailsModal,scheduledInstant,modalValues} from './tournament-gui.mjs';
assert.equal(scheduledInstant({day:'2026-07-01',hour:'18',minute:'30',zone:'America/New_York'}),'2026-07-01T22:30:00.000Z');
assert.equal(scheduledInstant({day:'2026-12-01',hour:'18',minute:'30',zone:'America/New_York'}),'2026-12-01T23:30:00.000Z');
assert.equal(scheduledInstant({day:'2026-12-01',hour:'0',minute:'0',zone:'Asia/Singapore'}),'2026-11-30T16:00:00.000Z');
assert.throws(()=>scheduledInstant({day:'2026-03-08',hour:'2',minute:'30',zone:'America/New_York'}),/does not exist/);
assert.throws(()=>scheduledInstant({day:'2026-02-30',hour:'2',minute:'30',zone:'UTC'}));
assert.throws(()=>scheduledInstant({day:'2026-12-01',hour:'24',minute:'0',zone:'UTC'}));
assert.equal(modalValues({components:[{type:18,component:{type:3,custom_id:'day',values:['2026-12-01']}}]}).day,'2026-12-01');
for(const modal of [scheduleModal('draft',Date.now()),detailsModal('draft')]){
 assert.equal(modal.type,9);assert(modal.data.components.length<=5);
 for(const row of modal.data.components){assert.equal(row.type,18);if(row.component.options)assert(row.component.options.length<=25);}
}
console.log('Discord tournament GUI: dropdown structure, selected values, timezone conversion and DST validation passed.');

const typeField=detailsModal('draft').data.components[0].component;
assert.equal(typeField.type,3);
assert.deepEqual(typeField.options.map(o=>o.value),['most_kills','longest_survival']);
