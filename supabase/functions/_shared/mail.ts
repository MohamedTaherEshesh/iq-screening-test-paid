// OMSAZE staging-only email adapter.
// This file is NOT deployed. Production mail.ts remains unchanged.
// Even when SMTP credentials exist, no mail is sent unless all staging guards pass.
import nodemailer from "npm:nodemailer@6.9.13";
import { certificateHtml } from "./certificate.ts";

const STAGING_URL = "https://cbklbucvidcutshhmwjy.supabase.co";
type Bucket = { count: number; egp: number };
export type PaymentTotals = {
  day: Bucket; week: Bucket; month: Bucket; year: Bucket; inception: Bucket;
  today: string; hours: Record<string, Bucket>;
};
export type ReportSubmission = {
  name: string; email: string; report_html: string;
  result: { date: string; correct: number; total: number; pctl: number; iq: number };
};

const esc = (value: unknown): string => String(value ?? "").replace(/[&<>"']/g, (c) =>
  ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));
const safeSubject = (value: unknown): string =>
  String(value ?? "").replace(/[\r\n\u0000-\u001f\u007f]/g, " ").trim().slice(0, 120);
const validEmail = (s: string): boolean => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s) && s.length <= 254;

function requiredEnv(name: string): string {
  const val = Deno.env.get(name)?.trim();
  if (!val) throw new Error(`missing staging environment setting: ${name}`);
  return val;
}

// Fail closed: only the isolated OMSAZE Supabase project may use this adapter.
// Every message goes to one explicitly configured TEST mailbox, never to the
// candidate's email or an owner BCC address.
function testMailSettings(): { user: string; pass: string; recipient: string } {
  if (Deno.env.get("OMSAZE_EMAIL_MODE") !== "smtp") {
    throw new Error("staging email delivery disabled");
  }
  const currentUrl = (Deno.env.get("SUPABASE_URL") ?? "").replace(/\/$/, "");
  if (Deno.env.get("OMSAZE_ENVIRONMENT") !== "staging" || currentUrl !== STAGING_URL) {
    throw new Error("refusing email delivery outside OMSAZE staging");
  }
  const recipient = requiredEnv("OMSAZE_TEST_RECIPIENT");
  const user = requiredEnv("SMTP_USER");
  const pass = requiredEnv("SMTP_PASS");
  if (!validEmail(recipient) || !validEmail(user)) throw new Error("invalid staging mailbox settings");
  return { user, pass, recipient };
}

function transport(user: string, pass: string) {
  return nodemailer.createTransport({
    host: "smtp.gmail.com", port: 465, secure: true,
    auth: { user, pass }, connectionTimeout: 10000, socketTimeout: 15000,
  });
}

export function buildReportMail(sub: ReportSubmission, recipient: string) {
  if (!sub || typeof sub.name !== "string" || sub.name.trim().length < 2) throw new Error("invalid candidate name");
  if (typeof sub.report_html !== "string" || sub.report_html.length < 1 ||
      sub.report_html.length > 1_000_000) throw new Error("invalid report content");
  if (!sub.result) throw new Error("missing server-calculated report result");
  if (!validEmail(recipient)) throw new Error("invalid test recipient");
  const cert = certificateHtml({
    name: sub.name, date: sub.result.date, correct: sub.result.correct,
    total: sub.result.total, iq: sub.result.iq, pctl: sub.result.pctl,
  });
  return {
    to: recipient,
    subject: `[OMSAZE STAGING] Test report - ${safeSubject(sub.name)}`,
    html: `<div style="font-family:Arial,sans-serif;color:#1d2433"><p>Test message for ${esc(sub.name)}.</p><p>The server-generated report and completion certificate are attached. This is not a validated IQ assessment.</p></div>`,
    attachments: [
      { filename: "OMSAZE-Completion-Certificate.html", content: cert, contentType: "text/html; charset=utf-8" },
      { filename: "OMSAZE-Test-Report.html", content: sub.report_html, contentType: "text/html; charset=utf-8" },
    ],
  };
}

function bucket(b: Bucket): string {
  if (!b || !Number.isInteger(b.count) || b.count < 0 ||
      !Number.isFinite(b.egp) || b.egp < 0) throw new Error("invalid payment totals");
  return `<td style="padding:8px 12px;text-align:right">${b.count}</td><td style="padding:8px 12px;text-align:right">${b.egp.toFixed(2)} EGP</td>`;
}

export function buildOwnerMail(
  totals: PaymentTotals, last: { name: string; amount_cents: number }, recipient: string,
) {
  if (!validEmail(recipient) || !totals || !totals.hours || !last ||
      !Number.isFinite(last.amount_cents) || last.amount_cents < 0) throw new Error("invalid owner summary");
  const day = String(totals.today ?? "");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) throw new Error("invalid totals date");
  const periods: Array<[string, Bucket]> = [
    ["Today", totals.day], ["Week to date", totals.week], ["Month to date", totals.month],
    ["Year to date", totals.year], ["Inception to date", totals.inception],
  ];
  const rows = periods.map(([label, value]) => `<tr><td>${label}</td>${bucket(value)}</tr>`).join("");
  const hours = Object.keys(totals.hours).sort().map((h) => {
    if (!/^(?:[01]?\d|2[0-3])$/.test(h)) throw new Error("invalid hourly label");
    return `<tr><td>${esc(h.padStart(2, "0"))}:00</td>${bucket(totals.hours[h])}</tr>`;
  }).join("");
  return {
    to: recipient,
    subject: `[OMSAZE STAGING] Payment simulation - ${(last.amount_cents / 100).toFixed(2)} EGP`,
    html: `<div style="font-family:Arial,sans-serif;color:#1d2433">
      <h2>Staging payment summary</h2>
      <p>${esc(last.name)} — ${(last.amount_cents / 100).toFixed(2)} EGP — ${esc(day)}.</p>
      <table><thead><tr><th>Period</th><th>Payments</th><th>Amount</th></tr></thead><tbody>${rows}</tbody></table>
      <h3>Today by hour</h3><table><tbody>${hours || "<tr><td>No payments yet today</td></tr>"}</tbody></table>
      <p>Staging only. Not a real settlement notification.</p></div>`,
  };
}

export async function sendReport(sub: ReportSubmission): Promise<void> {
  const { user, pass, recipient } = testMailSettings();
  await transport(user, pass).sendMail({ from: `"OMSAZE Staging" <${user}>`, ...buildReportMail(sub, recipient) });
}

export async function sendOwnerSummary(
  totals: PaymentTotals, last: { name: string; amount_cents: number },
): Promise<void> {
  const { user, pass, recipient } = testMailSettings();
  await transport(user, pass).sendMail({ from: `"OMSAZE Staging" <${user}>`, ...buildOwnerMail(totals, last, recipient) });
}
