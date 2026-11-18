// supabase functions deploy parse-students   (uses the same GEMINI_API_KEY secret as parse-tos)
const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type' };

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  try {
    const { base64, mime } = await req.json();
    const prompt = 'Extract every student from this class list. Return JSON: {"students":[{"id":"","firstName":"","middleName":"","lastName":""}]}. ' +
      'Use "" for anything missing. middleName is optional. Names written "Last, First M." must be split correctly. Skip headers, totals and blank rows. Do not invent students.';
    const r = await fetch(
      'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=' + Deno.env.get('GEMINI_API_KEY'),
      {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [{ inline_data: { mime_type: mime, data: base64 } }, { text: prompt }] }],
          generationConfig: { responseMimeType: 'application/json', temperature: 0 },
        }),
      },
    );
    const j = await r.json();
    const text = j?.candidates?.[0]?.content?.parts?.[0]?.text || '{"students":[]}';
    return new Response(JSON.stringify(JSON.parse(text)), { headers: { ...cors, 'Content-Type': 'application/json' } });
  } catch (e) {
    return new Response(JSON.stringify({ error: String(e) }), { status: 500, headers: { ...cors, 'Content-Type': 'application/json' } });
  }
});
