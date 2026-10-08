import { arrayOf, text, firstPresent, hostOf } from './_util.mjs';

const API_BASE = 'https://api.nomado24.de/api/public/v1/jobs';

function postingFromJob(job, context) {
  return {
    title: firstPresent(job.title, job.jobTitle),
    url: firstPresent(job.url),
    company: firstPresent(job.companyName, job.company, context.company, context.name),
    location: text(job.location),
    description: String(job.description ?? ''),
    postedAt: text(job.publishedAt ?? job.posted_at),
    externalId: text(job.slug ?? job.id),
  };
}

export default {
  id: 'nomado24',
  hosts: ['api.nomado24.de'],
  keyword: (url) => hostOf(url).endsWith('nomado24.de'),
  detect: (entry) => {
    const endpoint = firstPresent(entry.endpoint, entry.key);
    const base = endpoint ? (endpoint.startsWith('http') ? endpoint : `https://${endpoint}`) : API_BASE;
    const url = new URL(base);
    if (entry.page) url.searchParams.set('page', String(entry.page));
    if (entry.limit) url.searchParams.set('perPage', String(entry.limit));
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