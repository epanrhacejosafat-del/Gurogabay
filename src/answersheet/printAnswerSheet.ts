import * as Print from "expo-print";
import { AnswerSheetConfig, createAnswerSheet } from "./answerSheetConfig";
import { HeaderField } from "./headerConfig";

const esc = (t: string) =>
  t.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

export function buildSheetHtml(
  config: AnswerSheetConfig,
  header: HeaderField[],
  title = "Answer Sheet"
): string {
  const sheet = createAnswerSheet(config.items, config.choiceType);

  const headerHtml = header
    .map((f) =>
      f.kind === "score"
        ? `<div class="f ${f.span === 2 ? "full" : "half"}">
             <b>${esc(f.label)}:</b> <span class="scorebox"></span> / ${sheet.items}
           </div>`
        : `<div class="f ${f.span === 2 ? "full" : "half"}">
             <b>${esc(f.label)}:</b> <span class="line">${esc(f.value)}</span>
           </div>`
    )
    .join("");

  const columns = Array.from({ length: sheet.columns }, (_, c) => {
    const rows = sheet.rows
      .filter((r) => r.column === c)
      .map(
        (r) => `
      <div class="row"><span class="num">${r.item}</span>
        ${sheet.options.map((o) => `<span class="bubble">${o}</span>`).join("")}
      </div>`
      )
      .join("");
    return `<div class="col">${rows}</div>`;
  }).join("");

  return `
  <html><head><meta charset="utf-8"/>
  <style>
    @page { size: A4; margin: 0; }
    body { font-family: Arial, sans-serif; margin: 0; padding: 40px; position: relative; }
    .mark { position: absolute; width: 22px; height: 22px; background: #000; }
    .tl { top: 14px; left: 14px; } .tr { top: 14px; right: 14px; }
    .bl { bottom: 14px; left: 14px; } .br { bottom: 14px; right: 14px; }
    h2 { text-align: center; margin: 0 0 12px; }
    .head { display: flex; flex-wrap: wrap; gap: 10px 16px; font-size: 13px; }
    .f { box-sizing: border-box; }
    .full { width: 100%; } .half { width: calc(50% - 8px); }
    .line { display: inline-block; min-width: 60%; border-bottom: 1px solid #000; min-height: 16px; }
    .scorebox { display: inline-block; width: 60px; height: 22px; border: 1.5px solid #000; vertical-align: middle; }
    .grid { display: flex; gap: 18px; margin-top: 18px; }
    .col { flex: 1; }
    .row { display: flex; align-items: center; height: 26px; }
    .num { width: 26px; font-size: 12px; font-weight: bold; }
    .bubble { width: 20px; height: 20px; border: 1.2px solid #000; border-radius: 50%;
      display: inline-flex; align-items: center; justify-content: center;
      font-size: 9px; margin-right: 6px; }
  </style></head><body>
    <div class="mark tl"></div><div class="mark tr"></div>
    <div class="mark bl"></div><div class="mark br"></div>
    <h2>${esc(title)}</h2>
    <div class="head">${headerHtml}</div>
    <div class="grid">${columns}</div>
  </body></html>`;
}

export async function printAnswerSheet(
  config: AnswerSheetConfig,
  header: HeaderField[],
  title?: string
) {
  await Print.printAsync({ html: buildSheetHtml(config, header, title) });
}

// To save/share as PDF instead:
// const { uri } = await Print.printToFileAsync({ html: buildSheetHtml(config, header, title) });
