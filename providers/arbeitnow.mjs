import { arrayOf, text, firstPresent, hostOf } from './_util.mjs';

const API_BASE = 'https://www.arbeitnow.com/api/jobboard-api';

function postingFromJob(job, context) {
  return {
    title: firstPresent(job.title, job.position),
    url: firstPresent(job.url),
    company: firstPresent(job.company_name, context.company, context.name),
    location: text(job.location),
    description: String(job.description ?? ''),
    postedAt: text(job.created_at),
    externalId: text(job.slug ?? job.id),
  };
}

export default {
  id: 'arbeitnow',
  hosts: ['www.arbeitnow.com'],
  keyword: (url) => hostOf(url).endsWith('arbeitnow.com'),
  detect: (entry) => {
    const endpoint = firstPresent(entry.endpoint, entry.key);
    return { url: endpoint ? (endpoint.startsWith('http') ? endpoint : `https://${endpoint}`) : API_BASE };
  },
  async fetch(entry, ctx) {
    const seed = this.detect(entry);
    if (!seed) return [];
    const data = await ctx.fetchJson(seed.url, { redirect: 'error' });
    if (!data) return [];
    const records = Array.isArray(data) ? data : arrayOf(data.data ?? data.jobs);
    return records.map((job) => postingFromJob(job, entry));
  },
};