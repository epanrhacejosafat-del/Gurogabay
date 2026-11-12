// Reads a table of specification (PDF, photo or Excel) with Google Gemini (free tier) and returns its competencies as JSON.
// Get a free key:  https://aistudio.google.com  ->  Get API key
// Secret:  npx supabase secrets set GEMINI_API_KEY=your-key
// Deploy:  npx supabase functions deploy parse-tos
// Only signed-in teachers can call it (Supabase checks the login token before this code runs).

// Models are tried in this order. If one is busy (503), out of free quota (429) or too slow, the next one is used.
// To put another model first without editing the code:  npx supabase secrets set GEMINI_MODEL=model-name
const MODELS = [Deno.env.get("GEMINI_MODEL"), "gemini-3.5-flash-lite", "gemini-3.5-flash", "gemini-3.6-flash", "gemini-flash-latest"].filter(Boolean) as string[];
const XLSX_MIME = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
const IMAGES = ["image/jpeg", "image/png", "image/webp"];

const json = (b: unknown, status = 200) =>
  new Response(JSON.stringify(b), { status, headers: { "Content-Type": "application/json" } });

const SCHEMA = {
  type: "OBJECT",
  properties: {
    comps: {
      type: "ARRAY",
      description: "One entry per learning competency row, in the order of the table.",
      items: {
        type: "OBJECT",
        properties: {
          n: { type: "STRING", description: "The learning competency text, without the row number." },
          items: { type: "STRING", description: "The item placement of that row, copied exactly as written, e.g. '1, 2, 3, 4, 12, 17, 18, 19, 22'." },
          lv: {
            type: "ARRAY",
            items: { type: "INTEGER" },
            description: "Six counts in this order: Remembering, Understanding, Applying, Analyzing, Evaluating, Creating. Use zeros if the table has no such columns.",
          },
        },
        required: ["n", "items"],
      },
    },
  },
  required: ["comps"],
};

Deno.serve(async (req) => {
  if (req.method !== "POST") return json({ error: "Use POST." }, 405);
  const key = Deno.env.get("GEMINI_API_KEY");
  if (!key) return json({ error: "The server has no GEMINI_API_KEY set." }, 500);

  let body: any;
  try { body = await req.json(); } catch { return json({ error: "Bad request." }, 400); }
  const { file, mediaType, items } = body || {};
  if (typeof file !== "string" || !file) return json({ error: "No file received." }, 400);
  if (file.length > 12_000_000) return json({ error: "The file is too large." }, 413);

  let part: any;
  if (mediaType === "application/pdf" || IMAGES.includes(mediaType)) {
    part = { inlineData: { mimeType: mediaType, data: file } };
  } else if (mediaType === XLSX_MIME) {
    const XLSX = await import("npm:xlsx@0.18.5");
    const wb = XLSX.read(file, { type: "base64" });
    const text = wb.SheetNames.map((n: string) => "Sheet: " + n + "\n" + XLSX.utils.sheet_to_csv(wb.Sheets[n])).join("\n\n");
    part = { text };
  } else {
    return json({ error: "Use a PDF, a photo or an Excel (.xlsx) file." }, 415);
  }

  const prompt =
    "This file is a table of specifications (TOS) for a test" + (items ? " of " + Number(items) + " items" : "") + ". " +
    "Read the table and return one entry per learning competency row. " +
    "Copy the item placement numbers exactly as written. Never join neighbouring numbers and never invent items. " +
    "Ignore the school header, the total row and the signatures.";

  let r: Response | null = null;
  for (const model of [...new Set(MODELS)]) {
    // Thinking is switched off first: reading a table does not need it, and it makes the answer much slower.
    // If the model does not accept that setting (400), the same model is tried once more without it.
    for (const quick of [true, false]) {
      const generationConfig: any = { responseMimeType: "application/json", responseSchema: SCHEMA, temperature: 0, maxOutputTokens: 8000 };
      if (quick) generationConfig.thinkingConfig = model.startsWith("gemini-3.5") ? { thinkingBudget: 0 } : { thinkingLevel: "minimal" };
      try {
        r = await fetch("https://generativelanguage.googleapis.com/v1beta/models/" + encodeURIComponent(model) + ":generateContent", {
          method: "POST",
          headers: { "x-goog-api-key": key, "Content-Type": "application/json" },
          body: JSON.stringify({ contents: [{ role: "user", parts: [part, { text: prompt }] }], generationConfig }),
          signal: AbortSignal.timeout(35000), // do not wait on a slow model for more than 35 seconds
        });
      } catch { r = null; break; }
      if (!(r.status === 400 && quick)) break;
    }
    if (r && (r.ok || ![400, 404, 429, 500, 503].includes(r.status))) break; // otherwise try the next model
  }
  if (!r) return json({ error: "Google\u2019s reader took too long. Please try again in a minute." }, 503);
  if (r.status === 429) return json({ error: "The free reading limit was reached. Try again in a few minutes, or tomorrow." }, 429);
  if (r.status === 503 || r.status === 500) return json({ error: "Google's reader is very busy right now. Please try again in a minute." }, 503);
  if (!r.ok) {
    let why = ""; try { why = ((await r.json()).error || {}).message || ""; } catch { /* no details */ }
    return json({ error: "Reading the file failed (" + r.status + ")." + (why ? " " + why.slice(0, 160) : "") }, 502);
  }

  const out = await r.json();
  const text = ((out.candidates || [])[0]?.content?.parts || []).map((p: any) => p.text || "").join("").replace(/```json|```/g, "").trim();
  try {
    const data = JSON.parse(text);
    if (!data || !Array.isArray(data.comps) || !data.comps.length) throw new Error("empty");
    return json(data);
  } catch {
    return json({ error: "No table of specification was found in this file." }, 422);
  }
});
