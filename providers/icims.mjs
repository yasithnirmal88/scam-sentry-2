import { arrayOf, text, firstPresent, hostOf, hostMatchesSuffix } from './_util.mjs';

function postingFromBadge(job, context) {
  return {
    title: text(job.title ?? job.jobTitle ?? job.name),
    url: firstPresent(job.url ?? job.jobUri),
    company: firstPresent(job.company ?? job.organizationName, context.company, context.name),
    location: text(job.location ?? job.jobLocation),
    description: String(job.description ?? ''),
    postedAt: text(job.updatedOn ?? job.postedOn),
    externalId: text(job.jobId ?? job.id ?? job.uri),
  };
}

export default {
  id: 'icims',
  hosts: [],
  hostSuffixes: ['icims.com'],
  keyword: (url) => hostMatchesSuffix(url, ['icims.com']),
  assertEntryAllowed: (entry) => {
    const host = hostOf(entry?.url);
    if (!hostMatchesSuffix(entry?.url, ['icims.com'])) {
      throw new Error(`icims: url host must be anchored to .icims.com, got "${host}"`);
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
    const records = Array.isArray(data) ? data : arrayOf(data.searchedJobs ?? data.jobs ?? data.value ?? data.data);
    return records.map((job) => postingFromBadge(job, entry));
  },
};