import { setTimeout as delay } from "node:timers/promises";

const REPOSITORY = "https://github.com/Plasmaticz/pdx-vancouver-design-internships";
const NO_MENTIONS = { parse: [] };

function jobEmbed(job, isNew) {
  return {
    title: job.title.slice(0, 256),
    url: job.url,
    color: isNew ? 0x9b341c : 0x15735b,
    fields: [
      { name: "Company", value: job.company, inline: true },
      { name: "Location", value: job.location, inline: true },
    ],
  };
}

export function buildMessages(jobs, mode) {
  if (mode === "new") {
    return jobs.map((job) => ({
      content: "@everyone\n# **NEW ROLE**",
      embeds: [jobEmbed(job, true)],
      allowed_mentions: { parse: ["everyone"] },
    }));
  }
  if (mode !== "daily") throw new Error("Unknown Discord message mode");
  if (!jobs.length) {
    return [{
      content: "# Portland & Vancouver Design Internships",
      embeds: [{
        title: "No roles available :( Come back tomorrow",
        description: "No matching internships are listed on the monitored boards.",
        url: REPOSITORY,
        color: 0x15735b,
      }],
      allowed_mentions: NO_MENTIONS,
    }];
  }

  const messages = [];
  for (let offset = 0; offset < jobs.length; offset += 8) {
    messages.push({
      content: offset === 0
        ? `# Portland & Vancouver Design Internships\n**${jobs.length} current ${jobs.length === 1 ? "opening" : "openings"}**`
        : "**Current openings continued**",
      embeds: jobs.slice(offset, offset + 8).map((job) => jobEmbed(job, false)),
      allowed_mentions: NO_MENTIONS,
    });
  }
  return messages;
}

export async function sendMessages(jobs, mode, webhookUrl, fetchImpl = fetch) {
  const url = URL.canParse(webhookUrl ?? "") ? new URL(webhookUrl) : null;
  if (url?.origin !== "https://discord.com" || !/^\/api\/webhooks\/\d+\/[\w-]+$/.test(url.pathname)) {
    throw new Error("DISCORD_WEBHOOK_URL is missing or invalid");
  }
  url.searchParams.set("wait", "true");

  for (const message of buildMessages(jobs, mode)) {
    const body = JSON.stringify({ username: "PDX & Vancouver Design Internships", ...message });
    for (let attempt = 1; ; attempt += 1) {
      const response = await fetchImpl(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body,
        redirect: "error",
        signal: AbortSignal.timeout(15_000),
      }).catch(() => { throw new Error("Discord webhook request failed"); });
      if (response.ok) break;
      if (response.status !== 429 || attempt === 3) {
        throw new Error(`Discord webhook returned HTTP ${response.status}`);
      }
      const { retry_after: seconds } = await response.json();
      if (!Number.isFinite(seconds) || seconds < 0 || seconds > 30) {
        throw new Error("Discord rate limit exceeded");
      }
      await delay(Math.ceil(seconds * 1000));
    }
  }
  console.log(`Discord ${mode} notification confirmed for ${jobs.length} openings.`);
}
