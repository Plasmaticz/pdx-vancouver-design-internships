import { load } from "cheerio";

const INTERN = /\b(?:interns?|internships?|co[- ]?op)\b/i;
const DESIGN = /\b(?:(?:graphics?|visual|brand(?: identity)?|creative|(?:visual )?communications?|motion|packaging|digital|print) design(?:er|s)?|graphics intern(?:ship)?|motion graphics|art direct(?:ion|or)|print and pattern|design(?: intern(?:ship)?)?\s*[-:,(]\s*(?:graphics?|brand|visual))\b/i;

const CITIES = [
  [/(?:^|\b)(Portland|Beaverton|Hillsboro|Tigard|Tualatin|Lake Oswego|Gresham|Milwaukie|Wilsonville|Oregon City|West Linn|Happy Valley|Troutdale|Sherwood|Forest Grove|Clackamas|Aloha|Fairview|Cornelius|Damascus)\s*(?:,\s*|\s+)(?:OR|Oregon)\b/i, "OR"],
  [/(?:^|\b)(Vancouver|Camas|Washougal|Ridgefield|Battle Ground|Brush Prairie|Hazel Dell|Salmon Creek|Woodland|La Center)\s*(?:,\s*|\s+)(?:WA|Washington)\b/i, "WA"],
];

export function metroLocation(value) {
  for (const [pattern, state] of CITIES) {
    const city = pattern.exec(value)?.[1];
    if (city) {
      const label = city.toLowerCase().replace(/\b\w/g, (letter) => letter.toUpperCase());
      return `${label}, ${state}`;
    }
  }
  return null;
}

export function isDesignInternship(title) {
  const normalized = title.replace(/[-\u2013\u2014/]+/g, " ").replace(/\s*&\s*/g, " and ");
  return INTERN.test(normalized) && (DESIGN.test(title) || DESIGN.test(normalized));
}

const PAGE_LIMIT = 25;

async function get(fetchImpl, url, options) {
  const response = await fetchImpl(url, { signal: AbortSignal.timeout(15_000), ...options });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return response;
}

function makeJob(company, id, title, location, href) {
  if (!location || !isDesignInternship(title)) return [];
  const url = new URL(href);
  if (!id || url.protocol !== "https:") throw new Error("Invalid job link or ID");
  url.search = "";
  url.hash = "";
  return [{ id: `${company}:${id}`, company, title: title.trim(), location, url: url.href }];
}

function requireCount(total, rows) {
  if (!Number.isInteger(total) || total < 0 || !Array.isArray(rows)) {
    throw new Error("Unexpected search result");
  }
}

function addPage(seen, rows, idFor) {
  for (const row of rows) seen.add(idFor(row));
}

function requireProgress(seen, before, total, page) {
  if (seen.size >= total) return;
  if (seen.size === before || page >= PAGE_LIMIT) {
    throw new Error("Search pagination did not finish");
  }
}

async function nike(fetchImpl) {
  const site = "https://careers.nike.com";
  const query = "?keyword=intern";
  const seen = new Set();
  const jobs = [];
  for (let page = 1; ; page += 1) {
    const path = page === 1 ? "/jobs" : `/jobs/page/${page}`;
    const html = await (await get(fetchImpl, site + path + query)).text();
    const state = html.match(/window\.__PRELOAD_STATE__\s*=\s*(\{[^\r\n]+\})/);
    const result = state && JSON.parse(state[1]).jobSearch;
    requireCount(result?.totalJob, result?.jobs);
    const before = seen.size;
    addPage(seen, result.jobs, (job) => job.requisitionID);
    for (const job of result.jobs) {
      const location = job.locations?.map((item) => metroLocation(item.cityState ?? "")).find(Boolean);
      jobs.push(...makeJob("Nike", job.requisitionID, job.title, location, new URL(job.originalURL, site)));
    }
    if (seen.size >= result.totalJob) return jobs;
    requireProgress(seen, before, result.totalJob, page);
  }
}

async function adidas(fetchImpl) {
  const query = "https://careers.adidas-group.com/jobs?keywords=Portland&locale=en&location=%5B%5D";
  const seen = new Set();
  const jobs = [];
  let offset = 0;
  for (let page = 1; ; page += 1) {
    const html = await (await get(fetchImpl, `${query}&offset=${offset}`)).text();
    const $ = load(html);
    const count = $("#search-result__count-number").attr("data-count-to");
    const cards = $("#jobs .job-list__job").toArray();
    const total = count?.match(/^\d+$/) ? Number(count) : NaN;
    requireCount(total, cards);
    const before = seen.size;
    for (const card of cards) {
      const href = $(card).find("a.job-list__inner").attr("href");
      const title = $(card).find(".job-list__title").text().trim();
      const facts = $(card).find(".job-list__facts").text().trim().split("|")[0].trim();
      const id = href && new URL(href).pathname.match(/\/(\d+)\/?$/)?.[1];
      if (!id || !title) throw new Error("Invalid adidas job card");
      seen.add(id);
      const location = /^Portland, United States of America$/i.test(facts)
        ? "Portland, OR"
        : metroLocation(facts);
      jobs.push(...makeJob("adidas", id, title, location, href));
    }
    if (seen.size >= total) return jobs;
    requireProgress(seen, before, total, page);
    offset += cards.length;
  }
}

const STATE_IDS = ["6fcc4198762c4a7c807486c849fe94dd", "de9b48948ef8421db97ddf4ea206e931"];
const WORKDAY = [
  ["Columbia Sportswear", "columbiasportswearcompany", "CSC_Careers", "locationRegionStateProvince"],
  ["HP", "hp", "ExternalCareerSite", "Location_Region_State_Province"],
];

async function workday(fetchImpl, [company, tenant, board, facet]) {
  const site = `https://${tenant}.wd5.myworkdayjobs.com`;
  const api = `${site}/wday/cxs/${tenant}/${board}`;
  const seen = new Set();
  const jobs = [];
  let offset = 0;
  for (let page = 1; ; page += 1) {
    const response = await get(fetchImpl, `${api}/jobs`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ appliedFacets: { [facet]: STATE_IDS }, limit: 20, offset, searchText: "intern" }),
    });
    const { total, jobPostings } = await response.json();
    requireCount(total, jobPostings);
    const before = seen.size;
    for (const posting of jobPostings) {
      if (!posting.externalPath?.startsWith("/job/") || !posting.title) {
        throw new Error("Invalid Workday job card");
      }
      seen.add(posting.externalPath);
      if (!isDesignInternship(posting.title)) continue;
      let location = metroLocation(posting.locationsText ?? "");
      let id = posting.bulletFields?.[0] ?? posting.externalPath;
      if (!location) {
        const detail = await (await get(fetchImpl, api + posting.externalPath)).json();
        const info = detail.jobPostingInfo;
        if (!info) throw new Error("Missing Workday job details");
        id = info.jobReqId ?? id;
        const locations = [info.location, ...(info.additionalLocations ?? [])];
        location = locations.map((item) => metroLocation(item ?? "")).find(Boolean);
        if (!location && company === "Columbia Sportswear" && locations.includes("Corporate Headquarters")) {
          location = "Portland, OR";
        }
      }
      jobs.push(...makeJob(company, id, posting.title, location, site + "/" + board + posting.externalPath));
    }
    if (seen.size >= total) return jobs;
    requireProgress(seen, before, total, page);
    offset += jobPostings.length;
  }
}

async function aks(fetchImpl) {
  const url = "https://boards-api.greenhouse.io/v1/boards/aksengineeringforestryllc/jobs";
  const { jobs, meta } = await (await get(fetchImpl, url)).json();
  requireCount(meta?.total, jobs);
  if (meta.total !== jobs.length) throw new Error("Incomplete Greenhouse job list");
  return jobs.flatMap((job) =>
    makeJob("AKS Engineering & Forestry", job.id, job.title, metroLocation(job.location?.name ?? ""), job.absolute_url),
  );
}

export async function fetchJobs(fetchImpl = fetch) {
  const sources = [
    ["Nike", () => nike(fetchImpl)],
    ["adidas", () => adidas(fetchImpl)],
    ...WORKDAY.map((source) => [source[0], () => workday(fetchImpl, source)]),
    ["AKS Engineering & Forestry", () => aks(fetchImpl)],
  ];
  const results = await Promise.allSettled(sources.map(([, read]) => read()));
  const failures = results.flatMap((result, i) =>
    result.status === "rejected" ? [`${sources[i][0]} (${result.reason.message})`] : [],
  );
  if (failures.length) throw new Error(`Could not check all job boards: ${failures.join(", ")}`);
  const jobs = results.flatMap((result, i) => {
    console.log(`${sources[i][0]}: ${result.value.length} matches`);
    return result.value;
  });
  return [...new Map(jobs.map((job) => [job.id, job])).values()].sort(
    (a, b) => a.company.localeCompare(b.company) || a.title.localeCompare(b.title) || a.id.localeCompare(b.id),
  );
}
