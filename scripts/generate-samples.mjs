// Renders the sample supplier invoices to PNG (A4 at 150 dpi) with headless
// Chrome/Edge. The PNGs are committed, so you only need this to change them:
//
//   npm run samples                                  (all of them)
//   npm run samples -- 07-cleanpro-new-payee.png     (only the files named)
//
// Re-rendering a sample changes its bytes, so its recorded Claude reading (checked by SHA-256)
// must be recorded again: render only the files you changed.
//
// Set CHROME_PATH if Chrome/Edge is not in a standard location.

import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { RESTAURANT } from "../src/data/seed.ts";
import { SAMPLE_INVOICES, printedTotals } from "../src/data/samples.ts";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const outDir = path.join(root, "public", "samples");

function findBrowser() {
  const candidates = [
    process.env.CHROME_PATH,
    "C:/Program Files/Google/Chrome/Application/chrome.exe",
    "C:/Program Files (x86)/Google/Chrome/Application/chrome.exe",
    "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "/usr/bin/google-chrome",
    "/usr/bin/chromium",
    "/usr/bin/chromium-browser",
  ].filter(Boolean);
  const found = candidates.find((p) => fs.existsSync(p));
  if (!found) throw new Error("Chrome/Edge not found. Set CHROME_PATH.");
  return found;
}

const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

function money(cents, lang) {
  const v = cents / 100;
  return lang === "es"
    ? `${v.toLocaleString("es-ES", { minimumFractionDigits: 2, maximumFractionDigits: 2, useGrouping: "always" })} €`
    : `€${v.toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}
function num(n, lang, decimals = 2) {
  return n.toLocaleString(lang === "es" ? "es-ES" : "en-GB", { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
}
function qty(n, lang) {
  return Number.isInteger(n) ? String(n) : num(n, lang, 1);
}
function date(iso, lang) {
  const [y, m, d] = iso.split("-");
  if (lang === "es") return `${d}/${m}/${y}`;
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  return `${Number(d)} ${months[Number(m) - 1]} ${y}`;
}
function initials(name) {
  return name
    .replace(/(S\.L\.|Ltd\.|Co\.)/g, "")
    .split(/\s+/)
    .filter((w) => /^[A-ZÁÉÍÓÚ]/.test(w) && !["De", "Del", "La"].includes(w))
    .slice(0, 2)
    .map((w) => w[0])
    .join("");
}

const FONTS = {
  "es-classic": { body: "Georgia, 'Times New Roman', serif", head: "Georgia, serif" },
  "es-modern": { body: "'Segoe UI', Arial, sans-serif", head: "'Segoe UI Semibold', 'Segoe UI', Arial, sans-serif" },
  "en-corporate": { body: "Arial, Helvetica, sans-serif", head: "'Arial Black', Arial, sans-serif" },
  "en-minimal": { body: "'Segoe UI', Calibri, sans-serif", head: "Cambria, Georgia, serif" },
};

function render(inv) {
  const es = inv.language === "es";
  const L = es
    ? {
        title: "FACTURA",
        number: "Nº factura",
        date: "Fecha",
        due: "Vencimiento",
        dn: "Albarán",
        terms: "Condiciones",
        client: "Cliente",
        desc: "Descripción",
        q: "Cant.",
        u: "Ud.",
        price: "Precio",
        amount: "Importe",
        vat: "IVA",
        base: "Base imponible",
        vatLine: (r) => `IVA ${r}%`,
        total: "TOTAL FACTURA",
        cif: "CIF",
      }
    : {
        title: "INVOICE",
        number: "Invoice no.",
        date: "Invoice date",
        due: "Due date",
        dn: "Delivery note",
        terms: "Terms",
        client: "Bill to",
        desc: "Description",
        q: "Qty",
        u: "Unit",
        price: "Unit price",
        amount: "Amount",
        vat: "VAT",
        base: "Subtotal",
        vatLine: (r) => `VAT ${r}%`,
        total: "TOTAL DUE",
        cif: "VAT no.",
      };
  const t = printedTotals(inv);
  const f = FONTS[inv.style];
  const minimal = inv.style === "en-minimal";
  const rows = inv.lines
    .map(
      (l, i) => `<tr>
        <td class="code">${String(i + 1).padStart(2, "0")}</td>
        <td>${esc(l.description)}</td>
        <td class="r">${qty(l.qty, inv.language)}</td>
        <td>${esc(l.unit)}</td>
        <td class="r">${es ? num(l.unitPrice, "es") : num(l.unitPrice, "en")}</td>
        <td class="r">${es ? num(t.lineCents[i] / 100, "es") : num(t.lineCents[i] / 100, "en")}</td>
        <td class="r">${l.vat}%</td>
      </tr>`,
    )
    .join("");
  const vatRows = t.vat
    .map(
      (v) => `<tr><td>${L.base} ${t.vat.length > 1 ? `(${v.rate}%)` : ""}</td><td class="r">${money(v.base, inv.language)}</td></tr>
              <tr><td>${L.vatLine(v.rate)}</td><td class="r">${money(v.vat, inv.language)}</td></tr>`,
    )
    .join("");

  return `<!doctype html><html><head><meta charset="utf-8"><style>
    * { box-sizing: border-box; }
    html, body { margin: 0; width: 1240px; height: 1754px; background: #fff; }
    body { font-family: ${f.body}; color: #222; font-size: 19px; padding: 88px 96px; position: relative; }
    .top { display: flex; justify-content: space-between; align-items: flex-start; ${minimal ? "" : `border-bottom: 4px solid ${inv.accent};`} padding-bottom: 28px; }
    .brand { display: flex; gap: 22px; align-items: center; }
    .logo { width: 92px; height: 92px; border-radius: ${inv.style === "en-corporate" ? "14px" : "50%"}; background: ${inv.accent}; color: #fff; display: grid; place-items: center; font: 700 36px ${f.head}; letter-spacing: 1px; }
    .name { font: 700 31px ${f.head}; color: ${inv.accent}; }
    .tag { color: #666; font-size: 16px; margin-top: 4px; font-style: ${inv.style === "es-classic" ? "italic" : "normal"}; }
    .small { font-size: 15.5px; color: #555; line-height: 1.5; }
    .doc { text-align: right; }
    .doc h1 { margin: 0; font: 700 ${minimal ? "46px" : "40px"} ${f.head}; letter-spacing: ${minimal ? "6px" : "3px"}; color: ${minimal ? inv.accent : "#222"}; }
    .grid { display: grid; grid-template-columns: 1fr 1fr; gap: 36px; margin-top: 40px; }
    .box { border: 1.5px solid #ccc; border-radius: 6px; padding: 18px 22px; }
    .box h3 { margin: 0 0 8px; font-size: 14px; text-transform: uppercase; letter-spacing: 1.5px; color: ${inv.accent}; }
    .meta td { padding: 4px 0; font-size: 17px; }
    .meta td:first-child { color: #666; padding-right: 18px; }
    table.lines { width: 100%; border-collapse: collapse; margin-top: 42px; font-size: 17.5px; }
    table.lines th { text-align: left; background: ${minimal ? "#fff" : inv.accent}; color: ${minimal ? inv.accent : "#fff"}; padding: 12px 10px; font-size: 15px; text-transform: uppercase; letter-spacing: 1px; ${minimal ? `border-bottom: 2px solid ${inv.accent};` : ""} }
    table.lines td { padding: 12px 10px; border-bottom: 1px solid #e3e3e3; }
    table.lines tr:nth-child(even) td { background: ${inv.style === "es-modern" ? "#f4f8fb" : "#fafafa"}; }
    .r { text-align: right; } th.r { text-align: right; }
    .code { color: #999; width: 44px; }
    .totals { display: flex; justify-content: flex-end; margin-top: 34px; }
    .totals table { width: 470px; border-collapse: collapse; font-size: 18px; }
    .totals td { padding: 8px 10px; }
    .totals tr.grand td { border-top: 3px solid #222; font-weight: 700; font-size: 23px; padding-top: 14px; }
    .pay { margin-top: 60px; padding: 18px 22px; background: #f6f6f2; border-left: 5px solid ${inv.accent}; font-size: 16.5px; line-height: 1.55; }
    .terms { margin-top: 16px; font-size: 16.5px; }
    .foot { position: absolute; bottom: 70px; left: 96px; right: 96px; text-align: center; font-size: 13.5px; color: #888; border-top: 1px solid #ddd; padding-top: 14px; }
    .notice { margin-top: 10px; font-weight: 700; }
    .fine { margin-top: 26px; font-size: 15px; line-height: 1.45; color: #8a8a8a; }
    .stamp { position: absolute; top: 1240px; left: 140px; transform: rotate(-9deg); border: 5px double #c0392b; color: #c0392b; font: 700 30px 'Arial Black', Arial, sans-serif; padding: 12px 26px; letter-spacing: 2px; opacity: 0.82; border-radius: 6px; }
  </style></head><body>
    <div class="top">
      <div class="brand">
        <div class="logo">${esc(initials(inv.supplierName))}</div>
        <div>
          <div class="name">${esc(inv.supplierName)}</div>
          <div class="tag">${esc(inv.supplierTagline)}</div>
          <div class="small">${esc(inv.address)}<br>${L.cif} ${esc(inv.taxId)} · ${esc(inv.phone)} · ${esc(inv.email)}</div>
        </div>
      </div>
      <div class="doc"><h1>${L.title}</h1></div>
    </div>
    ${inv.stamp ? `<div class="stamp">${esc(inv.stamp)}</div>` : ""}
    <div class="grid">
      <div class="box">
        <h3>${L.client}</h3>
        <div><b>${esc(RESTAURANT.legalName)}</b> (${esc(RESTAURANT.name)})</div>
        <div class="small">${esc(RESTAURANT.address)}<br>${L.cif} ${esc(RESTAURANT.taxId)}</div>
      </div>
      <div class="box">
        <table class="meta">
          <tr><td>${L.number}</td><td><b>${esc(inv.number)}</b></td></tr>
          <tr><td>${L.date}</td><td>${date(inv.date, inv.language)}</td></tr>
          <tr><td>${L.due}</td><td>${date(inv.dueDate, inv.language)}</td></tr>
          <tr><td>${L.dn}</td><td>${esc(inv.deliveryRef)}</td></tr>
        </table>
      </div>
    </div>
    <table class="lines">
      <thead><tr><th>#</th><th>${L.desc}</th><th class="r">${L.q}</th><th>${L.u}</th><th class="r">${L.price}</th><th class="r">${L.amount}</th><th class="r">${L.vat}</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>
    <div class="totals"><table>
      ${t.vat.length > 1 ? `<tr><td>${L.base}</td><td class="r">${money(t.subtotal, inv.language)}</td></tr>` : ""}
      ${vatRows}
      <tr class="grand"><td>${L.total}</td><td class="r">${money(t.total, inv.language)}</td></tr>
    </table></div>
    <div class="terms"><b>${L.terms}:</b> ${esc(inv.terms)}</div>
    <div class="pay">${esc(inv.payment)}${inv.notice ? `<div class="notice">${esc(inv.notice)}</div>` : ""}</div>
    ${inv.finePrint ? `<div class="fine">${esc(inv.finePrint)}</div>` : ""}
    <div class="foot">${esc(inv.footer)}</div>
  </body></html>`;
}

const browser = findBrowser();
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "supplora-samples-"));
const profile = path.join(tmp, "profile");
fs.mkdirSync(outDir, { recursive: true });

const only = process.argv.slice(2);
const unknown = only.filter((f) => !SAMPLE_INVOICES.some((inv) => inv.file === f));
if (unknown.length) throw new Error(`No sample named ${unknown.join(", ")}`);

for (const inv of SAMPLE_INVOICES.filter((i) => !only.length || only.includes(i.file))) {
  const htmlPath = path.join(tmp, inv.file.replace(/\.png$/, ".html"));
  fs.writeFileSync(htmlPath, render(inv), "utf8");
  const out = path.join(outDir, inv.file);
  execFileSync(
    browser,
    [
      "--headless=new",
      "--disable-gpu",
      "--hide-scrollbars",
      "--no-first-run",
      "--no-default-browser-check",
      `--user-data-dir=${profile}`,
      "--force-device-scale-factor=1",
      "--window-size=1240,1754",
      `--screenshot=${out}`,
      `file:///${htmlPath.replace(/\\/g, "/")}`,
    ],
    { stdio: "ignore", timeout: 60_000 },
  );
  const t = printedTotals(inv);
  console.log(`${inv.file}  ${inv.number}  total ${(t.total / 100).toFixed(2)}  (${fs.statSync(out).size} bytes)`);
}

fs.rmSync(tmp, { recursive: true, force: true });
