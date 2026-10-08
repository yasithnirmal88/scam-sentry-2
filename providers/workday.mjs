import { arrayOf, text, firstPresent, hostOf, hostMatchesSuffix } from './_util.mjs';

function postingFromJob(job, context) {
  return {
    title: text(job.title ?? job.name ?? job.text),
    url: firstPresent(job.url ?? job.externalPath),
    company: firstPresent(job.company ?? job.organization, context.company, context.name),
    location: text(job.location ?? job.cities ?? job.country),
    description: String(job.description ?? job.externalFieldText ?? ''),
    postedAt: firstPresent(job.postedOn, job.dateCreated),
    externalId: text(job.externalPath ?? job.url),
  };
}

export default {
  id: 'workday',
  hosts: [],
  hostSuffixes: ['myworkdayjobs.com', 'wd1.myworkdayjobs.com'],
  keyword: (url) => hostMatchesSuffix(url, ['myworkdayjobs.com']),
  assertEntryAllowed: (entry) => {
    const host = hostOf(entry?.url);
    if (!hostMatchesSuffix(entry?.url, ['myworkdayjobs.com'])) {
      throw new Error(`workday: url host must be anchored to .myworkdayjobs.com, got "${host}"`);
    }
  },
  detect: (entry) => {
    const url = firstPresent(entry.url, entry.board);
    return url ? { url } : null;
  },
  async fetch(entry, ctx) {
    const seed = this.detect(entry);
    if (!seed) return [];
    let url = seed.url;
    if (!/^https?:\/\//i.test(url)) url = `https://${url}`;
    let data;
    try {
      data = await ctx.fetchJson(url, { redirect: 'error' });
    } catch {
      return [];
    }
    if (!data) return [];
    const records = Array.isArray(data) ? data : arrayOf(data.jobPostings ?? data.jobs ?? data.value ?? data.data);
    return records.map((job) => postingFromJob(job, entry));
  },
};