import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runAgent } from '../dist/agent.js';

const citation = '[queue.md:1-4]';
const search = { query: 'replay', limit: 3, pathPrefix: null };
const finish = { answer: 'Replay at 20 messages per second.', citations: [citation], insufficientEvidence: false };
let id = 0;
const call = (name, args) => ({ type: 'function_call', id: `fc_${++id}`, call_id: `call_${id}`, name, arguments: JSON.stringify(args), status: 'completed' });
const script = steps => async () => ({ output: steps.shift() ?? [call('search_documents', search)] });
const tool = async () => ({ passages: [{ citation, text: 'Replay at 20 messages per second.' }] });

test('agent performs retrieval and returns validated citations with a trace', async () => {
  const result = await runAgent(script([[call('search_documents', search)], [call('submit_answer', finish)]]), tool, 'Replay rate?');
  assert.equal(result.turns, 2); assert.equal(result.toolCalls, 2); assert.deepEqual(result.citations, [citation]);
  assert.equal(result.trace[0].tool, 'search_documents');
});
test('agent preserves reasoning and tool outputs across Responses turns', async () => {
  let turn = 0;
  const provider = async input => {
    if (turn++ === 0) return { output: [{ type: 'reasoning', id: 'rs_test', summary: [], encrypted_content: 'test-encrypted-state' }, call('search_documents', search)] };
    assert.ok(input.some(i => i.type === 'reasoning'));
    assert.ok(input.some(i => i.type === 'function_call_output' && i.output.includes(citation)));
    return { output: [call('submit_answer', finish)] };
  };
  await runAgent(provider, tool, 'Replay rate?');
});
test('agent rejects invented citations then lets the model correct them', async () => {
  let turns = 0;
  const provider = async input => {
    turns++;
    if (turns === 1) return { output: [call('search_documents', search)] };
    if (turns === 2) return { output: [call('submit_answer', { ...finish, citations: ['[invented.md:1-5]'] })] };
    assert.match(input.at(-1).output, /never retrieved/);
    return { output: [call('submit_answer', finish)] };
  };
  assert.equal((await runAgent(provider, tool, 'Replay rate?')).turns, 3);
});
test('an answer without retrieval never succeeds', async () => {
  await assert.rejects(runAgent(async () => ({ output: [call('submit_answer', finish)] }), tool, 'Replay rate?', { maxTurns: 2 }), /turn budget/);
});
test('no results can produce an explicit insufficient-evidence answer', async () => {
  const result = await runAgent(script([[call('search_documents', search)], [call('submit_answer', { answer: 'The indexed documents do not cover this topic.', citations: [], insufficientEvidence: true })]]), async () => ({ passages: [] }), 'Office opening hours?');
  assert.equal(result.insufficientEvidence, true); assert.deepEqual(result.citations, []);
});
test('turn and tool-call budgets stop repeated requests', async () => {
  const repeat = async () => ({ output: [call('search_documents', search)] });
  await assert.rejects(runAgent(repeat, tool, 'Replay?', { maxTurns: 2 }), /turn budget/);
  await assert.rejects(runAgent(repeat, tool, 'Replay?', { maxToolCalls: 1 }), /tool-call budget/);
});
test('unknown tools and invalid arguments are not executed', async () => {
  let executed = 0;
  await assert.rejects(runAgent(script([[call('delete_files', {})], [call('search_documents', { ...search, limit: 999 })]]), async () => { executed++; }, 'Replay?', { maxTurns: 2 }), /turn budget/);
  assert.equal(executed, 0);
});
test('tool failure is returned to the provider for recovery', async () => {
  let first = true;
  const result = await runAgent(script([[call('search_documents', search)], [call('search_documents', search)], [call('submit_answer', finish)]]), async () => { if (first) { first = false; throw new Error('Temporary failure'); } return tool(); }, 'Replay?');
  assert.equal(result.turns, 3); assert.equal(result.trace.length, 1);
});
test('abort is propagated and invalid limits fail before provider access', async () => {
  const controller = new AbortController(); controller.abort(new Error('Cancelled by caller'));
  await assert.rejects(runAgent(script([]), tool, 'Replay?', { signal: controller.signal }), /Cancelled/);
  await assert.rejects(runAgent(script([]), tool, 'Replay?', { maxTurns: 0 }), /Invalid/);
  await assert.rejects(runAgent(script([]), tool, ''), /Question/);
});
test('oversized evidence is rejected before it enters the model conversation', async () => {
  let turn = 0;
  const provider = async input => {
    if (turn++ === 0) return { output: [call('search_documents', search)] };
    assert.match(input.at(-1).output, /Evidence budget/);
    assert.ok(input.at(-1).output.length < 200);
    return { output: [call('submit_answer', finish)] };
  };
  await assert.rejects(runAgent(provider, async () => ({ passages: [{ citation, text: 'x'.repeat(60001) }] }), 'Replay?', { maxTurns: 2 }), /turn budget/);
});
