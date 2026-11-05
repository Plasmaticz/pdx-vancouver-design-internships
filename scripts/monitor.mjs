import { appendFile, readFile, writeFile } from "node:fs/promises";
import { fetchJobs } from "./sources.mjs";
import { sendMessages } from "./discord.mjs";

const STATE_PATH = "data/seen.json";
const OPENINGS = /<!-- OPENINGS:START -->[\s\S]*?<!-- OPENINGS:END -->/;

function markdown(text) {
  return text.replace(/[\\[\]*_`|<>]/g, "\\$&").replace(/\s+/g, " ").trim();
}

function jobLink(job) {
  return `[${markdown(job.title)}](<${job.url}>)`;
}

async function refreshReadme(jobs) {
  const readme = await readFile("README.md", "utf8");
  if (!OPENINGS.test(readme)) throw new Error("README opening markers are missing");
  const rows = jobs.length
    ? jobs.map((job) => `| ${jobLink(job)} | ${markdown(job.company)} | ${job.location} |`)
    : ["| No matching internships on the monitored boards. | | |"];
  const section = [
    "<!-- OPENINGS:START -->",
    `**${jobs.length} current ${jobs.length === 1 ? "opening" : "openings"}**`,
    "",
    "| Internship | Company | Location |",
    "| --- | --- | --- |",
    ...rows,
    "<!-- OPENINGS:END -->",
  ].join("\n");
  const next = readme.replace(OPENINGS, () => section);
  if (next !== readme) await writeFile("README.md", next);
}

const [mode, issuePath] = process.argv.slice(2);
if (mode !== "check" && mode !== "daily") throw new Error("Usage: monitor.mjs check [issue-file] | daily");
const jobs = await fetchJobs();

if (mode === "daily") {
  await sendMessages(jobs, mode, process.env.DISCORD_WEBHOOK_URL);
} else {
  const state = JSON.parse(await readFile(STATE_PATH, "utf8"));
  if (!Array.isArray(state.seen) || typeof state.initialized !== "boolean") {
    throw new Error("Invalid seen-job state");
  }
  const seen = new Set(state.seen);
  const newJobs = state.initialized ? jobs.filter((job) => !seen.has(job.id)) : [];
  if (process.env.GITHUB_ACTIONS === "true" && newJobs.length) {
    await sendMessages(newJobs, "new", process.env.DISCORD_WEBHOOK_URL);
    if (issuePath) {
      const body = newJobs.map((job) =>
        `- ${jobLink(job)} at ${markdown(job.company)} in ${job.location}`,
      ).join("\n");
      await writeFile(issuePath, `${body}\n`);
    }
  }
  await refreshReadme(jobs);
  for (const job of jobs) seen.add(job.id);
  if (!state.initialized || seen.size !== state.seen.length) {
    await writeFile(STATE_PATH, `${JSON.stringify({ initialized: true, seen: [...seen].sort() }, null, 2)}\n`);
  }
  if (process.env.GITHUB_OUTPUT) {
    await appendFile(process.env.GITHUB_OUTPUT, `new_count=${newJobs.length}\n`);
  }
  console.log(`Found ${jobs.length} current and ${newJobs.length} new openings.`);
}
