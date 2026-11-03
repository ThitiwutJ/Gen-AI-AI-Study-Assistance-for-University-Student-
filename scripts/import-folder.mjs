#!/usr/bin/env node
/**
 * Upload every supported file in a folder to a running Gen AI (the same as using the
 * Upload button, one file at a time). Files already in Gen AI with the same file name are skipped.
 *
 *   npm run import -- "C:\path\to\pdfs" --course "Our topic"
 *   node scripts/import-folder.mjs ./papers --course "Week 3" --url http://127.0.0.1:3000
 *
 * Gen AI must be running (npm start). Nothing is sent anywhere except to that local address.
 */
import fs from "node:fs";
import path from "node:path";

const SUPPORTED = new Set([".pdf", ".docx", ".pptx", ".txt", ".md"]);

function parseArgs(argv) {
  const args = { folder: null, course: null, url: "http://127.0.0.1:3000" };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--course") args.course = argv[++i];
    else if (a === "--url") args.url = argv[++i];
    else if (!args.folder) args.folder = a;
  }
  return args;
}

async function api(base, pathname, init) {
  const res = await fetch(`${base}${pathname}`, init);
  const text = await res.text();
  let data = null;
  try {
    data = JSON.parse(text);
  } catch {
    /* not JSON */
  }
  if (!res.ok) {
    const err = data?.error;
    throw new Error(err ? `${err.message}${err.fix ? ` ${err.fix}` : ""}` : `HTTP ${res.status}`);
  }
  return data;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.folder) {
    console.error('Usage: npm run import -- <folder> [--course "Course name"] [--url http://127.0.0.1:3000]');
    process.exit(2);
  }
  const folder = path.resolve(args.folder);
  if (!fs.existsSync(folder) || !fs.statSync(folder).isDirectory()) {
    console.error(`Folder not found: ${folder}`);
    process.exit(2);
  }
  const base = args.url.replace(/\/+$/, "");

  try {
    await api(base, "/api/settings");
  } catch {
    console.error(`Gen AI isn't running at ${base}. Start it with "npm start" and run this again.`);
    process.exit(1);
  }

  let courseId = null;
  if (args.course) {
    const courses = await api(base, "/api/courses");
    const existing = courses.find((c) => c.name.trim().toLowerCase() === args.course.trim().toLowerCase());
    courseId = existing
      ? existing.id
      : (await api(base, "/api/courses", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ name: args.course.trim() }) })).id;
    console.log(`${existing ? "Using" : "Created"} course "${args.course}" (id ${courseId})`);
  }

  const already = new Set((await api(base, "/api/documents")).map((d) => d.fileName).filter(Boolean));
  const files = fs
    .readdirSync(folder)
    .filter((f) => SUPPORTED.has(path.extname(f).toLowerCase()))
    .sort();
  if (!files.length) {
    console.log(`No PDF, DOCX, PPTX, TXT or MD files in ${folder}`);
    return;
  }

  let uploaded = 0;
  let failed = 0;
  for (const name of files) {
    if (already.has(name)) {
      console.log(`SKIPPED ${name} (already in Gen AI)`);
      continue;
    }
    const form = new FormData();
    form.append("file", new File([fs.readFileSync(path.join(folder, name))], name));
    if (courseId) form.append("courseId", String(courseId));
    try {
      const doc = await api(base, "/api/documents", { method: "POST", body: form });
      uploaded++;
      console.log(`UPLOADED ${name}: "${doc.title}", ${doc.unitCount} ${doc.unitKind}s, ${doc.chunkCount} chunks${doc.warning ? ` (warning: ${doc.warning})` : ""}`);
    } catch (error) {
      failed++;
      console.log(`FAILED ${name}: ${error instanceof Error ? error.message : error}`);
    }
  }
  console.log(`DONE ${uploaded} uploaded, ${failed} failed. Indexing continues in the background; see the Materials page.`);
  if (failed) process.exitCode = 1;
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
