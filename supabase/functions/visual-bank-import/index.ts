// OMS-MND-261126-17: one-time import of the 1,750 code-generated visual questions into question_bank as DRAFTS.
//
// - Only inserts the fixed items bundled in ./data.ts (status 'draft', provenance 'code_generated_v1').
// - Draft items are never served: the exam picks status 'reviewed_approved' only.
// - Safe to call again: rows whose legacy_id already exists are skipped, so a second call adds nothing.
// - Staging only (staging guard). No input is read from the request.
//
// Deploy (owner, from C:\Users\DELL\iq-screening-test-paid after `git pull`):
//   npx supabase functions deploy visual-bank-import --project-ref cbklbucvidcutshhmwjy --no-verify-jwt
// Run: open https://cbklbucvidcutshhmwjy.supabase.co/functions/v1/visual-bank-import in the browser.
// Rollback: delete from question_bank where provenance = 'code_generated_v1' and legacy_id like 'V-%';
import { stagingDb } from './_shared/staging-db.ts';
import { ITEMS_GZ_B64 } from './data.ts';

const EXPECTED = 1750;

async function loadItems(): Promise<any[]> {
  const bytes = Uint8Array.from(atob(ITEMS_GZ_B64), (c) => c.charCodeAt(0));
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'));
  return JSON.parse(await new Response(stream).text());
}

function reply(body: unknown, status = 200) {
  return new Response(JSON.stringify(body, null, 2), {
    status, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
  });
}

Deno.serve(async (req) => {
  if (req.method !== 'GET' && req.method !== 'POST') return reply({ error: 'method not allowed' }, 405);
  try {
    const sb = stagingDb();
    const items = await loadItems();
    if (items.length !== EXPECTED) return reply({ error: `bundle has ${items.length} items, expected ${EXPECTED}` }, 500);
    for (const it of items) {
      if (it.status !== 'draft' || !String(it.legacy_id).startsWith('V-')) return reply({ error: 'bundle check failed' }, 500);
    }
    let sent = 0;
    for (let i = 0; i < items.length; i += 100) {
      const { error } = await sb.from('question_bank')
        .upsert(items.slice(i, i + 100), { onConflict: 'legacy_id', ignoreDuplicates: true });
      if (error) return reply({ error: error.message, imported_before_error: sent }, 500);
      sent += Math.min(100, items.length - i);
    }
    const { data: rows, error: cErr } = await sb.from('question_bank')
      .select('exam_tags, status').like('legacy_id', 'V-%').eq('provenance', 'code_generated_v1');
    if (cErr) return reply({ error: cErr.message }, 500);
    const byExam: Record<string, number> = {};
    for (const r of rows ?? []) for (const t of r.exam_tags ?? []) byExam[t] = (byExam[t] ?? 0) + 1;
    return reply({ ok: true, change: 'OMS-MND-261126-17', visual_items_in_bank: rows?.length ?? 0,
      all_draft: (rows ?? []).every((r: any) => r.status === 'draft'), by_exam: byExam });
  } catch (e) {
    return reply({ error: String((e as Error).message ?? e) }, 500);
  }
});
