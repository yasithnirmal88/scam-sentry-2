import { arrayOf, text, firstPresent, hostOf } from './_util.mjs';

const API_BASE = 'https://jobicy.com/api/v2/remote-jobs';

function postingFromJob(job, context) {
  return {
    title: firstPresent(job.jobTitle, job.title),
    url: firstPresent(job.url, job.jobSlug ? `https://jobicy.com/jobs/${job.jobSlug}` : null),
    company: firstPresent(job.companyName, context.company, context.name),
    location: text(job.jobGeo),
    description: String(job.jobDescription ?? job.jobExcerpt ?? ''),
    postedAt: text(job.pubDate),
    externalId: text(job.id ?? job.jobSlug),
  };
}

export default {
  id: 'jobicy',
  hosts: ['jobicy.com'],
  keyword: (url) => hostOf(url).endsWith('jobicy.com'),
  detect: (entry) => {
    const endpoint = firstPresent(entry.endpoint, entry.key);
    const base = endpoint ? (endpoint.startsWith('http') ? endpoint : `https://${endpoint}`) : API_BASE;
    const url = new URL(base);
    if (entry.limit) url.searchParams.set('count', String(entry.limit));
    return { url: url.toString() };
  },
  async fetch(entry, ctx) {
    const seed = this.detect(entry);
    if (!seed) return [];
    const data = await ctx.fetchJson(seed.url, { redirect: 'error' });
    if (!data) return [];
    const records = Array.isArray(data) ? data : arrayOf(data.jobs ?? data.data);
    return records.map((job) => postingFromJob(job, entry));
  },
};