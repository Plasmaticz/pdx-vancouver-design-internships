import assert from "node:assert/strict";
import test from "node:test";
import { fetchJobs, isDesignInternship, metroLocation } from "../scripts/sources.mjs";
import { buildMessages, sendMessages } from "../scripts/discord.mjs";

test("matches graphic and related design internship titles", () => {
  for (const title of [
    "Graphic Design Intern", "2027 Brand Design Internship", "Visual Designer Co-op",
    "Internship - Graphic Design", "Design Intern (Graphics)", "Art Direction Intern",
  ]) {
    assert.equal(isDesignInternship(title), true, title);
  }
  for (const title of [
    "Senior Graphic Designer", "Internal Graphic Designer", "Software Design Intern",
    "Apparel Technical Design Undergraduate Internship", "Marketing Intern",
  ]) {
    assert.equal(isDesignInternship(title), false, title);
  }
});

test("uses metro city and state together", () => {
  assert.equal(metroLocation("Portland, Oregon, United States"), "Portland, OR");
  assert.equal(metroLocation("Beaverton, OR (hybrid)"), "Beaverton, OR");
  assert.equal(metroLocation("Camas, Washington, United States"), "Camas, WA");
  assert.equal(metroLocation("Vancouver, WA"), "Vancouver, WA");
  assert.equal(metroLocation("Vancouver, British Columbia"), null);
  assert.equal(metroLocation("Portland, ME"), null);
  assert.equal(metroLocation("Remote, United States"), null);
});

function sourcesFixture(input) {
  const url = new URL(input);
  if (url.hostname === "careers.nike.com") {
    const page = url.pathname.endsWith("/2") ? 2 : 1;
    const job = {
      requisitionID: `R-${page}`,
      title: "Graphic Design Intern",
      originalURL: `graphic-design-intern/job/R-${page}`,
      locations: [{ cityState: page === 1 ? "Vancouver, British Columbia" : "Beaverton, Oregon" }],
    };
    const state = JSON.stringify({ jobSearch: { totalJob: 2, jobs: [job] } });
    return new Response(`<script>window.__PRELOAD_STATE__ = ${state};</script>`);
  }
  if (url.hostname === "careers.adidas-group.com") {
    return new Response(`<span id="search-result__count-number" data-count-to="1"></span>
      <ul id="jobs"><li class="job-list__job">
      <a class="job-list__inner" href="https://jobs.adidas-group.com/job/Portland-Design/42/?feedId=1"></a>
      <h3 class="job-list__title">Internship - Graphic Design</h3>
      <p class="job-list__facts">Portland, United States of America | Design</p>
      </li></ul>`);
  }
  if (url.hostname === "hp.wd5.myworkdayjobs.com") {
    if (url.pathname.endsWith("/jobs")) {
      return Response.json({ total: 1, jobPostings: [{
        title: "Brand Design Intern",
        locationsText: "2 Locations",
        externalPath: "/job/Palo-Alto/Brand-Design-Intern_101",
        bulletFields: ["101"],
      }] });
    }
    return Response.json({ jobPostingInfo: {
      location: "Palo Alto, California",
      additionalLocations: ["Vancouver, Washington"],
      jobReqId: "101",
    } });
  }
  if (url.hostname === "columbiasportswearcompany.wd5.myworkdayjobs.com") {
    return Response.json({ total: 0, jobPostings: [] });
  }
  assert.equal(url.hostname, "boards-api.greenhouse.io");
  return Response.json({ meta: { total: 0 }, jobs: [] });
}

test("combines live board shapes, follows pages and resolves secondary locations", async () => {
  const jobs = await fetchJobs(sourcesFixture);
  assert.deepEqual(jobs.map(({ id, location }) => [id, location]), [
    ["adidas:42", "Portland, OR"],
    ["HP:101", "Vancouver, WA"],
    ["Nike:R-2", "Beaverton, OR"],
  ]);
  assert.equal(jobs[0].url, "https://jobs.adidas-group.com/job/Portland-Design/42/");
});

test("a failed board cannot look like a successful empty check", async () => {
  await assert.rejects(
    fetchJobs((url) => String(url).includes("boards-api.greenhouse.io")
      ? new Response("", { status: 503 })
      : sourcesFixture(url)),
    /AKS Engineering & Forestry \(HTTP 503\)/,
  );
});

test("daily empty digest sends one embed with no mentions", async () => {
  const requests = [];
  await sendMessages([], "daily", "https://discord.com/api/webhooks/123/fake_token", (url, options) => {
    assert.equal(url.searchParams.get("wait"), "true");
    requests.push(JSON.parse(options.body));
    return Promise.resolve(new Response());
  });
  assert.equal(requests.length, 1);
  assert.equal(requests[0].embeds[0].title, "No roles available :( Come back tomorrow");
  assert.deepEqual(requests[0].allowed_mentions, { parse: [] });
});

test("new openings mention everyone and link to the role", () => {
  const job = {
    title: "Visual Design Intern", company: "Example", location: "Vancouver, WA",
    url: "https://example.com/job",
  };
  const [message] = buildMessages([job], "new");
  assert.equal(message.content, "@everyone\n# **NEW ROLE**");
  assert.deepEqual(message.allowed_mentions, { parse: ["everyone"] });
  assert.equal(message.embeds[0].url, job.url);
  assert.deepEqual(buildMessages([], "new"), []);
});
